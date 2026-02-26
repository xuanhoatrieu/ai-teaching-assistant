import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    UseGuards,
    Request,
    Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { TextNormalizerService } from './text-normalizer.service';
import {
    CreateDictionaryEntryDto,
    UpdateDictionaryEntryDto,
    NormalizeTextDto,
    ImportCsvDto,
} from './dto';

// ========================
// Admin Routes
// ========================

@Controller('admin/tts-dictionaries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminTTSDictionaryController {
    constructor(private readonly service: TextNormalizerService) { }

    @Get()
    async getSystemDictionaries() {
        return this.service.getSystemDictionaries();
    }

    @Post()
    async createSystemEntry(@Body() dto: CreateDictionaryEntryDto) {
        return this.service.createSystemEntry(dto);
    }

    @Put(':id')
    async updateEntry(
        @Param('id') id: string,
        @Body() dto: UpdateDictionaryEntryDto,
    ) {
        return this.service.updateEntry(id, dto);
    }

    @Delete(':id')
    async deleteEntry(@Param('id') id: string) {
        return this.service.deleteEntry(id);
    }

    @Post('import-csv')
    async importCsv(@Body() dto: ImportCsvDto) {
        return this.service.importCsv(dto.csvContent, dto.type as 'acronym' | 'word', 'system');
    }

    @Get('export-csv')
    async exportCsv(@Res() res: Response) {
        const csv = await this.service.exportCsv('system');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="tts-dictionaries-system.csv"');
        res.send(csv);
    }
}

// ========================
// User Routes
// ========================

@Controller('tts-dictionaries')
@UseGuards(JwtAuthGuard)
export class UserTTSDictionaryController {
    constructor(private readonly service: TextNormalizerService) { }

    /** Get merged dictionaries (system readonly + user editable) */
    @Get()
    async getMergedDictionaries(@Request() req) {
        const systemEntries = await this.service.getSystemDictionaries();
        const userEntries = await this.service.getUserDictionaries(req.user.id);
        return {
            system: systemEntries,
            user: userEntries,
        };
    }

    /** Add personal dictionary entry (rejects if exists in system) */
    @Post()
    async createUserEntry(
        @Request() req,
        @Body() dto: CreateDictionaryEntryDto,
    ) {
        return this.service.createUserEntry(req.user.id, dto);
    }

    @Put(':id')
    async updateEntry(
        @Param('id') id: string,
        @Body() dto: UpdateDictionaryEntryDto,
    ) {
        return this.service.updateEntry(id, dto);
    }

    @Delete(':id')
    async deleteEntry(@Param('id') id: string) {
        return this.service.deleteEntry(id);
    }

    /** Normalize text using merged dictionaries */
    @Post('normalize')
    async normalizeText(@Request() req, @Body() dto: NormalizeTextDto) {
        const normalizedText = await this.service.normalizeForTTS(dto.text, {
            userId: req.user.id,
            enableTransliteration: dto.enableTransliteration,
        });
        return {
            original_text: dto.text,
            normalized_text: normalizedText,
            changes_made: normalizedText !== dto.text,
        };
    }
}
