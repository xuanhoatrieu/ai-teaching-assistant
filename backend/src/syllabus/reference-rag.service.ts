import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderService } from '../ai/ai-provider.service';

export interface RetrievedChunk {
    fileName: string;
    content: string;
    score: number;
}

const MAX_CHUNK_CHARS = 1500;

@Injectable()
export class ReferenceRagService {
    private readonly logger = new Logger(ReferenceRagService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly aiProvider: AiProviderService,
    ) {}

    /**
     * Split markdown into chunks of ~MAX_CHUNK_CHARS, breaking on headings and
     * paragraph boundaries so each chunk stays semantically coherent.
     */
    private chunkMarkdown(markdown: string): string[] {
        const blocks = markdown.split(/\n(?=#{1,6}\s)/g); // split before headings
        const chunks: string[] = [];

        for (const block of blocks) {
            const trimmed = block.trim();
            if (!trimmed) continue;

            if (trimmed.length <= MAX_CHUNK_CHARS) {
                chunks.push(trimmed);
                continue;
            }

            // Block too big — split further on paragraph boundaries.
            const paragraphs = trimmed.split(/\n\s*\n/);
            let current = '';
            for (const p of paragraphs) {
                if ((current + '\n\n' + p).length > MAX_CHUNK_CHARS && current) {
                    chunks.push(current.trim());
                    current = p;
                } else {
                    current = current ? `${current}\n\n${p}` : p;
                }
            }
            if (current.trim()) chunks.push(current.trim());
        }

        return chunks.filter((c) => c.length > 0);
    }

    /**
     * Ensure a reference's chunks are embedded with the given model.
     * Cached: skips if chunks already exist for this (reference, model).
     */
    async indexReference(referenceId: string, embeddingModel: string, userId?: string): Promise<number> {
        const ref = await this.prisma.syllabusReference.findUnique({
            where: { id: referenceId },
            select: { id: true, markdownContent: true, fileName: true },
        });
        if (!ref?.markdownContent) return 0;

        // Already indexed with this model?
        const existing = await this.prisma.syllabusReferenceChunk.findFirst({
            where: { referenceId, embeddingModel },
            select: { id: true },
        });
        if (existing) {
            const count = await this.prisma.syllabusReferenceChunk.count({ where: { referenceId, embeddingModel } });
            this.logger.log(`[RAG] ${ref.fileName} already indexed (${count} chunks, model=${embeddingModel})`);
            return count;
        }

        // Re-embedding with a different model — clear stale chunks for this reference.
        await this.prisma.syllabusReferenceChunk.deleteMany({ where: { referenceId } });

        const chunks = this.chunkMarkdown(ref.markdownContent);
        if (chunks.length === 0) return 0;

        this.logger.log(`[RAG] Embedding ${chunks.length} chunks for ${ref.fileName} (model=${embeddingModel})`);
        const vectors = await this.aiProvider.embed(chunks, embeddingModel, userId);

        await this.prisma.syllabusReferenceChunk.createMany({
            data: chunks.map((content, i) => ({
                referenceId,
                chunkIndex: i,
                content,
                embedding: vectors[i] || [],
                embeddingModel,
            })),
        });

        return chunks.length;
    }

    private cosine(a: number[], b: number[]): number {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Retrieve the top-k most relevant chunks across a syllabus's references.
     */
    async retrieve(
        syllabusId: string,
        query: string,
        embeddingModel: string,
        userId?: string,
        topK = 10,
    ): Promise<RetrievedChunk[]> {
        const chunks = await this.prisma.syllabusReferenceChunk.findMany({
            where: { embeddingModel, reference: { syllabusId, status: 'done' } },
            select: { content: true, embedding: true, reference: { select: { fileName: true } } },
        });
        if (chunks.length === 0) return [];

        const [queryVec] = await this.aiProvider.embed([query], embeddingModel, userId);
        if (!queryVec) return [];

        return chunks
            .map((c) => ({
                fileName: c.reference.fileName,
                content: c.content,
                score: this.cosine(queryVec, c.embedding),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }
}
