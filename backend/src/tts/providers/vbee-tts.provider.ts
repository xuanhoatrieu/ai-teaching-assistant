import { Logger } from '@nestjs/common';
import axios from 'axios';
import {
    ITTSProvider,
    TTSCredentials,
    TTSOptions,
    TTSResult,
    Voice,
} from '../interfaces/tts-provider.interface';

const VBEE_TTS_ENDPOINT = 'https://vbee.vn/api/v1/tts';
const VBEE_VOICES_ENDPOINT = 'https://vbee.vn/api/v1/voices';

/**
 * Vbee TTS Provider
 * Uses Vbee API for Vietnamese text-to-speech with personal voice cloning support
 * Reference: utils/vbee_tts_generator.py
 */
export class VbeeTTSProvider implements ITTSProvider {
    readonly name = 'Vbee TTS';
    readonly type = 'VBEE';
    private readonly logger = new Logger(VbeeTTSProvider.name);
    private readonly appId: string;
    private readonly token: string;

    constructor(credentials: TTSCredentials) {
        this.appId = credentials.appId || '';
        this.token = credentials.token || '';
    }

    async generateAudio(text: string, options?: TTSOptions): Promise<TTSResult> {
        this.logger.log(`Generating audio with Vbee TTS: ${text.substring(0, 50)}...`);

        if (!this.appId || !this.token) {
            throw new Error('Vbee credentials (appId, token) are required');
        }

        const voiceId = options?.voiceId || 'hn_female_ngochuyen_news_48k-fhg';
        const speed = options?.speed || 1.0;

        try {
            // Step 1: POST request to start audio generation
            const postResponse = await axios.post(
                VBEE_TTS_ENDPOINT,
                {
                    app_id: this.appId,
                    input_text: text,
                    voice_code: voiceId,
                    audio_type: 'wav',  // Changed from mp3 to wav for consistency with Gemini
                    response_type: 'indirect',
                    callback_url: 'https://example.com/dummy_callback', // Required but not used
                    speed_rate: speed,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json',
                    },
                },
            );

            if (postResponse.data?.status !== 1 || !postResponse.data?.result?.request_id) {
                this.logger.error(`Vbee POST failed: ${JSON.stringify(postResponse.data)}`);
                throw new Error(`Vbee TTS POST failed: ${JSON.stringify(postResponse.data)}`);
            }

            const requestId = postResponse.data.result.request_id;
            this.logger.log(`Vbee request_id: ${requestId}`);

            // Step 2: Poll for completion (max 30 seconds, 15 attempts x 2 seconds)
            for (let attempt = 0; attempt < 15; attempt++) {
                this.logger.debug(`Polling Vbee status (attempt ${attempt + 1}/15)...`);

                const getResponse = await axios.get(`${VBEE_TTS_ENDPOINT}/${requestId}`, {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                    },
                });

                if (getResponse.data?.status !== 1 || !getResponse.data?.result) {
                    this.logger.error(`Vbee GET poll failed: ${JSON.stringify(getResponse.data)}`);
                    throw new Error(`Vbee polling failed: ${JSON.stringify(getResponse.data)}`);
                }

                const resultStatus = getResponse.data.result.status;
                this.logger.debug(`Vbee status: ${resultStatus}`);

                if (resultStatus === 'SUCCESS') {
                    const audioLink = getResponse.data.result.audio_link;
                    if (!audioLink) {
                        throw new Error('Vbee SUCCESS but no audio_link');
                    }

                    this.logger.log(`Vbee SUCCESS. Downloading from ${audioLink}`);

                    // Step 3: Download audio file
                    const audioResponse = await axios.get(audioLink, {
                        responseType: 'arraybuffer',
                    });

                    return {
                        audio: Buffer.from(audioResponse.data),
                        format: 'wav',  // Changed from mp3 to wav
                        provider: this.name,
                    };
                } else if (resultStatus === 'FAILURE') {
                    throw new Error(`Vbee audio generation failed: ${JSON.stringify(getResponse.data)}`);
                }

                // Wait 2 seconds before next poll
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            throw new Error('Vbee TTS request timed out after 30 seconds');
        } catch (error) {
            this.logger.error(`Vbee TTS error: ${error.message}`);
            if (error.response?.data) {
                this.logger.error(`Response: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    async getVoices(): Promise<Voice[]> {
        // Get personal voices from API if credentials available
        const personalVoices = await this.fetchPersonalVoices();

        // Default/known voices
        const defaultVoices: Voice[] = [
            {
                id: 'n_thainguyen_male_giangbaitrieuhoa_education_vc',
                name: 'Giọng - Triệu Hòa',
                gender: 'male',
                languageCode: 'vi-VN',
                description: 'Giọng cá nhân Triệu Hòa - Giảng bài giáo dục',
            },
            {
                id: 'hn_female_ngochuyen_news_48k-fhg',
                name: 'Ngọc Huyền (Nữ)',
                gender: 'female',
                languageCode: 'vi-VN',
                description: 'Giọng nữ Hà Nội, phù hợp đọc tin tức',
            },
            {
                id: 'hn_male_manhdung_news_48k-fhg',
                name: 'Mạnh Dũng (Nam)',
                gender: 'male',
                languageCode: 'vi-VN',
                description: 'Giọng nam Hà Nội, phù hợp đọc tin tức',
            },
            {
                id: 'sg_female_thaongan_call_48k-fhg',
                name: 'Thảo Ngân (Nữ)',
                gender: 'female',
                languageCode: 'vi-VN',
                description: 'Giọng nữ Sài Gòn, phù hợp hội thoại',
            },
            {
                id: 'sg_male_minhhoang_call_48k-fhg',
                name: 'Minh Hoàng (Nam)',
                gender: 'male',
                languageCode: 'vi-VN',
                description: 'Giọng nam Sài Gòn, phù hợp hội thoại',
            },
        ];

        // Merge personal voices with defaults
        return [...personalVoices, ...defaultVoices];
    }

    private async fetchPersonalVoices(): Promise<Voice[]> {
        if (!this.token) {
            return [];
        }

        try {
            const response = await axios.get(VBEE_VOICES_ENDPOINT, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                },
            });

            if (response.data?.status !== 1 || !response.data?.result) {
                this.logger.warn(`Could not fetch Vbee voices: ${JSON.stringify(response.data)}`);
                return [];
            }

            const allVoices = response.data.result;
            const personalVoices: Voice[] = [];

            for (const [voiceCode, voiceDetails] of Object.entries(allVoices)) {
                const details = voiceDetails as Record<string, unknown>;
                if (details.voice_ownership === 'PERSONAL') {
                    personalVoices.push({
                        id: voiceCode,
                        name: (details.name as string) || voiceCode,
                        gender: (details.gender as string) === 'male' ? 'male' : 'female',
                        languageCode: 'vi-VN',
                        description: 'Giọng cá nhân',
                    });
                }
            }

            this.logger.log(`Found ${personalVoices.length} personal voices`);
            return personalVoices;
        } catch (error) {
            this.logger.warn(`Error fetching Vbee personal voices: ${error.message}`);
            return [];
        }
    }

    async testConnection(): Promise<boolean> {
        if (!this.appId || !this.token) {
            return false;
        }

        try {
            const response = await axios.get(VBEE_VOICES_ENDPOINT, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                },
                timeout: 10000,
            });

            return response.data?.status === 1;
        } catch {
            return false;
        }
    }
}
