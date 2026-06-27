import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { CLIProxyProvider } from './cliproxy.provider';
import { CustomOpenAIProvider } from './custom-openai.provider';
import { ApiKeysService } from '../api-keys/api-keys.service';

export type AIProviderType = 'cliproxy' | 'gemini' | string;

export interface AIProviderResult {
    content: string;
    provider: AIProviderType;
    model: string;
    tokens?: number;
}

@Injectable()
export class AiProviderService {
    private readonly logger = new Logger(AiProviderService.name);

    constructor(
        private readonly cliproxy: CLIProxyProvider,
        private readonly customOpenAI: CustomOpenAIProvider,
        private readonly apiKeysService: ApiKeysService,
    ) { }

    /**
     * Normalize model name by stripping provider prefixes
     * e.g., "cliproxy:gemini-2.5-flash" → "gemini-2.5-flash"
     */
    private normalizeModelName(modelName: string): string {
        // Strip provider prefixes
        if (modelName.startsWith('cliproxy:')) {
            return modelName.replace('cliproxy:', '');
        }
        if (modelName.startsWith('gemini:')) {
            return modelName.replace('gemini:', '');
        }
        if (modelName.startsWith('custom_openai:')) {
            const parts = modelName.split(':');
            if (parts.length >= 3) {
                return parts.slice(2).join(':');
            }
            return modelName.replace('custom_openai:', '');
        }
        return modelName;
    }

    /**
     * Generate text using the best available provider
     * Priority: CLIProxy (if enabled) → Gemini SDK (user key)
     */
    async generateText(
        prompt: string,
        modelName: string,
        userId?: string,
        options?: { maxTokens?: number },
    ): Promise<AIProviderResult> {
        // Check if this is a dynamic custom OpenAI model
        if (modelName.startsWith('custom_openai:')) {
            const parts = modelName.split(':');
            const providerId = parts[1];
            const realModel = parts.slice(2).join(':');
            this.logger.log(`Routing to Custom OpenAI provider: ${providerId}, model: ${realModel}`);
            const content = await this.customOpenAI.generateText(providerId, prompt, realModel, { maxTokens: options?.maxTokens, userId });
            return {
                content,
                provider: `custom_openai:${providerId}`,
                model: realModel,
            };
        }

        // Normalize model name (strip provider prefix)
        const normalizedModel = this.normalizeModelName(modelName);

        // Priority 1: Try CLIProxy if enabled
        if (await this.cliproxy.isEnabled()) {
            try {
                this.logger.log(`Attempting CLIProxy with model: ${normalizedModel}`);
                const content = await this.cliproxy.generateText(prompt, normalizedModel, { maxTokens: options?.maxTokens });
                if (!content || content.trim().length === 0) {
                    this.logger.warn(`CLIProxy returned empty content with model ${normalizedModel}, trying fallback models...`);
                    // Try fallback models from the same category
                    const fallbacks = await this.cliproxy.getModelFallbacks('text', normalizedModel);
                    for (const fbModel of fallbacks.slice(0, 3)) {
                        try {
                            this.logger.log(`Retrying CLIProxy with fallback model: ${fbModel}`);
                            const fbContent = await this.cliproxy.generateText(prompt, fbModel, { maxTokens: options?.maxTokens });
                            if (fbContent && fbContent.trim().length > 0) {
                                return {
                                    content: fbContent,
                                    provider: 'cliproxy',
                                    model: fbModel,
                                };
                            }
                        } catch (fbError) {
                            this.logger.warn(`Fallback model ${fbModel} also failed: ${fbError}`);
                        }
                    }
                    throw new Error(`CLIProxy returned empty content for model ${normalizedModel} and all fallbacks`);
                }
                return {
                    content,
                    provider: 'cliproxy',
                    model: normalizedModel,
                };
            } catch (error) {
                this.logger.warn(`CLIProxy failed, falling back to Gemini: ${error}`);
            }
        }

        // Priority 2: Gemini SDK with user's API key
        const geminiApiKey = userId ? await this.apiKeysService.getActiveKey(userId, 'GEMINI') : undefined;
        if (geminiApiKey) {
            try {
                this.logger.log(`Using Gemini SDK with model: ${normalizedModel}`);
                const genAI = new GoogleGenerativeAI(geminiApiKey);
                const model = genAI.getGenerativeModel({ model: normalizedModel });
                const result = await model.generateContent(prompt);
                const response = result.response;

                return {
                    content: response.text(),
                    provider: 'gemini',
                    model: normalizedModel,
                };
            } catch (error) {
                this.logger.error(`Gemini SDK failed: ${error}`);
                throw error;
            }
        }

        // No provider available
        throw new Error('No AI provider available. CLIProxy is disabled and no user API key provided.');
    }

    /**
     * Generate text with system prompt
     */
    async generateTextWithSystem(
        systemPrompt: string,
        userPrompt: string,
        modelName: string,
        userId?: string,
    ): Promise<AIProviderResult> {
        // Check if this is a dynamic custom OpenAI model
        if (modelName.startsWith('custom_openai:')) {
            const parts = modelName.split(':');
            const providerId = parts[1];
            const realModel = parts.slice(2).join(':');
            this.logger.log(`Routing with system prompt to Custom OpenAI provider: ${providerId}, model: ${realModel}`);
            const content = await this.customOpenAI.generateTextWithSystem(
                providerId,
                systemPrompt,
                userPrompt,
                realModel,
                { userId }
            );
            return {
                content,
                provider: `custom_openai:${providerId}`,
                model: realModel,
            };
        }

        // Normalize model name (strip provider prefix)
        const normalizedModel = this.normalizeModelName(modelName);

        // Priority 1: CLIProxy (supports system prompt natively)
        if (await this.cliproxy.isEnabled()) {
            try {
                this.logger.log(`CLIProxy with system prompt, model: ${normalizedModel}`);
                const content = await this.cliproxy.generateTextWithSystem(
                    systemPrompt,
                    userPrompt,
                    normalizedModel
                );
                return {
                    content,
                    provider: 'cliproxy',
                    model: normalizedModel,
                };
            } catch (error) {
                this.logger.warn(`CLIProxy failed: ${error}`);
            }
        }

        // Priority 2: Gemini SDK (combine prompts)
        const geminiApiKey = userId ? await this.apiKeysService.getActiveKey(userId, 'GEMINI') : undefined;
        if (geminiApiKey) {
            const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
            const genAI = new GoogleGenerativeAI(geminiApiKey);
            const model = genAI.getGenerativeModel({ model: normalizedModel });
            const result = await model.generateContent(combinedPrompt);

            return {
                content: result.response.text(),
                provider: 'gemini',
                model: normalizedModel,
            };
        }

        throw new Error('No AI provider available');
    }

    /**
     * Embed an array of texts into vectors. Returns one vector per input, same order.
     * Routes custom_openai:* models to the OpenAI-compatible provider; otherwise Gemini.
     */
    async embed(
        texts: string[],
        modelName: string,
        userId?: string,
    ): Promise<number[][]> {
        if (texts.length === 0) return [];

        // Route to custom OpenAI-compatible provider (e.g. ShopAIKey / personal OpenAI)
        if (modelName.startsWith('custom_openai:')) {
            const parts = modelName.split(':');
            const providerId = parts[1];
            const realModel = parts.slice(2).join(':');
            this.logger.log(`Embedding via Custom OpenAI provider: ${providerId}, model: ${realModel}`);
            return this.customOpenAI.embed(providerId, texts, realModel, { userId });
        }

        // Default: Gemini embeddings via @google/generative-ai
        const normalizedModel = this.normalizeModelName(modelName);
        const geminiApiKey = userId ? await this.apiKeysService.getActiveKey(userId, 'GEMINI') : undefined;
        if (!geminiApiKey) {
            throw new Error('No GEMINI API key available for embeddings');
        }
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({ model: normalizedModel });

        // Embed sequentially (SDK embedContent handles one text at a time reliably)
        const vectors: number[][] = [];
        for (const text of texts) {
            const result = await model.embedContent(text);
            vectors.push(result.embedding.values);
        }
        return vectors;
    }

    /**
     * Check which provider is currently active
     */
    async getActiveProvider(): Promise<{ provider: AIProviderType; status: string }> {
        const cliproxyEnabled = await this.cliproxy.isEnabled();

        if (cliproxyEnabled) {
            const healthy = await this.cliproxy.healthCheck();
            return {
                provider: 'cliproxy',
                status: healthy ? 'healthy' : 'unhealthy',
            };
        }

        return {
            provider: 'gemini',
            status: 'user-key-required',
        };
    }

    /**
     * Get available models from CLIProxy
     */
    async getAvailableModels(): Promise<{ id: string; owned_by?: string }[]> {
        let models: { id: string; owned_by?: string }[] = [];

        // 1. Fetch dynamic Custom OpenAI models
        try {
            const providers = await this.customOpenAI.getProviders();
            for (const provider of providers) {
                if (provider.enabled) {
                    try {
                        const providerModels = await this.customOpenAI.listModels(provider.id);
                        const prefixed = providerModels.map(m => ({
                            id: `custom_openai:${provider.id}:${m.id}`,
                            owned_by: provider.name,
                        }));
                        models = [...models, ...prefixed];
                    } catch (err) {
                        this.logger.warn(`Failed to list models for dynamic provider ${provider.name}: ${err.message}`);
                    }
                }
            }
        } catch (error) {
            this.logger.warn(`Failed to load custom openai providers in list: ${error.message}`);
        }

        // 2. Fetch CLIProxy models
        if (await this.cliproxy.isEnabled()) {
            try {
                const cliproxyModels = await this.cliproxy.listModels();
                models = [...models, ...cliproxyModels];
            } catch (error) {
                this.logger.warn(`Failed to list CLIProxy models: ${error}`);
            }
        }

        // 3. Fallback Gemini models if nothing else
        if (models.length === 0) {
            return [
                { id: 'gemini-2.5-flash' },
                { id: 'gemini-2.5-pro' },
                { id: 'gemini-2.0-flash' },
            ];
        }

        return models;
    }
}
