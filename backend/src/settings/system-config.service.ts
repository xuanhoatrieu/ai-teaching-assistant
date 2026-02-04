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
    }> {
        const configs = await this.getByPrefix('cliproxy.');
        const configMap = new Map(configs.map(c => [c.key, c.value]));

        return {
            enabled: configMap.get('cliproxy.enabled') === 'true',
            url: configMap.get('cliproxy.url') || process.env.CLIPROXY_URL || 'https://cliproxy.hoclieu.id.vn',
            apiKey: configMap.get('cliproxy.apiKey') || process.env.CLIPROXY_API_KEY || '',
            defaultTextModel: configMap.get('cliproxy.defaultTextModel') || 'gemini-2.5-flash',
            defaultImageModel: configMap.get('cliproxy.defaultImageModel') || 'gemini-3-pro-image-preview',
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
            { key: 'cliproxy.defaultTextModel', value: 'gemini-2.5-flash' },
            { key: 'cliproxy.defaultImageModel', value: 'gemini-3-pro-image-preview' },
        ];

        for (const { key, value } of defaults) {
            const existing = await this.get(key);
            if (existing === null) {
                await this.set(key, value);
            }
        }

        this.logger.log('CLIProxy defaults initialized');
    }
}
