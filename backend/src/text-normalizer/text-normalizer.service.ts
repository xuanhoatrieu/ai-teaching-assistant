import {
    Injectable,
    Logger,
    BadRequestException,
    NotFoundException,
    ConflictException,
    OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface NormalizeOptions {
    userId: string;
    subjectId?: string;
    enableTransliteration?: boolean;
}

interface DictEntry {
    original: string;
    replacement: string;
}

@Injectable()
export class TextNormalizerService implements OnModuleInit {
    private readonly logger = new Logger(TextNormalizerService.name);
    private readonly pptxServiceUrl: string;

    constructor(private readonly prisma: PrismaService) {
        this.pptxServiceUrl =
            process.env.PPTX_SERVICE_URL || 'http://localhost:3002';
    }

    async onModuleInit() {
        // Push all system dictionaries to Python service cache on startup
        try {
            await this.reloadPythonDictionaries();
        } catch (error) {
            this.logger.warn(`Failed to reload dicts on startup: ${error.message}`);
        }
    }

    /**
     * Push all system dictionary entries to Python service cache.
     * Called on startup and after any admin dictionary change.
     */
    async reloadPythonDictionaries() {
        const systemEntries = await this.getSystemDictionaries();
        const acronyms = systemEntries
            .filter((e) => e.type === 'acronym')
            .map((e) => ({ original: e.original, replacement: e.replacement }));
        const words = systemEntries
            .filter((e) => e.type === 'word')
            .map((e) => ({ original: e.original, replacement: e.replacement }));

        const response = await fetch(`${this.pptxServiceUrl}/reload-dictionaries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acronyms, words }),
        });

        if (!response.ok) {
            throw new Error(`Reload failed: ${response.status}`);
        }

        const result = await response.json();
        this.logger.log(
            `Dictionaries reloaded to Python: ${result.acronyms_count} acronyms, ${result.words_count} words`,
        );
    }

    // ========================
    // Normalize
    // ========================

    /**
     * Normalize text for TTS using VietNormalizer (Python service).
     * System dicts are cached in Python. Only user overrides are sent per-request.
     */
    async normalizeForTTS(
        text: string,
        options: NormalizeOptions,
    ): Promise<string> {
        const { userId, enableTransliteration = true } = options;

        // Only get USER-specific overrides (system entries are already cached in Python)
        const userEntries = await this.getUserDictionaries(userId);

        const userAcronyms: DictEntry[] = userEntries
            .filter((d) => d.type === 'acronym')
            .map((d) => ({ original: d.original, replacement: d.replacement }));

        const userWords: DictEntry[] = userEntries
            .filter((d) => d.type === 'word')
            .map((d) => ({ original: d.original, replacement: d.replacement }));

        try {
            const response = await fetch(`${this.pptxServiceUrl}/normalize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    enable_transliteration: enableTransliteration,
                    custom_acronyms: userAcronyms.length > 0 ? userAcronyms : null,
                    custom_words: userWords.length > 0 ? userWords : null,
                }),
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Python normalizer error: ${response.status} - ${error}`);
            }

            const result = await response.json();
            this.logger.debug(
                `Normalized: changes_made=${result.changes_made}, ` +
                `original_length=${text.length}, normalized_length=${result.normalized_text.length}`,
            );
            return result.normalized_text;
        } catch (error) {
            this.logger.error(`Normalize failed: ${error.message}`);
            throw error;
        }
    }

    // ========================
    // Dictionary CRUD
    // ========================

    /** Get all system dictionaries */
    async getSystemDictionaries() {
        return this.prisma.tTSDictionary.findMany({
            where: { scope: 'system', userId: null },
            orderBy: [{ type: 'asc' }, { original: 'asc' }],
        });
    }

    /** Get user's personal dictionaries */
    async getUserDictionaries(userId: string) {
        return this.prisma.tTSDictionary.findMany({
            where: { scope: 'user', userId },
            orderBy: [{ type: 'asc' }, { original: 'asc' }],
        });
    }

    /** Get merged dictionaries (system + user). System entries are readonly for user. */
    async getMergedDictionaries(userId: string) {
        const [system, user] = await Promise.all([
            this.getSystemDictionaries(),
            this.getUserDictionaries(userId),
        ]);

        // System first, then user entries (no duplicates since unique constraint prevents them)
        return [...system, ...user];
    }

    /** Create a system dictionary entry (admin only). Reloads Python cache after. */
    async createSystemEntry(data: { type: string; original: string; replacement: string }) {
        // Check if already exists
        const existing = await this.prisma.tTSDictionary.findFirst({
            where: {
                type: data.type,
                original: data.original,
                scope: 'system',
                userId: null,
            },
        });

        if (existing) {
            throw new ConflictException(
                `System entry already exists: ${data.type}/${data.original}`,
            );
        }

        const entry = await this.prisma.tTSDictionary.create({
            data: {
                type: data.type,
                original: data.original,
                replacement: data.replacement,
                scope: 'system',
                userId: null,
            },
        });

        // Reload Python cache
        this.reloadPythonDictionaries().catch((e) =>
            this.logger.warn(`Reload after create failed: ${e.message}`),
        );

        return entry;
    }

    /** Create a user dictionary entry (rejects if exists in system) */
    async createUserEntry(
        userId: string,
        data: { type: string; original: string; replacement: string },
    ) {
        // Check if exists in system dictionary
        const systemEntry = await this.prisma.tTSDictionary.findFirst({
            where: {
                type: data.type,
                original: data.original,
                scope: 'system',
                userId: null,
            },
        });

        if (systemEntry) {
            throw new ConflictException(
                `Từ "${data.original}" đã có trong từ điển hệ thống (đọc: "${systemEntry.replacement}")`,
            );
        }

        // Check if user already has this entry
        const userEntry = await this.prisma.tTSDictionary.findFirst({
            where: {
                type: data.type,
                original: data.original,
                scope: 'user',
                userId,
            },
        });

        if (userEntry) {
            throw new ConflictException(
                `Bạn đã thêm từ "${data.original}" rồi`,
            );
        }

        return this.prisma.tTSDictionary.create({
            data: {
                type: data.type,
                original: data.original,
                replacement: data.replacement,
                scope: 'user',
                userId,
            },
        });
    }

    /** Update a dictionary entry. Reloads Python cache if system entry. */
    async updateEntry(id: string, data: { original?: string; replacement?: string }) {
        const entry = await this.prisma.tTSDictionary.findUnique({ where: { id } });
        if (!entry) {
            throw new NotFoundException(`Dictionary entry ${id} not found`);
        }
        const updated = await this.prisma.tTSDictionary.update({
            where: { id },
            data,
        });

        if (entry.scope === 'system') {
            this.reloadPythonDictionaries().catch((e) =>
                this.logger.warn(`Reload after update failed: ${e.message}`),
            );
        }

        return updated;
    }

    /** Delete a dictionary entry. Reloads Python cache if system entry. */
    async deleteEntry(id: string) {
        const entry = await this.prisma.tTSDictionary.findUnique({ where: { id } });
        if (!entry) {
            throw new NotFoundException(`Dictionary entry ${id} not found`);
        }
        const deleted = await this.prisma.tTSDictionary.delete({ where: { id } });

        if (entry.scope === 'system') {
            this.reloadPythonDictionaries().catch((e) =>
                this.logger.warn(`Reload after delete failed: ${e.message}`),
            );
        }

        return deleted;
    }

    // ========================
    // Import / Export CSV
    // ========================

    /** Import entries from CSV text. Format: "original,replacement\n..." */
    async importCsv(
        csvContent: string,
        type: 'acronym' | 'word',
        scope: 'system' | 'user',
        userId?: string,
    ) {
        const lines = csvContent.trim().split('\n');
        // Skip header if present
        const startIdx = lines[0]?.toLowerCase().includes('original') ? 1 : 0;

        let created = 0;
        let skipped = 0;

        for (let i = startIdx; i < lines.length; i++) {
            const parts = lines[i].split(',').map((s) => s.trim());
            if (parts.length < 2 || !parts[0] || !parts[1]) continue;

            const [original, replacement] = parts;

            try {
                const existing = await this.prisma.tTSDictionary.findFirst({
                    where: {
                        type,
                        original,
                        scope,
                        userId: scope === 'system' ? null : userId,
                    },
                });

                if (existing) {
                    await this.prisma.tTSDictionary.update({
                        where: { id: existing.id },
                        data: { replacement },
                    });
                } else {
                    await this.prisma.tTSDictionary.create({
                        data: {
                            type,
                            original,
                            replacement,
                            scope,
                            userId: scope === 'system' ? null : userId,
                        },
                    });
                }
                created++;
            } catch {
                skipped++;
            }
        }

        return { created, skipped, total: lines.length - startIdx };
    }

    /** Export dictionary entries as CSV text */
    async exportCsv(scope: 'system' | 'user', userId?: string): Promise<string> {
        const entries = await this.prisma.tTSDictionary.findMany({
            where: {
                scope,
                userId: scope === 'system' ? null : userId,
            },
            orderBy: [{ type: 'asc' }, { original: 'asc' }],
        });

        const header = 'type,original,replacement';
        const rows = entries.map(
            (e) => `${e.type},${e.original},${e.replacement}`,
        );
        return [header, ...rows].join('\n');
    }
}
