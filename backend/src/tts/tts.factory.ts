import { Injectable, Logger } from '@nestjs/common';
import { TTSProviderType } from '@prisma/client';
import {
    ITTSProvider,
    TTSCredentials,
} from './interfaces/tts-provider.interface';
import { GeminiTTSProvider } from './providers/gemini-tts.provider';
import { GoogleCloudTTSProvider } from './providers/google-cloud-tts.provider';
import { VbeeTTSProvider } from './providers/vbee-tts.provider';
import { ViTTSTTSProvider } from './providers/vitts-tts.provider';

@Injectable()
export class TTSFactory {
    private readonly logger = new Logger(TTSFactory.name);

    /**
     * Get a TTS provider instance by type
     */
    getProvider(type: TTSProviderType, credentials: TTSCredentials): ITTSProvider {
        switch (type) {
            case TTSProviderType.GEMINI:
                return new GeminiTTSProvider(credentials);

            case TTSProviderType.GOOGLE_CLOUD:
                return new GoogleCloudTTSProvider(credentials);

            case TTSProviderType.VBEE:
                return new VbeeTTSProvider(credentials);

            case TTSProviderType.VITTS:
                return new ViTTSTTSProvider(credentials);

            default:
                this.logger.warn(`Unknown provider type: ${type}, falling back to Gemini`);
                return new GeminiTTSProvider(credentials);
        }
    }

    /**
     * Get default provider (Gemini) with system credentials
     */
    getDefaultProvider(systemApiKey: string): ITTSProvider {
        return new GeminiTTSProvider({ apiKey: systemApiKey });
    }

    /**
     * Get providers in fallback order
     */
    getFallbackChain(
        primaryType: TTSProviderType,
        primaryCredentials: TTSCredentials,
        systemApiKey?: string,
    ): ITTSProvider[] {
        const chain: ITTSProvider[] = [];

        // Add primary provider
        chain.push(this.getProvider(primaryType, primaryCredentials));

        // Add fallback: Gemini if not already primary
        if (primaryType !== TTSProviderType.GEMINI && systemApiKey) {
            chain.push(new GeminiTTSProvider({ apiKey: systemApiKey }));
        }

        // Add fallback: Google Cloud if not already in chain
        if (primaryType !== TTSProviderType.GOOGLE_CLOUD && systemApiKey) {
            chain.push(new GoogleCloudTTSProvider({ apiKey: systemApiKey }));
        }

        return chain;
    }
}
