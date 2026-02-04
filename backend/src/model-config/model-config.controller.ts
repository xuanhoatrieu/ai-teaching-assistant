import {
    Controller,
    Get,
    Post,
    Body,
    UseGuards,
    Request,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModelConfigService, TASK_TYPES } from './model-config.service';
import type { ModelConfigDto } from './model-config.service';

@Controller('user/model-config')
@UseGuards(JwtAuthGuard)
export class ModelConfigController {
    constructor(private modelConfigService: ModelConfigService) { }

    /**
     * Get all model configurations for the current user
     */
    @Get()
    async getConfigs(@Request() req: any) {
        const configs = await this.modelConfigService.getUserConfigs(req.user.id);
        const defaults = await this.modelConfigService.getDefaults();

        return {
            configs,
            defaults,
            taskTypes: TASK_TYPES,
        };
    }

    /**
     * Set model configuration for a task type
     */
    @Post()
    async setConfig(@Request() req: any, @Body() body: ModelConfigDto) {
        if (!body.taskType || !body.provider || !body.modelName) {
            throw new HttpException(
                'taskType, provider, and modelName are required',
                HttpStatus.BAD_REQUEST,
            );
        }

        const config = await this.modelConfigService.setModelConfig(req.user.id, body);
        return {
            message: 'Model configuration saved',
            config,
        };
    }

    /**
     * Set multiple model configurations at once
     */
    @Post('bulk')
    async setMultipleConfigs(@Request() req: any, @Body() body: { configs: ModelConfigDto[] }) {
        if (!body.configs || !Array.isArray(body.configs)) {
            throw new HttpException('configs array is required', HttpStatus.BAD_REQUEST);
        }

        const results = await this.modelConfigService.setMultipleConfigs(req.user.id, body.configs);
        return {
            message: `Saved ${results.length} model configurations`,
            configs: results,
        };
    }

    /**
     * Discover available models from user's API key
     */
    @Get('discover')
    async discoverModels(@Request() req: any) {
        try {
            const models = await this.modelConfigService.getAllAvailableModels(req.user.id);
            return {
                models,
                message: 'Models discovered successfully',
            };
        } catch (error: any) {
            throw new HttpException(
                error.message || 'Failed to discover models',
                HttpStatus.BAD_REQUEST,
            );
        }
    }
}
