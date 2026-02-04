import { Controller, Post, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MigrationService } from './migration.service';

@Controller('admin/migrate')
@UseGuards(JwtAuthGuard)
export class MigrationController {
    constructor(private readonly migrationService: MigrationService) { }

    /**
     * GET /admin/migrate/status
     * Get migration status including counts
     */
    @Get('status')
    async getMigrationStatus() {
        return this.migrationService.getMigrationStatus();
    }

    /**
     * POST /admin/migrate/slides
     * Migrate all lessons with slideScript to Slide records
     */
    @Post('slides')
    async migrateAllSlides() {
        return this.migrationService.migrateAllSlides();
    }

    /**
     * POST /admin/migrate/lessons/:lessonId
     * Migrate a single lesson's slides
     */
    @Post('lessons/:lessonId')
    async migrateLesson(@Param('lessonId') lessonId: string) {
        return this.migrationService.migrateLesson(lessonId);
    }

    /**
     * POST /admin/migrate/questions
     * Migrate all QuestionBank records to ReviewQuestion records
     */
    @Post('questions')
    async migrateAllQuestions() {
        return this.migrationService.migrateAllQuestions();
    }

    /**
     * POST /admin/migrate/all
     * Run full migration (slides + questions)
     */
    @Post('all')
    async migrateAll() {
        const slidesResult = await this.migrationService.migrateAllSlides();
        const questionsResult = await this.migrationService.migrateAllQuestions();

        return {
            slides: {
                success: slidesResult.successCount,
                failed: slidesResult.failCount,
            },
            questions: {
                success: questionsResult.successCount,
                failed: questionsResult.failCount,
            },
        };
    }
}
