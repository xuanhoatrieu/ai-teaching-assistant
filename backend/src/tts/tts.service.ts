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

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

@Injectable()
export class TTSService {
    private readonly logger = new Logger(TTSService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly ttsFactory: TTSFactory,
        @Inject(forwardRef(() => ApiKeysService))
        private readonly apiKeysService: ApiKeysService,
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

        // Route based on provider parameter
        if (dto.provider === 'VBEE') {
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
            // Get ViTTS credentials (stored as JSON: {"apiKey": "xxx", "baseUrl": "yyy"})
            const vittsCredentialsJson = await this.apiKeysService.getActiveKey(userId, 'VITTS' as any);

            if (!vittsCredentialsJson) {
                // AUTO-FALLBACK: ViTTS not configured, try Gemini TTS instead
                this.logger.warn('ViTTS API key not configured - falling back to Gemini TTS');
                const geminiApiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
                if (!geminiApiKey) {
                    throw new Error('No TTS provider configured. Please add Gemini API key or ViTTS credentials in Settings.');
                }
                this.logger.log('Using Gemini TTS as fallback (voice: Puck)');
                provider = this.ttsFactory.getDefaultProvider(geminiApiKey);
                dto.voiceId = 'Puck';
                dto.provider = 'GEMINI';
            } else {
                // Parse ViTTS credentials
                try {
                    const vittsCredentials = JSON.parse(vittsCredentialsJson);
                    if (!vittsCredentials.apiKey) {
                        throw new Error('Invalid ViTTS credentials format. Expected: {"apiKey": "xxx", "baseUrl": "yyy"}');
                    }

                    this.logger.log(`Using ViTTS provider with baseUrl: ${vittsCredentials.baseUrl || 'default'}`);
                    provider = this.ttsFactory.getProvider('VITTS' as any, {
                        apiKey: vittsCredentials.apiKey,
                        baseUrl: vittsCredentials.baseUrl,
                    });
                } catch (parseError) {
                    throw new Error(`Invalid ViTTS credentials JSON: ${parseError.message}`);
                }
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
