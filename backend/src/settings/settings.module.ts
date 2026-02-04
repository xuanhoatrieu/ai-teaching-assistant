import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SystemConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [SettingsController, SystemConfigController],
    providers: [SystemConfigService],
    exports: [SystemConfigService],
})
export class SettingsModule { }

