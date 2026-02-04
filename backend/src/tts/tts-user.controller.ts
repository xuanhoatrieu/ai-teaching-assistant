import {
    Controller,
    Get,
    Post,
    Delete,
    Body,
    Param,
    UseGuards,
    Res,
    StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { TTSService } from './tts.service';
import { GenerateAudioDto } from './dto/generate-audio.dto';
import { CreateUserTTSConfigDto } from './dto/user-tts-config.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('tts')
@UseGuards(JwtAuthGuard)
export class TTSUserController {
    constructor(private readonly ttsService: TTSService) { }

    // ========== Provider Discovery ==========

    @Get('providers')
    getActiveProviders() {
        return this.ttsService.findActiveProviders();
    }

    @Get('voices')
    getVoices(@CurrentUser() user: { id: string }) {
        return this.ttsService.getAvailableVoices(user.id);
    }

    @Get('all-voices')
    getAllVoices() {
        return this.ttsService.getAllProviderVoices();
    }

    // ========== User Configuration ==========

    @Get('config')
    getMyConfigs(@CurrentUser() user: { id: string }) {
        return this.ttsService.getUserConfigs(user.id);
    }

    @Post('config')
    createOrUpdateConfig(
        @CurrentUser() user: { id: string },
        @Body() dto: CreateUserTTSConfigDto,
    ) {
        return this.ttsService.createOrUpdateUserConfig(user.id, dto);
    }

    @Delete('config/:providerId')
    deleteConfig(
        @CurrentUser() user: { id: string },
        @Param('providerId') providerId: string,
    ) {
        return this.ttsService.deleteUserConfig(user.id, providerId);
    }

    @Get('config/:providerId/test')
    testConnection(
        @CurrentUser() user: { id: string },
        @Param('providerId') providerId: string,
    ) {
        return this.ttsService.testProviderConnection(user.id, providerId);
    }

    // ========== Audio Generation ==========

    @Post('generate')
    async generateAudio(
        @CurrentUser() user: { id: string },
        @Body() dto: GenerateAudioDto,
        @Res({ passthrough: true }) res: Response,
    ): Promise<StreamableFile> {
        const result = await this.ttsService.generateAudio(user.id, dto);

        // Set appropriate headers for audio response
        res.set({
            'Content-Type': `audio/${result.format}`,
            'Content-Disposition': `attachment; filename="audio.${result.format}"`,
            'X-TTS-Provider': result.provider,
        });

        if (result.durationMs) {
            res.set('X-Audio-Duration-Ms', result.durationMs.toString());
        }

        return new StreamableFile(result.audio);
    }
}
