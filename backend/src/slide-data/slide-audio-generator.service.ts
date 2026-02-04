import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TTSService } from '../tts/tts.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { SlideDataService } from './slide-data.service';
import { Slide } from '@prisma/client';

/**
 * Audio generator service integrated with new Slide model and FileStorageService.
 * Generates TTS audio from speaker notes and saves to user-centric storage.
 */
@Injectable()
export class SlideAudioGeneratorService {
    private readonly logger = new Logger(SlideAudioGeneratorService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly ttsService: TTSService,
        private readonly fileStorageService: FileStorageService,
        private readonly slideDataService: SlideDataService,
    ) { }

    /**
     * Generate audio for a single slide using TTS and save to user-centric storage
     */
    async generateAudioForSlide(
        userId: string,
        lessonId: string,
        slideIndex: number,
        voiceId?: string,
    ): Promise<Slide> {
        // Get the slide
        const slide = await this.slideDataService.getSlide(lessonId, slideIndex);
        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found in lesson ${lessonId}`);
        }

        if (!slide.speakerNote) {
            throw new BadRequestException(`Slide ${slideIndex} has no speaker note for audio generation`);
        }

        // Get lesson to find actual user and title
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: {
                subject: {
                    select: { userId: true },
                },
            },
        });

        if (!lesson) {
            throw new NotFoundException(`Lesson ${lessonId} not found`);
        }

        const actualUserId = lesson.subject.userId;

        // Update slide status to 'generating'
        await this.slideDataService.updateSlide(lessonId, slideIndex, {
            status: 'generating_audio',
        });

        try {
            // Generate audio using TTS service
            const audioResult = await this.ttsService.generateAudio(actualUserId, {
                text: slide.speakerNote,
                voiceId: voiceId,
            });

            // Save audio file using FileStorageService
            const { publicUrl } = await this.fileStorageService.saveAudioFile(
                actualUserId,
                lessonId,
                lesson.title,
                slideIndex,
                audioResult.audio,
            );

            // Update slide with audio URL and duration
            return this.slideDataService.updateSlide(lessonId, slideIndex, {
                audioUrl: publicUrl,
                audioDuration: audioResult.durationMs ? audioResult.durationMs / 1000 : null,
                status: 'audio_ready',
            });
        } catch (error) {
            this.logger.error(`Failed to generate audio for slide ${slideIndex} in lesson ${lessonId}:`, error);

            // Update slide status to error
            await this.slideDataService.updateSlide(lessonId, slideIndex, {
                status: 'audio_error',
            });

            throw new BadRequestException(`Failed to generate audio: ${error.message}`);
        }
    }

    /**
     * Generate audio for all slides in a lesson
     */
    async generateAllAudios(
        userId: string,
        lessonId: string,
        voiceId?: string,
    ): Promise<Slide[]> {
        const slides = await this.slideDataService.getSlides(lessonId);

        if (slides.length === 0) {
            throw new NotFoundException(`No slides found for lesson ${lessonId}`);
        }

        const results: Slide[] = [];

        for (const slide of slides) {
            if (slide.speakerNote) {
                try {
                    const updatedSlide = await this.generateAudioForSlide(userId, lessonId, slide.slideIndex, voiceId);
                    results.push(updatedSlide);
                } catch (error) {
                    this.logger.warn(`Skipping slide ${slide.slideIndex} audio generation due to error: ${error.message}`);
                    results.push(slide);
                }
            } else {
                this.logger.warn(`Skipping slide ${slide.slideIndex} - no speaker note`);
                results.push(slide);
            }
        }

        return results;
    }

    /**
     * Get slides with audio status summary
     */
    async getSlidesWithAudioStatus(lessonId: string): Promise<{
        slides: Slide[];
        summary: {
            total: number;
            withAudio: number;
            pending: number;
        };
    }> {
        const slides = await this.slideDataService.getSlides(lessonId);

        const withAudio = slides.filter(s => s.audioUrl).length;

        return {
            slides,
            summary: {
                total: slides.length,
                withAudio,
                pending: slides.length - withAudio,
            },
        };
    }

    /**
     * Delete audio for a specific slide
     */
    async deleteAudioForSlide(
        lessonId: string,
        slideIndex: number,
    ): Promise<Slide> {
        const slide = await this.slideDataService.getSlide(lessonId, slideIndex);
        if (!slide) {
            throw new NotFoundException(`Slide ${slideIndex} not found in lesson ${lessonId}`);
        }

        if (slide.audioUrl) {
            // Get lesson to find user and title
            const lesson = await this.prisma.lesson.findUnique({
                where: { id: lessonId },
                include: {
                    subject: { select: { userId: true } },
                },
            });

            if (lesson) {
                const filename = this.fileStorageService.generateAudioFileName(lesson.title, slideIndex);
                const filePath = this.fileStorageService.getAudioFilePath(
                    lesson.subject.userId,
                    lessonId,
                    filename,
                );

                try {
                    await this.fileStorageService.deleteFile(filePath);
                } catch (error) {
                    this.logger.warn(`Could not delete audio file: ${error.message}`);
                }
            }
        }

        // Clear audio fields
        return this.slideDataService.updateSlide(lessonId, slideIndex, {
            audioUrl: null,
            audioDuration: null,
            status: 'parsed',
        });
    }

    /**
     * Regenerate audio for a slide with updated speaker note
     */
    async regenerateAudio(
        userId: string,
        lessonId: string,
        slideIndex: number,
        newSpeakerNote: string,
        voiceId?: string,
    ): Promise<Slide> {
        // First update the speaker note
        await this.slideDataService.updateSlide(lessonId, slideIndex, {
            speakerNote: newSpeakerNote,
        });

        // Delete existing audio if present
        await this.deleteAudioForSlide(lessonId, slideIndex);

        // Generate new audio
        return this.generateAudioForSlide(userId, lessonId, slideIndex, voiceId);
    }
}
