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
        // Get personal and Vietnamese voices from API if credentials available
        const apiVoices = await this.fetchPersonalVoices();

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
                id: 'hn_female_ngochuyen_full_24k-st',
                name: 'Ngọc Huyền 2.0 (Nữ HN)',
                gender: 'female',
                languageCode: 'vi-VN',
                description: 'Giọng nữ Hà Nội truyền cảm',
            },
            {
                id: 'hn_male_manhdung_full_24k-st',
                name: 'Mạnh Dũng 2.0 (Nam HN)',
                gender: 'male',
                languageCode: 'vi-VN',
                description: 'Giọng nam Hà Nội mạnh mẽ',
            },
            {
                id: 'hn_male_minhquan_yt_24k-pre',
                name: 'Minh Quân Pro (Nam HN)',
                gender: 'male',
                languageCode: 'vi-VN',
                description: 'Giọng nam tự nhiên trẻ trung',
            },
            {
                id: 'sg_female_tuongvy_call_44k-fhg',
                name: 'Tường Vy (Nữ SG)',
                gender: 'female',
                languageCode: 'vi-VN',
                description: 'Giọng nữ Sài Gòn nhẹ nhàng',
            },
            {
                id: 'sg_female_thaotrinh_full_44k-phg',
                name: 'Thảo Trinh (Nữ SG)',
                gender: 'female',
                languageCode: 'vi-VN',
                description: 'Giọng nữ Sài Gòn truyền cảm',
            },
            {
                id: 'hue_female_huonggiang_full_48k-fhg',
                name: 'Hương Giang (Nữ Huế)',
                gender: 'female',
                languageCode: 'vi-VN',
                description: 'Giọng nữ Huế ngọt ngào',
            },
        ];

        // Merge API voices with defaults (deduplicate by id)
        const combined = [...apiVoices];
        for (const def of defaultVoices) {
            if (!combined.some(v => v.id === def.id)) {
                combined.push(def);
            }
        }
        return combined;
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

            const rawVoices: any[] = response.data.result.voices || (Array.isArray(response.data.result) ? response.data.result : []);
            const voices: Voice[] = [];

            for (const item of rawVoices) {
                const voiceCode = item.code || item.voice_code || item.id;
                if (!voiceCode) continue;

                const isVi = item.language_code === 'vi-VN' || item.language?.code === 'vi-VN' || item.language === 'vi-VN';
                const isPersonal = item.voice_ownership === 'PERSONAL' || 
                                   item.features?.includes('personal-voice') || 
                                   item.features?.includes('cloned-voice') ||
                                   voiceCode.includes('trieuhoa');

                if (!isVi && !isPersonal) continue;

                voices.push({
                    id: voiceCode,
                    name: item.name || voiceCode,
                    gender: item.gender === 'male' ? 'male' : 'female',
                    languageCode: 'vi-VN',
                    description: item.description || (isPersonal ? 'Giọng cá nhân' : `Giọng ${item.gender === 'female' ? 'nữ' : 'nam'} Vbee (${item.locale || 'VN'})`),
                });
            }

            this.logger.log(`Found ${voices.length} Vbee voices from API`);
            return voices;
        } catch (error) {
            this.logger.warn(`Error fetching Vbee voices: ${error.message}`);
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
