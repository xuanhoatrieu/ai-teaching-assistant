import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    UseGuards,
} from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { CreatePromptDto } from './dto/create-prompt.dto';
import { UpdatePromptDto } from './dto/update-prompt.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller()
export class PromptsController {
    constructor(private promptsService: PromptsService) { }

    // ==================== ADMIN ROUTES ====================

    @Get('admin/prompts')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    findAll() {
        return this.promptsService.findAll();
    }

    @Get('admin/prompts/:id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    findOne(@Param('id') id: string) {
        return this.promptsService.findOne(id);
    }

    @Post('admin/prompts')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    create(@Body() dto: CreatePromptDto) {
        return this.promptsService.create(dto);
    }

    @Patch('admin/prompts/:id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    update(@Param('id') id: string, @Body() dto: UpdatePromptDto) {
        return this.promptsService.update(id, dto);
    }

    @Delete('admin/prompts/:id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    remove(@Param('id') id: string) {
        return this.promptsService.remove(id);
    }

    @Post('admin/prompts/seed')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    seedPrompts() {
        return this.promptsService.seedV2();
    }

    // ==================== USER ROUTES ====================

    @Get('prompts/active/:slug')
    @UseGuards(JwtAuthGuard)
    findActiveBySlug(@Param('slug') slug: string) {
        return this.promptsService.findActiveBySlug(slug);
    }

    // ==================== DEV ONLY (remove in production) ====================
    @Post('dev/seed-prompts')
    devSeedPrompts() {
        return this.promptsService.seedV2();
    }
}
