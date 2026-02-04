/**
 * TTS Options for audio generation
 */
export interface TTSOptions {
    voiceId?: string;
    model?: string; // Model name, e.g., 'gemini-2.5-flash-preview-tts'
    speed?: number; // 0.5 - 2.0
    pitch?: number; // -20 to 20
    volume?: number; // -96 to 16 dB
    languageCode?: string; // e.g., 'vi-VN', 'en-US'
    multilingualMode?: string; // ViTTS: 'auto', 'syllable', 'english'
}

/**
 * Voice information
 */
export interface Voice {
    id: string;
    name: string;
    gender: 'male' | 'female' | 'neutral';
    languageCode: string;
    description?: string;
}

/**
 * TTS Generation Result
 */
export interface TTSResult {
    audio: Buffer;
    format: 'mp3' | 'wav' | 'ogg';
    durationMs?: number;
    provider: string;
}

/**
 * Base interface for all TTS providers
 */
export interface ITTSProvider {
    readonly name: string;
    readonly type: string;

    /**
     * Generate audio from text
     */
    generateAudio(text: string, options?: TTSOptions): Promise<TTSResult>;

    /**
     * Get available voices for this provider
     */
    getVoices(): Promise<Voice[]>;

    /**
     * Test if provider is configured correctly
     */
    testConnection(): Promise<boolean>;
}

/**
 * Credentials structure for providers
 */
export interface TTSCredentials {
    apiKey?: string;
    appId?: string;
    token?: string;
    endpoint?: string;
    [key: string]: string | undefined;
}
