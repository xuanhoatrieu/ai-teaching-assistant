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
            defaultTextModel: (configMap.get('cliproxy.defaultTextModel') as string) || '',
            defaultImageModel: (configMap.get('cliproxy.defaultImageModel') as string) || '',
            defaultTTSModel: (configMap.get('cliproxy.defaultTTSModel') as string) || '',
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
        const message = data.choices[0].message;
        let content = message.content;
        
        // Some models (GPT-5, o-series) return content in alternative fields
        if (content === null || content === undefined) {
            // Try reasoning_content (o1, o3, etc.)
            const alt = message as any;
            if (alt.reasoning_content) {
                this.logger.warn(`CLIProxy: content null but found reasoning_content (${String(alt.reasoning_content).length} chars)`);
                content = alt.reasoning_content;
            }
            // Try content as array (multimodal response)
            else if (Array.isArray(alt.content)) {
                const textParts = alt.content.filter((p: any) => p.type === 'text').map((p: any) => p.text);
                if (textParts.length > 0) {
                    this.logger.warn(`CLIProxy: content was array, extracted ${textParts.length} text parts`);
                    content = textParts.join('\n');
                }
            }
            // Try tool_calls content 
            else if (alt.tool_calls && alt.tool_calls.length > 0) {
                this.logger.warn(`CLIProxy: content null, found ${alt.tool_calls.length} tool_calls`);
                content = alt.tool_calls.map((tc: any) => tc.function?.arguments || '').join('\n');
            }
            
            if (content === null || content === undefined) {
                // Log the full message keys for debugging
                this.logger.error(`CLIProxy: content is null. Message keys: ${Object.keys(message).join(', ')}`);
                this.logger.error(`CLIProxy: finish_reason: ${data.choices[0].finish_reason}, raw message: ${JSON.stringify(message).substring(0, 500)}`);
            }
        }
        return content || '';
    }

    /**
     * Simple text generation (wraps chat with single user message)
     */
    async generateText(prompt: string, model?: string, options?: { maxTokens?: number }): Promise<string> {
        return this.chat([{ role: 'user', content: prompt }], model, { maxTokens: options?.maxTokens });
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
     * Generate TTS audio via CLIProxy using a TTS model.
     * Uses /v1/chat/completions with TTS model + audio response config.
     * Returns raw audio Buffer (WAV format).
     */
    async generateTTS(
        text: string,
        model?: string,
        voiceId?: string,
    ): Promise<{ audio: Buffer; format: string }> {
        const config = await this.getConfig();
        // Strip 'cliproxy:' prefix if present (user/admin config may include it)
        const cleanModel = model?.replace(/^cliproxy:/, '') || '';
        const modelName = cleanModel || config.defaultTTSModel;
        const voice = voiceId || 'Puck';

        this.logger.log(`CLIProxy TTS: model=${modelName}, voice=${voice}, text=${text.substring(0, 50)}...`);

        const response = await fetch(`${config.url}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelName,
                messages: [{ role: 'user', content: text }],
                modalities: ['AUDIO'],
                audio: {
                    voice: voice.toLowerCase(),
                    format: 'wav',
                },
                // Gemini-native fields that CLIProxy may forward directly
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: voice,
                            },
                        },
                    },
                },
            }),
            signal: AbortSignal.timeout(60000), // 60s timeout for TTS
        });

        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`CLIProxy TTS error: ${response.status} - ${errorText}`);
            throw new Error(`CLIProxy TTS failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const message = data.choices?.[0]?.message;

        // Format 1: message.audio.data (OpenAI audio response format)
        if (message?.audio?.data) {
            const audioBuffer = Buffer.from(message.audio.data, 'base64');
            this.logger.log(`✅ CLIProxy TTS: ${audioBuffer.length} bytes from message.audio.data`);
            return { audio: audioBuffer, format: 'wav' };
        }

        // Format 2: Inline data in content parts (Gemini-style)
        const content = message?.content;
        if (Array.isArray(content)) {
            for (const part of content) {
                if (part.inlineData?.data || part.inline_data?.data) {
                    const b64 = part.inlineData?.data || part.inline_data?.data;
                    const audioBuffer = Buffer.from(b64, 'base64');
                    this.logger.log(`✅ CLIProxy TTS: ${audioBuffer.length} bytes from inline_data`);
                    return { audio: audioBuffer, format: 'wav' };
                }
            }
        }

        // Format 3: Raw base64 string in content
        if (typeof content === 'string' && content.length > 100) {
            try {
                const audioBuffer = Buffer.from(content, 'base64');
                if (audioBuffer.length > 100) {
                    this.logger.log(`✅ CLIProxy TTS: ${audioBuffer.length} bytes from raw content`);
                    return { audio: audioBuffer, format: 'wav' };
                }
            } catch { /* not base64 */ }
        }

        // Format 4: CLIProxy images[] with data URI (data:audio/...;base64,...)
        if (Array.isArray(message?.images)) {
            for (const img of message.images) {
                const dataUrl = img?.image_url?.url || img?.url || '';
                if (dataUrl.startsWith('data:audio/')) {
                    const base64Part = dataUrl.split(',')[1];
                    if (base64Part) {
                        const audioBuffer = Buffer.from(base64Part, 'base64');
                        this.logger.log(`✅ CLIProxy TTS: ${audioBuffer.length} bytes from images[] data URI`);
                        return { audio: audioBuffer, format: 'wav' };
                    }
                }
            }
        }

        throw new Error('CLIProxy TTS: No audio data found in response');
    }

    /**
     * List available models (with timeout)
     */
    async listModels(): Promise<{ id: string; owned_by?: string }[]> {
        const config = await this.getConfig();

        const response = await fetch(`${config.url}/v1/models`, {
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
            },
            signal: AbortSignal.timeout(15000), // 15s timeout
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
     * Health check (with timeout)
     */
    async healthCheck(): Promise<boolean> {
        try {
            const config = await this.getConfig();
            const response = await fetch(`${config.url}/v1/models`, {
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                signal: AbortSignal.timeout(10000), // 10s timeout
            });
            return response.ok;
        } catch (error) {
            this.logger.error(`CLIProxy health check failed: ${error}`);
            return false;
        }
    }
}
