import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { ImagenService } from './imagen.service';
import { CLIProxyProvider } from './cliproxy.provider';
import { AiProviderService } from './ai-provider.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    providers: [GeminiService, ImagenService, CLIProxyProvider, AiProviderService],
    exports: [GeminiService, ImagenService, CLIProxyProvider, AiProviderService],
})
export class AIModule { }
