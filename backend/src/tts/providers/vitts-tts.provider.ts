import { Logger } from '@nestjs/common';
import axios from 'axios';
import {
    ITTSProvider,
    TTSCredentials,
    TTSOptions,
    TTSResult,
    Voice,
} from '../interfaces/tts-provider.interface';

const DEFAULT_VITTS_BASE_URL = 'http://117.0.36.6:8888';

// Poll config for async OmniVoice jobs
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 180000; // 3 minutes

/**
 * ViTTS TTS Provider (v2 - OmniVoice multi-mode)
 *
 * Supports 3 synthesis modes via OmniVoice:
 * 1. Auto Voice  — model picks the best voice
 * 2. Voice Clone — clone from saved reference (ref_id)
 * 3. Voice Design — describe voice attributes (gender, age, pitch, etc.)
 *
 * All OmniVoice endpoints are ASYNC:
 *   POST → {job_id, status} → poll GET /jobs/{job_id} → download audio_url
 */
export class ViTTSTTSProvider implements ITTSProvider {
    readonly name = 'ViTTS';
    readonly type = 'VITTS';
    private readonly logger = new Logger(ViTTSTTSProvider.name);
    private readonly apiKey: string;
    private readonly baseUrl: string;

    constructor(credentials: TTSCredentials) {
        this.apiKey = credentials.apiKey || '';
        this.baseUrl = credentials.baseUrl || DEFAULT_VITTS_BASE_URL;
    }

    private get headers() {
        return { 'X-API-Key': this.apiKey };
    }

    // ═══════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════

    async generateAudio(text: string, options?: TTSOptions): Promise<TTSResult> {
        this.logger.log(`ViTTS generateAudio: baseUrl=${this.baseUrl}, mode=${options?.vittsMode || 'auto'}`);
        this.logger.log(`Text preview: ${text.substring(0, 80)}...`);

        if (!this.apiKey) {
            throw new Error('ViTTS API key is required');
        }

        const mode = options?.vittsMode || 'auto';
        const speed = options?.vittsSpeed ?? options?.speed ?? 1.0;
        const numStep = options?.vittsNumStep ?? 32;
        const normalize = options?.vittsNormalize ?? true;

        try {
            let audioBytes: Buffer;

            switch (mode) {
                case 'clone': {
                    // Voice cloning from saved reference
                    let refId = options?.voiceId || '';
                    this.logger.log(`Mode=clone, raw voiceId=${refId}`);
                    if (refId.startsWith('vitts:')) refId = refId.substring(6);
                    if (refId.startsWith('ref:')) refId = refId.substring(4);
                    this.logger.log(`Mode=clone, extracted ref_id=${refId}`);
                    if (!refId) throw new Error('Voice Cloning requires a ref_id. Please select a reference voice.');
                    audioBytes = await this.omniCloneRef(text, refId, speed, numStep, normalize);
                    break;
                }
                case 'design': {
                    // Voice design via instruct text
                    const instruct = options?.vittsDesignInstruct || 'female, young adult';
                    this.logger.log(`Mode=design, instruct=${instruct}`);
                    audioBytes = await this.omniDesign(text, instruct, speed, numStep, normalize);
                    break;
                }
                case 'auto':
                default: {
                    this.logger.log(`Mode=auto`);
                    audioBytes = await this.omniAuto(text, speed, numStep, normalize);
                    break;
                }
            }

            return {
                audio: audioBytes,
                format: 'wav',
                provider: this.name,
            };
        } catch (error: any) {
            const errInfo: any = { message: error.message, code: error.code };
            if (error.response) {
                errInfo.status = error.response.status;
                try {
                    errInfo.body = Buffer.from(error.response.data).toString('utf-8').substring(0, 500);
                } catch { }
            }
            this.logger.error(`ViTTS error: ${JSON.stringify(errInfo)}`);
            throw error;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // OMNIVOICE ENDPOINTS (async — job polling)
    // ═══════════════════════════════════════════════════════════════

    private async omniAuto(text: string, speed: number, numStep: number, normalize: boolean): Promise<Buffer> {
        const resp = await axios.post(
            `${this.baseUrl}/api/v1/omnivoice/generate-auto`,
            { text, speed, num_step: numStep, normalize },
            { headers: this.headers, timeout: 30000 },
        );
        return this.pollJob(resp.data.job_id);
    }

    private async omniCloneRef(text: string, refId: string, speed: number, numStep: number, normalize: boolean): Promise<Buffer> {
        // This endpoint requires application/x-www-form-urlencoded
        const formData = new URLSearchParams();
        formData.append('text', text);
        formData.append('ref_id', refId);
        formData.append('speed', speed.toString());
        formData.append('num_step', numStep.toString());
        formData.append('normalize', normalize.toString());

        this.logger.log(`DEBUG omniCloneRef: refId="${refId}", body keys: ${[...formData.keys()].join(',')}`);

        const resp = await axios.post(
            `${this.baseUrl}/api/v1/omnivoice/generate-clone-ref`,
            formData,
            {
                headers: this.headers,
                timeout: 30000,
            },
        );
        return this.pollJob(resp.data.job_id);
    }

    private async omniDesign(text: string, instruct: string, speed: number, numStep: number, normalize: boolean): Promise<Buffer> {
        const resp = await axios.post(
            `${this.baseUrl}/api/v1/omnivoice/generate-design`,
            { text, instruct, speed, num_step: numStep, normalize },
            { headers: this.headers, timeout: 30000 },
        );
        return this.pollJob(resp.data.job_id);
    }

    // ═══════════════════════════════════════════════════════════════
    // JOB POLLING
    // ═══════════════════════════════════════════════════════════════

    private async pollJob(jobId: string): Promise<Buffer> {
        this.logger.log(`Polling job ${jobId}...`);
        const startTime = Date.now();

        while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
            await this.sleep(POLL_INTERVAL_MS);

            const resp = await axios.get(
                `${this.baseUrl}/api/v1/omnivoice/jobs/${jobId}`,
                { headers: this.headers, timeout: 10000 },
            );

            const job = resp.data;
            this.logger.debug(`Job ${jobId}: status=${job.status}`);

            if (job.status === 'completed' || job.status === 'done') {
                if (job.audio_url) {
                    this.logger.log(`Job ${jobId} completed (${job.duration_sec?.toFixed(1) || '?'}s audio, ${job.processing_time_sec?.toFixed(1) || '?'}s processing)`);
                    return this.downloadAudio(job.audio_url);
                }
                throw new Error(`Job ${jobId} completed but no audio_url`);
            }

            if (job.status === 'failed' || job.status === 'error') {
                throw new Error(`ViTTS job failed: ${job.error || 'Unknown error'}`);
            }

            // Still processing — continue polling
        }

        throw new Error(`ViTTS job ${jobId} timed out after ${MAX_POLL_DURATION_MS / 1000}s`);
    }

    // ═══════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════

    private async downloadAudio(audioUrl: string): Promise<Buffer> {
        const fullUrl = audioUrl.startsWith('http') ? audioUrl : `${this.baseUrl}${audioUrl}`;
        this.logger.log(`Downloading audio: ${fullUrl}`);

        const response = await axios.get(fullUrl, {
            headers: this.headers,
            responseType: 'arraybuffer',
            timeout: 60000,
        });

        return Buffer.from(response.data);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ═══════════════════════════════════════════════════════════════
    // VOICE DISCOVERY
    // ═══════════════════════════════════════════════════════════════

    async getVoices(): Promise<Voice[]> {
        const voices: Voice[] = [];

        // Fetch refs from voice library
        const refs = await this.fetchSavedReferences();
        voices.push(...refs);

        // Fetch trained voices
        const trainedVoices = await this.fetchTrainedVoices();
        voices.push(...trainedVoices);

        // System voices (fallback)
        voices.push(
            { id: 'male', name: 'ViTTS - Nam', gender: 'male', languageCode: 'vi-VN', description: 'Giọng nam hệ thống' },
            { id: 'female', name: 'ViTTS - Nữ', gender: 'female', languageCode: 'vi-VN', description: 'Giọng nữ hệ thống' },
        );

        return voices;
    }

    private async fetchSavedReferences(): Promise<Voice[]> {
        if (!this.apiKey) return [];
        try {
            const response = await axios.get(`${this.baseUrl}/api/v1/refs`, { headers: this.headers, timeout: 10000 });
            const refs = response.data || [];
            return refs.map((ref: any) => ({
                id: `ref:${ref.id}`,
                name: `📎 ${ref.name}`,
                gender: 'neutral' as const,
                languageCode: ref.language === 'en' ? 'en-US' : 'vi-VN',
                description: `Saved reference (${ref.duration_sec?.toFixed(1) || '?'}s)`,
            }));
        } catch (error: any) {
            this.logger.warn(`Error fetching ViTTS refs: ${error.message}`);
            return [];
        }
    }

    private async fetchTrainedVoices(): Promise<Voice[]> {
        if (!this.apiKey) return [];
        try {
            const response = await axios.get(`${this.baseUrl}/api/v1/tts/trained-voices`, { headers: this.headers, timeout: 10000 });
            const voices = response.data || [];
            return voices.map((v: any) => ({
                id: `trained_${v.id}`,
                name: `🎓 ${v.name}`,
                gender: 'neutral' as const,
                languageCode: v.language === 'en' ? 'en-US' : 'vi-VN',
                description: `Trained voice (${v.engine || 'f5tts'})`,
            }));
        } catch (error: any) {
            this.logger.warn(`Error fetching ViTTS trained voices: ${error.message}`);
            return [];
        }
    }

    async testConnection(): Promise<boolean> {
        if (!this.apiKey) return false;
        try {
            const response = await axios.get(`${this.baseUrl}/api/v1/tts/voices`, { headers: this.headers, timeout: 10000 });
            return response.status === 200;
        } catch {
            return false;
        }
    }
}
