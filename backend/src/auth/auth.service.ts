import {
    Injectable,
    ConflictException,
    UnauthorizedException,
    ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
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
}
