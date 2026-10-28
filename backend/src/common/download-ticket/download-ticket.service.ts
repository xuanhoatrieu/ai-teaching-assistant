import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Short-lived download tickets.
 *
 * Why: large files (PPTX/SCORM/H5P) must be downloaded by the browser natively
 * (<a href> navigation) instead of fetch()+Blob. Download managers such as IDM
 * intercept fetch/XHR responses with `Content-Disposition: attachment`, abort the
 * browser request (net::ERR_FAILED) and re-request the URL themselves WITHOUT the
 * Authorization header. A native link needs credentials in the URL, but the
 * access token must never be put in a URL. Instead we issue an opaque random
 * ticket that is scoped to ONE lesson + ONE file/export and expires quickly.
 *
 * Tickets are reusable until expiry on purpose: IDM re-requests the same URL
 * after the browser request is cancelled.
 */
export type DownloadTicketKind = 'pptx-temp' | 'scorm' | 'h5p' | 'pptx-tool-scorm' | 'pptx-tool-h5p' | 'pptx-tool-pptx';

export interface DownloadTicketPayload {
    kind: DownloadTicketKind;
    userId: string;
    lessonId: string;
    params: Record<string, string | undefined>;
}

interface StoredTicket extends DownloadTicketPayload {
    expiresAt: number;
}

const TICKET_TTL_MS = 2 * 60 * 1000;
const MAX_TICKETS = 5000;
const TICKET_PATTERN = /^[a-f0-9]{64}$/;

@Injectable()
export class DownloadTicketService {
    // TODO(security): in-memory store only works with a single backend instance.
    // Move to Redis if the backend is ever scaled horizontally.
    private readonly tickets = new Map<string, StoredTicket>();

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Ensure the user owns the lesson (admins may access any lesson).
     */
    async assertLessonAccess(lessonId: string, user: { id: string; role?: string }): Promise<void> {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            select: { subject: { select: { userId: true } } },
        });
        if (!lesson) {
            throw new NotFoundException('Không tìm thấy bài giảng');
        }
        if (lesson.subject.userId !== user.id && user.role !== 'ADMIN') {
            throw new ForbiddenException('Bạn không có quyền tải tài nguyên của bài giảng này');
        }
    }

    /**
     * Ensure the user owns the PPTX Audio Tool session (admins may access any session).
     */
    async assertPptxSessionAccess(sessionId: string, user: { id: string; role?: string }): Promise<void> {
        const session = await this.prisma.pptxAudioSession.findUnique({
            where: { id: sessionId },
            select: { userId: true },
        });
        if (!session) {
            throw new NotFoundException('Không tìm thấy phiên làm việc PPTX');
        }
        if (session.userId !== user.id && user.role !== 'ADMIN') {
            throw new ForbiddenException('Bạn không có quyền tải tài nguyên của bài giảng PPTX này');
        }
    }

    issue(payload: DownloadTicketPayload): { ticket: string; expiresInSeconds: number } {
        this.purgeExpired();
        if (this.tickets.size >= MAX_TICKETS) {
            // Map preserves insertion order -> drop the oldest ticket
            const oldestKey = this.tickets.keys().next().value;
            if (oldestKey) this.tickets.delete(oldestKey);
        }

        const ticket = randomBytes(32).toString('hex');
        this.tickets.set(ticket, { ...payload, expiresAt: Date.now() + TICKET_TTL_MS });
        return { ticket, expiresInSeconds: TICKET_TTL_MS / 1000 };
    }

    /**
     * Resolve a ticket for a given kind + lesson. Returns null when invalid/expired.
     */
    resolve(ticket: unknown, kind: DownloadTicketKind, lessonId: string): DownloadTicketPayload | null {
        if (typeof ticket !== 'string' || !TICKET_PATTERN.test(ticket)) return null;

        const stored = this.tickets.get(ticket);
        if (!stored) return null;

        if (stored.expiresAt < Date.now()) {
            this.tickets.delete(ticket);
            return null;
        }
        if (stored.kind !== kind || stored.lessonId !== lessonId) return null;

        const { expiresAt, ...payload } = stored;
        return payload;
    }

    private purgeExpired(): void {
        const now = Date.now();
        for (const [key, value] of this.tickets) {
            if (value.expiresAt < now) this.tickets.delete(key);
        }
    }
}
