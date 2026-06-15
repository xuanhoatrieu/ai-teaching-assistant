import {
    Controller,
    Post,
    Get,
    Put,
    Body,
    UseGuards,
    HttpCode,
    HttpStatus,
    Headers,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './guards/roles.guard';
import { UserRole } from '@prisma/client';

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    @Post('register')
    async register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('login')
    @HttpCode(HttpStatus.OK)
    async login(@Body() dto: LoginDto) {
        return this.authService.login(dto);
    }

    @Post('refresh')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    async refresh(@CurrentUser('id') userId: string) {
        return this.authService.refreshToken(userId);
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    async getMe(@CurrentUser('id') userId: string) {
        return this.authService.getMe(userId);
    }

    // Example: Admin-only endpoint
    @Get('admin/users')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    async getAdminData() {
        return { message: 'This is admin-only data' };
    }

    @Put('profile')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    async updateProfile(
        @CurrentUser('id') userId: string,
        @Body() dto: { fullName: string; phone: string; organization: string }
    ) {
        return this.authService.updateProfile(userId, dto);
    }

    @Post('change-password')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    async changePassword(
        @CurrentUser('id') userId: string,
        @Body() dto: ChangePasswordDto
    ) {
        return this.authService.changePassword(userId, dto);
    }

    @Post('forgot-password')
    @HttpCode(HttpStatus.OK)
    async forgotPassword(
        @Body() dto: ForgotPasswordDto,
        @Headers('origin') origin: string
    ) {
        return this.authService.forgotPassword(dto, origin);
    }

    @Post('reset-password')
    @HttpCode(HttpStatus.OK)
    async resetPassword(@Body() dto: ResetPasswordDto) {
        return this.authService.resetPassword(dto);
    }
}
