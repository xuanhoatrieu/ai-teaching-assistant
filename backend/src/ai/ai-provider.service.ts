import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { CLIProxyProvider } from './cliproxy.provider';

export type AIProviderType = 'cliproxy' | 'gemini';

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
        return modelName;
    }

    /**
     * Generate text using the best available provider
     * Priority: CLIProxy (if enabled) → Gemini SDK (user key)
     */
    async generateText(
        prompt: string,
        modelName: string,
        userApiKey?: string,
    ): Promise<AIProviderResult> {
        // Normalize model name (strip provider prefix)
        const normalizedModel = this.normalizeModelName(modelName);

        // Priority 1: Try CLIProxy if enabled
        if (await this.cliproxy.isEnabled()) {
            try {
                this.logger.log(`Attempting CLIProxy with model: ${normalizedModel}`);
                const content = await this.cliproxy.generateText(prompt, normalizedModel);
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
        if (userApiKey) {
            try {
                this.logger.log(`Using Gemini SDK with model: ${normalizedModel}`);
                const genAI = new GoogleGenerativeAI(userApiKey);
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
        userApiKey?: string,
    ): Promise<AIProviderResult> {
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
        if (userApiKey) {
            const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
            const genAI = new GoogleGenerativeAI(userApiKey);
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
        if (await this.cliproxy.isEnabled()) {
            try {
                return await this.cliproxy.listModels();
            } catch (error) {
                this.logger.warn(`Failed to list CLIProxy models: ${error}`);
            }
        }

        // Default Gemini models
        return [
            { id: 'gemini-2.5-flash' },
            { id: 'gemini-2.5-pro' },
            { id: 'gemini-2.0-flash' },
        ];
    }
}
