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

class TestApiKeyDto {
    @IsEnum(APIService)
    service: APIService;

    @IsString()
    @IsNotEmpty()
    key: string;
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

    @Post('test')
    async testKey(@Body() dto: TestApiKeyDto) {
        if (dto.service === ('OPENAI' as any)) {
            try {
                const creds = JSON.parse(dto.key);
                const apiKey = creds.apiKey;
                const baseUrl = creds.baseUrl || 'https://api.openai.com/v1';
                
                if (!apiKey) {
                    return { success: false, message: 'Thiếu API Key' };
                }

                const response = await fetch(`${baseUrl}/v1/models`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                    signal: AbortSignal.timeout(10000),
                });

                if (response.ok) {
                    return { success: true, message: 'Kết nối thành công!' };
                } else {
                    const errorText = await response.text();
                    return { success: false, message: `Lỗi từ server: HTTP ${response.status} - ${errorText.substring(0, 100)}` };
                }
            } catch (err: any) {
                return { success: false, message: `Lỗi kết nối: ${err.message}` };
            }
        }
        
        if (dto.service === 'GEMINI') {
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${dto.key}`, {
                    signal: AbortSignal.timeout(10000),
                });
                if (response.ok) {
                    return { success: true, message: 'Kết nối thành công!' };
                } else {
                    return { success: false, message: `Lỗi kết nối: HTTP ${response.status}` };
                }
            } catch (err: any) {
                return { success: false, message: `Lỗi kết nối: ${err.message}` };
            }
        }

        if (dto.service === ('VBEE' as any)) {
            try {
                let token = dto.key;
                try {
                    const parsed = JSON.parse(dto.key);
                    token = parsed.token || parsed.apiKey || dto.key;
                } catch {}

                const response = await fetch('https://vbee.vn/api/v1/voices', {
                    headers: { 'Authorization': `Bearer ${token}` },
                    signal: AbortSignal.timeout(10000),
                });

                if (response.ok) {
                    const data = await response.json();
                    const total = data.result?.voices?.length || 0;
                    return { success: true, message: `Kết nối thành công! Đã xác thực tài khoản Vbee và kết nối kho giọng (${total} giọng).` };
                } else {
                    return { success: false, message: `Lỗi xác thực Vbee: HTTP ${response.status} (Vui lòng kiểm tra lại Token)` };
                }
            } catch (err: any) {
                return { success: false, message: `Lỗi kết nối Vbee: ${err.message}` };
            }
        }

        if (dto.service === ('VITTS' as any)) {
            try {
                let apiKey = dto.key;
                let baseUrl = 'http://117.0.36.6:8888';
                try {
                    const parsed = JSON.parse(dto.key);
                    apiKey = parsed.apiKey || dto.key;
                    baseUrl = parsed.baseUrl || baseUrl;
                } catch {}

                const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
                const authHeaders: Record<string, string> = {};
                if (apiKey) {
                    authHeaders['X-API-Key'] = apiKey;
                    authHeaders['Authorization'] = `Bearer ${apiKey}`;
                }

                // Check /api/v1/tts/models or /api/v1/tts/options
                const response = await fetch(`${cleanBaseUrl}/api/v1/tts/models`, {
                    headers: authHeaders,
                    signal: AbortSignal.timeout(10000),
                });

                if (response.ok) {
                    return { success: true, message: `Kết nối thành công tới máy chủ ViTTS (${cleanBaseUrl})!` };
                } else {
                    return { success: false, message: `Lỗi kết nối ViTTS: HTTP ${response.status} (Kiểm tra lại Base URL hoặc API Key)` };
                }
            } catch (err: any) {
                return { success: false, message: `Lỗi kết nối ViTTS: ${err.message}` };
            }
        }

        return { success: true, message: 'Dịch vụ này hiện chưa hỗ trợ kiểm tra kết nối trực tiếp.' };
    }

    // Check if user has a key for a specific service (including system fallback)
    @Get('check/:service')
    async checkService(@Request() req, @Param('service') service: APIService) {
        const hasKey = await this.apiKeysService.hasKeyForService(req.user.id, service);
        return { service, hasKey };
    }
}
