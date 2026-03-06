import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CLIProxyConfig {
    enabled: boolean;
    url: string;
    apiKey: string;
    defaultTextModel: string;
    defaultImageModel: string;
    defaultTTSModel: string;
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface ChatCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

@Injectable()
export class CLIProxyProvider {
    private readonly logger = new Logger(CLIProxyProvider.name);
    private readonly baseUrl: string;
    private readonly apiKey: string;

    // Cached auto-detected models by category (populated on startup)
    private detectedModels: { text: string[]; image: string[]; tts: string[] } = {
        text: [], image: [], tts: [],
    };

    constructor(
        private readonly prisma: PrismaService,
    ) {
        this.baseUrl = process.env.CLIPROXY_URL || 'https://cliproxy.hoclieu.id.vn';
        this.apiKey = process.env.CLIPROXY_API_KEY || '';
    }

    /**
     * Auto-detect available models from CLIProxy /v1/models endpoint.
     * Categorizes into text, image, and TTS. Saves best of each to system_configs.
     * Call this on app startup. Non-blocking — returns gracefully on failure.
     */
    async autoDetectModels(): Promise<{ text: string | null; image: string | null; tts: string | null }> {
        const result = { text: null as string | null, image: null as string | null, tts: null as string | null };

        try {
            const isEnabled = await this.isEnabled();
            if (!isEnabled) {
                this.logger.log('Auto-detect skipped: CLIProxy not enabled');
                return result;
            }

            const models = await this.listModels();
            const textModels: string[] = [];
            const imageModels: string[] = [];
            const ttsModels: string[] = [];

            for (const m of models) {
                const id = m.id.toLowerCase();

                // Skip non-generative models
                if (id.includes('embedding') || id.includes('retrieval') || id.includes('moderation')) {
                    continue;
                }

                // Classify
                if (id.includes('image') || id.includes('imagen') || id.includes('dall-e')) {
                    imageModels.push(m.id);
                } else if (id.includes('tts') || id.includes('speech')) {
                    ttsModels.push(m.id);
                } else {
                    textModels.push(m.id);
                }
            }

            // Sort each category by version (newest first)
            const sortByVersion = (arr: string[]) => arr.sort((a, b) => {
                const versionOf = (s: string) => {
                    const nums = s.match(/(\d+\.?\d*)/g);
                    if (!nums) return 0;
                    // Score: major * 1000 + minor to handle e.g. "3.1" > "2.5"
                    return nums.reduce((score, n, i) => score + parseFloat(n) * Math.pow(100, nums.length - i - 1), 0);
                };
                return versionOf(b) - versionOf(a);
            });

            sortByVersion(textModels);
            sortByVersion(imageModels);
            sortByVersion(ttsModels);

            this.detectedModels = { text: textModels, image: imageModels, tts: ttsModels };

            this.logger.log(`Auto-detect: ${textModels.length} text, ${imageModels.length} image, ${ttsModels.length} TTS models`);

            // Save and auto-update defaults for each category
            const categories = [
                { key: 'Text', models: textModels, configKey: 'cliproxy.defaultTextModel' },
                { key: 'Image', models: imageModels, configKey: 'cliproxy.defaultImageModel' },
                { key: 'TTS', models: ttsModels, configKey: 'cliproxy.defaultTTSModel' },
            ] as const;

            for (const cat of categories) {
                if (cat.models.length > 0) {
                    const best = cat.models[0];

                    // Read current admin setting
                    const current = await this.prisma.systemConfig.findUnique({
                        where: { key: cat.configKey },
                    });
                    const currentModel = current?.value || '';

                    // Auto-update if: no setting yet, or current model is no longer available
                    const isCurrentAvailable = cat.models.includes(currentModel);
                    if (!currentModel || !isCurrentAvailable) {
                        await this.prisma.systemConfig.upsert({
                            where: { key: cat.configKey },
                            update: { value: best },
                            create: { key: cat.configKey, value: best },
                        });
                        this.logger.log(`Auto-detect ${cat.key}: ${currentModel || '(none)'} → ${best}${!isCurrentAvailable && currentModel ? ' (old model unavailable)' : ''}`);
                    } else {
                        this.logger.log(`Auto-detect ${cat.key}: keeping current "${currentModel}" (still available)`);
                    }

                    result[cat.key.toLowerCase() as 'text' | 'image' | 'tts'] = cat.models[0];
                } else {
                    this.logger.warn(`Auto-detect ${cat.key}: no models found`);
                }

                // Also save full detected list for fallback use
                await this.prisma.systemConfig.upsert({
                    where: { key: `cliproxy.detected${cat.key}Models` },
                    update: { value: JSON.stringify(cat.models) },
                    create: { key: `cliproxy.detected${cat.key}Models`, value: JSON.stringify(cat.models) },
                });
            }

            return result;
        } catch (error) {
            this.logger.warn(`Auto-detect models failed (non-critical): ${error}`);
            return result;
        }
    }

    /**
     * Get fallback models for a category when the primary model fails.
     * @param category - 'text' | 'image' | 'tts'
     * @param excludeModel - model to exclude (the one that just failed)
     */
    async getModelFallbacks(category: 'text' | 'image' | 'tts', excludeModel?: string): Promise<string[]> {
        // Use cached detected models if available
        if (this.detectedModels[category].length > 0) {
            return this.detectedModels[category].filter(m => m !== excludeModel);
        }

        // Try to load from DB
        const keyMap = { text: 'cliproxy.detectedTextModels', image: 'cliproxy.detectedImageModels', tts: 'cliproxy.detectedTTSModels' };
        try {
            const saved = await this.prisma.systemConfig.findUnique({ where: { key: keyMap[category] } });
            if (saved?.value) {
                const models = JSON.parse(saved.value) as string[];
                this.detectedModels[category] = models;
                return models.filter(m => m !== excludeModel);
            }
        } catch { /* ignore */ }

        // Last resort: re-detect
        try {
            await this.autoDetectModels();
            return this.detectedModels[category].filter(m => m !== excludeModel);
        } catch {
            return [];
        }
    }

    /**
     * Check if CLIProxy is enabled in system config
     */
    async isEnabled(): Promise<boolean> {
        try {
            const config = await this.prisma.systemConfig.findUnique({
                where: { key: 'cliproxy.enabled' }
            });
            return config?.value === 'true';
        } catch (error) {
            this.logger.warn(`Failed to check CLIProxy status: ${error}`);
            return false;
        }
    }

    /**
     * Get CLIProxy configuration from system config
     */
    async getConfig(): Promise<CLIProxyConfig> {
        const configs = await this.prisma.systemConfig.findMany({
            where: {
                key: {
                    startsWith: 'cliproxy.'
                }
            }
        });

        const configMap = new Map(configs.map(c => [c.key, c.value]));

        return {
            enabled: configMap.get('cliproxy.enabled') === 'true',
            url: (configMap.get('cliproxy.url') as string) || this.baseUrl,
            apiKey: (configMap.get('cliproxy.apiKey') as string) || this.apiKey,
            defaultTextModel: (configMap.get('cliproxy.defaultTextModel') as string) || 'gemini-2.5-flash',
            defaultImageModel: (configMap.get('cliproxy.defaultImageModel') as string) || 'gemini-3.1-flash-image',
            defaultTTSModel: (configMap.get('cliproxy.defaultTTSModel') as string) || 'gemini-2.5-flash-preview-tts',
        };
    }

    /**
     * Chat completion using OpenAI-compatible API
     */
    async chat(
        messages: ChatMessage[],
        model?: string,
        options?: { stream?: boolean; maxTokens?: number }
    ): Promise<string> {
        const config = await this.getConfig();
        const modelName = model || config.defaultTextModel;

        this.logger.log(`CLIProxy chat: model=${modelName}, messages=${messages.length}`);

        const response = await fetch(`${config.url}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelName,
                messages,
                stream: options?.stream ?? false,
                max_tokens: options?.maxTokens,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`CLIProxy error: ${response.status} - ${errorText}`);
            throw new Error(`CLIProxy request failed: ${response.status} - ${errorText}`);
        }

        const data: ChatCompletionResponse = await response.json();

        if (!data.choices || data.choices.length === 0) {
            throw new Error('CLIProxy returned empty response');
        }

        this.logger.log(`CLIProxy response: tokens=${data.usage?.total_tokens || 'unknown'}`);
        return data.choices[0].message.content;
    }

    /**
     * Simple text generation (wraps chat with single user message)
     */
    async generateText(prompt: string, model?: string): Promise<string> {
        return this.chat([{ role: 'user', content: prompt }], model);
    }

    /**
     * Generate text with system prompt
     */
    async generateTextWithSystem(
        systemPrompt: string,
        userPrompt: string,
        model?: string
    ): Promise<string> {
        return this.chat([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], model);
    }

    /**
     * Generate image using image model
     * Note: This uses the multimodal endpoint, image is returned as base64 in response
     * Response format varies by CLIProxy implementation:
     * - String content with base64 data
     * - Array content with image_url parts (OpenAI multimodal format)
     * - Raw base64 string
     */
    async generateImage(prompt: string, model?: string): Promise<string> {
        const config = await this.getConfig();
        const modelName = model || config.defaultImageModel;

        this.logger.log(`CLIProxy image generation: model=${modelName}`);

        const response = await fetch(`${config.url}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelName,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`CLIProxy image generation failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const message = data.choices?.[0]?.message;
        const content = message?.content;
        const images = message?.images; // CLIProxy native image response field

        this.logger.log(`CLIProxy image response: content=${typeof content}, images=${Array.isArray(images) ? images.length + ' items' : 'none'}`);

        // Priority 1: Check message.images[] (CLIProxy native format)
        // Format: [{type: 'image_url', image_url: {url: 'data:image/png;base64,...'}, index: 0}]
        if (Array.isArray(images) && images.length > 0) {
            for (const img of images) {
                if (img.type === 'image_url' && img.image_url?.url) {
                    this.logger.log(`✅ Found image in images[] array (${img.image_url.url.length} chars)`);
                    return img.image_url.url; // "data:image/png;base64,..."
                }
            }
        }

        // Priority 2: Check content as array (OpenAI multimodal format)
        if (Array.isArray(content)) {
            for (const part of content) {
                if (part.type === 'image_url' && part.image_url?.url) {
                    this.logger.log(`✅ Found image_url in content array`);
                    return part.image_url.url;
                }
                if (part.type === 'text' && part.text && part.text.includes('base64')) {
                    return part.text;
                }
            }
            const textPart = content.find((p: any) => p.type === 'text');
            return textPart?.text || JSON.stringify(content);
        }

        // Priority 3: String content (could be base64, data URI, or text)
        return content || '';
    }

    /**
     * List available models
     */
    async listModels(): Promise<{ id: string; owned_by?: string }[]> {
        const config = await this.getConfig();

        const response = await fetch(`${config.url}/v1/models`, {
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to list models: ${response.status}`);
        }

        const data = await response.json();
        return data.data.map((m: { id: string; owned_by?: string }) => ({
            id: m.id,
            owned_by: m.owned_by,
        }));
    }

    /**
     * Health check
     */
    async healthCheck(): Promise<boolean> {
        try {
            const config = await this.getConfig();
            const response = await fetch(`${config.url}/v1/models`, {
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`,
                },
            });
            return response.ok;
        } catch (error) {
            this.logger.error(`CLIProxy health check failed: ${error}`);
            return false;
        }
    }
}
