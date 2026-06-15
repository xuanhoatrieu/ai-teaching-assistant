import {
    Injectable,
    ConflictException,
    UnauthorizedException,
    ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EmailService } from '../common/email.service';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private emailService: EmailService,
    ) { }

    async register(dto: RegisterDto) {
        // Check if user exists
        const existingUser = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (existingUser) {
            throw new ConflictException('Email already registered');
        }

        // Hash password
        const passwordHash = await bcrypt.hash(dto.password, 10);

        // Create user
        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                passwordHash,
                fullName: dto.fullName,
                phone: dto.phone,
                organization: dto.organization,
                status: 'PENDING',
            },
            select: {
                id: true,
                email: true,
                role: true,
                fullName: true,
                phone: true,
                organization: true,
                status: true,
                createdAt: true,
            },
        });

        return {
            message: 'Đăng ký thành công. Tài khoản của bạn đang chờ quản trị viên phê duyệt.',
            user,
        };
    }

    async login(dto: LoginDto) {
        // Find user
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        // Verify password
        const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);

        if (!passwordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        // Check user status
        if (user.status === 'PENDING') {
            throw new ForbiddenException('Tài khoản của bạn đang chờ quản trị viên phê duyệt.');
        }

        if (user.status === 'REJECTED') {
            throw new ForbiddenException('Tài khoản của bạn đã bị từ chối phê duyệt. Vui lòng liên hệ quản trị viên.');
        }

        // Generate tokens
        const tokens = await this.generateTokens(user.id, user.email, user.role);
        const requireProfileUpdate = !user.fullName || !user.phone || !user.organization;

        return {
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                fullName: user.fullName,
                phone: user.phone,
                organization: user.organization,
                status: user.status,
                requireProfileUpdate,
            },
            ...tokens,
        };
    }

    async refreshToken(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        return this.generateTokens(user.id, user.email, user.role);
    }

    private async generateTokens(userId: string, email: string, role: string) {
        const payload = { sub: userId, email, role };

        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync(payload, {
                expiresIn: 86400, // 24 hours
            }),
            this.jwtService.signAsync(payload, {
                expiresIn: 2592000, // 30 days
            }),
        ]);

        return {
            accessToken,
            refreshToken,
        };
    }

    async getMe(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                role: true,
                fullName: true,
                phone: true,
                organization: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        const requireProfileUpdate = !user.fullName || !user.phone || !user.organization;

        return {
            ...user,
            requireProfileUpdate,
        };
    }

    async updateProfile(userId: string, dto: { fullName: string; phone: string; organization: string }) {
        const user = await this.prisma.user.update({
            where: { id: userId },
            data: {
                fullName: dto.fullName,
                phone: dto.phone,
                organization: dto.organization,
            },
        });
        const requireProfileUpdate = !user.fullName || !user.phone || !user.organization;
        return {
            id: user.id,
            email: user.email,
            role: user.role,
            fullName: user.fullName,
            phone: user.phone,
            organization: user.organization,
            status: user.status,
            requireProfileUpdate,
        };
    }

    async changePassword(userId: string, dto: ChangePasswordDto) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new UnauthorizedException('Không tìm thấy người dùng');
        }

        const passwordValid = await bcrypt.compare(dto.oldPassword, user.passwordHash);
        if (!passwordValid) {
            throw new UnauthorizedException('Mật khẩu cũ không chính xác');
        }

        const passwordHash = await bcrypt.hash(dto.newPassword, 10);

        await this.prisma.user.update({
            where: { id: userId },
            data: { passwordHash },
        });

        return {
            success: true,
            message: 'Đổi mật khẩu thành công.',
        };
    }

    async forgotPassword(dto: ForgotPasswordDto, origin: string) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (!user) {
            return {
                success: true,
                message: 'Nếu email tồn tại trên hệ thống, một liên kết đặt lại mật khẩu đã được gửi.',
            };
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                resetPasswordToken: token,
                resetPasswordExpires: expires,
            },
        });

        const frontendUrl = process.env.FRONTEND_URL || origin || 'http://localhost:5173';
        const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

        await this.emailService.sendPasswordResetEmail(user.email, resetUrl);

        return {
            success: true,
            message: 'Liên kết đặt lại mật khẩu đã được gửi đến email của bạn.',
        };
    }

    async resetPassword(dto: ResetPasswordDto) {
        const user = await this.prisma.user.findFirst({
            where: {
                resetPasswordToken: dto.token,
                resetPasswordExpires: {
                    gt: new Date(),
                },
            },
        });

        if (!user) {
            throw new UnauthorizedException('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
        }

        const passwordHash = await bcrypt.hash(dto.newPassword, 10);

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash,
                resetPasswordToken: null,
                resetPasswordExpires: null,
            },
        });

        return {
            success: true,
            message: 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.',
        };
    }
}
