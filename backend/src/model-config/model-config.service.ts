import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { CLIProxyProvider } from '../ai/cliproxy.provider';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Task types for model configuration - must match Prisma TaskType enum
export const TASK_TYPES = ['OUTLINE', 'SLIDES', 'QUESTIONS', 'IMAGE', 'TTS'] as const;
export type TaskTypeValue = typeof TASK_TYPES[number];

export interface AvailableModel {
    name: string;
    displayName: string;
    description?: string;
    supportedTasks: string[];
}

export interface ModelConfigDto {
    taskType: TaskTypeValue;
    provider: string;
    modelName: string;
}

// Default models for each task type - Using Gemini 2.5 models
// NOTE: Image model updated to gemini-2.0-flash-exp-image-generation (2026-01)
const DEFAULT_MODELS: Record<TaskTypeValue, { provider: string; modelName: string }> = {
    OUTLINE: { provider: 'GEMINI', modelName: 'gemini-2.5-pro' },
    SLIDES: { provider: 'GEMINI', modelName: 'gemini-2.5-pro' },
    QUESTIONS: { provider: 'GEMINI', modelName: 'gemini-2.5-pro' },
    IMAGE: { provider: 'GEMINI', modelName: 'gemini-2.0-flash-exp-image-generation' },
    TTS: { provider: 'GEMINI', modelName: 'gemini-2.5-flash-preview-tts' },
};

@Injectable()
export class ModelConfigService {
    private readonly logger = new Logger(ModelConfigService.name);

    constructor(
        private prisma: PrismaService,
        private apiKeysService: ApiKeysService,
        private cliproxy?: CLIProxyProvider,
    ) { }

    /**
     * Get all model configs for a user
     */
    async getUserConfigs(userId: string) {
        const configs = await this.prisma.modelConfig.findMany({
            where: { userId },
        });

        // Return merged with defaults
        const result: Record<string, { provider: string; modelName: string }> = {};

        for (const taskType of TASK_TYPES) {
            const userConfig = configs.find(c => c.taskType === taskType);
            if (userConfig) {
                result[taskType] = {
                    provider: userConfig.provider,
                    modelName: userConfig.modelName,
                };
            } else {
                result[taskType] = DEFAULT_MODELS[taskType];
            }
        }

        return result;
    }

    /**
     * Get model for a specific task type
     */
    async getModelForTask(userId: string, taskType: TaskTypeValue): Promise<{ provider: string; modelName: string }> {
        // Validate userId - must be a non-empty string
        if (!userId || typeof userId !== 'string' || userId.trim() === '') {
            this.logger.warn(`getModelForTask called with invalid userId: ${typeof userId} = ${userId}`);
            return DEFAULT_MODELS[taskType];
        }

        try {
            const config = await this.prisma.modelConfig.findUnique({
                where: {
                    userId_taskType: { userId: userId.trim(), taskType: taskType as any },
                },
            });

            if (config) {
                return { provider: config.provider, modelName: config.modelName };
            }
        } catch (error) {
            this.logger.error(`Error fetching model config for user ${userId}: ${error.message}`);
        }

        return DEFAULT_MODELS[taskType];
    }

    /**
     * Set model for a task type
     */
    async setModelConfig(userId: string, dto: ModelConfigDto) {
        return this.prisma.modelConfig.upsert({
            where: {
                userId_taskType: { userId, taskType: dto.taskType },
            },
            create: {
                userId,
                taskType: dto.taskType,
                provider: dto.provider,
                modelName: dto.modelName,
            },
            update: {
                provider: dto.provider,
                modelName: dto.modelName,
            },
        });
    }

    /**
     * Set multiple model configs at once
     */
    async setMultipleConfigs(userId: string, configs: ModelConfigDto[]) {
        const results: Awaited<ReturnType<typeof this.setModelConfig>>[] = [];
        for (const config of configs) {
            const result = await this.setModelConfig(userId, config);
            results.push(result);
        }
        return results;
    }

    /**
     * Discover available Gemini models using user's API key
     */
    async discoverGeminiModels(userId: string): Promise<AvailableModel[]> {
        const apiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');

        if (!apiKey) {
            throw new Error('No Gemini API key configured. Please add your API key in Settings.');
        }

        try {
            const genAI = new GoogleGenerativeAI(apiKey);

            // Gemini 2.5 models - all capabilities unified under Gemini API
            const knownModels: AvailableModel[] = [
                // Content generation models
                {
                    name: 'gemini-2.5-pro',
                    displayName: 'Gemini 2.5 Pro ⭐',
                    description: 'Best for complex reasoning and content creation',
                    supportedTasks: ['OUTLINE', 'SLIDES', 'QUESTIONS'],
                },
                {
                    name: 'gemini-2.5-flash',
                    displayName: 'Gemini 2.5 Flash',
                    description: 'Fast and efficient for most tasks',
                    supportedTasks: ['OUTLINE', 'SLIDES', 'QUESTIONS'],
                },
                {
                    name: 'gemini-2.0-flash',
                    displayName: 'Gemini 2.0 Flash',
                    description: 'Previous generation, still powerful',
                    supportedTasks: ['OUTLINE', 'SLIDES', 'QUESTIONS'],
                },
                {
                    name: 'gemini-1.5-pro',
                    displayName: 'Gemini 1.5 Pro',
                    description: 'Stable long-context model',
                    supportedTasks: ['OUTLINE', 'SLIDES', 'QUESTIONS'],
                },
                {
                    name: 'gemini-2.0-flash',
                    displayName: 'Gemini 1.5 Flash',
                    description: 'Fast and cost-effective',
                    supportedTasks: ['OUTLINE', 'SLIDES', 'QUESTIONS'],
                },
                // Image generation models
                {
                    name: 'gemini-2.0-flash-exp-image-generation',
                    displayName: 'Gemini 2.0 Flash Image Gen ⭐',
                    description: 'Native image generation with Gemini 2.0 Flash',
                    supportedTasks: ['IMAGE'],
                },
                {
                    name: 'imagen-3.0-generate-002',
                    displayName: 'Imagen 3.0',
                    description: 'High quality dedicated image generation',
                    supportedTasks: ['IMAGE'],
                },
                // TTS models - Gemini (2 models)
                {
                    name: 'gemini-2.5-flash-preview-tts',
                    displayName: 'Gemini 2.5 Flash TTS ⭐',
                    description: 'Fast TTS - Gemini 2.5',
                    supportedTasks: ['TTS'],
                },
                {
                    name: 'gemini-2.5-pro-preview-tts',
                    displayName: 'Gemini 2.5 Pro TTS',
                    description: 'High quality TTS - Gemini 2.5',
                    supportedTasks: ['TTS'],
                },
                // Gemini TTS Voices - Full 30 voices
                { name: 'gemini-voice:Zephyr', displayName: 'Zephyr (Nữ - Tươi sáng)', description: 'Giọng nữ tươi sáng', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Puck', displayName: 'Puck (Nam - Rộn ràng)', description: 'Giọng nam rộn ràng', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Charon', displayName: 'Charon (Cung cấp nhiều thông tin)', description: 'Giọng trầm ấm', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Kore', displayName: 'Kore (Chắc chắn)', description: 'Giọng chắc chắn', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Fenrir', displayName: 'Fenrir (Dễ kích động)', description: 'Giọng sôi nổi', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Leda', displayName: 'Leda (Trẻ trung)', description: 'Giọng trẻ trung', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Orus', displayName: 'Orus (Chắc chắn)', description: 'Giọng đanh thép', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Aoede', displayName: 'Aoede (Nhẹ nhàng)', description: 'Giọng nhẹ nhàng', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Callirrhoe', displayName: 'Callirrhoe (Dễ tính)', description: 'Giọng dễ nghe', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Autonoe', displayName: 'Autonoe (Tươi sáng)', description: 'Giọng vui vẻ', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Enceladus', displayName: 'Enceladus (Thì thầm)', description: 'Giọng thì thầm', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Iapetus', displayName: 'Iapetus (Rõ ràng)', description: 'Giọng rõ ràng', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Umbriel', displayName: 'Umbriel (Dễ tính)', description: 'Giọng thân thiện', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Algieba', displayName: 'Algieba (Mượt mà)', description: 'Giọng mượt mà', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Despina', displayName: 'Despina (Mượt mà)', description: 'Giọng êm dịu', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Erinome', displayName: 'Erinome (Rõ ràng)', description: 'Giọng sắc bén', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Algenib', displayName: 'Algenib (Trầm)', description: 'Giọng trầm', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Rasalgethi', displayName: 'Rasalgethi (Cung cấp nhiều thông tin)', description: 'Giọng thông thái', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Laomedeia', displayName: 'Laomedeia (Rộn ràng)', description: 'Giọng vui tươi', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Achernar', displayName: 'Achernar (Mềm mại)', description: 'Giọng mềm mại', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Alnilam', displayName: 'Alnilam (Chắc chắn)', description: 'Giọng mạnh mẽ', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Schedar', displayName: 'Schedar (Đều đặn)', description: 'Giọng đều đặn', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Gacrux', displayName: 'Gacrux (Trưởng thành)', description: 'Giọng trưởng thành', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Pulcherrima', displayName: 'Pulcherrima (Chuyển tiếp)', description: 'Giọng linh hoạt', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Achird', displayName: 'Achird (Thân thiện)', description: 'Giọng thân thiện', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Zubenelgenubi', displayName: 'Zubenelgenubi (Bình thường)', description: 'Giọng tự nhiên', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Vindemiatrix', displayName: 'Vindemiatrix (Dịu dàng)', description: 'Giọng dịu dàng', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Sadachbia', displayName: 'Sadachbia (Sôi nổi)', description: 'Giọng năng động', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Sadaltager', displayName: 'Sadaltager (Hiểu biết)', description: 'Giọng thông minh', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Sulafat', displayName: 'Sulafat (Ấm áp)', description: 'Giọng ấm áp', supportedTasks: ['TTS_VOICE'] },
                // Vbee TTS Voices - Sample voices
                {
                    name: 'vbee:hn_female_thutrang_news_48k-1',
                    displayName: 'Vbee - Thu Trang (Nữ HN)',
                    description: 'Giọng nữ Hà Nội - Vbee TTS',
                    supportedTasks: ['TTS_VOICE'],
                },
                {
                    name: 'vbee:sg_male_minhhoang_news_48k-1',
                    displayName: 'Vbee - Minh Hoàng (Nam SG)',
                    description: 'Giọng nam Sài Gòn - Vbee TTS',
                    supportedTasks: ['TTS_VOICE'],
                },
                {
                    name: 'vbee:hn_female_maingoc_news_48k-1',
                    displayName: 'Vbee - Mai Ngọc (Nữ HN)',
                    description: 'Giọng nữ Hà Nội - Vbee TTS',
                    supportedTasks: ['TTS_VOICE'],
                },
            ];

            // Verify API key is valid by making a simple request
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
            await model.generateContent('Hello');

            this.logger.log(`Discovered ${knownModels.length} Gemini models for user ${userId}`);
            return knownModels;
        } catch (error: any) {
            this.logger.error(`Failed to discover models: ${error.message}`);
            throw new Error(`Failed to verify API key: ${error.message}`);
        }
    }

    /**
     * Discover available models from CLIProxy
     * Fetches from /v1/models endpoint and categorizes by task type
     */
    async discoverCLIProxyModels(): Promise<AvailableModel[]> {
        if (!this.cliproxy) {
            return [];
        }

        try {
            const isEnabled = await this.cliproxy.isEnabled();
            if (!isEnabled) {
                return [];
            }

            const modelList = await this.cliproxy.listModels();
            const models: AvailableModel[] = [];

            for (const model of modelList) {
                const modelId = model.id;
                const supportedTasks: string[] = [];

                // Categorize models based on their capabilities
                if (modelId.includes('flash') || modelId.includes('pro')) {
                    if (!modelId.includes('image') && !modelId.includes('tts')) {
                        supportedTasks.push('OUTLINE', 'SLIDES', 'QUESTIONS');
                    }
                }
                if (modelId.includes('image') || modelId.includes('imagen')) {
                    supportedTasks.push('IMAGE');
                }
                if (modelId.includes('tts')) {
                    supportedTasks.push('TTS');
                }

                // Skip if no supported tasks (e.g., embeddings)
                if (supportedTasks.length === 0) {
                    // Default to text tasks for generic models
                    if (modelId.includes('gemini') || modelId.includes('claude')) {
                        supportedTasks.push('OUTLINE', 'SLIDES', 'QUESTIONS');
                    } else {
                        continue;
                    }
                }

                models.push({
                    name: `cliproxy:${modelId}`,
                    displayName: `🌐 ${modelId}`,
                    description: `via CLIProxy (${model.owned_by || 'shared'})`,
                    supportedTasks,
                });
            }

            this.logger.log(`Discovered ${models.length} CLIProxy models`);
            return models;
        } catch (error: any) {
            this.logger.error(`Failed to discover CLIProxy models: ${error.message}`);
            return [];
        }
    }

    /**
     * Discover Vbee personal voices using user's API token
     */
    async discoverVbeeVoices(userId: string): Promise<AvailableModel[]> {
        // Always include hardcoded known voices
        const knownVoices: AvailableModel[] = [
            {
                name: 'vbee:n_thainguyen_male_giangbaitrieuhoa_education_vc',
                displayName: 'Vbee - Giọng Triệu Hòa 👨 (Giảng bài)',
                description: 'Giọng cá nhân - Giảng bài giáo dục',
                supportedTasks: ['TTS', 'TTS_VOICE'],
            },
        ];

        const vbeeToken = await this.apiKeysService.getActiveKey(userId, 'VBEE');

        if (!vbeeToken) {
            this.logger.log('No Vbee token configured, returning known voices only');
            return knownVoices;
        }

        try {
            const VBEE_VOICES_ENDPOINT = 'https://vbee.vn/api/v1/voices';

            const response = await fetch(VBEE_VOICES_ENDPOINT, {
                headers: { 'Authorization': `Bearer ${vbeeToken}` },
            });

            if (!response.ok) {
                throw new Error(`Vbee API returned ${response.status}`);
            }

            const data = await response.json();
            const voices: AvailableModel[] = [];

            if (data.status === 1 && data.result) {
                // data.result is a dictionary: { voice_code: voice_details }
                for (const [voiceCode, voiceDetails] of Object.entries(data.result)) {
                    const details = voiceDetails as any;
                    // Filter for personal voices like the Python code
                    if (details.voice_ownership === 'PERSONAL' || details.voice_ownership === 'SYSTEM') {
                        const displayName = details.name || voiceCode;
                        const gender = details.gender === 'female' ? '👩' : '👨';
                        const region = details.locale === 'vi-VN-x-south' ? 'SG' : 'HN';

                        voices.push({
                            name: `vbee:${voiceCode}`,
                            displayName: `Vbee - ${displayName} ${gender} (${region})`,
                            description: `${details.voice_ownership} - ${details.locale || 'vi-VN'}`,
                            supportedTasks: ['TTS'],
                        });
                    }
                }
            }

            this.logger.log(`Discovered ${voices.length} Vbee voices for user ${userId}`);
            // Merge with known voices (remove duplicates by name)
            const allVoices = [...knownVoices];
            for (const voice of voices) {
                if (!allVoices.find(v => v.name === voice.name)) {
                    allVoices.push(voice);
                }
            }
            return allVoices;
        } catch (error: any) {
            this.logger.error(`Failed to discover Vbee voices: ${error.message}`);
            return knownVoices; // Return known voices even on error
        }
    }

    /**
     * Discover ViTTS voices - fetches saved refs and trained voices from API
     * Priority order: 1) Saved references (default), 2) Trained voices, 3) System voices
     */
    async discoverViTTSVoices(userId: string): Promise<AvailableModel[]> {
        // System voices are always available as fallback
        const systemVoices: AvailableModel[] = [
            {
                name: 'vitts:male',
                displayName: 'ViTTS - Nam (Hệ thống)',
                description: 'Giọng nam hệ thống - ViTTS Local',
                supportedTasks: ['TTS', 'TTS_VOICE'],
            },
            {
                name: 'vitts:female',
                displayName: 'ViTTS - Nữ (Hệ thống)',
                description: 'Giọng nữ hệ thống - ViTTS Local',
                supportedTasks: ['TTS', 'TTS_VOICE'],
            },
        ];

        // Try to get user's ViTTS credentials
        const vittsCredentialsJson = await this.apiKeysService.getActiveKey(userId, 'VITTS' as any);

        if (!vittsCredentialsJson) {
            this.logger.log('No ViTTS credentials configured, returning system voices only');
            return systemVoices;
        }

        try {
            const credentials = JSON.parse(vittsCredentialsJson);
            const apiKey = credentials.apiKey;
            const baseUrl = credentials.baseUrl || 'http://117.0.36.6:8000';

            const savedRefs: AvailableModel[] = [];
            const trainedVoices: AvailableModel[] = [];

            // 1. Fetch saved references (top priority)
            try {
                const refsResponse = await fetch(`${baseUrl}/api/v1/refs`, {
                    headers: { 'x-api-key': apiKey },
                });
                if (refsResponse.ok) {
                    const refsData = await refsResponse.json();
                    // API returns array directly, not {refs: [...]}
                    const refsArray = Array.isArray(refsData) ? refsData : (refsData.refs || []);
                    for (const ref of refsArray) {
                        savedRefs.push({
                            name: `vitts:ref:${ref.id}`,
                            displayName: `ViTTS - ${ref.name || ref.id} 🎤`,
                            description: 'Giọng tham chiếu đã lưu - ViTTS',
                            supportedTasks: ['TTS', 'TTS_VOICE'],
                        });
                    }
                    this.logger.log(`ViTTS refs response: ${refsArray.length} items`);
                } else {
                    this.logger.warn(`ViTTS refs API returned ${refsResponse.status}`);
                }
            } catch (refError: any) {
                this.logger.warn(`Failed to fetch ViTTS saved refs: ${refError.message}`);
            }

            // 2. Fetch trained voices (second priority)
            try {
                const voicesResponse = await fetch(`${baseUrl}/api/v1/users/voices`, {
                    headers: { 'x-api-key': apiKey },
                });
                if (voicesResponse.ok) {
                    const voicesData = await voicesResponse.json();
                    // API returns array directly, not {voices: [...]}
                    const voicesArray = Array.isArray(voicesData) ? voicesData : (voicesData.voices || []);
                    for (const voice of voicesArray) {
                        trainedVoices.push({
                            name: `vitts:trained_${voice.id}`,
                            displayName: `ViTTS - ${voice.name || voice.id} 🎓`,
                            description: 'Giọng đã train - ViTTS',
                            supportedTasks: ['TTS', 'TTS_VOICE'],
                        });
                    }
                    this.logger.log(`ViTTS trained voices response: ${voicesArray.length} items`);
                } else {
                    this.logger.warn(`ViTTS trained voices API returned ${voicesResponse.status}`);
                }
            } catch (voiceError: any) {
                this.logger.warn(`Failed to fetch ViTTS trained voices: ${voiceError.message}`);
            }

            // Return in priority order: refs -> trained -> system
            const allVoices = [...savedRefs, ...trainedVoices, ...systemVoices];
            this.logger.log(`Discovered ${savedRefs.length} refs, ${trainedVoices.length} trained, ${systemVoices.length} system ViTTS voices`);
            return allVoices;
        } catch (error: any) {
            this.logger.error(`Failed to parse ViTTS credentials: ${error.message}`);
            return systemVoices;
        }
    }

    /**
     * Get all available models - Gemini + CLIProxy + Vbee + ViTTS
     */
    async getAllAvailableModels(userId: string) {
        const models: Record<string, AvailableModel[]> = {
            GEMINI: [],
            CLIPROXY: [],
        };

        // Try to discover Gemini models (includes text, image, and base TTS)
        try {
            models.GEMINI = await this.discoverGeminiModels(userId);
        } catch (error) {
            // Return default list if discovery fails
            models.GEMINI = [
                {
                    name: 'gemini-2.5-pro',
                    displayName: 'Gemini 2.5 Pro (Default)',
                    description: 'Best for content creation',
                    supportedTasks: ['OUTLINE', 'SLIDES', 'QUESTIONS'],
                },
                {
                    name: 'gemini-2.0-flash-exp-image-generation',
                    displayName: 'Gemini 2.0 Flash Image Gen (Default)',
                    description: 'Image generation',
                    supportedTasks: ['IMAGE'],
                },
                {
                    name: 'gemini-2.5-flash-preview-tts',
                    displayName: 'Gemini 2.5 TTS (Default)',
                    description: 'Text-to-speech',
                    supportedTasks: ['TTS'],
                },
            ];
        }

        // Discover CLIProxy models if enabled
        try {
            const cliproxyModels = await this.discoverCLIProxyModels();
            if (cliproxyModels.length > 0) {
                models.CLIPROXY = cliproxyModels;
                this.logger.log(`Added ${cliproxyModels.length} CLIProxy models`);
            }
        } catch (error: any) {
            this.logger.warn(`CLIProxy model discovery failed: ${error.message}`);
        }

        // Add Vbee personal voices (if Vbee token is configured)
        try {
            const vbeeVoices = await this.discoverVbeeVoices(userId);
            if (vbeeVoices.length > 0) {
                // Merge Vbee voices into the GEMINI array (they'll be filtered by supportedTasks)
                models.GEMINI = [...models.GEMINI, ...vbeeVoices];
                this.logger.log(`Added ${vbeeVoices.length} Vbee voices to available models`);
            }
        } catch (error: any) {
            this.logger.warn(`Vbee voice discovery failed: ${error.message}`);
        }

        // Add ViTTS voices (refs -> trained -> system, in priority order)
        try {
            const vittsVoices = await this.discoverViTTSVoices(userId);
            if (vittsVoices.length > 0) {
                models.GEMINI = [...models.GEMINI, ...vittsVoices];
                this.logger.log(`Added ${vittsVoices.length} ViTTS voices to available models`);
            }
        } catch (error: any) {
            this.logger.warn(`ViTTS voice discovery failed: ${error.message}`);
        }

        return models;
    }

    /**
     * Get default models - uses CLIProxy admin defaults if enabled
     */
    async getDefaults(): Promise<Record<TaskTypeValue, { provider: string; modelName: string }>> {
        // Start with hardcoded defaults
        const defaults = { ...DEFAULT_MODELS };

        this.logger.debug(`getDefaults: cliproxy injected = ${!!this.cliproxy}`);

        // Try to get CLIProxy admin defaults
        if (this.cliproxy) {
            try {
                const isEnabled = await this.cliproxy.isEnabled();
                this.logger.debug(`getDefaults: CLIProxy isEnabled = ${isEnabled}`);

                if (isEnabled) {
                    const cliproxyConfig = await this.cliproxy.getConfig();
                    this.logger.debug(`getDefaults: CLIProxy config = ${JSON.stringify(cliproxyConfig)}`);

                    // Override text model defaults with CLIProxy admin setting
                    if (cliproxyConfig.defaultTextModel) {
                        defaults.OUTLINE = { provider: 'CLIPROXY', modelName: cliproxyConfig.defaultTextModel };
                        defaults.SLIDES = { provider: 'CLIPROXY', modelName: cliproxyConfig.defaultTextModel };
                        defaults.QUESTIONS = { provider: 'CLIPROXY', modelName: cliproxyConfig.defaultTextModel };
                    }

                    // Override image model default
                    if (cliproxyConfig.defaultImageModel) {
                        defaults.IMAGE = { provider: 'CLIPROXY', modelName: cliproxyConfig.defaultImageModel };
                    }

                    this.logger.log(`Using CLIProxy admin defaults: text=${cliproxyConfig.defaultTextModel}, image=${cliproxyConfig.defaultImageModel}`);
                }
            } catch (error: any) {
                this.logger.warn(`Failed to get CLIProxy config: ${error.message}`);
            }
        }

        this.logger.debug(`getDefaults: returning = ${JSON.stringify(defaults)}`);
        return defaults;
    }
}
