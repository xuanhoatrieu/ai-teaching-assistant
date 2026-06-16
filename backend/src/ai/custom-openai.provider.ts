import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CustomProviderConfig {
    id: string;
    name: string;
    url: string;
    apiKey: string;
    enabled: boolean;
    ttsType: 'none' | 'openai' | 'shopaikey';
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

@Injectable()
export class CustomOpenAIProvider {
    private readonly logger = new Logger(CustomOpenAIProvider.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Get all custom providers from system config
     */
    async getProviders(): Promise<CustomProviderConfig[]> {
        try {
            const config = await this.prisma.systemConfig.findUnique({
                where: { key: 'custom_openai.providers' },
            });
            if (!config || !config.value) {
                return [];
            }
            return JSON.parse(config.value) as CustomProviderConfig[];
        } catch (error) {
            this.logger.error(`Failed to get custom providers: ${error.message}`);
            return [];
        }
    }

    /**
     * Save custom providers to system config
     */
    async saveProviders(providers: CustomProviderConfig[]): Promise<void> {
        await this.prisma.systemConfig.upsert({
            where: { key: 'custom_openai.providers' },
            update: { value: JSON.stringify(providers) },
            create: { key: 'custom_openai.providers', value: JSON.stringify(providers) },
        });
    }

    /**
     * Get config of a specific provider
     */
    async getProvider(providerId: string): Promise<CustomProviderConfig | null> {
        const providers = await this.getProviders();
        return providers.find(p => p.id === providerId) || null;
    }

    /**
     * Check if a specific provider is enabled
     */
    async isEnabled(providerId: string): Promise<boolean> {
        const provider = await this.getProvider(providerId);
        return provider ? provider.enabled : false;
    }

    /**
     * Call OpenAI Chat completions endpoint with streaming SSE to bypass Cloudflare 100s timeout
     */
    async chat(
        providerId: string,
        messages: ChatMessage[],
        model: string,
        options?: { stream?: boolean; maxTokens?: number }
    ): Promise<string> {
        const provider = await this.getProvider(providerId);
        if (!provider || !provider.enabled) {
            throw new NotFoundException(`Custom OpenAI Provider "${providerId}" is disabled or not found`);
        }

        this.logger.log(`Custom OpenAI chat (${provider.name}): model=${model}, messages=${messages.length}`);

        const response = await fetch(`${provider.url}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${provider.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages,
                stream: true, // Force streaming to bypass Cloudflare timeout
                max_tokens: options?.maxTokens,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`Custom OpenAI Provider "${provider.name}" error: ${response.status} - ${errorText}`);
            throw new Error(`Provider "${provider.name}" request failed: ${response.status} - ${errorText}`);
        }

        let fullContent = '';
        let reasoningContent = '';
        const decoder = new TextDecoder('utf-8');

        if (response.body && typeof (response.body as any)[Symbol.asyncIterator] === 'function') {
            let buffer = '';
            for await (const chunk of response.body as any) {
                buffer += decoder.decode(chunk, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === '') continue;
                    if (trimmed === 'data: [DONE]') continue;
                    if (trimmed.startsWith('data: ')) {
                        try {
                            const parsed = JSON.parse(trimmed.slice(6));
                            const delta = parsed.choices?.[0]?.delta;
                            if (delta?.content) fullContent += delta.content;
                            if (delta?.reasoning_content) reasoningContent += delta.reasoning_content;
                        } catch (e) {
                            // Ignore incomplete JSON chunks
                        }
                    }
                }
            }
        } else {
            // Fallback for non-streaming response body
            const text = await response.text();
            try {
                const data = JSON.parse(text);
                if (data.choices && data.choices.length > 0) {
                    fullContent = data.choices[0].message?.content || '';
                }
            } catch (e) {
                fullContent = text;
            }
        }

        if (!fullContent && reasoningContent) {
            this.logger.warn(`Custom OpenAI chat: content null but found reasoning_content`);
            fullContent = reasoningContent;
        }

        return fullContent || '';
    }

    /**
     * Simple text generation
     */
    async generateText(
        providerId: string,
        prompt: string,
        model: string,
        options?: { maxTokens?: number }
    ): Promise<string> {
        return this.chat(providerId, [{ role: 'user', content: prompt }], model, { maxTokens: options?.maxTokens });
    }

    /**
     * Generate text with system prompt
     */
    async generateTextWithSystem(
        providerId: string,
        systemPrompt: string,
        userPrompt: string,
        model: string
    ): Promise<string> {
        return this.chat(
            providerId,
            [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            model
        );
    }

    /**
     * Dynamic TTS handler
     */
    async generateTTS(
        providerId: string,
        text: string,
        model: string,
        voiceId?: string
    ): Promise<{ audio: Buffer; format: 'wav' | 'mp3' }> {
        const provider = await this.getProvider(providerId);
        if (!provider || !provider.enabled) {
            throw new NotFoundException(`Custom OpenAI Provider "${providerId}" is disabled or not found`);
        }

        let voice = voiceId || 'Puck';
        if (voice.startsWith('custom_openai:')) {
            const parts = voice.split(':');
            voice = parts[parts.length - 1] || 'Puck';
        }
        this.logger.log(`Custom OpenAI TTS (${provider.name}): model=${model}, voice=${voice} (raw=${voiceId}), text=${text.substring(0, 50)}...`);

        // Handle ShopAIKey Custom endpoints
        if (provider.ttsType === 'shopaikey') {
            let actualModel = model;
            if (actualModel === 'gemini-tts') {
                actualModel = 'gemini-2.5-flash-preview-tts';
            }
            const isGoogleTTS = actualModel.toLowerCase().includes('gemini') || actualModel.toLowerCase().includes('google');
            let endpoint = '';
            let requestBody = {};

            if (isGoogleTTS) {
                // ShopAIKey custom Google TTS endpoint
                endpoint = `${provider.url}/tts/google/generations`;
                requestBody = { text, model: actualModel, voice };
            } else {
                // ShopAIKey custom OpenAI TTS endpoint
                endpoint = `${provider.url}/tts/openai/speech`;
                requestBody = { input: text, model: actualModel, voice, response_format: 'mp3' };
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${provider.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                signal: AbortSignal.timeout(60000),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`ShopAIKey custom TTS API failed: ${response.status} - ${errText}`);
            }

            const data = await response.json();
            const fileUrl = data.url;
            if (!fileUrl) {
                throw new Error('ShopAIKey custom TTS API: No audio URL returned in response');
            }

            this.logger.log(`Downloading audio file from URL: ${fileUrl}`);
            const audioResponse = await fetch(fileUrl);
            if (!audioResponse.ok) {
                throw new Error(`Failed to download audio file: HTTP ${audioResponse.status}`);
            }

            const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
            const format = isGoogleTTS ? 'wav' : 'mp3';
            return { audio: audioBuffer, format };
        }

        // Handle standard OpenAI TTS endpoint
        if (provider.ttsType === 'openai') {
            const response = await fetch(`${provider.url}/v1/audio/speech`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${provider.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    input: text,
                    voice: voice.toLowerCase(),
                    response_format: 'mp3',
                }),
                signal: AbortSignal.timeout(60000),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`OpenAI compatible TTS API failed: ${response.status} - ${errText}`);
            }

            const audioBuffer = Buffer.from(await response.arrayBuffer());
            return { audio: audioBuffer, format: 'mp3' };
        }

        throw new Error(`Provider "${provider.name}" does not support TTS or TTS is not configured`);
    }

    /**
     * Get available models from /v1/models endpoint
     */
    async listModels(providerId: string): Promise<{ id: string; owned_by?: string }[]> {
        const provider = await this.getProvider(providerId);
        if (!provider) {
            throw new NotFoundException(`Custom OpenAI Provider "${providerId}" not found`);
        }

        const response = await fetch(`${provider.url}/v1/models`, {
            headers: {
                'Authorization': `Bearer ${provider.apiKey}`,
            },
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            throw new Error(`Failed to list models from ${provider.name}: HTTP ${response.status}`);
        }

        const data = await response.json();
        const models = data.data || [];
        return models.map((m: any) => ({
            id: m.id,
            owned_by: m.owned_by || provider.name,
        }));
    }
}
