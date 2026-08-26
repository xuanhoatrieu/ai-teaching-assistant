import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { CLIProxyProvider } from '../ai/cliproxy.provider';
import { SystemConfigService } from '../settings/system-config.service';
import { CustomOpenAIProvider } from '../ai/custom-openai.provider';
import { CryptoUtil } from '../common/crypto.util';

// Task types for model configuration - must match Prisma TaskType enum
export const TASK_TYPES = ['OUTLINE', 'SLIDES', 'SPEAKER_NOTES', 'QUESTIONS', 'IMAGE', 'TTS', 'EMBEDDING'] as const;
export type TaskTypeValue = typeof TASK_TYPES[number];

// Last-resort ViTTS base URL (production public IP). Only used when neither the
// user's personal key nor the admin system config provides a baseUrl. Configured
// values from admin/user settings always take precedence so the IP can change
// without touching code.
const DEFAULT_VITTS_BASE_URL = 'http://117.0.36.6:8888';

export interface AvailableModel {
    name: string;
    displayName: string;
    description?: string;
    supportedTasks: string[];
    source?: string;
}

export interface ModelConfigDto {
    taskType: TaskTypeValue;
    provider: string;
    modelName: string;
}

// Default models for each task type
// NOTE: These are LAST-RESORT fallbacks. CLIProxy admin config overrides them.
// TTS default: ViTTS OmniVoice → Voice Design → Male
// Image default: gpt-image-2 via CLIProxy
const DEFAULT_MODELS: Record<TaskTypeValue, { provider: string; modelName: string }> = {
    OUTLINE: { provider: 'CLIPROXY', modelName: 'gpt-5.5' },
    SLIDES: { provider: 'CLIPROXY', modelName: 'gpt-5.5' },
    SPEAKER_NOTES: { provider: 'CLIPROXY', modelName: 'gpt-5.5' },
    QUESTIONS: { provider: 'CLIPROXY', modelName: 'gpt-5.5' },
    IMAGE: { provider: 'CLIPROXY', modelName: 'gpt-image-2' },
    TTS: { provider: 'VITTS', modelName: 'vitts:design' },
    EMBEDDING: { provider: 'GEMINI', modelName: 'text-embedding-004' },
};

@Injectable()
export class ModelConfigService {
    private readonly logger = new Logger(ModelConfigService.name);
    private readonly crypto = new CryptoUtil();
    private availableModelsCache = new Map<string, { data: Record<string, AvailableModel[]>; expiresAt: number }>();
    private vittsOptionsCache = new Map<string, { data: any; expiresAt: number }>();

    constructor(
        private prisma: PrismaService,
        private apiKeysService: ApiKeysService,
        private cliproxy?: CLIProxyProvider,
        private systemConfigService?: SystemConfigService,
        private customOpenAI?: CustomOpenAIProvider,
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
    async getDefaultForTask(taskType: TaskTypeValue): Promise<{ provider: string; modelName: string }> {
        // For TTS: Check ViTTS admin config FIRST (priority over CLIProxy TTS)
        if (taskType === 'TTS') {
            try {
                const vittsEnabled = await this.prisma.systemConfig.findUnique({ where: { key: 'vitts.enabled' } });
                if (vittsEnabled?.value === 'true') {
                    const vittsVoice = await this.prisma.systemConfig.findUnique({ where: { key: 'vitts.defaultVoice' } });
                    const modelName = vittsVoice?.value || 'vitts:design';
                    return { provider: 'VITTS', modelName };
                }
            } catch (error: any) {
                this.logger.warn(`Failed to get ViTTS config: ${error.message}`);
            }
        }

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
                    // TTS from CLIProxy only if ViTTS admin not enabled (already checked above)
                    if (taskType === 'TTS' && cliproxyConfig.defaultTTSModel) {
                        return { provider: 'CLIPROXY', modelName: cliproxyConfig.defaultTTSModel };
                    }
                    if (taskType === 'EMBEDDING' && (cliproxyConfig as any).defaultEmbeddingModel) {
                        return { provider: 'CLIPROXY', modelName: (cliproxyConfig as any).defaultEmbeddingModel };
                    }
                }
            } catch (error: any) {
                this.logger.warn(`Failed to get CLIProxy config: ${error.message}`);
            }
        }

        // Priority 3: Check ImageGen config (for IMAGE task)
        if (taskType === 'IMAGE' && this.systemConfigService) {
            try {
                const imageGenConfig = await this.systemConfigService.getImageGenConfig();
                if (imageGenConfig.enabled && imageGenConfig.defaultModel) {
                    return { provider: 'IMAGE_GEN', modelName: imageGenConfig.defaultModel };
                }
            } catch (error: any) {
                this.logger.warn(`Failed to get ImageGen config: ${error.message}`);
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
        'text-embedding-004': { displayName: 'Text Embedding 004 ⭐', description: 'Embedding cho RAG tài liệu', supportedTasks: ['EMBEDDING'] },
    };

    /**
     * Classify a Gemini model ID into supported tasks
     */
    private classifyGeminiModel(modelId: string): string[] {
        const id = modelId.toLowerCase();
        if (id.includes('tts')) return ['TTS'];
        if (id.includes('image') || id.includes('imagen')) return ['IMAGE'];
        if (id.includes('embedding')) return ['EMBEDDING'];
        if (id.includes('aqa') || id.includes('retrieval')) return []; // skip non-generative
        // Default: text generation tasks
        return ['OUTLINE', 'SLIDES', 'SPEAKER_NOTES', 'QUESTIONS'];
    }

    /**
     * Discover available Gemini models dynamically using the API
     * Falls back to known models list if API call fails
     */
    async discoverGeminiModels(userId: string): Promise<AvailableModel[]> {
        const apiKey = await this.apiKeysService.getActiveKey(userId, 'GEMINI');
        let discoveredModels: AvailableModel[] = [];
        const seenNames = new Set<string>();

        if (!apiKey) {
            // No key available — use known models list
            this.logger.warn('No Gemini API key available, using known models only');
            for (const [name, info] of Object.entries(this.KNOWN_GEMINI_MODELS)) {
                discoveredModels.push({ name, ...info });
                seenNames.add(name);
            }
        } else {
            try {
                // Dynamically fetch models from Gemini API
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`
                );

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

                    // Save best models per category to DB for other services to use dynamically
                    if (this.systemConfigService) {
                        const bestImage = discoveredModels.find(m => m.supportedTasks.includes('IMAGE'));
                        const bestTTS = discoveredModels.find(m => m.supportedTasks.includes('TTS'));
                        const bestText = discoveredModels.find(m =>
                            m.supportedTasks.includes('OUTLINE') && m.name.includes('pro'),
                        ) || discoveredModels.find(m => m.supportedTasks.includes('OUTLINE'));

                        if (bestImage) {
                            await this.systemConfigService.setDiscoveredGeminiModel('image', bestImage.name);
                        }
                        if (bestTTS) {
                            await this.systemConfigService.setDiscoveredGeminiModel('tts', bestTTS.name);
                        }
                        if (bestText) {
                            await this.systemConfigService.setDiscoveredGeminiModel('text', bestText.name);
                        }
                        this.logger.log(`Saved discovered Gemini models: text=${bestText?.name}, image=${bestImage?.name}, tts=${bestTTS?.name}`);
                    }
                } else {
                    this.logger.warn(`Gemini API listModels returned ${response.status}, falling back to known models`);
                }
            } catch (error: any) {
                this.logger.error(`Failed to dynamically fetch models from Gemini API: ${error.message}`);
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
        }

        // Always add Gemini static TTS voices
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

        // Add Custom OpenAI dynamic voices
        if (this.customOpenAI) {
            try {
                const customProviders = await this.customOpenAI.getProviders();
                for (const cp of customProviders) {
                    if (cp.enabled && cp.ttsType !== 'none') {
                        if (cp.ttsType === 'shopaikey') {
                            const voicesList = [
                                { id: 'Zephyr', displayName: 'Gemini - Zephyr (Nữ)', gender: 'female', desc: 'Giọng nữ tươi sáng (Google)' },
                                { id: 'Puck', displayName: 'Gemini - Puck (Nam)', gender: 'male', desc: 'Giọng nam trầm ấm (Google)' },
                                { id: 'Charon', displayName: 'Gemini - Charon (Ấm áp)', gender: 'male', desc: 'Giọng trầm ấm (Google)' },
                                { id: 'Kore', displayName: 'Gemini - Kore (Chắc chắn)', gender: 'male', desc: 'Giọng chắc chắn (Google)' },
                                { id: 'Aoede', displayName: 'Gemini - Aoede (Nhẹ nhàng)', gender: 'female', desc: 'Giọng nhẹ nhàng (Google)' },
                                { id: 'alloy', displayName: 'OpenAI - Alloy (Trung tính)', gender: 'male', desc: 'Giọng OpenAI Alloy' },
                                { id: 'echo', displayName: 'OpenAI - Echo (Nam)', gender: 'male', desc: 'Giọng OpenAI Echo' },
                                { id: 'fable', displayName: 'OpenAI - Fable (Nam)', gender: 'male', desc: 'Giọng OpenAI Fable' },
                                { id: 'onyx', displayName: 'OpenAI - Onyx (Nam)', gender: 'male', desc: 'Giọng OpenAI Onyx' },
                                { id: 'nova', displayName: 'OpenAI - Nova (Nữ)', gender: 'female', desc: 'Giọng OpenAI Nova' },
                                { id: 'shimmer', displayName: 'OpenAI - Shimmer (Nữ)', gender: 'female', desc: 'Giọng OpenAI Shimmer' }
                            ];
                            voicesList.forEach(v => {
                                discoveredModels.push({
                                    name: `custom_openai:${cp.id}:${v.id}`,
                                    displayName: `${v.displayName}`,
                                    description: `${v.desc} - via ${cp.name}`,
                                    supportedTasks: ['TTS_VOICE']
                                });
                            });
                        } else if (cp.ttsType === 'openai') {
                            const voicesList = [
                                { id: 'alloy', displayName: 'Alloy (Trung tính)', gender: 'male', desc: 'Giọng trung tính' },
                                { id: 'echo', displayName: 'Echo (Nam)', gender: 'male', desc: 'Giọng nam' },
                                { id: 'fable', displayName: 'Fable (Nam)', gender: 'male', desc: 'Giọng nam' },
                                { id: 'onyx', displayName: 'Onyx (Nam)', gender: 'male', desc: 'Giọng nam' },
                                { id: 'nova', displayName: 'Nova (Nữ)', gender: 'female', desc: 'Giọng nữ' },
                                { id: 'shimmer', displayName: 'Shimmer (Nữ)', gender: 'female', desc: 'Giọng nữ' }
                            ];
                            voicesList.forEach(v => {
                                discoveredModels.push({
                                    name: `custom_openai:${cp.id}:${v.id}`,
                                    displayName: `${v.displayName}`,
                                    description: `${v.desc} - via ${cp.name}`,
                                    supportedTasks: ['TTS_VOICE']
                                });
                            });
                        }
                    }
                }
            } catch (err: any) {
                this.logger.warn(`Failed to add custom voices to discoverGeminiModels: ${err.message}`);
            }
        }

        return discoveredModels;
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

        // Embedding models support the EMBEDDING task only
        if (id.includes('embedding')) {
            return ['EMBEDDING'];
        }
        // Skip other non-generative models
        if (id.includes('retrieval') || id.includes('moderation')) {
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
     * Discover Vbee personal and Vietnamese voices using user's API token
     */
    async discoverVbeeVoices(userId: string): Promise<AvailableModel[]> {
        // Default known fallback voices
        const knownVoices: AvailableModel[] = [
            {
                name: 'vbee:n_thainguyen_male_giangbaitrieuhoa_education_vc',
                displayName: 'Vbee - Giọng Triệu Hòa 👨 (Giảng bài)',
                description: 'Giọng cá nhân Triệu Hòa - Giảng bài giáo dục',
                supportedTasks: ['TTS', 'TTS_VOICE'],
            },
            {
                name: 'vbee:hn_female_ngochuyen_full_24k-st',
                displayName: 'Vbee - Ngọc Huyền 2.0 👩 (HN)',
                description: 'Giọng nữ Hà Nội truyền cảm',
                supportedTasks: ['TTS', 'TTS_VOICE'],
            },
            {
                name: 'vbee:hn_male_manhdung_full_24k-st',
                displayName: 'Vbee - Mạnh Dũng 2.0 👨 (HN)',
                description: 'Giọng nam Hà Nội mạnh mẽ',
                supportedTasks: ['TTS', 'TTS_VOICE'],
            },
            {
                name: 'vbee:hn_male_minhquan_yt_24k-pre',
                displayName: 'Vbee - Minh Quân Pro 👨 (HN)',
                description: 'Giọng nam tự nhiên trẻ trung',
                supportedTasks: ['TTS', 'TTS_VOICE'],
            },
            {
                name: 'vbee:sg_female_tuongvy_call_44k-fhg',
                displayName: 'Vbee - SG - Tường Vy 👩 (SG)',
                description: 'Giọng nữ Sài Gòn nhẹ nhàng',
                supportedTasks: ['TTS', 'TTS_VOICE'],
            },
            {
                name: 'vbee:sg_female_thaotrinh_full_44k-phg',
                displayName: 'Vbee - SG - Thảo Trinh 👩 (SG)',
                description: 'Giọng nữ Sài Gòn truyền cảm',
                supportedTasks: ['TTS', 'TTS_VOICE'],
            },
            {
                name: 'vbee:hue_female_huonggiang_full_48k-fhg',
                displayName: 'Vbee - Huế - Hương Giang 👩 (Huế)',
                description: 'Giọng nữ Huế ngọt ngào',
                supportedTasks: ['TTS', 'TTS_VOICE'],
            },
        ];

        const rawKey = await this.apiKeysService.getActiveKey(userId, 'VBEE');

        if (!rawKey) {
            this.logger.log('No Vbee token configured, returning known voices only');
            return knownVoices;
        }

        // Vbee credentials may be stored as JSON { "token": "xxx", "appId": "yyy", "voiceCodes": "..." } or plain token
        let vbeeToken = rawKey;
        let parsedKey: any = null;
        try {
            parsedKey = JSON.parse(rawKey);
            if (parsedKey && typeof parsedKey === 'object') {
                vbeeToken = parsedKey.token || parsedKey.apiKey || rawKey;
            }
        } catch {
            // raw string token
        }

        // Parse user custom cloned voices from credentials (voiceCodes)
        const customVoiceEntries: { code: string; displayName?: string }[] = [];
        if (parsedKey && parsedKey.voiceCodes) {
            const lines = typeof parsedKey.voiceCodes === 'string'
                ? parsedKey.voiceCodes.split(/[\r\n,;]+/)
                : Array.isArray(parsedKey.voiceCodes) ? parsedKey.voiceCodes : [];
            for (const line of lines) {
                const trimmed = (typeof line === 'string' ? line : '').trim();
                if (!trimmed) continue;
                if (trimmed.includes(':')) {
                    const [c, ...nameParts] = trimmed.split(':');
                    const code = c.trim();
                    const displayName = nameParts.join(':').trim();
                    if (code) customVoiceEntries.push({ code, displayName });
                } else {
                    customVoiceEntries.push({ code: trimmed });
                }
            }
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
                // Vbee API returns { status: 1, result: { total: N, voices: [...] } }
                const rawVoices: any[] = data.result.voices || (Array.isArray(data.result) ? data.result : []);

                // Fallback if data.result is an object map { code: details }
                if (rawVoices.length === 0 && typeof data.result === 'object' && !Array.isArray(data.result)) {
                    for (const [code, details] of Object.entries(data.result)) {
                        if (code !== 'voices' && code !== 'total' && typeof details === 'object' && details !== null) {
                            rawVoices.push({ ...(details as object), code: (details as any).code || code });
                        }
                    }
                }

                for (const item of rawVoices) {
                    const voiceCode = item.code || item.voice_code || item.id;
                    if (!voiceCode) continue;

                    const isVi = item.language_code === 'vi-VN' || item.language?.code === 'vi-VN' || item.language === 'vi-VN';
                    const isPersonal = item.voice_ownership === 'PERSONAL' || 
                                       item.features?.includes('personal-voice') || 
                                       item.features?.includes('cloned-voice') ||
                                       voiceCode.includes('trieuhoa');

                    // Include all Vietnamese voices and any personal/cloned voices
                    if (!isVi && !isPersonal) continue;

                    const displayName = item.name || voiceCode;
                    const gender = item.gender === 'female' ? '👩' : '👨';
                    let region = 'VN';
                    if (item.locale === 'northern') region = 'HN';
                    else if (item.locale === 'southern') region = 'SG';
                    else if (item.locale === 'central') region = 'Huế';
                    else if (item.locale) region = item.locale;

                    voices.push({
                        name: `vbee:${voiceCode}`,
                        displayName: `Vbee - ${displayName} ${gender} (${region})`,
                        description: item.description || (isPersonal ? 'Giọng cá nhân' : `${item.level || 'Vbee'} - ${item.locale || 'vi-VN'}`),
                        supportedTasks: ['TTS', 'TTS_VOICE'],
                    });
                }
            }

            this.logger.log(`Discovered ${voices.length} Vbee voices for user ${userId}`);
            
            // Merge with known voices (remove duplicates by name)
            const allVoices = [...knownVoices];
            for (const voice of voices) {
                const existingIndex = allVoices.findIndex(v => v.name === voice.name);
                if (existingIndex >= 0) {
                    allVoices[existingIndex] = voice; // update with live data
                } else {
                    allVoices.push(voice);
                }
            }

            // Insert user custom cloned voices at the top
            for (const custom of customVoiceEntries) {
                const name = `vbee:${custom.code}`;
                const existingIdx = allVoices.findIndex(v => v.name === name);
                const modelItem: AvailableModel = {
                    name,
                    displayName: `Vbee - ${custom.displayName || custom.code} ⭐ (Cá nhân)`,
                    description: 'Giọng nhân bản cá nhân Vbee Studio',
                    supportedTasks: ['TTS', 'TTS_VOICE'],
                };
                if (existingIdx >= 0) {
                    allVoices.splice(existingIdx, 1);
                }
                allVoices.unshift(modelItem);
            }

            return allVoices;
        } catch (error: any) {
            this.logger.error(`Failed to discover Vbee voices: ${error.message}`);
            
            // Still include custom cloned voices even if network error
            const fallbackVoices = [...knownVoices];
            for (const custom of customVoiceEntries) {
                const name = `vbee:${custom.code}`;
                const existingIdx = fallbackVoices.findIndex(v => v.name === name);
                const modelItem: AvailableModel = {
                    name,
                    displayName: `Vbee - ${custom.displayName || custom.code} ⭐ (Cá nhân)`,
                    description: 'Giọng nhân bản cá nhân Vbee Studio',
                    supportedTasks: ['TTS', 'TTS_VOICE'],
                };
                if (existingIdx >= 0) {
                    fallbackVoices.splice(existingIdx, 1);
                }
                fallbackVoices.unshift(modelItem);
            }
            return fallbackVoices; // Return voices even on error
        }
    }

    /**
     * Resolve all active ViTTS servers (admin + personal)
     */
    async resolveAllViTTSServers(userId: string): Promise<Array<{
        id: string;
        name: string;
        baseUrl: string;
        apiKey: string;
        isPersonal: boolean;
        defaultVoice?: string;
        designInstruct?: string;
    }>> {
        const result: Array<{
            id: string;
            name: string;
            baseUrl: string;
            apiKey: string;
            isPersonal: boolean;
            defaultVoice?: string;
            designInstruct?: string;
        }> = [];

        // 1. Check user personal ViTTS keys from ApiKeys table
        try {
            const userKeys = await this.prisma.apiKey.findMany({
                where: { userId, service: 'VITTS' as any },
                orderBy: { createdAt: 'asc' },
            });

            for (const uk of userKeys) {
                let baseUrl = DEFAULT_VITTS_BASE_URL;
                let apiKey = '';
                try {
                    const decrypted = uk.keyEncrypted ? await this.crypto.decrypt(uk.keyEncrypted) : '{}';
                    const parsed = JSON.parse(decrypted);
                    if (typeof parsed === 'object' && parsed !== null) {
                        apiKey = parsed.apiKey || '';
                        baseUrl = parsed.baseUrl || DEFAULT_VITTS_BASE_URL;
                    } else {
                        apiKey = String(parsed);
                    }
                } catch {
                    apiKey = uk.keyEncrypted ? await this.crypto.decrypt(uk.keyEncrypted) : '';
                }

                if (apiKey) {
                    result.push({
                        id: `personal-${uk.id}`,
                        name: uk.name || 'ViTTS Cá nhân',
                        baseUrl: baseUrl.replace(/\/+$/, ''),
                        apiKey,
                        isPersonal: true,
                    });
                }
            }
        } catch (err: any) {
            this.logger.warn(`Failed to load personal ViTTS keys: ${err.message}`);
        }

        // 2. Check Admin System ViTTS servers
        if (this.systemConfigService) {
            try {
                const adminServers = await this.systemConfigService.getViTTSServers();
                for (const s of adminServers) {
                    if (s.enabled && s.baseUrl) {
                        result.push({
                            id: s.id,
                            name: s.name,
                            baseUrl: s.baseUrl.replace(/\/+$/, ''),
                            apiKey: s.apiKey,
                            isPersonal: false,
                            defaultVoice: s.defaultVoice,
                            designInstruct: s.designInstruct,
                        });
                    }
                }
            } catch (err: any) {
                this.logger.warn(`Failed to load admin ViTTS servers: ${err.message}`);
            }
        }

        return result;
    }

    /**
     * Discover ViTTS voices across all active servers in parallel
     */
    async discoverViTTSVoices(userId: string): Promise<AvailableModel[]> {
        const servers = await this.resolveAllViTTSServers(userId);

        if (servers.length === 0) {
            return [
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
        }

        const serverPromises = servers.map(async (server) => {
            const serverVoices: AvailableModel[] = [];
            const authHeaders: Record<string, string> = {};
            if (server.apiKey) {
                authHeaders['X-API-Key'] = server.apiKey;
                authHeaders['Authorization'] = `Bearer ${server.apiKey}`;
            }
            const serverSource = `ViTTS - ${server.name}`;

            // Fetch refs, trained voices, presets, and standard voices in parallel with fast 2.5s timeout
            const results = await Promise.allSettled([
                fetch(`${server.baseUrl}/api/v1/refs`, { headers: authHeaders, signal: AbortSignal.timeout(2500) })
                    .then(res => res.ok ? res.json() : null),
                fetch(`${server.baseUrl}/api/v1/tts/trained-voices`, { headers: authHeaders, signal: AbortSignal.timeout(2500) })
                    .then(res => res.ok ? res.json() : null),
                fetch(`${server.baseUrl}/api/v1/tts/presets`, { headers: authHeaders, signal: AbortSignal.timeout(2500) })
                    .then(res => res.ok ? res.json() : null),
                fetch(`${server.baseUrl}/api/v1/tts/voices`, { headers: authHeaders, signal: AbortSignal.timeout(2500) })
                    .then(res => res.ok ? res.json() : null),
            ]);

            // 1. Saved refs
            if (results[0].status === 'fulfilled' && results[0].value) {
                const refsData = results[0].value;
                const refsArray = Array.isArray(refsData) ? refsData : (refsData.refs || []);
                for (const ref of refsArray) {
                    serverVoices.push({
                        name: `vitts:${server.id}:ref:${ref.id}`,
                        displayName: `ViTTS - ${ref.name || ref.id} 🎤 (${server.name})`,
                        description: `Giọng tham chiếu đã lưu - ${server.name}`,
                        supportedTasks: ['TTS', 'TTS_VOICE'],
                        source: serverSource,
                    });
                }
            }

            // 2. Trained voices
            if (results[1].status === 'fulfilled' && results[1].value) {
                const voicesData = results[1].value;
                const voicesArray = Array.isArray(voicesData) ? voicesData : (voicesData.voices || []);
                for (const voice of voicesArray) {
                    serverVoices.push({
                        name: `vitts:${server.id}:trained_${voice.id}`,
                        displayName: `ViTTS - ${voice.name || voice.id} 🎓 (${server.name})`,
                        description: `Giọng đã train - ${server.name}`,
                        supportedTasks: ['TTS', 'TTS_VOICE'],
                        source: serverSource,
                    });
                }
            }

            // 3. VieNeu Presets
            if (results[2].status === 'fulfilled' && results[2].value && Array.isArray(results[2].value)) {
                const regionOrder: Record<string, number> = { 'Bắc': 1, 'bac': 1, 'Trung': 2, 'trung': 2, 'Nam': 3, 'nam': 3 };
                const genderOrder: Record<string, number> = { 'Nam': 1, 'nam': 1, 'male': 1, 'Nữ': 2, 'nu': 2, 'female': 2 };
                const sortedPresets = [...results[2].value].sort((a: any, b: any) => {
                    const rA = regionOrder[a.region || ''] || 99;
                    const rB = regionOrder[b.region || ''] || 99;
                    if (rA !== rB) return rA - rB;
                    const gA = genderOrder[a.gender || ''] || 99;
                    const gB = genderOrder[b.gender || ''] || 99;
                    if (gA !== gB) return gA - gB;
                    return (a.name || '').localeCompare(b.name || '', 'vi');
                });
                for (const p of sortedPresets) {
                    serverVoices.push({
                        name: `vitts:${server.id}:vieneu:${p.id || p.name}`,
                        displayName: `ViTTS - [Miền ${p.region || 'Bắc'}] ${p.gender || 'Nam'} - ${p.name}`,
                        description: p.description || `Giọng ${p.gender || 'Nam'} miền ${p.region || 'Bắc'} - VieNeu-TTS 48kHz (${server.name})`,
                        supportedTasks: ['TTS', 'TTS_VOICE'],
                        source: serverSource,
                    });
                }
            }

            // 4. Standard voices
            if (results[3].status === 'fulfilled' && results[3].value) {
                const voicesList = results[3].value;
                const rawList = Array.isArray(voicesList) ? voicesList : (voicesList.voices || []);
                for (const item of rawList) {
                    const voiceId = item.id || item.voice_id || item.name;
                    const displayName = item.name || item.id;
                    serverVoices.push({
                        name: `vitts:${server.id}:${voiceId}`,
                        displayName: `ViTTS - ${displayName} (${server.name})`,
                        description: item.description || `Giọng ${item.language || 'Tiếng Việt'} - ${server.name}`,
                        supportedTasks: ['TTS', 'TTS_VOICE'],
                        source: serverSource,
                    });
                }
            }

            return serverVoices;
        });

        const settledServers = await Promise.allSettled(serverPromises);
        const allVoices: AvailableModel[] = [];
        for (const res of settledServers) {
            if (res.status === 'fulfilled' && Array.isArray(res.value)) {
                allVoices.push(...res.value);
            }
        }

        return allVoices;
    }

    /**
     * Get all available models - Gemini + CLIProxy + Vbee + ViTTS
     * Uses in-memory caching (TTL 45s) and parallel execution for lightning-fast loading
     */
    async getAllAvailableModels(userId: string) {
        const cached = this.availableModelsCache.get(userId);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }

        const models: Record<string, AvailableModel[]> = {
            GEMINI: [],
            CLIPROXY: [],
        };

        // Run all discoveries in parallel for speed
        const [
            geminiSettled,
            cliproxySettled,
            vbeeSettled,
            vittsServersSettled,
            vittsVoicesSettled,
            imageGenSettled,
        ] = await Promise.allSettled([
            this.discoverGeminiModels(userId),
            this.discoverCLIProxyModels(),
            this.discoverVbeeVoices(userId),
            this.resolveAllViTTSServers(userId),
            this.discoverViTTSVoices(userId),
            this.discoverImageGenModels(),
        ]);

        // 1. Gemini
        if (geminiSettled.status === 'fulfilled' && geminiSettled.value.length > 0) {
            models.GEMINI = geminiSettled.value;
        } else {
            let imageModelName = 'gemini-2.0-flash-image-generation';
            let ttsModelName = 'gemini-2.5-flash-preview-tts';
            if (this.systemConfigService) {
                try {
                    const discovered = await this.systemConfigService.getDiscoveredGeminiModels();
                    if (discovered.image) imageModelName = discovered.image;
                    if (discovered.tts) ttsModelName = discovered.tts;
                } catch { /* use fallback */ }
            }
            models.GEMINI = [
                {
                    name: 'gemini-2.5-pro',
                    displayName: 'Gemini 2.5 Pro (Default)',
                    description: 'Best for content creation',
                    supportedTasks: ['OUTLINE', 'SLIDES', 'QUESTIONS'],
                },
                {
                    name: imageModelName,
                    displayName: `${imageModelName} (Default)`,
                    description: 'Image generation',
                    supportedTasks: ['IMAGE'],
                },
                {
                    name: ttsModelName,
                    displayName: `${ttsModelName} (Default)`,
                    description: 'Text-to-speech',
                    supportedTasks: ['TTS'],
                },
            ];
        }

        // 2. CLIProxy
        if (cliproxySettled.status === 'fulfilled' && cliproxySettled.value.length > 0) {
            models.CLIPROXY = cliproxySettled.value;
            this.logger.log(`Added ${cliproxySettled.value.length} CLIProxy models`);
        }

        // 3. Vbee
        if (vbeeSettled.status === 'fulfilled' && vbeeSettled.value.length > 0) {
            models.GEMINI = [...models.GEMINI, ...vbeeSettled.value];
            this.logger.log(`Added ${vbeeSettled.value.length} Vbee voices to available models`);
        }

        // 4. ViTTS Servers
        if (vittsServersSettled.status === 'fulfilled' && vittsServersSettled.value.length > 0) {
            const servers = vittsServersSettled.value;
            models.VITTS = servers.map((server) => ({
                name: `vitts:${server.id}:auto`,
                displayName: server.name,
                description: `Máy chủ ViTTS - ${server.name}`,
                supportedTasks: ['TTS'],
                source: server.name,
            }));
        }

        // 5. ViTTS Voices
        if (vittsVoicesSettled.status === 'fulfilled' && vittsVoicesSettled.value.length > 0) {
            models.GEMINI = [...models.GEMINI, ...vittsVoicesSettled.value];
            this.logger.log(`Added ${vittsVoicesSettled.value.length} ViTTS voices`);
        }

        // 6. ImageGen
        if (imageGenSettled.status === 'fulfilled' && imageGenSettled.value.length > 0) {
            (models as any).IMAGE_GEN = imageGenSettled.value;
            this.logger.log(`Added ${imageGenSettled.value.length} ImageGen models`);
        }

        // 7. Custom OpenAI
        if (this.customOpenAI) {
            try {
                const customProviders = await this.customOpenAI.getProviders();
                for (const cp of customProviders) {
                    if (cp.enabled) {
                        const customModelsList: AvailableModel[] = [];
                        const providerKey = cp.id.toUpperCase();

                        if (cp.ttsType !== 'none') {
                            if (cp.ttsType === 'shopaikey') {
                                customModelsList.push(
                                    {
                                        name: `custom_openai:${cp.id}:tts-1`,
                                        displayName: 'OpenAI TTS (Default)',
                                        description: `OpenAI text-to-speech model via ${cp.name}`,
                                        supportedTasks: ['TTS'],
                                    },
                                    {
                                        name: `custom_openai:${cp.id}:gemini-tts`,
                                        displayName: 'Gemini TTS (Default)',
                                        description: `Gemini text-to-speech model via ${cp.name}`,
                                        supportedTasks: ['TTS'],
                                    }
                                );
                            } else {
                                customModelsList.push({
                                    name: `custom_openai:${cp.id}:tts-1`,
                                    displayName: 'OpenAI TTS',
                                    description: `OpenAI text-to-speech model via ${cp.name}`,
                                    supportedTasks: ['TTS'],
                                });
                            }
                        }

                        let listedRealModels = false;
                        try {
                            const realModels = await this.customOpenAI.listModels(cp.id);
                            for (const rm of realModels) {
                                const id = rm.id;
                                const tasks = this.classifyCLIProxyModel(id);
                                if (tasks.length === 0) continue;
                                const name = `custom_openai:${cp.id}:${id}`;
                                if (customModelsList.some((m) => m.name === name)) continue;

                                let emoji = '🧠';
                                if (tasks.includes('IMAGE')) emoji = '🎨';
                                else if (tasks.includes('TTS')) emoji = '🔊';
                                else if (tasks.includes('EMBEDDING')) emoji = '🔎';

                                customModelsList.push({
                                    name,
                                    displayName: `${emoji} ${this.formatModelDisplayName(id)} (${cp.name})`,
                                    description: `via ${cp.name}`,
                                    supportedTasks: tasks,
                                });
                                listedRealModels = true;
                            }
                        } catch (err: any) {
                            this.logger.warn(`Could not list models for provider ${cp.id}: ${err.message}`);
                        }

                        if (customModelsList.length > 0) {
                            models[providerKey] = customModelsList;
                            this.logger.log(`Added dynamic provider ${providerKey} with ${customModelsList.length} models`);
                        }
                    }
                }

                // Discover personal OpenAI models if configured
                const personalKeyJson = await this.apiKeysService.getActiveKey(userId, 'OPENAI' as any);
                if (personalKeyJson) {
                    try {
                        const parsed = JSON.parse(personalKeyJson);
                        if (parsed.apiKey) {
                            const apiKey = parsed.apiKey;
                            const rawBaseUrl = parsed.baseUrl || 'https://api.openai.com/v1';
                            
                            let cleanBaseUrl = rawBaseUrl.trim();
                            if (cleanBaseUrl.endsWith('/')) {
                                cleanBaseUrl = cleanBaseUrl.slice(0, -1);
                            }
                            if (cleanBaseUrl.endsWith('/v1')) {
                                cleanBaseUrl = cleanBaseUrl.slice(0, -3);
                            }
                            
                            const response = await fetch(`${cleanBaseUrl}/v1/models`, {
                                headers: { 'Authorization': `Bearer ${apiKey}` },
                                signal: AbortSignal.timeout(3000),
                            });
                            
                            if (response.ok) {
                                const data = await response.json();
                                const rawModels = data.data || [];
                                const customModelsList: AvailableModel[] = [];
                                
                                const isShopaikey = cleanBaseUrl.toLowerCase().includes('shopaikey');
                                if (isShopaikey) {
                                    customModelsList.push(
                                        {
                                            name: `custom_openai:personal:tts-1`,
                                            displayName: '🧠 OpenAI TTS (Cá nhân)',
                                            description: `OpenAI text-to-speech model via Personal Key`,
                                            supportedTasks: ['TTS'],
                                        },
                                        {
                                            name: `custom_openai:personal:gemini-tts`,
                                            displayName: '🧠 Gemini TTS (Cá nhân)',
                                            description: `Gemini text-to-speech model via Personal Key`,
                                            supportedTasks: ['TTS'],
                                        }
                                    );
                                    
                                    const voicesList = [
                                        { id: 'Zephyr', displayName: 'Gemini - Zephyr (Nữ)' },
                                        { id: 'Puck', displayName: 'Gemini - Puck (Nam)' },
                                        { id: 'Charon', displayName: 'Gemini - Charon (Ấm áp)' },
                                        { id: 'Kore', displayName: 'Gemini - Kore (Chắc chắn)' },
                                        { id: 'Aoede', displayName: 'Gemini - Aoede (Nhẹ nhàng)' },
                                        { id: 'alloy', displayName: 'OpenAI - Alloy (Trung tính)' },
                                        { id: 'echo', displayName: 'OpenAI - Echo (Nam)' },
                                        { id: 'fable', displayName: 'OpenAI - Fable (Nam)' },
                                        { id: 'onyx', displayName: 'OpenAI - Onyx (Nam)' },
                                        { id: 'nova', displayName: 'OpenAI - Nova (Nữ)' },
                                        { id: 'shimmer', displayName: 'OpenAI - Shimmer (Nữ)' }
                                    ];
                                    for (const v of voicesList) {
                                        customModelsList.push({
                                            name: `custom_openai:personal:${v.id}`,
                                            displayName: `🔊 ${v.displayName} (Cá nhân)`,
                                            description: `via Personal Key (${rawBaseUrl})`,
                                            supportedTasks: ['TTS_VOICE'],
                                        });
                                    }
                                } else {
                                    const voicesList = [
                                        { id: 'alloy', displayName: 'Alloy (Trung tính)' },
                                        { id: 'echo', displayName: 'Echo (Nam)' },
                                        { id: 'fable', displayName: 'Fable (Nam)' },
                                        { id: 'onyx', displayName: 'Onyx (Nam)' },
                                        { id: 'nova', displayName: 'Nova (Nữ)' },
                                        { id: 'shimmer', displayName: 'Shimmer (Nữ)' }
                                    ];
                                    for (const v of voicesList) {
                                        customModelsList.push({
                                            name: `custom_openai:personal:${v.id}`,
                                            displayName: `🔊 ${v.displayName} (Cá nhân)`,
                                            description: `via Personal Key (${rawBaseUrl})`,
                                            supportedTasks: ['TTS_VOICE'],
                                        });
                                    }
                                }

                                for (const m of rawModels) {
                                    const modelId = m.id;
                                    if (modelId.includes('mod') && !modelId.includes('embed')) continue;

                                    const tasks = this.classifyCLIProxyModel(modelId);
                                    if (tasks.length === 0) continue;

                                    let emoji = '🧠';
                                    if (tasks.includes('IMAGE')) emoji = '🎨';
                                    else if (tasks.includes('TTS')) emoji = '🔊';
                                    else if (tasks.includes('EMBEDDING')) emoji = '🔎';

                                    customModelsList.push({
                                        name: `custom_openai:personal:${modelId}`,
                                        displayName: `${emoji} ${this.formatModelDisplayName(modelId)} (Cá nhân)`,
                                        description: `via Personal Key (${rawBaseUrl})`,
                                        supportedTasks: tasks,
                                    });
                                }
                                
                                if (customModelsList.length > 0) {
                                    models['PERSONAL'] = customModelsList;
                                    this.logger.log(`Added personal OpenAI provider with ${customModelsList.length} models for user ${userId}`);
                                }
                            }
                        }
                    } catch (err: any) {
                        this.logger.warn(`Failed to discover personal OpenAI models: ${err.message}`);
                    }
                }
            } catch (error: any) {
                this.logger.warn(`Custom OpenAI models discovery failed: ${error.message}`);
            }
        }

        // Cache the result for 45s
        this.availableModelsCache.set(userId, {
            data: models,
            expiresAt: Date.now() + 45000,
        });

        return models;
    }

    /**
     * Discover ImageGen models (Flux/ComfyUI) from admin config
     */
    async discoverImageGenModels(): Promise<AvailableModel[]> {
        if (!this.systemConfigService) return [];

        try {
            const config = await this.systemConfigService.getImageGenConfig();
            if (!config.enabled || !config.defaultModel) return [];

            return [{
                name: `imagegen:${config.defaultModel}`,
                displayName: `🎨 ${config.defaultModel} (ImageGen)`,
                description: `via Image Gen API (${config.url?.split('/')[2] || 'local'})`,
                supportedTasks: ['IMAGE'],
            }];
        } catch (error: any) {
            this.logger.warn(`ImageGen model discovery failed: ${error.message}`);
            return [];
        }
    }

    /**
     * Get default models - uses CLIProxy admin defaults if enabled
     */
    async getDefaults(): Promise<Record<TaskTypeValue, { provider: string; modelName: string }>> {
        // Start with hardcoded defaults (last resort)
        const defaults = { ...DEFAULT_MODELS };

        // Override with dynamically discovered Gemini models from DB (if available)
        if (this.systemConfigService) {
            try {
                const discovered = await this.systemConfigService.getDiscoveredGeminiModels();
                if (discovered.text) {
                    defaults.OUTLINE = { provider: 'GEMINI', modelName: discovered.text };
                    defaults.SLIDES = { provider: 'GEMINI', modelName: discovered.text };
                    defaults.SPEAKER_NOTES = { provider: 'GEMINI', modelName: discovered.text };
                    defaults.QUESTIONS = { provider: 'GEMINI', modelName: discovered.text };
                }
                if (discovered.image) {
                    defaults.IMAGE = { provider: 'GEMINI', modelName: discovered.image };
                }
                if (discovered.tts) {
                    defaults.TTS = { provider: 'GEMINI', modelName: discovered.tts };
                }
            } catch (error: any) {
                this.logger.warn(`Failed to load discovered Gemini models: ${error.message}`);
            }
        }

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

                    // Override TTS model default: ViTTS admin > CLIProxy TTS
                    // Check ViTTS admin config first
                    let vittsOverride = false;
                    try {
                        const vittsEnabled = await this.prisma.systemConfig.findUnique({ where: { key: 'vitts.enabled' } });
                        if (vittsEnabled?.value === 'true') {
                            const vittsVoice = await this.prisma.systemConfig.findUnique({ where: { key: 'vitts.defaultVoice' } });
                            defaults.TTS = { provider: 'VITTS', modelName: vittsVoice?.value || 'vitts:design' };
                            vittsOverride = true;
                        }
                    } catch { /* ignore */ }
                    if (!vittsOverride && cliproxyConfig.defaultTTSModel) {
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

    /**
     * Get defaults — with ImageGen priority for IMAGE task
     * Priority: CLIProxy admin > ImageGen admin > system defaults
     */
    private async getImageGenDefault(): Promise<{ provider: string; modelName: string } | null> {
        if (!this.systemConfigService) return null;
        try {
            const config = await this.systemConfigService.getImageGenConfig();
            if (config.enabled && config.defaultModel) {
                return { provider: 'IMAGE_GEN', modelName: config.defaultModel };
            }
        } catch { /* ignore */ }
        return null;
    }

    /**
     * Discover ViTTS options from the server's /api/v1/tts/options endpoint.
     * Returns modes, voice library, design attributes, and defaults for a specific server or default.
     * Uses in-memory caching (TTL 45s) and parallel fetching for fast response.
     */
    async discoverViTTSOptions(userId: string, serverId?: string): Promise<any> {
        const cacheKey = `${userId}:${serverId || 'default'}`;
        const cached = this.vittsOptionsCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }

        const servers = await this.resolveAllViTTSServers(userId);

        if (servers.length === 0) {
            return { error: 'No ViTTS credentials configured' };
        }

        const server = serverId
            ? (servers.find(s => s.id === serverId || s.name === serverId) || servers[0])
            : servers[0];

        try {
            const apiKey = server.apiKey;
            const baseUrl = server.baseUrl;

            const authHeaders: Record<string, string> = {};
            if (apiKey) {
                authHeaders['X-API-Key'] = apiKey;
                authHeaders['Authorization'] = `Bearer ${apiKey}`;
            }

            // Fetch in parallel with 3s timeout
            const [modelsSettled, optionsSettled, refsSettled, presetsSettled] = await Promise.allSettled([
                fetch(`${baseUrl}/api/v1/tts/models`, { headers: authHeaders, signal: AbortSignal.timeout(3000) })
                    .then(res => res.ok ? res.json() : null),
                fetch(`${baseUrl}/api/v1/tts/options`, { headers: authHeaders, signal: AbortSignal.timeout(3000) })
                    .then(res => res.ok ? res.json() : null),
                fetch(`${baseUrl}/api/v1/refs`, { headers: authHeaders, signal: AbortSignal.timeout(3000) })
                    .then(res => res.ok ? res.json() : null),
                fetch(`${baseUrl}/api/v1/tts/presets`, { headers: authHeaders, signal: AbortSignal.timeout(3000) })
                    .then(res => res.ok ? res.json() : null),
            ]);

            let availableEngines: string[] = ['omnivoice'];
            if (modelsSettled.status === 'fulfilled' && modelsSettled.value) {
                const mData = modelsSettled.value;
                if (mData.current_engines && Array.isArray(mData.current_engines)) {
                    availableEngines = mData.current_engines;
                } else if (mData.available_models && Array.isArray(mData.available_models)) {
                    availableEngines = Array.from(new Set(mData.available_models.map((m: any) => m.engine || m.id)));
                } else if (mData.engine) {
                    availableEngines = [mData.engine];
                }
            }

            let optionsData: any = {};
            if (optionsSettled.status === 'fulfilled' && optionsSettled.value) {
                optionsData = optionsSettled.value;
                if (optionsData.engines && typeof optionsData.engines === 'object') {
                    availableEngines = Object.keys(optionsData.engines);
                }
            }

            let voiceLibrary: any[] = [];
            if (refsSettled.status === 'fulfilled' && refsSettled.value) {
                const rawRefs = refsSettled.value;
                const refsList = Array.isArray(rawRefs) ? rawRefs : (rawRefs.refs || []);
                voiceLibrary = refsList.map((v: any) => ({
                    ref_id: v.id || v.ref_id || v.name,
                    name: v.name || v.id,
                    gender: (v.name || '').toLowerCase().includes('female') || (v.name || '').toLowerCase().includes('nữ') ? 'female' : 'male',
                    language: v.language || 'vi',
                    duration_sec: v.duration_sec || null,
                }));
            }

            let vieneuPresets: any[] = [];
            if (optionsData.engines?.vieneu?.presets) {
                vieneuPresets = optionsData.engines.vieneu.presets;
            } else if (presetsSettled.status === 'fulfilled' && presetsSettled.value && Array.isArray(presetsSettled.value)) {
                vieneuPresets = presetsSettled.value;
            }

            // Sort presets by [Miền Bắc]-nam, nữ, [Miền Trung], [Miền Nam]
            if (vieneuPresets.length > 0) {
                const regionOrder: Record<string, number> = { 'Bắc': 1, 'bac': 1, 'Trung': 2, 'trung': 2, 'Nam': 3, 'nam': 3 };
                const genderOrder: Record<string, number> = { 'Nam': 1, 'nam': 1, 'male': 1, 'Nữ': 2, 'nu': 2, 'female': 2 };
                vieneuPresets.sort((a: any, b: any) => {
                    const rA = regionOrder[a.region || ''] || 99;
                    const rB = regionOrder[b.region || ''] || 99;
                    if (rA !== rB) return rA - rB;
                    const gA = genderOrder[a.gender || ''] || 99;
                    const gB = genderOrder[b.gender || ''] || 99;
                    if (gA !== gB) return gA - gB;
                    return (a.name || '').localeCompare(b.name || '', 'vi');
                });
            }

            const omniEngine = optionsData.engines?.omnivoice || optionsData;
            const designAttributes = omniEngine.design_attributes || optionsData.design_attributes || {
                gender: ['male', 'female'],
                age: ['child', 'young', 'middle-aged', 'elderly'],
                pitch: ['very low', 'low', 'normal', 'high', 'very high'],
                style: ['normal', 'whisper'],
                accent: ['', 'american accent', 'british accent', 'australian accent', 'indian accent'],
            };
            const modes = omniEngine.modes || optionsData.modes || [
                { id: 'auto', name: 'Auto Voice', description: 'Model tự chọn giọng phù hợp' },
                { id: 'clone', name: 'Voice Cloning', description: 'Clone giọng từ Voice Library' },
                { id: 'design', name: 'Voice Design', description: 'Thiết kế giọng theo thuộc tính' },
            ];

            const result = {
                ...optionsData,
                available_engines: availableEngines,
                vieneu_presets: vieneuPresets,
                voice_library: voiceLibrary,
                design_attributes: designAttributes,
                modes,
                isPersonal: server.isPersonal,
                serverId: server.id,
                serverName: server.name,
            };

            // Cache result for 45s
            this.vittsOptionsCache.set(cacheKey, {
                data: result,
                expiresAt: Date.now() + 45000,
            });

            return result;
        } catch (error: any) {
            this.logger.error(`Failed to discover ViTTS options for ${server.name}: ${error.message}`);
            return { error: error.message };
        }
    }
}
