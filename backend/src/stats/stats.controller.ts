import {
    Controller,
    Get,
    UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('admin/stats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class StatsController {
    constructor(private prisma: PrismaService) { }

    @Get()
    async getStats() {
        const [totalUsers, totalPrompts, activePrompts, totalTTSProviders, totalLessons, totalSubjects] = await Promise.all([
            this.prisma.user.count(),
            this.prisma.prompt.count(),
            this.prisma.prompt.count({ where: { isActive: true } }),
            this.prisma.tTSProvider.count(),
            this.prisma.lesson.count(),
            this.prisma.subject.count(),
        ]);

        return {
            totalUsers,
            totalPrompts,
            activePrompts,
            totalTTSProviders,
            totalLessons,
            totalSubjects,
        };
    }
}
