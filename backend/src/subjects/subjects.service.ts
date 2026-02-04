import {
    Injectable,
    Logger,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

@Injectable()
export class SubjectsService {
    private readonly logger = new Logger(SubjectsService.name);

    constructor(private readonly prisma: PrismaService) { }

    async create(userId: string, dto: CreateSubjectDto) {
        this.logger.log(`Creating subject for user ${userId}`);
        return this.prisma.subject.create({
            data: {
                userId,
                name: dto.name,
                description: dto.description,
                // Role definition fields
                institutionType: dto.institutionType,
                expertiseArea: dto.expertiseArea,
                courseName: dto.courseName,
                targetAudience: dto.targetAudience,
                majorName: dto.majorName,
                additionalContext: dto.additionalContext,
            },
        });
    }

    async findAll(userId: string) {
        return this.prisma.subject.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: { lessons: true },
                },
            },
        });
    }

    async findOne(id: string, userId: string) {
        const subject = await this.prisma.subject.findUnique({
            where: { id },
            include: {
                lessons: {
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        title: true,
                        status: true,
                        createdAt: true,
                    },
                },
            },
        });

        if (!subject) {
            throw new NotFoundException(`Subject with ID ${id} not found`);
        }

        if (subject.userId !== userId) {
            throw new ForbiddenException('You do not have access to this subject');
        }

        return subject;
    }

    async update(id: string, userId: string, dto: UpdateSubjectDto) {
        await this.findOne(id, userId); // Check ownership
        return this.prisma.subject.update({
            where: { id },
            data: dto,
        });
    }

    async remove(id: string, userId: string) {
        await this.findOne(id, userId); // Check ownership
        return this.prisma.subject.delete({
            where: { id },
        });
    }
}
