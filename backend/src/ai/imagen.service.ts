import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI, Part, Content, GenerateContentConfig } from '@google/genai';
import { CLIProxyProvider } from './cliproxy.provider';

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
    async generateImage(
        prompt: string,
        aspectRatio: string = '16:9',
        modelName?: string,
        apiKey?: string
    ): Promise<GeneratedImage> {
        this.logger.log(`[DEBUG] generateImage called: model=${modelName || 'default'}, apiKey=${apiKey ? `present (${apiKey.length} chars)` : 'MISSING'}`);

        // Use provided API key or environment
        const effectiveApiKey = apiKey || this.getApiKey();
        this.logger.log(`[DEBUG] effectiveApiKey: ${effectiveApiKey ? `present (${effectiveApiKey.length} chars)` : 'MISSING - will use placeholder'}`);

        if (!effectiveApiKey) {
            this.logger.warn('Image generation disabled - returning placeholder');
            return this.generatePlaceholder(prompt);
        }

        // Ensure client is initialized with correct API key
        if (!this.ensureClient(effectiveApiKey)) {
            return this.generatePlaceholder(prompt);
        }

        try {
            // Use provided model or default to image generation model
            let effectiveModel = modelName || 'gemini-2.0-flash-exp-image-generation';

            // Strip provider prefix (cliproxy:, gemini:, etc.) - these are internal routing prefixes
            if (effectiveModel.includes(':')) {
                const originalModel = effectiveModel;
                effectiveModel = effectiveModel.split(':').pop() || effectiveModel;
                this.logger.log(`[DEBUG] Stripped prefix: ${originalModel} → ${effectiveModel}`);
            }

            this.logger.log(`[DEBUG] Using model: ${effectiveModel}`);

            // Build the prompt with aspect ratio guidance
            const imagePrompt = this.buildImageGenerationPrompt(prompt, aspectRatio);

            // Configure for image generation - matching Python exactly
            // Python: types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"])
            const config: GenerateContentConfig = {
                responseModalities: ['IMAGE', 'TEXT'],
            };

            // Contents payload matching Python structure
            const contents: Content[] = [{
                role: 'user',
                parts: [{ text: imagePrompt }],
            }];

            this.logger.log(`[DEBUG] Calling generate_content_stream with config: ${JSON.stringify(config)}`);

            // Use streaming like Python does (generate_content_stream)
            const stream = await this.client!.models.generateContentStream({
                model: effectiveModel,
                contents: contents,
                config: config,
            });

            // Process stream chunks - matching Python logic
            for await (const chunk of stream) {
                // Check for image data in response
                if (chunk.candidates?.[0]?.content?.parts) {
                    for (const part of chunk.candidates[0].content.parts) {
                        if (part.inlineData) {
                            this.logger.log('✅ Image generated successfully via streaming');
                            return {
                                base64: part.inlineData.data!,
                                mimeType: part.inlineData.mimeType || 'image/png',
                                filename: `generated_${Date.now()}.png`,
                            };
                        }
                    }
                }
            }

            // No image in stream, fallback to placeholder
            this.logger.warn('❌ No image data found in response stream, falling back to placeholder');
            return this.generatePlaceholder(prompt);

        } catch (error) {
            this.logger.error(`❌ Image generation failed: ${error}`);
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

    /**
     * Generate image using CLIProxy (alternative to native SDK)
     * Uses gemini-3-pro-image-preview model via CLIProxy
     */
    async generateImageViaCLIProxy(prompt: string): Promise<GeneratedImage> {
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

            const imagePrompt = this.buildImageGenerationPrompt(prompt, '16:9');

            // CLIProxy returns text response for image model
            // The actual image bytes need to be handled differently
            const response = await this.cliproxy.generateImage(imagePrompt);

            this.logger.log('✅ Image generated via CLIProxy');

            // If response contains base64 data, extract it
            if (response.includes('base64,')) {
                const base64Match = response.match(/base64,([A-Za-z0-9+/=]+)/);
                if (base64Match) {
                    return {
                        base64: base64Match[1],
                        mimeType: 'image/png',
                        filename: `cliproxy_${Date.now()}.png`,
                    };
                }
            }

            // Fallback: treat response as description and generate placeholder
            return this.generatePlaceholder(prompt);

        } catch (error) {
            this.logger.error(`CLIProxy image generation failed: ${error}`);
            return this.generatePlaceholder(prompt);
        }
    }
}
