import {
    Controller,
    Get,
    Put,
    Body,
    UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

interface UpdateSettingsDto {
    geminiApiKey?: string;
    encryptionKey?: string;
}

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class SettingsController {
    constructor(private prisma: PrismaService) { }

    @Get()
    async getSettings() {
        // Get settings from environment/config - for now return masked values
        const hasGeminiKey = !!process.env.GEMINI_API_KEY;
        const hasEncryptionKey = !!process.env.ENCRYPTION_KEY;

        return {
            geminiApiKey: hasGeminiKey ? '••••••••••••••••' : '',
            encryptionKey: hasEncryptionKey ? '••••••••••••••••' : '',
            hasGeminiKey,
            hasEncryptionKey,
        };
    }

    @Put()
    async updateSettings(@Body() dto: UpdateSettingsDto) {
        // In a real app, these would be stored encrypted in database or secure vault
        // For now, just validate and acknowledge
        const updates: string[] = [];

        if (dto.geminiApiKey && dto.geminiApiKey.length > 0) {
            // Validate Gemini API key format (should start with 'AI')
            if (dto.geminiApiKey.startsWith('AI') || dto.geminiApiKey.length >= 20) {
                updates.push('Gemini API Key');
                // In production: store encrypted in database or environment
                process.env.GEMINI_API_KEY = dto.geminiApiKey;
            }
        }

        if (dto.encryptionKey && dto.encryptionKey.length >= 16) {
            updates.push('Encryption Key');
            // In production: store securely
            process.env.ENCRYPTION_KEY = dto.encryptionKey;
        }

        return {
            success: true,
            message: updates.length > 0
                ? `Updated: ${updates.join(', ')}`
                : 'No changes made',
            updatedFields: updates,
        };
    }
}
