import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CLIProxyConfig {
    enabled: boolean;
    url: string;
    apiKey: string;
    defaultTextModel: string;
    defaultImageModel: string;
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

    constructor(
        private readonly prisma: PrismaService,
    ) {
        this.baseUrl = process.env.CLIPROXY_URL || 'https://cliproxy.hoclieu.id.vn';
        this.apiKey = process.env.CLIPROXY_API_KEY || '';
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
            defaultImageModel: (configMap.get('cliproxy.defaultImageModel') as string) || 'gemini-3-pro-image-preview',
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
        return data.choices[0].message.content;
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
