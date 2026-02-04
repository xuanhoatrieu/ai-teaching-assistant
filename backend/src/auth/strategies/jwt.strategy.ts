import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import type { Request } from 'express';

export interface JwtPayload {
    sub: string; // user id
    email: string;
    role: string;
}

// Custom extractor that checks both header and query param (for SSE)
const jwtExtractor = (req: Request): string | null => {
    // First try Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }

    // Fallback to query parameter (for EventSource/SSE)
    if (req.query && req.query.token) {
        const token = req.query.token as string;
        console.log(`[JWT] Token from query: ${token.substring(0, 20)}...`);
        return token;
    }

    console.log(`[JWT] No token found! Headers: ${JSON.stringify(req.headers)}, Query: ${JSON.stringify(req.query)}`);
    return null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private prisma: PrismaService) {
        super({
            jwtFromRequest: jwtExtractor,
            ignoreExpiration: false,
            secretOrKey: process.env.JWT_SECRET || 'your-secret-key',
        });
    }

    async validate(payload: JwtPayload) {
        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: {
                id: true,
                email: true,
                role: true,
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        return user;
    }
}
