import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { APIService } from '@prisma/client';
import { CryptoUtil } from '../common/crypto.util';

@Injectable()
export class ApiKeysService {
    private crypto: CryptoUtil;

    constructor(private prisma: PrismaService) {
        this.crypto = new CryptoUtil();
    }

    // ========== SYSTEM KEYS (Admin only) ==========

    async findAllSystemKeys() {
        const keys = await this.prisma.apiKey.findMany({
            where: { isSystem: true },
            orderBy: { createdAt: 'desc' },
        });

        // Mask encrypted keys for display
        return keys.map((key) => ({
            ...key,
            keyEncrypted: key.keyEncrypted ? '••••••••' : null,
            hasKey: !!key.keyEncrypted,
        }));
    }

    async createSystemKey(data: { name: string; service: APIService; key: string }) {
        const encrypted = await this.crypto.encrypt(data.key);
        return this.prisma.apiKey.create({
            data: {
                name: data.name,
                service: data.service,
                keyEncrypted: encrypted,
                isSystem: true,
                userId: null,
            },
        });
    }

    async updateSystemKey(id: string, data: { name?: string; key?: string }) {
        const updateData: any = {};
        if (data.name) updateData.name = data.name;
        if (data.key) {
            updateData.keyEncrypted = await this.crypto.encrypt(data.key);
        }
        return this.prisma.apiKey.update({
            where: { id, isSystem: true },
            data: updateData,
        });
    }

    async deleteSystemKey(id: string) {
        return this.prisma.apiKey.delete({
            where: { id, isSystem: true },
        });
    }

    // ========== USER KEYS ==========

    async findUserKeys(userId: string) {
        const keys = await this.prisma.apiKey.findMany({
            where: { userId, isSystem: false },
            orderBy: { createdAt: 'desc' },
        });

        return Promise.all(keys.map(async (key) => {
            let metadata: any = undefined;
            if (key.keyEncrypted && (key.service === 'VITTS' || key.service === 'OPENAI' || key.service === 'VBEE')) {
                try {
                    const decrypted = await this.crypto.decrypt(key.keyEncrypted);
                    const parsed = JSON.parse(decrypted);
                    if (typeof parsed === 'object' && parsed !== null) {
                        metadata = {
                            baseUrl: parsed.baseUrl,
                            appId: parsed.appId,
                            voiceCodes: parsed.voiceCodes,
                        };
                    }
                } catch {}
            }
            return {
                ...key,
                keyEncrypted: key.keyEncrypted ? '••••••••' : null,
                hasKey: !!key.keyEncrypted,
                metadata,
            };
        }));
    }

    async createUserKey(userId: string, data: { name: string; service: APIService; key: string }) {
        const encrypted = await this.crypto.encrypt(data.key);
        return this.prisma.apiKey.create({
            data: {
                name: data.name,
                service: data.service,
                keyEncrypted: encrypted,
                isSystem: false,
                userId,
            },
        });
    }

    async updateUserKey(userId: string, id: string, data: { name?: string; key?: string }) {
        const updateData: any = {};
        if (data.name) updateData.name = data.name;
        if (data.key) {
            try {
                const parsedNew = JSON.parse(data.key);
                if (typeof parsedNew === 'object' && parsedNew !== null) {
                    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
                    if (existing?.keyEncrypted) {
                        const oldDecrypted = await this.crypto.decrypt(existing.keyEncrypted);
                        try {
                            const parsedOld = JSON.parse(oldDecrypted);
                            if (typeof parsedOld === 'object' && parsedOld !== null) {
                                if (!parsedNew.apiKey && parsedOld.apiKey) {
                                    parsedNew.apiKey = parsedOld.apiKey;
                                }
                                if (!parsedNew.token && parsedOld.token) {
                                    parsedNew.token = parsedOld.token;
                                }
                                if (!parsedNew.appId && parsedOld.appId) {
                                    parsedNew.appId = parsedOld.appId;
                                }
                            }
                        } catch {
                            if (!parsedNew.apiKey && oldDecrypted) {
                                parsedNew.apiKey = oldDecrypted;
                            }
                        }
                    }
                    updateData.keyEncrypted = await this.crypto.encrypt(JSON.stringify(parsedNew));
                } else {
                    updateData.keyEncrypted = await this.crypto.encrypt(data.key);
                }
            } catch {
                updateData.keyEncrypted = await this.crypto.encrypt(data.key);
            }
        }
        return this.prisma.apiKey.update({
            where: { id, userId, isSystem: false },
            data: updateData,
        });
    }

    async deleteUserKey(userId: string, id: string) {
        return this.prisma.apiKey.delete({
            where: { id, userId, isSystem: false },
        });
    }

    // ========== KEY RESOLUTION (Priority: User > System) ==========

    async getActiveKey(userId: string, service: APIService): Promise<string | null> {
        // 1. First try user's own key
        const userKey = await this.prisma.apiKey.findFirst({
            where: {
                userId,
                service,
                isSystem: false,
            },
        });

        if (userKey?.keyEncrypted) {
            console.log(`[DEBUG] Found user key for ${service}, userId=${userId}`);
            return this.crypto.decrypt(userKey.keyEncrypted);
        }

        console.log(`[DEBUG] No user key found for ${service}, userId=${userId}. Trying system key...`);

        // 2. Fall back to system key
        const systemKey = await this.prisma.apiKey.findFirst({
            where: {
                service,
                isSystem: true,
            },
        });

        if (systemKey?.keyEncrypted) {
            console.log(`[DEBUG] Found system key for ${service}: id=${systemKey.id}, name=${systemKey.name}`);
            const decrypted = await this.crypto.decrypt(systemKey.keyEncrypted);
            console.log(`[DEBUG] Decrypted key length: ${decrypted?.length || 0}`);
            return decrypted;
        }

        console.log(`[DEBUG] No system key found for ${service}`);
        return null;
    }

    // Check if a service has any key configured (user or system)
    async hasKeyForService(userId: string, service: APIService): Promise<boolean> {
        const key = await this.getActiveKey(userId, service);
        return !!key;
    }
}
