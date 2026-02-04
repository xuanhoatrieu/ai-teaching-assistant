import { Controller, Get, Put, Body, UseGuards, Logger } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SystemConfigService } from './system-config.service';

export class UpdateCLIProxyConfigDto {
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @IsOptional()
    @IsString()
    url?: string;

    @IsOptional()
    @IsString()
    apiKey?: string;

    @IsOptional()
    @IsString()
    defaultTextModel?: string;

    @IsOptional()
    @IsString()
    defaultImageModel?: string;
}

@Controller('admin/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class SystemConfigController {
    private readonly logger = new Logger(SystemConfigController.name);

    constructor(private readonly configService: SystemConfigService) { }

    /**
     * Get CLIProxy configuration
     */
    @Get('cliproxy')
    async getCLIProxyConfig() {
        const config = await this.configService.getCLIProxyConfig();
        // Mask API key for security
        return {
            ...config,
            apiKey: config.apiKey ? '***' + config.apiKey.slice(-4) : '',
        };
    }

    /**
     * Update CLIProxy configuration
     */
    @Put('cliproxy')
    async updateCLIProxyConfig(@Body() dto: UpdateCLIProxyConfigDto) {
        this.logger.log(`Updating CLIProxy config: ${JSON.stringify({ ...dto, apiKey: dto.apiKey ? '***' : undefined })}`);

        if (dto.enabled !== undefined) {
            await this.configService.set('cliproxy.enabled', String(dto.enabled));
        }
        if (dto.url) {
            await this.configService.set('cliproxy.url', dto.url);
        }
        if (dto.apiKey) {
            await this.configService.set('cliproxy.apiKey', dto.apiKey);
        }
        if (dto.defaultTextModel) {
            await this.configService.set('cliproxy.defaultTextModel', dto.defaultTextModel);
        }
        if (dto.defaultImageModel) {
            await this.configService.set('cliproxy.defaultImageModel', dto.defaultImageModel);
        }

        return { success: true, message: 'CLIProxy configuration updated' };
    }

    /**
     * Test CLIProxy connection
     */
    @Get('cliproxy/test')
    async testCLIProxyConnection() {
        const config = await this.configService.getCLIProxyConfig();

        try {
            const response = await fetch(`${config.url}/v1/models`, {
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`,
                },
            });

            if (response.ok) {
                const data = await response.json();
                // Return all models for dropdown selection
                const allModels = data.data?.map((m: { id: string }) => m.id) || [];
                return {
                    success: true,
                    message: 'CLIProxy connection successful',
                    modelsCount: allModels.length,
                    models: allModels,
                };
            } else {
                return {
                    success: false,
                    message: `CLIProxy returned ${response.status}`,
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `Connection failed: ${error}`,
            };
        }
    }

    /**
     * Get AI provider status
     */
    @Get('ai-provider/status')
    async getAIProviderStatus() {
        const cliproxyConfig = await this.configService.getCLIProxyConfig();

        return {
            cliproxy: {
                enabled: cliproxyConfig.enabled,
                url: cliproxyConfig.url,
                defaultTextModel: cliproxyConfig.defaultTextModel,
                defaultImageModel: cliproxyConfig.defaultImageModel,
            },
            geminiSdk: {
                available: !!process.env.GEMINI_API_KEY,
            },
            activeProvider: cliproxyConfig.enabled ? 'cliproxy' : 'gemini-sdk',
        };
    }
}
