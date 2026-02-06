import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { renderSlidePrompt } from './prompts/slide.prompt';
import { renderHandoutPrompt } from './prompts/handout.prompt';
import { renderQuizPrompt } from './prompts/quiz.prompt';
import { renderImagePromptTemplate } from './prompts/image.prompt';

export interface SlideContent {
    title: string;
    totalSlides: number;
    slides: Array<{
        slideNumber: number;
        type: 'title' | 'content' | 'two-column' | 'image' | 'summary';
        title: string;
        content: string[];
        speakerNotes: string;
        imagePrompt?: string;
    }>;
}

export interface HandoutContent {
    title: string;
    subject: string;
    sections: Array<{
        heading: string;
        content: string;
        keyPoints: string[];
        examples: string[];
    }>;
    summary: string;
    reviewQuestions: string[];
}

export interface QuizContent {
    title: string;
    totalQuestions: number;
    questions: Array<{
        id: number;
        type: 'multiple_choice' | 'true_false';
        question: string;
        options: string[];
        correctAnswer: string;
        explanation: string;
        difficulty: 'easy' | 'medium' | 'hard';
    }>;
}

export interface ImagePromptResult {
    prompt: string;
    style: string;
    aspectRatio: string;
}

@Injectable()
export class GeminiService {
    private readonly logger = new Logger(GeminiService.name);
    private genAI: GoogleGenerativeAI;
    private model: GenerativeModel;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            this.logger.warn('GEMINI_API_KEY not set - AI features will not work');
        }
        this.genAI = new GoogleGenerativeAI(apiKey || '');
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    }

    /**
     * Generate slide content from lesson outline
     */
    async generateSlideContent(outline: string): Promise<SlideContent> {
        this.logger.log('Generating slide content...');

        const prompt = renderSlidePrompt(outline);
        const result = await this.generateWithRetry(prompt);

        return this.parseJSON<SlideContent>(result);
    }

    /**
     * Generate handout content from lesson outline
     */
    async generateHandoutContent(outline: string): Promise<HandoutContent> {
        this.logger.log('Generating handout content...');

        const prompt = renderHandoutPrompt(outline);
        const result = await this.generateWithRetry(prompt);

        return this.parseJSON<HandoutContent>(result);
    }

    /**
     * Generate quiz questions from lesson outline
     */
    async generateQuizQuestions(outline: string, questionCount: number = 10): Promise<QuizContent> {
        this.logger.log(`Generating ${questionCount} quiz questions...`);

        const prompt = renderQuizPrompt(outline, questionCount);
        const result = await this.generateWithRetry(prompt);

        return this.parseJSON<QuizContent>(result);
    }

    /**
     * Generate image prompt for a slide
     */
    async generateImagePrompt(title: string, content: string): Promise<ImagePromptResult> {
        this.logger.log('Generating image prompt...');

        const prompt = renderImagePromptTemplate(title, content);
        const result = await this.generateWithRetry(prompt);

        return this.parseJSON<ImagePromptResult>(result);
    }

    /**
     * Raw text generation for custom prompts
     */
    async generateText(prompt: string): Promise<string> {
        return this.generateWithRetry(prompt);
    }

    /**
     * Text generation with custom model and API key
     * Used for dynamic model selection from user settings
     */
    async generateTextWithModel(prompt: string, modelName: string, apiKey: string): Promise<string> {
        // Strip provider prefix (cliproxy:, gemini:, etc.) - these are internal routing prefixes
        let effectiveModel = modelName;
        if (effectiveModel.includes(':')) {
            const originalModel = effectiveModel;
            effectiveModel = effectiveModel.split(':').pop() || effectiveModel;
            this.logger.log(`[DEBUG] Stripped prefix: ${originalModel} → ${effectiveModel}`);
        }

        const client = new GoogleGenerativeAI(apiKey);
        const model = client.getGenerativeModel({ model: effectiveModel });

        const result = await model.generateContent(prompt);
        const response = result.response;
        return response.text();
    }

    /**
     * Generate with retry logic
     */
    private async generateWithRetry(prompt: string, maxRetries: number = 3): Promise<string> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await this.model.generateContent(prompt);
                const response = result.response;
                const text = response.text();

                return text;
            } catch (error) {
                lastError = error as Error;
                this.logger.warn(`Generation attempt ${attempt} failed: ${error}`);

                if (attempt < maxRetries) {
                    // Exponential backoff: 1s, 2s, 4s
                    await this.sleep(Math.pow(2, attempt - 1) * 1000);
                }
            }
        }

        throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message}`);
    }

    /**
     * Parse JSON from AI response, handling markdown code blocks
     */
    private parseJSON<T>(text: string): T {
        // Remove markdown code blocks if present
        let cleanText = text.trim();

        // Handle ```json ... ``` blocks
        const jsonBlockMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonBlockMatch) {
            cleanText = jsonBlockMatch[1];
        }

        // Remove any leading/trailing whitespace
        cleanText = cleanText.trim();

        try {
            return JSON.parse(cleanText) as T;
        } catch (error) {
            this.logger.error(`Failed to parse JSON: ${error}`);
            this.logger.debug(`Raw text: ${text.substring(0, 500)}`);
            throw new Error('Failed to parse AI response as JSON');
        }
    }

    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
