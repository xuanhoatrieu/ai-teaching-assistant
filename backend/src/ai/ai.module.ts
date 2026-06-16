import { Module, forwardRef } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { ImagenService } from './imagen.service';
import { CLIProxyProvider } from './cliproxy.provider';
import { CustomOpenAIProvider } from './custom-openai.provider';
import { AiProviderService } from './ai-provider.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
    imports: [PrismaModule, forwardRef(() => SettingsModule)],
    providers: [GeminiService, ImagenService, CLIProxyProvider, CustomOpenAIProvider, AiProviderService],
    exports: [GeminiService, ImagenService, CLIProxyProvider, CustomOpenAIProvider, AiProviderService],
})
export class AIModule { }
