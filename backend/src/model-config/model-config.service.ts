import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { CLIProxyProvider } from '../ai/cliproxy.provider';

// Task types for model configuration - must match Prisma TaskType enum
export const TASK_TYPES = ['OUTLINE', 'SLIDES', 'SPEAKER_NOTES', 'QUESTIONS', 'IMAGE', 'TTS'] as const;
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
    SPEAKER_NOTES: { provider: 'GEMINI', modelName: 'gemini-2.5-pro' },
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

        // Return merged with admin defaults (not hardcoded)
        const result: Record<string, { provider: string; modelName: string }> = {};
        const adminDefaults = await this.getDefaults();

        for (const taskType of TASK_TYPES) {
            const userConfig = configs.find(c => c.taskType === taskType);
            if (userConfig) {
                result[taskType] = {
                    provider: userConfig.provider,
                    modelName: userConfig.modelName,
                };
            } else {
                result[taskType] = adminDefaults[taskType];
            }
        }

        return result;
    }

    /**
     * Get model for a specific task type
     * Priority: User setting > Admin setting (CLIProxy) > System default
     * This is the FAST method - no network calls, just DB lookup
     */
    async getModelForTask(userId: string, taskType: TaskTypeValue): Promise<{ provider: string; modelName: string }> {
        // Validate userId - must be a non-empty string
        if (!userId || typeof userId !== 'string' || userId.trim() === '') {
            this.logger.warn(`getModelForTask called with invalid userId: ${typeof userId} = ${userId}`);
            return this.getDefaultForTask(taskType);
        }

        try {
            // Priority 1: Check user's own config
            const config = await this.prisma.modelConfig.findUnique({
                where: {
                    userId_taskType: { userId: userId.trim(), taskType: taskType as any },
                },
            });

            if (config) {
                this.logger.debug(`[getModelForTask] User ${userId} has custom config for ${taskType}: ${config.modelName}`);
                return { provider: config.provider, modelName: config.modelName };
            }
        } catch (error) {
            this.logger.error(`Error fetching model config for user ${userId}: ${error.message}`);
        }

        // Priority 2 & 3: Admin (CLIProxy) defaults, then system defaults
        return this.getDefaultForTask(taskType);
    }

    /**
     * Get default model for a task (Admin > System)
     * Fast method - uses cached CLIProxy config if available
     */
    private async getDefaultForTask(taskType: TaskTypeValue): Promise<{ provider: string; modelName: string }> {
        // Check admin defaults (stored in system_configs table)
        if (this.cliproxy) {
            try {
                const isEnabled = await this.cliproxy.isEnabled();
                if (isEnabled) {
                    const cliproxyConfig = await this.cliproxy.getConfig();

                    if (taskType === 'OUTLINE' || taskType === 'SLIDES' || taskType === 'SPEAKER_NOTES' || taskType === 'QUESTIONS') {
                        if (cliproxyConfig.defaultTextModel) {
                            return { provider: 'CLIPROXY', modelName: cliproxyConfig.defaultTextModel };
                        }
                    }
                    if (taskType === 'IMAGE' && cliproxyConfig.defaultImageModel) {
                        return { provider: 'CLIPROXY', modelName: cliproxyConfig.defaultImageModel };
                    }
                    if (taskType === 'TTS' && cliproxyConfig.defaultTTSModel) {
                        return { provider: 'GEMINI', modelName: cliproxyConfig.defaultTTSModel };
                    }
                }
            } catch (error: any) {
                this.logger.warn(`Failed to get CLIProxy config: ${error.message}`);
            }
        }

        // Fallback to system defaults
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
     * Known model display names and task assignments
     * Used to enrich dynamically discovered models with friendly names
     */
    private readonly KNOWN_GEMINI_MODELS: Record<string, { displayName: string; description: string; supportedTasks: string[] }> = {
        'gemini-2.5-pro': { displayName: 'Gemini 2.5 Pro ⭐', description: 'Best for complex reasoning and content creation', supportedTasks: ['OUTLINE', 'SLIDES', 'QUESTIONS'] },
        'gemini-2.5-flash': { displayName: 'Gemini 2.5 Flash', description: 'Fast and efficient for most tasks', supportedTasks: ['OUTLINE', 'SLIDES', 'QUESTIONS'] },
        'gemini-2.0-flash': { displayName: 'Gemini 2.0 Flash', description: 'Previous generation, still powerful', supportedTasks: ['OUTLINE', 'SLIDES', 'QUESTIONS'] },
        'gemini-1.5-pro': { displayName: 'Gemini 1.5 Pro', description: 'Stable long-context model', supportedTasks: ['OUTLINE', 'SLIDES', 'QUESTIONS'] },
        'gemini-1.5-flash': { displayName: 'Gemini 1.5 Flash', description: 'Fast and cost-effective', supportedTasks: ['OUTLINE', 'SLIDES', 'QUESTIONS'] },
        'gemini-2.0-flash-exp-image-generation': { displayName: 'Gemini 2.0 Flash Image Gen ⭐', description: 'Native image generation', supportedTasks: ['IMAGE'] },
        'imagen-3.0-generate-002': { displayName: 'Imagen 3.0', description: 'High quality image generation', supportedTasks: ['IMAGE'] },
        'gemini-2.5-flash-preview-tts': { displayName: 'Gemini 2.5 Flash TTS ⭐', description: 'Fast TTS', supportedTasks: ['TTS'] },
        'gemini-2.5-pro-preview-tts': { displayName: 'Gemini 2.5 Pro TTS', description: 'High quality TTS', supportedTasks: ['TTS'] },
    };

    /**
     * Classify a Gemini model ID into supported tasks
     */
    private classifyGeminiModel(modelId: string): string[] {
        const id = modelId.toLowerCase();
        if (id.includes('tts')) return ['TTS'];
        if (id.includes('image') || id.includes('imagen')) return ['IMAGE'];
        if (id.includes('embedding') || id.includes('aqa') || id.includes('retrieval')) return []; // skip non-generative
        // Default: text generation tasks
        return ['OUTLINE', 'SLIDES', 'SPEAKER_NOTES', 'QUESTIONS'];
    }

    /**
     * Discover available Gemini models dynamically using the API
     * Falls back to known models list if API call fails
     */
    async discoverGeminiModels(userId: string): Promise<AvailableModel[]> {
        const apiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');

        if (!apiKey) {
            // No key available — return known models list instead of throwing
            this.logger.warn('No Gemini API key available, returning known models only');
            const knownModels: AvailableModel[] = Object.entries(this.KNOWN_GEMINI_MODELS)
                .map(([name, info]) => ({ name, ...info }));
            // Also add TTS voices
            knownModels.push(
                { name: 'gemini-voice:Zephyr', displayName: 'Zephyr (Nữ - Tươi sáng)', description: 'Giọng nữ tươi sáng', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Puck', displayName: 'Puck (Nam - Rộn ràng)', description: 'Giọng nam rộn ràng', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Charon', displayName: 'Charon (Cung cấp nhiều thông tin)', description: 'Giọng trầm ấm', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Kore', displayName: 'Kore (Chắc chắn)', description: 'Giọng chắc chắn', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Fenrir', displayName: 'Fenrir (Dễ kích động)', description: 'Giọng sôi nổi', supportedTasks: ['TTS_VOICE'] },
                { name: 'gemini-voice:Aoede', displayName: 'Aoede (Nhẹ nhàng)', description: 'Giọng nhẹ nhàng', supportedTasks: ['TTS_VOICE'] },
            );
            return knownModels;
        }

        try {
            // Dynamically fetch models from Gemini API
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`
            );

            const discoveredModels: AvailableModel[] = [];
            const seenNames = new Set<string>();

            if (response.ok) {
                const data = await response.json();
                const apiModels = data.models || [];

                for (const model of apiModels) {
                    // model.name is like "models/gemini-2.5-pro" — extract the ID
                    const modelId = (model.name || '').replace('models/', '');
                    if (!modelId || seenNames.has(modelId)) continue;

                    // Classify tasks
                    const supportedTasks = this.classifyGeminiModel(modelId);
                    if (supportedTasks.length === 0) continue; // Skip embeddings etc.

                    // Use known display name if available, otherwise format from ID
                    const known = this.KNOWN_GEMINI_MODELS[modelId];
                    discoveredModels.push({
                        name: modelId,
                        displayName: known?.displayName || this.formatModelDisplayName(modelId),
                        description: known?.description || model.description || model.displayName || '',
                        supportedTasks: known?.supportedTasks || supportedTasks,
                    });
                    seenNames.add(modelId);
                }

                this.logger.log(`Discovered ${discoveredModels.length} Gemini models from API`);
            } else {
                this.logger.warn(`Gemini API listModels returned ${response.status}, falling back to known models`);
            }

            // If API returned models, use them; otherwise fall back to known list
            if (discoveredModels.length > 0) {
                // Add known models that weren't in the API response (like imagen)
                for (const [name, info] of Object.entries(this.KNOWN_GEMINI_MODELS)) {
                    if (!seenNames.has(name)) {
                        discoveredModels.push({ name, ...info });
                    }
                }
            } else {
                // Fallback: use the static known models list
                for (const [name, info] of Object.entries(this.KNOWN_GEMINI_MODELS)) {
                    discoveredModels.push({ name, ...info });
                }
            }

            // Always add TTS voices (static, not from API)
            discoveredModels.push(
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
                { name: 'vbee:hn_female_thutrang_news_48k-1', displayName: 'Vbee - Thu Trang (Nữ HN)', description: 'Giọng nữ Hà Nội - Vbee TTS', supportedTasks: ['TTS_VOICE'] },
                { name: 'vbee:sg_male_minhhoang_news_48k-1', displayName: 'Vbee - Minh Hoàng (Nam SG)', description: 'Giọng nam Sài Gòn - Vbee TTS', supportedTasks: ['TTS_VOICE'] },
                { name: 'vbee:hn_female_maingoc_news_48k-1', displayName: 'Vbee - Mai Ngọc (Nữ HN)', description: 'Giọng nữ Hà Nội - Vbee TTS', supportedTasks: ['TTS_VOICE'] },
            );

            return discoveredModels;
        } catch (error: any) {
            this.logger.error(`Failed to discover models: ${error.message}`);
            throw new Error(`Failed to get models: ${error.message}`);
        }
    }

    /**
     * Format a model ID into a human-readable display name
     * e.g. "gemini-2.5-ultra-latest" → "Gemini 2.5 Ultra Latest"
     */
    private formatModelDisplayName(modelId: string): string {
        return modelId
            .split(/[-_]/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Discover available models from CLIProxy
     * Fetches from /v1/models endpoint and categorizes by task type
     */
    /**
     * Classify a CLIProxy model ID into supported tasks
     * Default: all models get text tasks unless they are specifically image/tts/embedding
     */
    private classifyCLIProxyModel(modelId: string): string[] {
        const id = modelId.toLowerCase();

        // Skip non-generative models
        if (id.includes('embedding') || id.includes('retrieval') || id.includes('moderation')) {
            return [];
        }

        const tasks: string[] = [];

        // Image-specific models
        if (id.includes('image') || id.includes('imagen') || id.includes('dall-e')) {
            tasks.push('IMAGE');
        }

        // TTS-specific models
        if (id.includes('tts') || id.includes('speech')) {
            tasks.push('TTS');
        }

        // If not specifically image/tts, or if it's a general-purpose model, assign text tasks
        if (tasks.length === 0) {
            tasks.push('OUTLINE', 'SLIDES', 'SPEAKER_NOTES', 'QUESTIONS');
        }

        return tasks;
    }

    /**
     * Discover available models from CLIProxy
     * Fetches from /v1/models endpoint and categorizes by task type
     * All models are included by default (GPT, Claude, Gemini, etc.)
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
                const supportedTasks = this.classifyCLIProxyModel(modelId);

                // Skip non-generative models (embeddings, moderation)
                if (supportedTasks.length === 0) {
                    continue;
                }

                models.push({
                    name: `cliproxy:${modelId}`,
                    displayName: `🌐 ${modelId}`,
                    description: `via CLIProxy (${model.owned_by || 'shared'})`,
                    supportedTasks,
                });
            }

            this.logger.log(`Discovered ${models.length} CLIProxy models (from ${modelList.length} total)`);
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
            // Use direct IP instead of Cloudflare tunnel to avoid 530 errors
            const baseUrl = 'http://117.0.36.6:8000';

            this.logger.log(`ViTTS credentials: baseUrl=${baseUrl}, apiKey=${apiKey?.substring(0, 8)}...`);

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
                        defaults.SPEAKER_NOTES = { provider: 'CLIPROXY', modelName: cliproxyConfig.defaultTextModel };
                        defaults.QUESTIONS = { provider: 'CLIPROXY', modelName: cliproxyConfig.defaultTextModel };
                    }

                    // Override image model default
                    if (cliproxyConfig.defaultImageModel) {
                        defaults.IMAGE = { provider: 'CLIPROXY', modelName: cliproxyConfig.defaultImageModel };
                    }

                    // Override TTS model default (uses GEMINI provider, not CLIProxy)
                    if (cliproxyConfig.defaultTTSModel) {
                        defaults.TTS = { provider: 'GEMINI', modelName: cliproxyConfig.defaultTTSModel };
                    }

                    this.logger.log(`Using admin defaults: text=${cliproxyConfig.defaultTextModel}, image=${cliproxyConfig.defaultImageModel}, tts=${cliproxyConfig.defaultTTSModel}`);
                }
            } catch (error: any) {
                this.logger.warn(`Failed to get CLIProxy config: ${error.message}`);
            }
        }

        this.logger.debug(`getDefaults: returning = ${JSON.stringify(defaults)}`);
        return defaults;
    }
}
