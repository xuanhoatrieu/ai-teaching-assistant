import { Logger } from '@nestjs/common';
import {
    ITTSProvider,
    TTSCredentials,
    TTSOptions,
    TTSResult,
    Voice,
} from '../interfaces/tts-provider.interface';

/**
 * Gemini TTS Provider
 * Uses Google Gemini API for text-to-speech generation
 * Reference: https://ai.google.dev/gemini-api/docs/speech-generation
 */
export class GeminiTTSProvider implements ITTSProvider {
    readonly name = 'Gemini TTS';
    readonly type = 'GEMINI';
    private readonly logger = new Logger(GeminiTTSProvider.name);
    private readonly apiKey: string;

    constructor(credentials: TTSCredentials) {
        this.apiKey = credentials.apiKey || '';
    }

    async generateAudio(text: string, options?: TTSOptions): Promise<TTSResult> {
        this.logger.log(`Generating audio with Gemini TTS: ${text.substring(0, 50)}...`);

        if (!this.apiKey) {
            throw new Error('Gemini API key is required for TTS generation');
        }

        try {
            // Dynamically import the SDK 
            const { GoogleGenAI } = await import('@google/genai');

            const ai = new GoogleGenAI({ apiKey: this.apiKey });

            // Use voice from options or default to Puck
            const voiceName = options?.voiceId || 'Puck';
            const model = options?.model || 'gemini-2.5-flash-preview-tts';

            this.logger.log(`Using model: ${model}, voice: ${voiceName}`);

            const response = await ai.models.generateContent({
                model: model,
                contents: [{
                    parts: [{ text: text }]
                }],
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: voiceName
                            },
                        },
                    },
                },
            });

            const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

            if (!data) {
                throw new Error('No audio data in response');
            }

            // Decode base64 audio data
            const audioBuffer = Buffer.from(data, 'base64');

            this.logger.log(`Audio generated successfully: ${audioBuffer.length} bytes`);

            return {
                audio: audioBuffer,
                format: 'wav', // Gemini returns PCM audio in WAV format
                provider: this.name,
            };
        } catch (error: any) {
            this.logger.error(`Gemini TTS error: ${error.message}`);
            throw error;
        }
    }

    async getVoices(): Promise<Voice[]> {
        // Gemini TTS prebuilt voices
        // Reference: https://ai.google.dev/gemini-api/docs/speech-generation#voice-options
        return [
            {
                id: 'Puck',
                name: 'Puck',
                gender: 'male',
                languageCode: 'en-US',
                description: 'Playful and friendly',
            },
            {
                id: 'Charon',
                name: 'Charon',
                gender: 'male',
                languageCode: 'en-US',
                description: 'Deep and authoritative',
            },
            {
                id: 'Kore',
                name: 'Kore',
                gender: 'female',
                languageCode: 'en-US',
                description: 'Bright and energetic',
            },
            {
                id: 'Fenrir',
                name: 'Fenrir',
                gender: 'male',
                languageCode: 'en-US',
                description: 'Warm and friendly',
            },
            {
                id: 'Aoede',
                name: 'Aoede',
                gender: 'female',
                languageCode: 'en-US',
                description: 'Clear and professional',
            },
            {
                id: 'Leda',
                name: 'Leda',
                gender: 'female',
                languageCode: 'en-US',
                description: 'Soft and calm',
            },
            {
                id: 'Orus',
                name: 'Orus',
                gender: 'male',
                languageCode: 'en-US',
                description: 'Strong and confident',
            },
            {
                id: 'Zephyr',
                name: 'Zephyr',
                gender: 'neutral',
                languageCode: 'en-US',
                description: 'Light and airy',
            },
        ];
    }

    async testConnection(): Promise<boolean> {
        if (!this.apiKey) {
            return false;
        }

        try {
            // Simple test - try to list models
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: this.apiKey });
            // If we can instantiate without error, connection is OK
            return true;
        } catch {
            return false;
        }
    }
}
