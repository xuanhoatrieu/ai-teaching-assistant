import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    UseGuards,
} from '@nestjs/common';
import { TTSService } from './tts.service';
import { CreateTTSProviderDto, UpdateTTSProviderDto } from './dto/create-tts-provider.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('admin/tts-providers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class TTSAdminController {
    constructor(private readonly ttsService: TTSService) { }

    @Post()
    create(@Body() dto: CreateTTSProviderDto) {
        return this.ttsService.createProvider(dto);
    }

    @Get()
    findAll() {
        return this.ttsService.findAllProviders();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.ttsService.findProviderById(id);
    }

    @Put(':id')
    update(@Param('id') id: string, @Body() dto: UpdateTTSProviderDto) {
        return this.ttsService.updateProvider(id, dto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.ttsService.deleteProvider(id);
    }
}
