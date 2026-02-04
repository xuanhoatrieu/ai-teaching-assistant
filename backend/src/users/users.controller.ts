import {
    Controller,
    Get,
    Patch,
    Delete,
    Param,
    Body,
    UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class UsersController {
    constructor(private prisma: PrismaService) { }

    @Get()
    async findAll() {
        return this.prisma.user.findMany({
            select: {
                id: true,
                email: true,
                role: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    @Get(':id')
    async findOne(@Param('id') id: string) {
        return this.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                role: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }

    @Patch(':id/role')
    async updateRole(
        @Param('id') id: string,
        @Body() body: { role: UserRole },
    ) {
        return this.prisma.user.update({
            where: { id },
            data: { role: body.role },
            select: {
                id: true,
                email: true,
                role: true,
            },
        });
    }

    @Delete(':id')
    async remove(@Param('id') id: string) {
        return this.prisma.user.delete({
            where: { id },
            select: {
                id: true,
                email: true,
            },
        });
    }
}
