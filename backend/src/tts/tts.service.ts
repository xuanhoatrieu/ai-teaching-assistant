import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    Inject,
    forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TTSFactory } from './tts.factory';
import { GenerateAudioDto } from './dto/generate-audio.dto';
import { CreateTTSProviderDto, UpdateTTSProviderDto } from './dto/create-tts-provider.dto';
import { CreateUserTTSConfigDto, UpdateUserTTSConfigDto } from './dto/user-tts-config.dto';
import { TTSResult, Voice, TTSCredentials } from './interfaces/tts-provider.interface';
import { encrypt, decrypt } from '../common/crypto.util';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { CLIProxyProvider } from '../ai/cliproxy.provider';
import { CustomOpenAIProvider } from '../ai/custom-openai.provider';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

@Injectable()
export class TTSService {
    private readonly logger = new Logger(TTSService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly ttsFactory: TTSFactory,
        @Inject(forwardRef(() => ApiKeysService))
        private readonly apiKeysService: ApiKeysService,
        private readonly cliproxy: CLIProxyProvider,
        private readonly customOpenAI: CustomOpenAIProvider,
    ) { }

    // ========== ADMIN: TTS Provider Management ==========

    async createProvider(dto: CreateTTSProviderDto) {
        return this.prisma.tTSProvider.create({
            data: {
                name: dto.name,
                type: dto.type,
                requiredFields: dto.requiredFields || [],
                isActive: dto.isActive ?? true,
                isSystem: dto.isSystem ?? false,
                endpoint: dto.endpoint,
            },
        });
    }

    async findAllProviders() {
        return this.prisma.tTSProvider.findMany({
            orderBy: { createdAt: 'desc' },
        });
    }

    async findActiveProviders() {
        return this.prisma.tTSProvider.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
        });
    }

    async findProviderById(id: string) {
        const provider = await this.prisma.tTSProvider.findUnique({
            where: { id },
        });
        if (!provider) {
            throw new NotFoundException(`TTS Provider with ID ${id} not found`);
        }
        return provider;
    }

    async updateProvider(id: string, dto: UpdateTTSProviderDto) {
        await this.findProviderById(id);
        return this.prisma.tTSProvider.update({
            where: { id },
            data: {
                name: dto.name,
                requiredFields: dto.requiredFields,
                isActive: dto.isActive,
                endpoint: dto.endpoint,
            },
        });
    }

    async deleteProvider(id: string) {
        await this.findProviderById(id);
        return this.prisma.tTSProvider.delete({
            where: { id },
        });
    }

    // ========== USER: TTS Config Management ==========

    async getUserConfigs(userId: string) {
        return this.prisma.userTTSConfig.findMany({
            where: { userId },
            include: { provider: true },
        });
    }

    async getUserDefaultConfig(userId: string) {
        return this.prisma.userTTSConfig.findFirst({
            where: { userId, isDefault: true },
            include: { provider: true },
        });
    }

    async createOrUpdateUserConfig(userId: string, dto: CreateUserTTSConfigDto) {
        const provider = await this.findProviderById(dto.providerId);

        // Encrypt credentials as JSON string
        let credentialsEnc = '';
        if (dto.credentials) {
            credentialsEnc = await encrypt(JSON.stringify(dto.credentials), ENCRYPTION_KEY);
        }

        // If setting as default, unset other defaults first
        if (dto.isDefault) {
            await this.prisma.userTTSConfig.updateMany({
                where: { userId },
                data: { isDefault: false },
            });
        }

        return this.prisma.userTTSConfig.upsert({
            where: {
                userId_providerId: {
                    userId,
                    providerId: dto.providerId,
                },
            },
            create: {
                userId,
                providerId: dto.providerId,
                credentialsEnc,
                isDefault: dto.isDefault ?? false,
            },
            update: {
                credentialsEnc,
                isDefault: dto.isDefault ?? false,
            },
            include: { provider: true },
        });
    }

    async deleteUserConfig(userId: string, providerId: string) {
        const config = await this.prisma.userTTSConfig.findUnique({
            where: {
                userId_providerId: { userId, providerId },
            },
        });
        if (!config) {
            throw new NotFoundException('User TTS configuration not found');
        }
        return this.prisma.userTTSConfig.delete({
            where: {
                userId_providerId: { userId, providerId },
            },
        });
    }

    // ========== TTS Generation ==========

    async generateAudio(userId: string, dto: GenerateAudioDto): Promise<TTSResult> {
        this.logger.log(`Generating audio for user ${userId}, provider: ${dto.provider || 'GEMINI'}, voice: ${dto.voiceId}`);

        let provider;

        // Auto-resolve provider if missing but voiceId is a custom OpenAI format
        if (!dto.provider && dto.voiceId?.startsWith('custom_openai:')) {
            const parts = dto.voiceId.split(':');
            if (parts[1]) {
                dto.provider = parts[1].toUpperCase();
                this.logger.log(`[FIX] Auto-resolved missing provider to "${dto.provider}" based on voice "${dto.voiceId}"`);
            }
        }

        // Route based on provider parameter
        const customProviders = await this.customOpenAI.getProviders();
        const matchingProvider = customProviders.find(p => p.id.toUpperCase() === dto.provider?.toUpperCase() && p.enabled && p.ttsType !== 'none');

        if (matchingProvider) {
            // FIX: Correct wrong or missing model name for custom providers
            let model = dto.model;
            const isWrongModel = !model || !model.startsWith(`custom_openai:${matchingProvider.id}:`);
            
            if (isWrongModel && dto.voiceId) {
                const voiceId = dto.voiceId;
                if (matchingProvider.id === 'shopaikey') {
                    const isGeminiVoice = ['zephyr', 'puck', 'charon', 'kore', 'aoede'].some(name => voiceId.toLowerCase().endsWith(':' + name.toLowerCase()));
                    const modelSuffix = isGeminiVoice ? 'gemini-tts' : 'tts-1';
                    model = `custom_openai:shopaikey:${modelSuffix}`;
                } else {
                    model = `custom_openai:${matchingProvider.id}:tts-1`;
                }
                this.logger.log(`[FIX] Auto-resolved wrong model "${dto.model}" to "${model}" based on voice "${dto.voiceId}"`);
                dto.model = model;
            }

            this.logger.log(`Using Custom OpenAI TTS (${matchingProvider.name}) with model: ${dto.model}, voice: ${dto.voiceId}`);
            try {
                const cleanModel = dto.model?.replace(`custom_openai:${matchingProvider.id}:`, '') || '';
                const result = await this.customOpenAI.generateTTS(
                    matchingProvider.id,
                    dto.text,
                    cleanModel,
                    dto.voiceId
                );
                return {
                    audio: result.audio,
                    format: result.format,
                    provider: `${matchingProvider.name} TTS`,
                };
            } catch (error: any) {
                this.logger.error(`Custom OpenAI TTS (${matchingProvider.name}) failed: ${error.message}`);
                // Fallback to Gemini SDK
                this.logger.warn('Falling back to Gemini SDK for TTS');
                const geminiApiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
                if (!geminiApiKey) {
                    throw new Error(`TTS failed and no Gemini API key configured for fallback: ${error.message}`);
                }
                provider = this.ttsFactory.getDefaultProvider(geminiApiKey);
                dto.model = 'gemini-2.5-flash-preview-tts';
            }
        } else if (dto.provider === 'VBEE') {
            // Get Vbee credentials (stored as JSON: {"token": "xxx", "appId": "yyy"})
            const vbeeCredentialsJson = await this.apiKeysService.getActiveKey(userId, 'VBEE' as any);

            if (!vbeeCredentialsJson) {
                // AUTO-FALLBACK: Vbee not configured, try Gemini TTS instead
                this.logger.warn('Vbee API credentials not configured - falling back to Gemini TTS');
                const geminiApiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
                if (!geminiApiKey) {
                    throw new Error('No TTS provider configured. Please add Gemini API key or Vbee credentials in Settings.');
                }
                this.logger.log('Using Gemini TTS as fallback (voice: Puck)');
                provider = this.ttsFactory.getDefaultProvider(geminiApiKey);
                // Override to valid Gemini voice
                dto.voiceId = 'Puck';
                dto.provider = 'GEMINI';
            } else {
                // Parse Vbee credentials
                try {
                    const vbeeCredentials = JSON.parse(vbeeCredentialsJson);
                    if (!vbeeCredentials.token || !vbeeCredentials.appId) {
                        throw new Error('Invalid Vbee credentials format. Expected: {"token": "xxx", "appId": "yyy"}');
                    }

                    this.logger.log(`Using Vbee TTS provider with appId: ${vbeeCredentials.appId.substring(0, 8)}...`);
                    provider = this.ttsFactory.getProvider('VBEE' as any, {
                        token: vbeeCredentials.token,
                        appId: vbeeCredentials.appId,
                    });
                } catch (parseError) {
                    throw new Error(`Invalid Vbee credentials JSON: ${parseError.message}`);
                }
            }
        } else if (dto.provider === 'VITTS') {
            // Priority 1: User's own ViTTS credentials
            const vittsCredentialsJson = await this.apiKeysService.getActiveKey(userId, 'VITTS' as any);

            if (vittsCredentialsJson) {
                // Parse user's ViTTS credentials
                try {
                    const vittsCredentials = JSON.parse(vittsCredentialsJson);
                    this.logger.log(`[DEBUG] ViTTS user credentials: apiKey=${vittsCredentials.apiKey?.substring(0, 10)}..., baseUrl=${vittsCredentials.baseUrl || 'NOT SET'}`);
                    if (!vittsCredentials.apiKey) {
                        throw new Error('Invalid ViTTS credentials format. Expected: {"apiKey": "xxx", "baseUrl": "yyy"}');
                    }

                    this.logger.log(`Using ViTTS provider with user credentials, baseUrl: ${vittsCredentials.baseUrl || 'default'}`);
                    provider = this.ttsFactory.getProvider('VITTS' as any, {
                        apiKey: vittsCredentials.apiKey,
                        baseUrl: vittsCredentials.baseUrl,
                    });
                } catch (parseError) {
                    throw new Error(`Invalid ViTTS credentials JSON: ${parseError.message}`);
                }
            } else {
                // Priority 2: Admin/system ViTTS credentials from system_configs
                const adminVittsEnabled = await this.prisma.systemConfig.findUnique({ where: { key: 'vitts.enabled' } });
                const adminVittsApiKey = await this.prisma.systemConfig.findUnique({ where: { key: 'vitts.apiKey' } });
                const adminVittsBaseUrl = await this.prisma.systemConfig.findUnique({ where: { key: 'vitts.baseUrl' } });

                if (adminVittsEnabled?.value === 'true' && adminVittsApiKey?.value) {
                    this.logger.log(`Using ViTTS admin credentials (system-level), baseUrl: ${adminVittsBaseUrl?.value || 'default'}`);
                    provider = this.ttsFactory.getProvider('VITTS' as any, {
                        apiKey: adminVittsApiKey.value,
                        baseUrl: adminVittsBaseUrl?.value || 'http://117.0.36.6:8888',
                    });
                } else {
                    // Priority 3: Fallback to Gemini TTS
                    this.logger.warn('ViTTS not configured (no user or admin credentials) - falling back to Gemini TTS');
                    const geminiApiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
                    if (!geminiApiKey) {
                        throw new Error('No TTS provider configured. Please add Gemini API key or ViTTS credentials in Settings.');
                    }
                    this.logger.log('Using Gemini TTS as fallback (voice: Puck)');
                    provider = this.ttsFactory.getDefaultProvider(geminiApiKey);
                    dto.voiceId = 'Puck';
                    dto.provider = 'GEMINI';
                }
            }
        } else if (dto.provider === 'CLIPROXY') {
            // CLIProxy TTS - uses system CLIProxy config, no user API key needed
            this.logger.log(`Using CLIProxy TTS with model: ${dto.model}, voice: ${dto.voiceId}`);
            try {
                const result = await this.cliproxy.generateTTS(
                    dto.text,
                    dto.model,
                    dto.voiceId,
                );
                return {
                    audio: result.audio,
                    format: result.format as 'wav',
                    provider: 'CLIProxy TTS',
                };
            } catch (error: any) {
                this.logger.error(`CLIProxy TTS failed: ${error.message}`);
                // Fallback to Gemini SDK
                this.logger.warn('Falling back to Gemini SDK for TTS');
                const geminiApiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
                if (!geminiApiKey) {
                    throw new Error(`CLIProxy TTS failed and no Gemini API key configured for fallback: ${error.message}`);
                }
                provider = this.ttsFactory.getDefaultProvider(geminiApiKey);
                // Override model to use Gemini default TTS model (CLIProxy model name is not valid for Gemini SDK)
                dto.model = 'gemini-2.5-flash-preview-tts';
            }
        } else {
            // Default to Gemini
            const geminiApiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
            if (!geminiApiKey) {
                throw new Error('No Gemini API key configured. Please add one in Settings.');
            }
            this.logger.log(`Using Gemini TTS with voice: ${dto.voiceId}`);
            provider = this.ttsFactory.getDefaultProvider(geminiApiKey);
        }

        return provider.generateAudio(dto.text, {
            voiceId: dto.voiceId,
            model: dto.model,
            speed: dto.speed,
            pitch: dto.pitch,
            languageCode: dto.languageCode,
            multilingualMode: dto.multilingualMode,
            vittsMode: dto.vittsMode as any,
            vittsDesignInstruct: dto.vittsDesignInstruct,
            vittsNormalize: dto.vittsNormalize,
        });
    }

    async getAvailableVoices(userId: string): Promise<Voice[]> {
        const userConfig = await this.getUserDefaultConfig(userId);

        let provider;
        if (userConfig) {
            const credentials = await this.decryptCredentials(userConfig.credentialsEnc);
            provider = this.ttsFactory.getProvider(userConfig.provider.type, credentials);
        } else {
            const systemApiKey = process.env.GEMINI_API_KEY || '';
            provider = this.ttsFactory.getDefaultProvider(systemApiKey);
        }

        return provider.getVoices();
    }

    /**
     * Get all voices from all active providers
     */
    async getAllProviderVoices(): Promise<{ provider: string; voices: Voice[] }[]> {
        const results: { provider: string; voices: Voice[] }[] = [];

        // Gemini voices
        const geminiProvider = this.ttsFactory.getDefaultProvider(process.env.GEMINI_API_KEY || '');
        const geminiVoices = await geminiProvider.getVoices();
        results.push({ provider: 'Gemini TTS', voices: geminiVoices });

        // Vbee default voices (hardcoded since no user credentials needed for list)
        const vbeeVoices: Voice[] = [
            {
                id: 'n_thainguyen_male_giangbaitrieuhoa_education_vc',
                name: 'Giọng - Triệu Hòa',
                gender: 'male',
                languageCode: 'vi-VN',
                description: 'Giọng cá nhân Triệu Hòa - Giảng bài giáo dục',
            },
            {
                id: 'hn_female_ngochuyen_news_48k-fhg',
                name: 'Ngọc Huyền (Nữ)',
                gender: 'female',
                languageCode: 'vi-VN',
                description: 'Giọng nữ Hà Nội',
            },
            {
                id: 'hn_male_manhdung_news_48k-fhg',
                name: 'Mạnh Dũng (Nam)',
                gender: 'male',
                languageCode: 'vi-VN',
                description: 'Giọng nam Hà Nội',
            },
        ];
        results.push({ provider: 'Vbee TTS', voices: vbeeVoices });

        // ViTTS voices (system voices only, saved refs/trained need user credentials)
        const vittsVoices: Voice[] = [
            {
                id: 'male',
                name: 'ViTTS - Nam',
                gender: 'male',
                languageCode: 'vi-VN',
                description: 'Giọng nam hệ thống',
            },
            {
                id: 'female',
                name: 'ViTTS - Nữ',
                gender: 'female',
                languageCode: 'vi-VN',
                description: 'Giọng nữ hệ thống',
            },
        ];
        results.push({ provider: 'ViTTS', voices: vittsVoices });

        // Dynamic Custom OpenAI Providers voices
        try {
            const customProvidersList = await this.customOpenAI.getProviders();
            for (const cp of customProvidersList) {
                if (cp.enabled && cp.ttsType !== 'none') {
                    const cpVoices: Voice[] = [];
                    if (cp.ttsType === 'shopaikey') {
                        cpVoices.push(
                            { id: 'Zephyr', name: 'Gemini - Zephyr (Nữ)', gender: 'female', languageCode: 'vi-VN', description: 'Giọng nữ tươi sáng (Google)' },
                            { id: 'Puck', name: 'Gemini - Puck (Nam)', gender: 'male', languageCode: 'vi-VN', description: 'Giọng nam trầm ấm (Google)' },
                            { id: 'Charon', name: 'Gemini - Charon (Ấm áp)', gender: 'male', languageCode: 'vi-VN', description: 'Giọng trầm ấm (Google)' },
                            { id: 'Kore', name: 'Gemini - Kore (Chắc chắn)', gender: 'male', languageCode: 'vi-VN', description: 'Giọng chắc chắn (Google)' },
                            { id: 'Aoede', name: 'Gemini - Aoede (Nhẹ nhàng)', gender: 'female', languageCode: 'vi-VN', description: 'Giọng nhẹ nhàng (Google)' },
                            { id: 'alloy', name: 'OpenAI - Alloy (Trung tính)', gender: 'male', languageCode: 'vi-VN', description: 'Giọng OpenAI Alloy' },
                            { id: 'echo', name: 'OpenAI - Echo (Nam)', gender: 'male', languageCode: 'vi-VN', description: 'Giọng OpenAI Echo' },
                            { id: 'fable', name: 'OpenAI - Fable (Nam)', gender: 'male', languageCode: 'vi-VN', description: 'Giọng OpenAI Fable' },
                            { id: 'onyx', name: 'OpenAI - Onyx (Nam)', gender: 'male', languageCode: 'vi-VN', description: 'Giọng OpenAI Onyx' },
                            { id: 'nova', name: 'OpenAI - Nova (Nữ)', gender: 'female', languageCode: 'vi-VN', description: 'Giọng OpenAI Nova' },
                            { id: 'shimmer', name: 'OpenAI - Shimmer (Nữ)', gender: 'female', languageCode: 'vi-VN', description: 'Giọng OpenAI Shimmer' }
                        );
                    } else if (cp.ttsType === 'openai') {
                        cpVoices.push(
                            { id: 'alloy', name: 'Alloy (Trung tính)', gender: 'male', languageCode: 'vi-VN', description: 'Giọng trung tính' },
                            { id: 'echo', name: 'Echo (Nam)', gender: 'male', languageCode: 'vi-VN', description: 'Giọng nam' },
                            { id: 'fable', name: 'Fable (Nam)', gender: 'male', languageCode: 'vi-VN', description: 'Giọng nam' },
                            { id: 'onyx', name: 'Onyx (Nam)', gender: 'male', languageCode: 'vi-VN', description: 'Giọng nam' },
                            { id: 'nova', name: 'Nova (Nữ)', gender: 'female', languageCode: 'vi-VN', description: 'Giọng nữ' },
                            { id: 'shimmer', name: 'Shimmer (Nữ)', gender: 'female', languageCode: 'vi-VN', description: 'Giọng nữ' }
                        );
                    }
                    results.push({ provider: `${cp.name}`, voices: cpVoices });
                }
            }
        } catch (error) {
            this.logger.warn(`Failed to add custom providers voices to list: ${error.message}`);
        }

        return results;
    }

    async testProviderConnection(userId: string, providerId: string): Promise<{ success: boolean; provider: string }> {
        const config = await this.prisma.userTTSConfig.findUnique({
            where: {
                userId_providerId: { userId, providerId },
            },
            include: { provider: true },
        });

        if (!config) {
            throw new BadRequestException('No TTS configuration found for this provider');
        }

        const credentials = await this.decryptCredentials(config.credentialsEnc);
        const provider = this.ttsFactory.getProvider(config.provider.type, credentials);

        const success = await provider.testConnection();
        return {
            success,
            provider: provider.name,
        };
    }

    // ========== Helper Methods ==========

    private async decryptCredentials(encrypted: string): Promise<TTSCredentials> {
        if (!encrypted) {
            return {};
        }
        try {
            const decrypted = await decrypt(encrypted, ENCRYPTION_KEY);
            return JSON.parse(decrypted);
        } catch {
            return {};
        }
    }
}
