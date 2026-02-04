import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { PromptsModule } from './prompts/prompts.module';
import { TTSModule } from './tts/tts.module';
import { SubjectsModule } from './subjects/subjects.module';
import { LessonsModule } from './lessons/lessons.module';
import { AIModule } from './ai/ai.module';
import { ExportModule } from './export/export.module';
import { GenerationModule } from './generation/generation.module';
import { TemplatesModule } from './templates/templates.module';
import { UsersModule } from './users/users.module';
import { StatsModule } from './stats/stats.module';
import { SettingsModule } from './settings/settings.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { OutlineModule } from './outline/outline.module';
import { SlidesModule } from './slides/slides.module';
import { QuestionBankModule } from './question-bank/question-bank.module';
import { ModelConfigModule } from './model-config/model-config.module';
import { SlideAudioModule } from './slide-audio/slide-audio.module';
import { FileStorageModule } from './file-storage/file-storage.module';
import { SlideDataModule } from './slide-data/slide-data.module';
import { QuestionsModule } from './questions/questions.module';
import { MigrationModule } from './migration/migration.module';
import { PptxModule } from './pptx/pptx.module';

@Module({
  imports: [
    // Serve static files from uploads directory
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: {
        index: false,
        setHeaders: (res, path) => {
          if (path.endsWith('.wav')) {
            res.setHeader('Content-Type', 'audio/wav');
          } else if (path.endsWith('.mp3')) {
            res.setHeader('Content-Type', 'audio/mpeg');
          }
        },
      },
    }),
    PrismaModule,
    AuthModule,
    PromptsModule,
    TTSModule,
    SubjectsModule,
    LessonsModule,
    AIModule,
    ExportModule,
    GenerationModule,
    TemplatesModule,
    UsersModule,
    StatsModule,
    SettingsModule,
    ApiKeysModule,
    OutlineModule,
    SlidesModule,
    QuestionBankModule,
    ModelConfigModule,
    SlideAudioModule,
    FileStorageModule,
    SlideDataModule,
    QuestionsModule,
    MigrationModule,
    PptxModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
