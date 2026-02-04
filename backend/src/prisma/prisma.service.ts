import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
    extends PrismaClient
    implements OnModuleInit, OnModuleDestroy {

    private pool: Pool;

    constructor() {
        // Create PostgreSQL connection pool
        const connectionString = process.env.DATABASE_URL;
        const pool = new Pool({ connectionString });

        // Create Prisma adapter
        const adapter = new PrismaPg(pool);

        super({
            adapter,
            log:
                process.env.NODE_ENV === 'development'
                    ? ['query', 'info', 'warn', 'error']
                    : ['error'],
        });

        this.pool = pool;
    }

    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }

    async cleanDatabase() {
        if (process.env.NODE_ENV !== 'production') {
            // Delete in correct order to respect foreign keys
            await this.generatedContent.deleteMany();
            await this.lesson.deleteMany();
            await this.subject.deleteMany();
            await this.userTTSConfig.deleteMany();
            await this.apiKey.deleteMany();
            await this.user.deleteMany();
            await this.tTSProvider.deleteMany();
            await this.prompt.deleteMany();
        }
    }
}
