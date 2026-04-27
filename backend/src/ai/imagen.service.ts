import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI, Part, Content, GenerateContentConfig } from '@google/genai';
import { CLIProxyProvider } from './cliproxy.provider';
import { SystemConfigService } from '../settings/system-config.service';

export interface GeneratedImage {
    base64: string;
    mimeType: string;
    filename: string;
}

/**
 * Image Generation Service
 * Uses @google/genai SDK (same as Python google-genai) for image generation
 * Supports both Gemini 2.5 Flash Image and Imagen 3.0 models
 */
@Injectable()
export class ImagenService {
    private readonly logger = new Logger(ImagenService.name);
    private client: GoogleGenAI | null = null;
    private lastApiKey: string = '';

    constructor(
        private readonly cliproxy?: CLIProxyProvider,
        private readonly systemConfigService?: SystemConfigService,
    ) {
        // Check at startup but will re-check on each call
        const apiKey = this.getApiKey();
        if (!apiKey) {
            this.logger.warn('GEMINI_API_KEY not set at startup - image generation will use placeholders until configured');
        } else {
            this.initializeClient(apiKey);
        }
    }

    /**
     * Get API key from environment (supports runtime configuration)
     */
    private getApiKey(): string {
        return process.env.GEMINI_API_KEY || process.env.IMAGEN_API_KEY || '';
    }

    /**
     * Initialize or re-initialize GenAI client if API key changed
     */
    private ensureClient(apiKey?: string): boolean {
        const currentKey = apiKey || this.getApiKey();

        if (!currentKey) {
            return false;
        }

        // Re-initialize if key changed
        if (currentKey !== this.lastApiKey) {
            this.initializeClient(currentKey);
        }

        return !!this.client;
    }

    /**
     * Initialize GenAI client
     */
    private initializeClient(apiKey: string): void {
        this.client = new GoogleGenAI({ apiKey });
        this.lastApiKey = apiKey;
        this.logger.log('ImagenService initialized with @google/genai SDK');
    }

    /**
     * Generate an image from a text prompt using Gemini 2.5 Flash Image
     * Uses streaming like the Python implementation for better compatibility
     * @param prompt - Image prompt
     * @param aspectRatio - Aspect ratio (default 16:9)
     * @param modelName - Model to use (optional, defaults to gemini-2.5-flash-image)
     * @param apiKey - API key (optional, uses environment variable if not provided)
     */
    // Last-resort fallback — only used if DB has no discovered model
    private static readonly FALLBACK_IMAGE_MODEL = 'gemini-2.0-flash-image-generation';

    /**
     * Get the best Gemini image model dynamically from DB.
     * Priority: DB discovered model > static fallback
     */
    private async getGeminiImageModel(): Promise<string> {
        if (this.systemConfigService) {
            const discovered = await this.systemConfigService.getDiscoveredGeminiModel('image');
            if (discovered) {
                return discovered;
            }
        }
        return ImagenService.FALLBACK_IMAGE_MODEL;
    }

    async generateImage(
        prompt: string,
        aspectRatio: string = '16:9',
        modelName?: string,
        apiKey?: string
    ): Promise<GeneratedImage> {
        const geminiImageModel = await this.getGeminiImageModel();
        const effectiveModel = modelName || geminiImageModel;
        const effectiveApiKey = apiKey || this.getApiKey();

        // Validate API key is real (not a placeholder)
        const hasValidApiKey = effectiveApiKey &&
            effectiveApiKey.length > 20 &&
            !effectiveApiKey.includes('your-') &&
            !effectiveApiKey.includes('-here');

        this.logger.log(`generateImage: model=${effectiveModel}, hasValidApiKey=${!!hasValidApiKey}`);

        // Priority 1: If model has cliproxy: prefix or no valid API key, try CLIProxy
        const isCliproxyModel = effectiveModel.startsWith('cliproxy:');
        const isImageGenModel = effectiveModel.toLowerCase().includes('flux') || effectiveModel.startsWith('imagegen:');

        // Priority 0: If model is IMAGE_GEN provider (Flux/ComfyUI), route immediately
        if (isImageGenModel) {
            this.logger.log(`Routing to OpenAI Images API for model=${effectiveModel}`);
            try {
                const result = await this.generateImageWithOpenAIImages(prompt, aspectRatio, effectiveModel);
                if (result.mimeType !== 'image/svg+xml') {
                    return result;
                }
                this.logger.warn('ImageGen returned placeholder, trying fallback...');
            } catch (error) {
                this.logger.warn(`ImageGen failed: ${error}, trying fallback providers...`);
            }
        }

        if (isCliproxyModel || (!hasValidApiKey && this.cliproxy)) {
            this.logger.log(`Trying CLIProxy for image generation (model=${effectiveModel})`);
            try {
                const result = await this.generateImageViaCLIProxy(prompt, effectiveModel);
                if (result.mimeType !== 'image/svg+xml') {
                    return result;
                }
                this.logger.warn('CLIProxy returned placeholder, will try Gemini SDK fallback');
            } catch (error) {
                this.logger.warn(`CLIProxy image generation failed: ${error}, trying Gemini SDK fallback`);
            }
        }

        // Priority 2: Use Gemini SDK with valid API key
        // IMPORTANT: Always use the correct Gemini image model, not CLIProxy model name
        if (!hasValidApiKey) {
            this.logger.warn('Image generation disabled - no valid API key and CLIProxy failed - returning placeholder');
            return this.generatePlaceholder(prompt);
        }

        if (!this.ensureClient(effectiveApiKey)) {
            return this.generatePlaceholder(prompt);
        }

        try {
            // For Gemini SDK fallback, always use the correct image generation model
            // CLIProxy model names (e.g. gemini-3.1-flash-image) and ImageGen model names (e.g. flux-image)
            // don't work with Gemini SDK - must use a real Gemini model
            const sdkModel = (isCliproxyModel || isImageGenModel) ? geminiImageModel : (
                effectiveModel.includes(':')
                    ? geminiImageModel  // Any prefixed model → use default
                    : effectiveModel
            );

            this.logger.log(`Using Gemini SDK model: ${sdkModel}`);

            const imagePrompt = this.buildImageGenerationPrompt(prompt, aspectRatio);

            const config: GenerateContentConfig = {
                responseModalities: ['IMAGE', 'TEXT'],
            };

            const contents: Content[] = [{
                role: 'user',
                parts: [{ text: imagePrompt }],
            }];

            const stream = await this.client!.models.generateContentStream({
                model: sdkModel,
                contents: contents,
                config: config,
            });

            for await (const chunk of stream) {
                if (chunk.candidates?.[0]?.content?.parts) {
                    for (const part of chunk.candidates[0].content.parts) {
                        if (part.inlineData) {
                            this.logger.log('✅ Image generated successfully via Gemini SDK');
                            return {
                                base64: part.inlineData.data!,
                                mimeType: part.inlineData.mimeType || 'image/png',
                                filename: `generated_${Date.now()}.png`,
                            };
                        }
                    }
                }
            }

            this.logger.warn('❌ No image data in Gemini SDK response, falling back to placeholder');
            return this.generatePlaceholder(prompt);

        } catch (error) {
            this.logger.error(`❌ Gemini SDK image generation failed: ${error}`);
            return this.generatePlaceholder(prompt);
        }
    }

    /**
     * Generate image using Imagen 3.0 model (dedicated image model)
     * Uses generate_images API like Python
     */
    async generateImageWithImagen(
        prompt: string,
        aspectRatio: string = '16:9',
        apiKey?: string
    ): Promise<GeneratedImage> {
        const effectiveApiKey = apiKey || this.getApiKey();

        if (!effectiveApiKey) {
            return this.generatePlaceholder(prompt);
        }

        if (!this.ensureClient(effectiveApiKey)) {
            return this.generatePlaceholder(prompt);
        }

        try {
            const modelName = 'imagen-3.0-generate-002';
            this.logger.log(`[DEBUG] Using Imagen model: ${modelName}`);

            // Config matching Python generate_image_with_gemini function
            const response = await this.client!.models.generateImages({
                model: modelName,
                prompt: this.buildImageGenerationPrompt(prompt, aspectRatio),
                config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/jpeg',
                    aspectRatio: aspectRatio as any,
                },
            });

            if (response.generatedImages && response.generatedImages.length > 0) {
                const image = response.generatedImages[0];
                this.logger.log('✅ Imagen 3.0 generated successfully');
                return {
                    base64: image.image?.imageBytes || '',
                    mimeType: 'image/jpeg',
                    filename: `imagen_${Date.now()}.jpg`,
                };
            }

            this.logger.warn('❌ Imagen API returned no images');
            return this.generatePlaceholder(prompt);

        } catch (error) {
            this.logger.error(`❌ Imagen generation failed: ${error}`);
            return this.generatePlaceholder(prompt);
        }
    }

    /**
     * Build optimized prompt for image generation
     */
    private buildImageGenerationPrompt(visualIdea: string, aspectRatio: string): string {
        return `Generate a high-quality educational illustration for a presentation slide.

Requirements:
- Style: Clean, professional, suitable for academic presentation
- Aspect ratio: ${aspectRatio} (landscape, suitable for PowerPoint slides)
- No text or letters in the image
- High quality, vibrant colors

Scene description: ${visualIdea}

Generate the image now.`;
    }

    /**
     * Generate a placeholder image (for development/fallback)
     */
    private generatePlaceholder(prompt: string): GeneratedImage {
        const width = 1920;
        const height = 1080;
        const encodedPrompt = this.escapeXML(prompt.substring(0, 100));

        // Generate a color based on prompt hash for variety
        const hashCode = this.hashString(prompt);
        const hue = Math.abs(hashCode) % 360;
        const bgColor = `hsl(${hue}, 30%, 20%)`;
        const accentColor = `hsl(${hue}, 50%, 40%)`;

        const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${bgColor}"/>
            <stop offset="100%" style="stop-color:#1a1a2e"/>
        </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <rect x="40" y="40" width="${width - 80}" height="${height - 80}" 
          fill="none" stroke="${accentColor}" stroke-width="2" rx="20"/>
    <circle cx="${width / 2}" cy="${height / 2 - 50}" r="80" fill="${accentColor}" opacity="0.3"/>
    <text x="50%" y="45%" fill="#ffffff" font-family="Arial, sans-serif" 
          font-size="48" text-anchor="middle" font-weight="bold">
        🎨 AI Image
    </text>
    <text x="50%" y="55%" fill="#9ca3af" font-family="Arial, sans-serif" 
          font-size="20" text-anchor="middle">
        ${encodedPrompt}...
    </text>
    <text x="50%" y="65%" fill="#6b7280" font-family="Arial, sans-serif" 
          font-size="16" text-anchor="middle">
        (Placeholder - Set GEMINI_API_KEY for real images)
    </text>
</svg>`;

        const base64 = Buffer.from(svg).toString('base64');

        return {
            base64,
            mimeType: 'image/svg+xml',
            filename: `placeholder_${Date.now()}.svg`,
        };
    }

    /**
     * Simple hash function for generating consistent colors
     */
    private hashString(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash;
    }

    /**
     * Escape XML special characters
     */
    private escapeXML(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /**
     * Check if image generation is available
     */
    isEnabled(): boolean {
        return !!this.getApiKey();
    }

    // ========================
    // OpenAI Images API (Flux/ComfyUI)
    // ========================

    /**
     * Convert aspect ratio to pixel size for OpenAI Images API
     */
    private aspectRatioToSize(aspectRatio: string): string {
        const sizeMap: Record<string, string> = {
            '1:1': '1024x1024',
            '16:9': '1024x768',
            '9:16': '768x1024',
            '4:3': '1024x768',
            '3:4': '768x1024',
        };
        return sizeMap[aspectRatio] || '1024x768';
    }

    /**
     * Generate image using OpenAI Images API compatible endpoint (Flux/ComfyUI)
     * POST {model, prompt, size, steps} → response.data[0].url → download → base64
     */
    async generateImageWithOpenAIImages(
        prompt: string,
        aspectRatio: string = '1:1',
        modelName?: string,
    ): Promise<GeneratedImage> {
        if (!this.systemConfigService) {
            this.logger.warn('SystemConfigService not available for ImageGen');
            return this.generatePlaceholder(prompt);
        }

        const config = await this.systemConfigService.getImageGenConfig();

        if (!config.enabled || !config.url || !config.apiKey) {
            this.logger.warn('ImageGen provider not configured or disabled');
            return this.generatePlaceholder(prompt);
        }

        // Strip imagegen: prefix if present
        let model = modelName || config.defaultModel;
        if (model.startsWith('imagegen:')) {
            model = model.substring('imagegen:'.length);
        }

        const size = this.aspectRatioToSize(aspectRatio);

        this.logger.log(`ImageGen API: model=${model}, size=${size}, steps=${config.steps}`);

        try {
            const response = await fetch(config.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    prompt,
                    size,
                    steps: config.steps,
                }),
                signal: AbortSignal.timeout(180000), // 180s timeout (Flux can be slow)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`ImageGen API HTTP ${response.status}: ${errorText.substring(0, 300)}`);
            }

            const data = await response.json();

            // Format 1: { data: [{ url: "http://..." }] }
            if (data?.data?.[0]?.url) {
                let imageUrl = data.data[0].url;
                this.logger.log(`ImageGen returned URL: ${imageUrl.substring(0, 80)}...`);

                // FIX: ImageGen API often returns URLs with localhost even when hosted remotely.
                // Rewrite the URL origin to match the configured API URL so downloads succeed.
                try {
                    const imageUrlParsed = new URL(imageUrl);
                    const configUrlParsed = new URL(config.url);
                    if (imageUrlParsed.hostname === 'localhost' || imageUrlParsed.hostname === '127.0.0.1') {
                        // Replace origin but keep the path
                        imageUrlParsed.protocol = configUrlParsed.protocol;
                        imageUrlParsed.hostname = configUrlParsed.hostname;
                        imageUrlParsed.port = configUrlParsed.port;
                        const rewrittenUrl = imageUrlParsed.toString();
                        this.logger.log(`Rewrote ImageGen URL: ${imageUrl.substring(0, 60)} → ${rewrittenUrl.substring(0, 60)}`);
                        imageUrl = rewrittenUrl;
                    }
                } catch (urlError) {
                    this.logger.warn(`Failed to parse ImageGen URL for rewriting: ${urlError}`);
                }

                // Download the image and convert to base64
                const imageResponse = await fetch(imageUrl, {
                    signal: AbortSignal.timeout(30000),
                });

                if (!imageResponse.ok) {
                    throw new Error(`Failed to download image from ${imageUrl}: HTTP ${imageResponse.status}`);
                }

                const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
                const contentType = imageResponse.headers.get('content-type') || 'image/png';
                const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';

                this.logger.log(`✅ ImageGen: Downloaded ${imageBuffer.length} bytes (${contentType})`);
                return {
                    base64: imageBuffer.toString('base64'),
                    mimeType: contentType,
                    filename: `imagegen_${Date.now()}.${ext}`,
                };
            }

            // Format 2: { data: [{ b64_json: "..." }] }
            if (data?.data?.[0]?.b64_json) {
                this.logger.log('✅ ImageGen: Received base64 directly');
                return {
                    base64: data.data[0].b64_json,
                    mimeType: 'image/png',
                    filename: `imagegen_${Date.now()}.png`,
                };
            }

            this.logger.warn('ImageGen: No image data in response');
            return this.generatePlaceholder(prompt);

        } catch (error) {
            this.logger.error(`❌ ImageGen API failed: ${error}`);
            throw error; // Let caller handle fallback
        }
    }

    /**
     * Generate image using CLIProxy (alternative to native SDK)
     * Uses CLIProxy image model with automatic fallback chain.
     * If the primary model fails (502, error), tries alternative models.
     */
    async generateImageViaCLIProxy(prompt: string, modelName?: string): Promise<GeneratedImage> {
        if (!this.cliproxy) {
            this.logger.warn('CLIProxy not available, falling back to placeholder');
            return this.generatePlaceholder(prompt);
        }

        try {
            const isEnabled = await this.cliproxy.isEnabled();
            if (!isEnabled) {
                this.logger.log('CLIProxy disabled, falling back to placeholder');
                return this.generatePlaceholder(prompt);
            }

            const imagePrompt = this.buildImageGenerationPrompt(prompt, '1:1');

            // Strip cliproxy: prefix if present
            let model = modelName;
            if (model && model.startsWith('cliproxy:')) {
                model = model.substring('cliproxy:'.length);
            }

            // Try primary model first
            const result = await this.tryGenerateWithModel(imagePrompt, model);
            if (result) return result;

            // Primary failed → try fallback models
            this.logger.warn(`Primary model "${model}" failed, trying fallback models...`);
            const fallbacks = await this.cliproxy.getModelFallbacks('image', model);
            for (const fallbackModel of fallbacks) {
                this.logger.log(`Trying fallback model: ${fallbackModel}`);
                const fallbackResult = await this.tryGenerateWithModel(imagePrompt, fallbackModel);
                if (fallbackResult) {
                    this.logger.log(`✅ Fallback model "${fallbackModel}" succeeded`);
                    return fallbackResult;
                }
            }

            this.logger.warn('All CLIProxy image models failed, falling back to placeholder');
            return this.generatePlaceholder(prompt);

        } catch (error) {
            this.logger.error(`CLIProxy image generation failed: ${error}`);
            return this.generatePlaceholder(prompt);
        }
    }

    /**
     * Try to generate an image with a specific CLIProxy model.
     * Returns GeneratedImage on success, null on failure.
     */
    private async tryGenerateWithModel(imagePrompt: string, model?: string): Promise<GeneratedImage | null> {
        try {
            const response = await this.cliproxy!.generateImage(imagePrompt, model);

            // Handle data URI format: "data:image/png;base64,iVBORw0KGgo..."
            if (response.startsWith('data:') && response.includes('base64,')) {
                const commaIndex = response.indexOf(',');
                const header = response.substring(0, commaIndex);
                const base64Data = response.substring(commaIndex + 1);
                const mimeMatch = header.match(/data:([^;]+)/);
                const mimeType = mimeMatch?.[1] || 'image/png';
                const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';

                this.logger.log(`✅ CLIProxy image: ${mimeType}, base64 length: ${base64Data.length}`);
                return {
                    base64: base64Data,
                    mimeType,
                    filename: `cliproxy_${Date.now()}.${ext}`,
                };
            }

            // Legacy: base64 data URI embedded somewhere in the response
            if (response.includes('base64,')) {
                const startIdx = response.indexOf('base64,') + 7;
                const base64Data = response.substring(startIdx).replace(/[^A-Za-z0-9+/=]/g, '');
                if (base64Data.length > 1000) {
                    this.logger.log(`✅ CLIProxy extracted base64 from response (${base64Data.length} chars)`);
                    return {
                        base64: base64Data,
                        mimeType: 'image/png',
                        filename: `cliproxy_${Date.now()}.png`,
                    };
                }
            }

            // Check if response itself is raw base64 image data
            if (response.length > 1000 && /^[A-Za-z0-9+/=\s]+$/.test(response.trim())) {
                this.logger.log('✅ CLIProxy returned raw base64 image data');
                return {
                    base64: response.trim(),
                    mimeType: 'image/png',
                    filename: `cliproxy_${Date.now()}.png`,
                };
            }

            // Not an image response
            this.logger.warn(`Model "${model}" returned non-image data (${response.length} chars)`);
            return null;

        } catch (error) {
            this.logger.warn(`Model "${model}" failed: ${error}`);
            return null;
        }
    }
}
