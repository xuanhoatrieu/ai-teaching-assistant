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
        const isPersonalOpenAI = dto.provider?.toUpperCase() === 'PERSONAL';

        if (matchingProvider || isPersonalOpenAI) {
            const pid = matchingProvider ? matchingProvider.id : 'personal';
            const pname = matchingProvider ? matchingProvider.name : 'Personal OpenAI';

            // FIX: Correct wrong or missing model name for custom providers
            let model = dto.model;
            const isWrongModel = !model || (!model.startsWith(`custom_openai:${pid}:`) && model !== 'tts-1' && model !== 'gemini-tts');
            
            if (isWrongModel && dto.voiceId) {
                const voiceId = dto.voiceId;
                // Auto-detect if base URL points to shopaikey (if personal)
                let isShopaikey = matchingProvider?.ttsType === 'shopaikey';
                if (isPersonalOpenAI) {
                    const userKeyJson = await this.apiKeysService.getActiveKey(userId, 'OPENAI' as any);
                    if (userKeyJson) {
                        try {
                            const parsed = JSON.parse(userKeyJson);
                            const baseUrl = parsed.baseUrl || '';
                            isShopaikey = baseUrl.toLowerCase().includes('shopaikey');
                        } catch {}
                    }
                }

                if (isShopaikey) {
                    const isGeminiVoice = ['zephyr', 'puck', 'charon', 'kore', 'aoede'].some(name => voiceId.toLowerCase().endsWith(':' + name.toLowerCase()) || voiceId.toLowerCase() === name.toLowerCase());
                    const modelSuffix = isGeminiVoice ? 'gemini-tts' : 'tts-1';
                    model = `custom_openai:${pid}:${modelSuffix}`;
                } else {
                    model = `custom_openai:${pid}:tts-1`;
                }
                this.logger.log(`[FIX] Auto-resolved wrong model "${dto.model}" to "${model}" based on voice "${dto.voiceId}"`);
                dto.model = model;
            }

            this.logger.log(`Using Custom OpenAI TTS (${pname}) with model: ${dto.model}, voice: ${dto.voiceId}`);
            try {
                const cleanModel = dto.model?.replace(`custom_openai:${pid}:`, '') || '';
                const result = await this.customOpenAI.generateTTS(
                    pid,
                    dto.text,
                    cleanModel,
                    dto.voiceId,
                    userId
                );
                return {
                    audio: result.audio,
                    format: result.format,
                    provider: `${pname} TTS`,
                };
            } catch (error: any) {
                this.logger.error(`Custom OpenAI TTS (${pname}) failed: ${error.message}`);
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
        } else if (dto.provider === 'VITTS' || dto.provider?.startsWith('VITTS_') || dto.provider?.toLowerCase().startsWith('vitts') || dto.voiceId?.startsWith('vitts:')) {
            // Multi-Server ViTTS resolution
            let targetServer: { baseUrl: string; apiKey: string; name?: string } | null = null;

            // 1. Load admin servers
            let adminServers: Array<{ id: string; name: string; baseUrl: string; apiKey: string; enabled: boolean }> = [];
            try {
                const rawServers = await this.prisma.systemConfig.findUnique({ where: { key: 'vitts.servers' } });
                if (rawServers?.value) {
                    adminServers = JSON.parse(rawServers.value);
                }
            } catch {}

            // Legacy fallback if vitts.servers not set
            if (adminServers.length === 0) {
                const legacyEnabled = await this.prisma.systemConfig.findUnique({ where: { key: 'vitts.enabled' } });
                const legacyBaseUrl = await this.prisma.systemConfig.findUnique({ where: { key: 'vitts.baseUrl' } });
                const legacyApiKey = await this.prisma.systemConfig.findUnique({ where: { key: 'vitts.apiKey' } });
                if (legacyBaseUrl?.value || legacyApiKey?.value) {
                    adminServers = [{
                        id: 'vitts-server-1',
                        name: 'ViTTS Server 1',
                        baseUrl: legacyBaseUrl?.value || 'http://10.64.11.16:8888',
                        apiKey: legacyApiKey?.value || '',
                        enabled: legacyEnabled?.value === 'true',
                    }];
                }
            }

            // 2. Load user personal keys
            const userKeys = await this.prisma.apiKey.findMany({
                where: { userId, service: 'VITTS' as any },
                orderBy: { createdAt: 'asc' },
            });

            const personalServers: Array<{ id: string; name: string; baseUrl: string; apiKey: string }> = [];
            for (const uk of userKeys) {
                try {
                    const decrypted = uk.keyEncrypted ? await decrypt(uk.keyEncrypted, ENCRYPTION_KEY) : '';
                    const parsed = JSON.parse(decrypted);
                    if (typeof parsed === 'object' && parsed !== null) {
                        personalServers.push({
                            id: `personal-${uk.id}`,
                            name: uk.name ? (uk.name.includes('(Cá nhân)') ? uk.name : `${uk.name} (Cá nhân)`) : 'ViTTS Cá nhân',
                            baseUrl: (parsed.baseUrl || 'http://117.0.36.6:8888').replace(/\/+$/, ''),
                            apiKey: parsed.apiKey || '',
                        });
                    } else if (decrypted) {
                        personalServers.push({
                            id: `personal-${uk.id}`,
                            name: uk.name ? (uk.name.includes('(Cá nhân)') ? uk.name : `${uk.name} (Cá nhân)`) : 'ViTTS Cá nhân',
                            baseUrl: 'http://117.0.36.6:8888',
                            apiKey: decrypted,
                        });
                    }
                } catch {}
            }

            const allAvailableServers = [...personalServers, ...adminServers.filter(s => s.enabled)];

            // Match server by provider name or voiceId prefix
            let serverMatchId = '';
            if (dto.voiceId && dto.voiceId.startsWith('vitts:')) {
                const parts = dto.voiceId.split(':');
                if (parts.length >= 3) {
                    serverMatchId = parts[1];
                }
            }

            if (serverMatchId) {
                targetServer = allAvailableServers.find(s => s.id === serverMatchId || s.id.includes(serverMatchId)) || null;
            }

            if (!targetServer && dto.provider) {
                const normProvider = dto.provider.replace(/^VITTS_/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
                targetServer = allAvailableServers.find(s =>
                    s.id.toLowerCase().replace(/[^a-z0-9]/g, '') === normProvider ||
                    s.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normProvider
                ) || null;
            }

            // Fallback to first active server
            if (!targetServer && allAvailableServers.length > 0) {
                targetServer = allAvailableServers[0];
            }

            if (targetServer && (targetServer.apiKey || targetServer.baseUrl)) {
                this.logger.log(`Using ViTTS server "${targetServer.name || 'Default'}" at ${targetServer.baseUrl}`);

                // Clean voiceId by removing the serverId prefix (e.g. vitts:server-1:vieneu:Adam -> vieneu:Adam)
                if (dto.voiceId && dto.voiceId.startsWith('vitts:')) {
                    const parts = dto.voiceId.split(':');
                    if (parts.length >= 3) {
                        dto.voiceId = parts.slice(2).join(':');
                    }
                }

                provider = this.ttsFactory.getProvider('VITTS' as any, {
                    apiKey: targetServer.apiKey || '',
                    baseUrl: targetServer.baseUrl,
                });
            } else {
                // Fallback to Gemini TTS
                this.logger.warn('ViTTS not configured (no active server found) - falling back to Gemini TTS');
                const geminiApiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
                if (!geminiApiKey) {
                    throw new Error('No TTS provider configured. Please add Gemini API key or ViTTS credentials in Settings.');
                }
                this.logger.log('Using Gemini TTS as fallback (voice: Puck)');
                provider = this.ttsFactory.getDefaultProvider(geminiApiKey);
                dto.voiceId = 'Puck';
                dto.provider = 'GEMINI';
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
            vittsEngine: (dto as any).vittsEngine,
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

        // Vbee default voices
        const vbeeVoices: Voice[] = [
            {
                id: 'n_thainguyen_male_giangbaitrieuhoa_education_vc',
                name: 'Giọng - Triệu Hòa',
                gender: 'male',
                languageCode: 'vi-VN',
                description: 'Giọng cá nhân Triệu Hòa - Giảng bài giáo dục',
            },
            {
                id: 'hn_female_ngochuyen_full_24k-st',
                name: 'Ngọc Huyền 2.0 (Nữ HN)',
                gender: 'female',
                languageCode: 'vi-VN',
                description: 'Giọng nữ Hà Nội truyền cảm',
            },
            {
                id: 'hn_male_manhdung_full_24k-st',
                name: 'Mạnh Dũng 2.0 (Nam HN)',
                gender: 'male',
                languageCode: 'vi-VN',
                description: 'Giọng nam Hà Nội mạnh mẽ',
            },
            {
                id: 'hn_male_minhquan_yt_24k-pre',
                name: 'Minh Quân Pro (Nam HN)',
                gender: 'male',
                languageCode: 'vi-VN',
                description: 'Giọng nam tự nhiên trẻ trung',
            },
            {
                id: 'sg_female_tuongvy_call_44k-fhg',
                name: 'Tường Vy (Nữ SG)',
                gender: 'female',
                languageCode: 'vi-VN',
                description: 'Giọng nữ Sài Gòn nhẹ nhàng',
            },
            {
                id: 'sg_female_thaotrinh_full_44k-phg',
                name: 'Thảo Trinh (Nữ SG)',
                gender: 'female',
                languageCode: 'vi-VN',
                description: 'Giọng nữ Sài Gòn truyền cảm',
            },
            {
                id: 'hue_female_huonggiang_full_48k-fhg',
                name: 'Hương Giang (Nữ Huế)',
                gender: 'female',
                languageCode: 'vi-VN',
                description: 'Giọng nữ Huế ngọt ngào',
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
