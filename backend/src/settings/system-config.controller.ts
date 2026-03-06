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

    @IsOptional()
    @IsString()
    defaultTTSModel?: string;
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
        if (dto.defaultTTSModel) {
            await this.configService.set('cliproxy.defaultTTSModel', dto.defaultTTSModel);
        }

        return { success: true, message: 'CLIProxy configuration updated' };
    }

    /**
     * Test CLIProxy connection (with timeout and retry)
     */
    @Get('cliproxy/test')
    async testCLIProxyConnection() {
        const config = await this.configService.getCLIProxyConfig();
        const TIMEOUT_MS = 15000; // 15 second timeout
        const MAX_RETRIES = 2;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                this.logger.log(`Testing CLIProxy connection (attempt ${attempt}/${MAX_RETRIES})...`);

                const response = await fetch(`${config.url}/v1/models`, {
                    headers: {
                        'Authorization': `Bearer ${config.apiKey}`,
                    },
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                });

                if (response.ok) {
                    const data = await response.json();
                    const allModels = data.data?.map((m: { id: string }) => m.id) || [];
                    return {
                        success: true,
                        message: 'CLIProxy connection successful',
                        modelsCount: allModels.length,
                        models: allModels,
                    };
                } else {
                    // Non-OK but got a response — don't retry, report status
                    return {
                        success: false,
                        message: `CLIProxy returned HTTP ${response.status}. This may be a temporary issue — try again in a moment.`,
                    };
                }
            } catch (error: any) {
                const isTimeout = error.name === 'TimeoutError' || error.message?.includes('timeout') || error.message?.includes('aborted');
                const isLastAttempt = attempt === MAX_RETRIES;

                if (isTimeout && !isLastAttempt) {
                    this.logger.warn(`CLIProxy test timed out (attempt ${attempt}), retrying...`);
                    continue; // retry
                }

                if (isTimeout) {
                    return {
                        success: false,
                        message: `CLIProxy connection timed out after ${TIMEOUT_MS / 1000}s (${MAX_RETRIES} attempts). The server at ${config.url} is not responding. This usually means CLIProxy is overloaded or the network connection is slow.`,
                    };
                }

                return {
                    success: false,
                    message: `Connection failed: ${error.message || error}`,
                };
            }
        }

        return { success: false, message: 'Test failed after all retries' };
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
                defaultTTSModel: cliproxyConfig.defaultTTSModel,
            },
            geminiSdk: {
                available: !!process.env.GEMINI_API_KEY,
            },
            activeProvider: cliproxyConfig.enabled ? 'cliproxy' : 'gemini-sdk',
        };
    }
}
