import {
    Injectable,
    Logger,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { OutlineParserService } from './outline-parser.service';
import { LessonStatus } from '@prisma/client';

@Injectable()
export class LessonsService {
    private readonly logger = new Logger(LessonsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly outlineParser: OutlineParserService,
    ) { }

    async create(subjectId: string, userId: string, dto: CreateLessonDto) {
        // Verify subject ownership
        const subject = await this.prisma.subject.findUnique({
            where: { id: subjectId },
        });

        if (!subject) {
            throw new NotFoundException(`Subject with ID ${subjectId} not found`);
        }

        if (subject.userId !== userId) {
            throw new ForbiddenException('You do not have access to this subject');
        }

        return this.prisma.lesson.create({
            data: {
                subjectId,
                title: dto.title,
                outlineRaw: dto.outlineRaw,
                status: LessonStatus.DRAFT,
            },
        });
    }

    async findAllBySubject(subjectId: string, userId: string) {
        // Verify subject ownership
        const subject = await this.prisma.subject.findUnique({
            where: { id: subjectId },
        });

        if (!subject) {
            throw new NotFoundException(`Subject with ID ${subjectId} not found`);
        }

        if (subject.userId !== userId) {
            throw new ForbiddenException('You do not have access to this subject');
        }

        return this.prisma.lesson.findMany({
            where: { subjectId },
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: { generatedContents: true },
                },
            },
        });
    }

    async findOne(id: string, userId: string) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id },
            include: {
                subject: true,
                generatedContents: {
                    orderBy: { createdAt: 'desc' },
                },
            },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson with ID ${id} not found`);
        }

        if (lesson.subject.userId !== userId) {
            throw new ForbiddenException('You do not have access to this lesson');
        }

        return lesson;
    }

    async update(id: string, userId: string, dto: UpdateLessonDto) {
        await this.findOne(id, userId); // Check ownership
        return this.prisma.lesson.update({
            where: { id },
            data: dto,
        });
    }

    async remove(id: string, userId: string) {
        await this.findOne(id, userId); // Check ownership
        return this.prisma.lesson.delete({
            where: { id },
        });
    }

    async uploadOutline(
        id: string,
        userId: string,
        file: Express.Multer.File,
    ) {
        const lesson = await this.findOne(id, userId);

        // Parse the file
        const content = await this.outlineParser.parseFile(
            file.buffer,
            file.mimetype,
            file.originalname,
        );

        // Validate
        const validation = this.outlineParser.validateOutline(content);
        if (!validation.valid) {
            throw new BadRequestException(validation.error);
        }

        // Update lesson with parsed outline
        return this.prisma.lesson.update({
            where: { id },
            data: {
                outlineRaw: content,
                status: LessonStatus.DRAFT,
            },
        });
    }

    async triggerGeneration(id: string, userId: string) {
        const lesson = await this.findOne(id, userId);

        if (!lesson.outlineRaw) {
            throw new BadRequestException('Lesson has no outline. Upload an outline first.');
        }

        // Update status to PROCESSING
        await this.prisma.lesson.update({
            where: { id },
            data: { status: LessonStatus.PROCESSING },
        });

        // TODO: Queue job with BullMQ
        // For now, return the lesson with processing status
        this.logger.log(`Generation triggered for lesson ${id}`);

        return {
            message: 'Generation started',
            lessonId: id,
            status: LessonStatus.PROCESSING,
        };
    }

    async getGenerationStatus(id: string, userId: string) {
        const lesson = await this.findOne(id, userId);

        return {
            lessonId: id,
            status: lesson.status,
            generatedContents: lesson.generatedContents.map(gc => ({
                id: gc.id,
                type: gc.type,
                status: gc.status,
                fileUrl: gc.fileUrl,
                createdAt: gc.createdAt,
            })),
        };
    }
}
