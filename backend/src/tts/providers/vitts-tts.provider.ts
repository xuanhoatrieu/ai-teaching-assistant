import { Logger } from '@nestjs/common';
import axios from 'axios';
import {
    ITTSProvider,
    TTSCredentials,
    TTSOptions,
    TTSResult,
    Voice,
} from '../interfaces/tts-provider.interface';

const DEFAULT_VITTS_BASE_URL = 'http://117.0.36.6:8000';

/**
 * ViTTS TTS Provider
 * Local TTS service with support for:
 * - System voices (male, female)
 * - Saved reference voices (user uploaded)
 * - Trained voices (user fine-tuned)
 */
export class ViTTSTTSProvider implements ITTSProvider {
    readonly name = 'ViTTS';
    readonly type = 'VITTS';
    private readonly logger = new Logger(ViTTSTTSProvider.name);
    private readonly apiKey: string;
    private readonly baseUrl: string;

    constructor(credentials: TTSCredentials) {
        this.apiKey = credentials.apiKey || '';
        this.baseUrl = (credentials.baseUrl || DEFAULT_VITTS_BASE_URL).replace(/\/$/, '');
    }

    private get headers() {
        return { 'X-API-Key': this.apiKey };
    }

    async generateAudio(text: string, options?: TTSOptions): Promise<TTSResult> {
        this.logger.log(`Generating audio with ViTTS. BaseURL: ${this.baseUrl}`);
        this.logger.log(`Text preview: ${text.substring(0, 50)}...`);

        if (!this.apiKey) {
            throw new Error('ViTTS API key is required');
        }

        let voiceId = options?.voiceId || 'male';
        const speed = options?.speed || 1.0;
        const multilingualMode = options?.multilingualMode;

        // Strip 'vitts:' prefix if present (voice IDs from ModelConfigService have this prefix)
        if (voiceId.startsWith('vitts:')) {
            voiceId = voiceId.substring(6); // Remove 'vitts:' prefix
        }

        this.logger.log(`ViTTS voiceId after normalization: ${voiceId}, multilingualMode: ${multilingualMode || 'none'}`);

        try {
            let audioBytes: Buffer;

            // Check if using saved reference voice (format: ref:{id})
            if (voiceId.startsWith('ref:')) {
                const refId = parseInt(voiceId.split(':')[1], 10);
                this.logger.log(`Using saved reference voice, refId: ${refId}`);
                audioBytes = await this.synthesizeWithRef(text, refId, speed, multilingualMode);
            } else if (voiceId.startsWith('trained_')) {
                // Trained voice (trained_{id} format)
                this.logger.log(`Using trained voice: ${voiceId}`);
                audioBytes = await this.synthesize(text, voiceId, speed, multilingualMode);
            } else {
                // System voice (male, female)
                this.logger.log(`Using system voice: ${voiceId}`);
                audioBytes = await this.synthesize(text, voiceId, speed, multilingualMode);
            }

            return {
                audio: audioBytes,
                format: 'wav',
                provider: this.name,
            };
        } catch (error) {
            this.logger.error(`ViTTS error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Synthesize with system voice or trained voice
     */
    private async synthesize(text: string, voiceId: string, speed: number, multilingualMode?: string): Promise<Buffer> {
        const body: any = {
            text,
            voice_id: voiceId,
            speed,
            nfe_step: 32,
            cfg_strength: 2.0,
        };

        if (multilingualMode) {
            body.multilingual_mode = multilingualMode;
        }

        const response = await axios.post(
            `${this.baseUrl}/api/v1/tts/synthesize`,
            body,
            {
                headers: this.headers,
                responseType: 'arraybuffer',
                timeout: 120000, // 120 seconds for GPU model loading
            },
        );

        return Buffer.from(response.data);
    }

    /**
     * Synthesize with saved reference audio
     * Note: API expects form-urlencoded data (not JSON) for this endpoint
     */
    private async synthesizeWithRef(text: string, refId: number, speed: number, multilingualMode?: string): Promise<Buffer> {
        // Build form data (matching Python SDK's data= parameter)
        const formData = new URLSearchParams();
        formData.append('text', text);
        formData.append('ref_id', refId.toString());
        formData.append('speed', speed.toString());
        formData.append('nfe_step', '32');
        formData.append('cfg_strength', '2.0');

        if (multilingualMode) {
            formData.append('multilingual_mode', multilingualMode);
        }

        this.logger.log(`ViTTS synthesizeWithRef: text=${text.substring(0, 50)}..., ref_id=${refId}, multilingual=${multilingualMode || 'none'}`);

        const response = await axios.post(
            `${this.baseUrl}/api/v1/tts/synthesize-with-saved-ref`,
            formData.toString(),
            {
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                responseType: 'arraybuffer',
                timeout: 120000, // 120 seconds for GPU model loading
            },
        );

        return Buffer.from(response.data);
    }

    async getVoices(): Promise<Voice[]> {
        const voices: Voice[] = [];

        // 1. Fetch saved references (default/priority)
        const refs = await this.fetchSavedReferences();
        voices.push(...refs);

        // 2. Fetch trained voices
        const trainedVoices = await this.fetchTrainedVoices();
        voices.push(...trainedVoices);

        // 3. Add system voices (last)
        voices.push(
            {
                id: 'male',
                name: 'ViTTS - Nam',
                gender: 'male',
                languageCode: 'vi-VN',
                description: 'Giọng nam hệ thống',
            },
            {
                id: 'female',
                name: 'ViTTS - Nữ',
                gender: 'female',
                languageCode: 'vi-VN',
                description: 'Giọng nữ hệ thống',
            },
        );

        return voices;
    }

    private async fetchSavedReferences(): Promise<Voice[]> {
        if (!this.apiKey) return [];

        try {
            const response = await axios.get(`${this.baseUrl}/api/v1/refs`, {
                headers: this.headers,
            });

            const refs = response.data || [];
            return refs.map((ref: any) => ({
                id: `ref:${ref.id}`,
                name: `📎 ${ref.name}`,
                gender: 'neutral' as const,
                languageCode: ref.language === 'en' ? 'en-US' : 'vi-VN',
                description: `Saved reference (${ref.duration?.toFixed(1) || '?'}s)`,
            }));
        } catch (error) {
            this.logger.warn(`Error fetching ViTTS references: ${error.message}`);
            return [];
        }
    }

    private async fetchTrainedVoices(): Promise<Voice[]> {
        if (!this.apiKey) return [];

        try {
            const response = await axios.get(`${this.baseUrl}/api/v1/users/voices`, {
                headers: this.headers,
            });

            const voices = response.data || [];
            return voices.map((v: any) => ({
                id: `trained_${v.id}`,
                name: `🎓 ${v.name}`,
                gender: 'neutral' as const,
                languageCode: v.language === 'en' ? 'en-US' : 'vi-VN',
                description: `Trained voice (${v.engine || 'f5tts'})`,
            }));
        } catch (error) {
            this.logger.warn(`Error fetching ViTTS trained voices: ${error.message}`);
            return [];
        }
    }

    async testConnection(): Promise<boolean> {
        if (!this.apiKey) return false;

        try {
            const response = await axios.get(`${this.baseUrl}/api/v1/tts/voices`, {
                headers: this.headers,
                timeout: 120000, // 120 seconds for GPU model loading
            });
            return response.status === 200;
        } catch {
            return false;
        }
    }
}
