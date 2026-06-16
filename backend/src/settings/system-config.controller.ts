import { Controller, Get, Put, Post, Delete, Param, Body, UseGuards, Logger, Req, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { CustomOpenAIProvider } from '../ai/custom-openai.provider';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SystemConfigService } from './system-config.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { EmailService } from '../common/email.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

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

export class UpdateImageGenConfigDto {
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
    defaultModel?: string;

    @IsOptional()
    steps?: number;
}

export class UpdateSMTPConfigDto {
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @IsOptional()
    @IsString()
    host?: string;

    @IsOptional()
    @IsString()
    port?: string;

    @IsOptional()
    @IsString()
    user?: string;

    @IsOptional()
    @IsString()
    pass?: string;

    @IsOptional()
    @IsString()
    from?: string;
}

export class CreateCustomProviderDto {
    @IsString()
    name: string;

    @IsString()
    url: string;

    @IsString()
    apiKey: string;

    @IsBoolean()
    enabled: boolean;

    @IsString()
    ttsType: 'none' | 'openai' | 'shopaikey';
}

export class UpdateCustomProviderDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    url?: string;

    @IsOptional()
    @IsString()
    apiKey?: string;

    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @IsOptional()
    @IsString()
    ttsType?: 'none' | 'openai' | 'shopaikey';
}

@Controller('admin/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class SystemConfigController {
    private readonly logger = new Logger(SystemConfigController.name);

    constructor(
        private readonly configService: SystemConfigService,
        private readonly apiKeysService: ApiKeysService,
        private readonly emailService: EmailService,
        @Inject(forwardRef(() => CustomOpenAIProvider))
        private readonly customOpenAI: CustomOpenAIProvider,
    ) { }

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
     * Test CLIProxy connection AND discover models from ALL sources
     */
    @Get('cliproxy/test')
    async testCLIProxyConnection() {
        const config = await this.configService.getCLIProxyConfig();
        const TIMEOUT_MS = 15000;
        const MAX_RETRIES = 2;

        // Result containers
        const text: { id: string; source: string }[] = [];
        const image: { id: string; source: string }[] = [];
        const tts: { id: string; source: string }[] = [];
        const allModels: string[] = [];
        let cliproxySuccess = false;
        let cliproxyMessage = '';

        // ═══════════════════════════════════════════
        // 1. CLIProxy models (if enabled)
        // ═══════════════════════════════════════════
        if (config.enabled && config.url && config.apiKey) {
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    this.logger.log(`Testing CLIProxy connection (attempt ${attempt}/${MAX_RETRIES})...`);
                    const response = await fetch(`${config.url}/v1/models`, {
                        headers: { 'Authorization': `Bearer ${config.apiKey}` },
                        signal: AbortSignal.timeout(TIMEOUT_MS),
                    });

                    if (response.ok) {
                        const data = await response.json();
                        const models = data.data?.map((m: { id: string }) => m.id) || [];

                        for (const id of models) {
                            const lower = id.toLowerCase();
                            if (lower.includes('embedding') || lower.includes('retrieval') || lower.includes('moderation')) continue;

                            allModels.push(id);
                            const entry = { id, source: 'CLIProxy' };
                            if (lower.includes('tts') || lower.includes('speech')) {
                                tts.push(entry);
                            } else if (lower.includes('image') || lower.includes('imagen') || lower.includes('dall-e')) {
                                image.push(entry);
                            } else {
                                text.push(entry);
                            }
                        }

                        cliproxySuccess = true;
                        cliproxyMessage = `CLIProxy: ${models.length} models`;
                        break; // success, no need to retry
                    } else {
                        cliproxyMessage = `CLIProxy HTTP ${response.status}`;
                        break; // non-OK, don't retry
                    }
                } catch (error: any) {
                    const isTimeout = error.name === 'TimeoutError' || error.message?.includes('timeout') || error.message?.includes('aborted');
                    if (isTimeout && attempt < MAX_RETRIES) {
                        this.logger.warn(`CLIProxy test timed out (attempt ${attempt}), retrying...`);
                        continue;
                    }
                    cliproxyMessage = isTimeout
                        ? `CLIProxy timed out after ${TIMEOUT_MS / 1000}s`
                        : `CLIProxy failed: ${error.message || error}`;
                }
            }
        } else {
            cliproxyMessage = 'CLIProxy not configured';
        }

        // ═══════════════════════════════════════════
        // 2. Gemini SDK models (if API key available)
        // ═══════════════════════════════════════════
        let geminiMessage = '';
        // Try to get Gemini API key: 1) from DB system key, 2) from env
        let geminiApiKey = '';
        try {
            // Use a dummy userId - getActiveKey falls through to system key
            geminiApiKey = await this.apiKeysService.getActiveKey('__system__', 'GEMINI' as any) || '';
        } catch {
            // ignore
        }
        if (!geminiApiKey) {
            geminiApiKey = process.env.GEMINI_API_KEY || '';
        }
        // Skip placeholder value
        if (geminiApiKey === 'your-gemini-api-key-here') {
            geminiApiKey = '';
        }

        if (geminiApiKey) {
            try {
                const geminiResponse = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}&pageSize=100`,
                    { signal: AbortSignal.timeout(10000) },
                );

                if (geminiResponse.ok) {
                    const data = await geminiResponse.json();
                    const apiModels = data.models || [];
                    const seenCliproxy = new Set(allModels.map(m => m.toLowerCase()));
                    let geminiCount = 0;

                    for (const model of apiModels) {
                        const modelId = (model.name || '').replace('models/', '');
                        if (!modelId) continue;
                        const lower = modelId.toLowerCase();

                        // Skip non-generative
                        if (lower.includes('embedding') || lower.includes('aqa') || lower.includes('retrieval')) continue;
                        // Skip if already in CLIProxy (avoid duplicates)
                        if (seenCliproxy.has(lower)) continue;

                        const entry = { id: modelId, source: 'Gemini SDK' };
                        if (lower.includes('tts') || lower.includes('speech')) {
                            tts.push(entry);
                        } else if (lower.includes('image') || lower.includes('imagen')) {
                            image.push(entry);
                        } else {
                            text.push(entry);
                        }
                        allModels.push(modelId);
                        geminiCount++;
                    }

                    geminiMessage = `Gemini SDK: ${geminiCount} models`;
                    this.logger.log(`Discovered ${geminiCount} unique Gemini SDK models`);
                } else {
                    geminiMessage = `Gemini API returned HTTP ${geminiResponse.status}`;
                    this.logger.warn(geminiMessage);
                }
            } catch (error: any) {
                geminiMessage = `Gemini SDK failed: ${error.message}`;
                this.logger.warn(geminiMessage);
            }
        } else {
            geminiMessage = 'Gemini API key not set';
        }

        // ═══════════════════════════════════════════
        // 3. Return combined result
        // ═══════════════════════════════════════════
        const messages = [cliproxyMessage, geminiMessage].filter(Boolean).join(' | ');
        const success = cliproxySuccess || text.length > 0 || image.length > 0 || tts.length > 0;

        return {
            success,
            message: success ? `✅ ${messages}` : `❌ ${messages}`,
            modelsCount: allModels.length,
            models: allModels,
            categorized: { text, image, tts },
        };
    }

    /**
     * Get AI provider status
     */
    @Get('ai-provider/status')
    async getAIProviderStatus() {
        const cliproxyConfig = await this.configService.getCLIProxyConfig();
        const imageGenConfig = await this.configService.getImageGenConfig();

        return {
            cliproxy: {
                enabled: cliproxyConfig.enabled,
                url: cliproxyConfig.url,
                defaultTextModel: cliproxyConfig.defaultTextModel,
                defaultImageModel: cliproxyConfig.defaultImageModel,
                defaultTTSModel: cliproxyConfig.defaultTTSModel,
            },
            imageGen: {
                enabled: imageGenConfig.enabled,
                url: imageGenConfig.url,
                defaultModel: imageGenConfig.defaultModel,
                steps: imageGenConfig.steps,
            },
            geminiSdk: {
                available: !!process.env.GEMINI_API_KEY,
            },
            activeProvider: cliproxyConfig.enabled ? 'cliproxy' : 'gemini-sdk',
        };
    }

    // ========================
    // Image Generation Provider Config
    // ========================

    /**
     * Get Image Gen configuration
     */
    @Get('image-gen')
    async getImageGenConfig() {
        const config = await this.configService.getImageGenConfig();
        return {
            ...config,
            apiKey: config.apiKey ? '***' + config.apiKey.slice(-4) : '',
        };
    }

    /**
     * Update Image Gen configuration
     */
    @Put('image-gen')
    async updateImageGenConfig(@Body() dto: UpdateImageGenConfigDto) {
        this.logger.log(`Updating ImageGen config: ${JSON.stringify({ ...dto, apiKey: dto.apiKey ? '***' : undefined })}`);

        if (dto.enabled !== undefined) {
            await this.configService.set('imageGen.enabled', String(dto.enabled));
        }
        if (dto.url) {
            await this.configService.set('imageGen.url', dto.url);
        }
        if (dto.apiKey) {
            await this.configService.set('imageGen.apiKey', dto.apiKey);
        }
        if (dto.defaultModel) {
            await this.configService.set('imageGen.defaultModel', dto.defaultModel);
        }
        if (dto.steps !== undefined) {
            await this.configService.set('imageGen.steps', String(dto.steps));
        }

        return { success: true, message: 'Image Gen configuration updated' };
    }

    /**
     * Test Image Gen connection
     */
    @Get('image-gen/test')
    async testImageGenConnection() {
        const config = await this.configService.getImageGenConfig();

        if (!config.enabled || !config.url || !config.apiKey) {
            return { success: false, message: 'Image Gen provider not configured' };
        }

        try {
            // Send a minimal test request to see if the API responds
            const response = await fetch(config.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify({
                    model: config.defaultModel,
                    prompt: 'A simple test image: a white circle on a blue background. Minimal flat design.',
                    size: '1024x768',
                    steps: config.steps || 20,
                }),
                signal: AbortSignal.timeout(180000), // 180s timeout for full generation
            });

            if (response.ok) {
                const data = await response.json();
                const hasImage = data?.data?.[0]?.url || data?.data?.[0]?.b64_json;
                return {
                    success: true,
                    message: `✅ Image Gen API connected! Model: ${config.defaultModel}${hasImage ? ' — Test image generated' : ''}`,
                    model: config.defaultModel,
                };
            } else {
                const errorText = await response.text();
                return {
                    success: false,
                    message: `❌ Image Gen API returned HTTP ${response.status}: ${errorText.substring(0, 200)}`,
                };
            }
        } catch (error: any) {
            const isTimeout = error.name === 'TimeoutError' || error.message?.includes('timeout');
            return {
                success: false,
                message: isTimeout
                    ? '❌ Image Gen API timed out (60s)'
                    : `❌ Image Gen API error: ${error.message}`,
            };
        }
    }

    // ========================
    // ViTTS System Config
    // ========================

    /**
     * Get ViTTS admin configuration
     */
    @Get('vitts')
    async getViTTSConfig() {
        const enabled = await this.configService.get('vitts.enabled');
        const baseUrl = await this.configService.get('vitts.baseUrl');
        const apiKey = await this.configService.get('vitts.apiKey');
        const defaultVoice = await this.configService.get('vitts.defaultVoice');
        const designInstruct = await this.configService.get('vitts.designInstruct');

        return {
            enabled: enabled === 'true',
            baseUrl: baseUrl || 'http://117.0.36.6:8888',
            apiKey: apiKey ? '***' + apiKey.slice(-4) : '',
            defaultVoice: defaultVoice || 'vitts:design',
            designInstruct: designInstruct || 'male, middle-aged',
        };
    }

    /**
     * Update ViTTS admin configuration
     */
    @Put('vitts')
    async updateViTTSConfig(@Body() dto: {
        enabled?: boolean;
        baseUrl?: string;
        apiKey?: string;
        defaultVoice?: string;
        designInstruct?: string;
    }) {
        this.logger.log(`Updating ViTTS config: ${JSON.stringify({ ...dto, apiKey: dto.apiKey ? '***' : undefined })}`);

        if (dto.enabled !== undefined) {
            await this.configService.set('vitts.enabled', String(dto.enabled));
        }
        if (dto.baseUrl) {
            await this.configService.set('vitts.baseUrl', dto.baseUrl);
        }
        if (dto.apiKey) {
            await this.configService.set('vitts.apiKey', dto.apiKey);
        }
        if (dto.defaultVoice) {
            await this.configService.set('vitts.defaultVoice', dto.defaultVoice);
        }
        if (dto.designInstruct) {
            await this.configService.set('vitts.designInstruct', dto.designInstruct);
        }

        return { success: true, message: 'ViTTS configuration updated' };
    }

    /**
     * Test ViTTS connection
     */
    @Get('vitts/test')
    async testViTTSConnection() {
        const apiKey = await this.configService.get('vitts.apiKey');
        const baseUrl = await this.configService.get('vitts.baseUrl') || 'http://117.0.36.6:8888';

        if (!apiKey) {
            return { success: false, message: '❌ ViTTS API key not configured' };
        }

        try {
            const response = await fetch(`${baseUrl}/api/v1/tts/voices`, {
                headers: { 'X-API-Key': apiKey },
                signal: AbortSignal.timeout(10000),
            });

            if (response.ok) {
                const data = await response.json().catch(() => null);
                const voiceCount = Array.isArray(data) ? data.length : (data?.voices?.length || '?');
                return {
                    success: true,
                    message: `✅ ViTTS connected! URL: ${baseUrl} (${voiceCount} voices)`,
                };
            } else {
                return {
                    success: false,
                    message: `❌ ViTTS returned HTTP ${response.status}`,
                };
            }
        } catch (error: any) {
            const msg = error.message || '';
            const isTimeout = error.name === 'TimeoutError' || msg.includes('timeout') || msg.includes('aborted');
            const isNetworkError = msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('EHOSTUNREACH') || msg.includes('ENOTFOUND');

            if (isNetworkError) {
                return {
                    success: false,
                    message: `⚠️ Không kết nối được tới ${baseUrl}. Server ViTTS có thể chỉ accessible từ VPS. Trên VPS sẽ hoạt động bình thường.`,
                };
            }
            if (isTimeout) {
                return {
                    success: false,
                    message: `❌ ViTTS timeout (10s) — server có thể chậm hoặc không accessible từ máy này.`,
                };
            }
            return {
                success: false,
                message: `❌ ViTTS error: ${msg}`,
            };
        }
    }

    /**
     * Get SMTP configuration
     */
    @Get('smtp')
    async getSMTPConfig() {
        const config = await this.configService.getSMTPConfig();
        return {
            ...config,
            pass: config.pass ? '***' + config.pass.slice(-3) : '',
        };
    }

    /**
     * Update SMTP configuration
     */
    @Put('smtp')
    async updateSMTPConfig(@Body() dto: UpdateSMTPConfigDto) {
        this.logger.log(`Updating SMTP config: ${JSON.stringify({ ...dto, pass: dto.pass ? '***' : undefined })}`);

        if (dto.enabled !== undefined) {
            await this.configService.set('smtp.enabled', String(dto.enabled));
        }
        if (dto.host !== undefined) {
            await this.configService.set('smtp.host', dto.host);
        }
        if (dto.port !== undefined) {
            await this.configService.set('smtp.port', dto.port);
        }
        if (dto.user !== undefined) {
            await this.configService.set('smtp.user', dto.user);
        }
        if (dto.pass !== undefined) {
            await this.configService.set('smtp.pass', dto.pass);
        }
        if (dto.from !== undefined) {
            await this.configService.set('smtp.from', dto.from);
        }

        return { success: true, message: 'SMTP configuration updated' };
    }

    /**
     * Test SMTP connection by sending a test email to the current admin user
     */
    @Get('smtp/test')
    async testSMTPConnection(@CurrentUser('email') email: string) {
        if (!email) {
            return { success: false, message: 'Không xác định được email người nhận (Admin).' };
        }
        try {
            await this.emailService.sendTestEmail(email);
            return { success: true, message: `✅ Đã gửi email test thành công tới ${email}` };
        } catch (error: any) {
            return { success: false, message: error.message };
        }
    }

    // ==========================================
    // Dynamic Custom OpenAI Providers Endpoints
    // ==========================================

    @Get('custom-openai')
    async getCustomProviders() {
        const providers = await this.customOpenAI.getProviders();
        return providers.map(p => ({
            ...p,
            apiKey: p.apiKey ? '***' + p.apiKey.slice(-4) : '',
        }));
    }

    @Post('custom-openai')
    async createCustomProvider(@Body() dto: CreateCustomProviderDto) {
        const providers = await this.customOpenAI.getProviders();
        const id = dto.name.toLowerCase().replace(/[^a-z0-9]/g, '-');

        if (providers.some(p => p.id === id)) {
            throw new BadRequestException(`Provider với tên "${dto.name}" đã tồn tại.`);
        }

        const newProvider = {
            id,
            name: dto.name,
            url: dto.url,
            apiKey: dto.apiKey,
            enabled: dto.enabled,
            ttsType: dto.ttsType,
        };

        providers.push(newProvider);
        await this.customOpenAI.saveProviders(providers);
        return { success: true, provider: newProvider };
    }

    @Put('custom-openai/:id')
    async updateCustomProvider(@Param('id') id: string, @Body() dto: UpdateCustomProviderDto) {
        const providers = await this.customOpenAI.getProviders();
        const index = providers.findIndex(p => p.id === id);

        if (index === -1) {
            throw new BadRequestException(`Không tìm thấy provider với ID "${id}".`);
        }

        const current = providers[index];
        const updatedApiKey = dto.apiKey && dto.apiKey !== '***' ? dto.apiKey : current.apiKey;

        providers[index] = {
            ...current,
            name: dto.name ?? current.name,
            url: dto.url ?? current.url,
            apiKey: updatedApiKey,
            enabled: dto.enabled ?? current.enabled,
            ttsType: dto.ttsType ?? current.ttsType,
        };

        await this.customOpenAI.saveProviders(providers);
        return { success: true, provider: providers[index] };
    }

    @Delete('custom-openai/:id')
    async deleteCustomProvider(@Param('id') id: string) {
        const providers = await this.customOpenAI.getProviders();
        const filtered = providers.filter(p => p.id !== id);

        if (filtered.length === providers.length) {
            throw new BadRequestException(`Không tìm thấy provider với ID "${id}".`);
        }

        await this.customOpenAI.saveProviders(filtered);
        return { success: true, message: 'Đã xóa nhà cung cấp thành công' };
    }

    @Get('custom-openai/:id/test')
    async testCustomProvider(@Param('id') id: string) {
        const provider = await this.customOpenAI.getProvider(id);
        if (!provider) {
            return { success: false, message: '❌ Không tìm thấy nhà cung cấp' };
        }

        try {
            this.logger.log(`Testing connection for Custom OpenAI Provider: ${provider.name} (${provider.url})...`);
            const models = await this.customOpenAI.listModels(id);
            return {
                success: true,
                message: `✅ Kết nối thành công tới ${provider.name}! Phát hiện ${models.length} model.`,
                modelsCount: models.length,
                models,
            };
        } catch (error: any) {
            return {
                success: false,
                message: `❌ Kết nối thất bại tới ${provider.name}: ${error.message}`,
            };
        }
    }
}
