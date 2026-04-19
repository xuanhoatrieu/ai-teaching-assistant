import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SystemConfigValue {
    key: string;
    value: string;
}

@Injectable()
export class SystemConfigService {
    private readonly logger = new Logger(SystemConfigService.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Get a config value by key
     */
    async get(key: string): Promise<string | null> {
        const config = await this.prisma.systemConfig.findUnique({
            where: { key }
        });
        return config?.value ?? null;
    }

    /**
     * Get a config value with default
     */
    async getOrDefault(key: string, defaultValue: string): Promise<string> {
        const value = await this.get(key);
        return value ?? defaultValue;
    }

    /**
     * Get boolean config
     */
    async getBoolean(key: string, defaultValue = false): Promise<boolean> {
        const value = await this.get(key);
        if (value === null) return defaultValue;
        return value === 'true';
    }

    /**
     * Set a config value
     */
    async set(key: string, value: string): Promise<void> {
        await this.prisma.systemConfig.upsert({
            where: { key },
            update: { value },
            create: { key, value },
        });
        this.logger.log(`Config set: ${key} = ${value}`);
    }

    /**
     * Delete a config
     */
    async delete(key: string): Promise<void> {
        await this.prisma.systemConfig.delete({
            where: { key }
        }).catch(() => {
            // Ignore if not found
        });
    }

    /**
     * Get all configs with a prefix
     */
    async getByPrefix(prefix: string): Promise<SystemConfigValue[]> {
        const configs = await this.prisma.systemConfig.findMany({
            where: {
                key: {
                    startsWith: prefix
                }
            }
        });
        return configs.map(c => ({ key: c.key, value: c.value }));
    }

    /**
     * Get CLIProxy specific configs
     */
    async getCLIProxyConfig(): Promise<{
        enabled: boolean;
        url: string;
        apiKey: string;
        defaultTextModel: string;
        defaultImageModel: string;
        defaultTTSModel: string;
    }> {
        const configs = await this.getByPrefix('cliproxy.');
        const configMap = new Map(configs.map(c => [c.key, c.value]));

        return {
            enabled: configMap.get('cliproxy.enabled') === 'true',
            url: configMap.get('cliproxy.url') || process.env.CLIPROXY_URL || 'https://cliproxy.hoclieu.id.vn',
            apiKey: configMap.get('cliproxy.apiKey') || process.env.CLIPROXY_API_KEY || '',
            defaultTextModel: configMap.get('cliproxy.defaultTextModel') || '',
            defaultImageModel: configMap.get('cliproxy.defaultImageModel') || '',
            defaultTTSModel: configMap.get('cliproxy.defaultTTSModel') || '',
        };
    }

    /**
     * Initialize default CLIProxy config
     */
    async initializeCLIProxyDefaults(): Promise<void> {
        const defaults = [
            { key: 'cliproxy.enabled', value: 'false' },
            { key: 'cliproxy.url', value: process.env.CLIPROXY_URL || 'https://cliproxy.hoclieu.id.vn' },
            { key: 'cliproxy.apiKey', value: process.env.CLIPROXY_API_KEY || '' },
            { key: 'cliproxy.defaultTextModel', value: '' },
            { key: 'cliproxy.defaultImageModel', value: '' },
            { key: 'cliproxy.defaultTTSModel', value: '' },
        ];

        for (const { key, value } of defaults) {
            const existing = await this.get(key);
            if (existing === null) {
                await this.set(key, value);
            }
        }

        this.logger.log('CLIProxy defaults initialized');
    }

    // ========================
    // Image Generation Provider (OpenAI Images API compatible — Flux/ComfyUI)
    // ========================

    /**
     * Get Image Generation provider configs
     */
    async getImageGenConfig(): Promise<{
        enabled: boolean;
        url: string;
        apiKey: string;
        defaultModel: string;
        steps: number;
    }> {
        const configs = await this.getByPrefix('imageGen.');
        const configMap = new Map(configs.map(c => [c.key, c.value]));

        return {
            enabled: configMap.get('imageGen.enabled') === 'true',
            url: configMap.get('imageGen.url') || process.env.IMAGE_GEN_URL || '',
            apiKey: configMap.get('imageGen.apiKey') || process.env.IMAGE_GEN_API_KEY || '',
            defaultModel: configMap.get('imageGen.defaultModel') || 'flux-image',
            steps: parseInt(configMap.get('imageGen.steps') || '20', 10),
        };
    }

    /**
     * Initialize default Image Gen config
     */
    async initializeImageGenDefaults(): Promise<void> {
        const defaults = [
            { key: 'imageGen.enabled', value: 'false' },
            { key: 'imageGen.url', value: process.env.IMAGE_GEN_URL || '' },
            { key: 'imageGen.apiKey', value: process.env.IMAGE_GEN_API_KEY || '' },
            { key: 'imageGen.defaultModel', value: 'flux-image' },
            { key: 'imageGen.steps', value: '20' },
        ];

        for (const { key, value } of defaults) {
            const existing = await this.get(key);
            if (existing === null) {
                await this.set(key, value);
            }
        }

        this.logger.log('ImageGen defaults initialized');
    }
}
