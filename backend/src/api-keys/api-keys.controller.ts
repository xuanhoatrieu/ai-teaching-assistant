import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    UseGuards,
    Request,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole, APIService } from '@prisma/client';

// ========== DTOs ==========

class CreateApiKeyDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsEnum(APIService)
    service: APIService;

    @IsString()
    @IsNotEmpty()
    key: string;
}

class UpdateApiKeyDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    key?: string;
}

// ========== ADMIN CONTROLLER ==========

@Controller('admin/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminApiKeysController {
    constructor(private apiKeysService: ApiKeysService) { }

    @Get()
    async findAll() {
        return this.apiKeysService.findAllSystemKeys();
    }

    @Post()
    async create(@Body() dto: CreateApiKeyDto) {
        return this.apiKeysService.createSystemKey(dto);
    }

    @Put(':id')
    async update(@Param('id') id: string, @Body() dto: UpdateApiKeyDto) {
        return this.apiKeysService.updateSystemKey(id, dto);
    }

    @Delete(':id')
    async delete(@Param('id') id: string) {
        return this.apiKeysService.deleteSystemKey(id);
    }
}

// ========== USER CONTROLLER ==========

@Controller('user/api-keys')
@UseGuards(JwtAuthGuard)
export class UserApiKeysController {
    constructor(private apiKeysService: ApiKeysService) { }

    @Get()
    async findAll(@Request() req) {
        return this.apiKeysService.findUserKeys(req.user.id);
    }

    @Post()
    async create(@Request() req, @Body() dto: CreateApiKeyDto) {
        return this.apiKeysService.createUserKey(req.user.id, dto);
    }

    @Put(':id')
    async update(@Request() req, @Param('id') id: string, @Body() dto: UpdateApiKeyDto) {
        return this.apiKeysService.updateUserKey(req.user.id, id, dto);
    }

    @Delete(':id')
    async delete(@Request() req, @Param('id') id: string) {
        return this.apiKeysService.deleteUserKey(req.user.id, id);
    }

    // Check if user has a key for a specific service (including system fallback)
    @Get('check/:service')
    async checkService(@Request() req, @Param('service') service: APIService) {
        const hasKey = await this.apiKeysService.hasKeyForService(req.user.id, service);
        return { service, hasKey };
    }
}
