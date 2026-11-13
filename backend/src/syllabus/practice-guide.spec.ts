import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SyllabusService } from './syllabus.service';
import { SyllabusExportService } from './syllabus-export.service';

describe('Practice Guide Feature (Parallel to Textbook PRO)', () => {
    const createMockDeps = () => {
        const prisma: any = {
            subject: {
                findUnique: jest.fn(),
            },
            syllabusLesson: {
                findUnique: jest.fn(),
                update: jest.fn(),
            },
        };
        const aiProvider: any = {
            generateTextWithSystem: jest.fn(),
        };
        const markItDown: any = {};
        const mermaid: any = {
            renderToPng: jest.fn().mockResolvedValue(Buffer.from('fake-png-bytes')),
        };
        const imagen: any = {
            generateImage: jest.fn(),
        };
        const fileStorage: any = {
            saveTextbookAsset: jest.fn().mockImplementation((_sylId: string, _lesId: string, _buf: Buffer, filename: string) =>
                Promise.resolve({
                    publicUrl: `/files/public/syllabus-textbook/syl-1/les-1/assets/${filename}`,
                }),
            ),
        };
        const apiKeysService: any = {
            getActiveKey: jest.fn().mockResolvedValue(null),
        };
        const referenceRag: any = {
            indexReference: jest.fn(),
            retrieve: jest.fn().mockResolvedValue([]),
        };

        const service = new SyllabusService(
            prisma,
            aiProvider,
            markItDown,
            mermaid,
            imagen,
            fileStorage,
            apiKeysService,
            referenceRag,
        );

        return { service, prisma, aiProvider, mermaid, fileStorage };
    };

    describe('Ownership & Access Control', () => {
        it('rejects access to a lesson owned by another user', async () => {
            const { service, prisma } = createMockDeps();
            prisma.syllabusLesson.findUnique.mockResolvedValue({
                id: 'les-1',
                syllabus: { subject: { id: 'sub-1', name: 'Tin học cơ sở', userId: 'owner-1' } },
            });

            await expect(service.verifyLessonOwnership('les-1', 'intruder-2')).rejects.toThrow(ForbiddenException);
        });

        it('rejects non-existent lesson IDs with BadRequestException', async () => {
            const { service, prisma } = createMockDeps();
            prisma.syllabusLesson.findUnique.mockResolvedValue(null);

            await expect(service.verifyLessonOwnership('missing', 'owner-1')).rejects.toThrow(BadRequestException);
        });

        it('rejects subject export when subject belongs to another user', async () => {
            const { service, prisma } = createMockDeps();
            prisma.subject.findUnique.mockResolvedValue({
                id: 'sub-1',
                name: 'Hóa sinh nông nghiệp',
                userId: 'owner-1',
            });

            await expect(service.verifySubjectOwnership('sub-1', 'intruder-2')).rejects.toThrow(ForbiddenException);
        });
    });

    describe('Parallel Storage & Status Polling', () => {
        it('maps practice phases to accurate progress percentages and Vietnamese messages', async () => {
            const { service, prisma } = createMockDeps();
            prisma.syllabusLesson.findUnique
                .mockResolvedValueOnce({
                    id: 'les-1',
                    syllabus: { subject: { id: 'sub-1', name: 'Môn A', userId: 'user-1' } },
                })
                .mockResolvedValueOnce({
                    practicePhase: 'writing',
                    practiceStatus: 'generating',
                });

            const status = await service.getPracticeStatus('les-1', 'user-1');
            expect(status).toEqual({
                phase: 'writing',
                status: 'generating',
                progress: 58,
                message: 'Biên soạn hướng dẫn thực hành từng bước...',
            });
        });

        it('saves edited practiceContent without mutating textbookContent or textbookStatus', async () => {
            const { service, prisma } = createMockDeps();
            prisma.syllabusLesson.findUnique.mockResolvedValue({
                id: 'les-1',
                textbookContent: '# Chương 1: Lý thuyết giữ nguyên',
                textbookStatus: 'done',
                syllabus: { subject: { id: 'sub-1', name: 'Môn A', userId: 'user-1' } },
            });
            prisma.syllabusLesson.update.mockResolvedValue({ id: 'les-1', practiceStatus: 'done' });

            await service.savePracticeContent('les-1', '## Hướng dẫn thực hành đã chỉnh sửa', 'user-1');

            expect(prisma.syllabusLesson.update).toHaveBeenCalledWith({
                where: { id: 'les-1' },
                data: {
                    practiceContent: '## Hướng dẫn thực hành đã chỉnh sửa',
                    practiceStatus: 'done',
                    practicePhase: 'done',
                },
            });
        });
    });

    describe('5-Step Domain-Adaptive Practice Pipeline & Asset Isolation', () => {
        it('runs PLAN → WRITE → ILLUSTRATE → REVIEW and prefixes diagram filenames with practice_*', async () => {
            const { service, prisma, aiProvider, fileStorage } = createMockDeps();

            prisma.syllabusLesson.findUnique.mockResolvedValue({
                id: 'les-1',
                syllabusId: 'syl-1',
                title: 'Bài 4: Thực hành chuẩn độ axit-bazơ trong phân tích đất',
                outline: '- Chuẩn bị dung dịch NaOH 0.1N\n- Tiến hành chuẩn độ 3 lần lặp',
                textbookContent: 'Existing Textbook Content',
                textbookStatus: 'done',
                syllabus: {
                    subject: {
                        id: 'sub-1',
                        userId: 'user-1',
                        name: 'Phân tích nông hóa',
                        courseName: 'Phân tích nông hóa',
                        majorName: 'Khoa học cây trồng',
                        expertiseArea: 'Nông nghiệp',
                        targetAudience: 'Sinh viên năm 2',
                        institutionType: 'Đại học ứng dụng',
                        language: 'Tiếng Việt',
                        additionalContext: null,
                    },
                    blocks: [
                        { blockType: 'clo', content: 'CLO2: Thực hiện đúng thao tác chuẩn độ trong phòng thí nghiệm.' },
                    ],
                    references: [],
                },
            });
            prisma.syllabusLesson.update.mockResolvedValue({ id: 'les-1' });

            aiProvider.generateTextWithSystem
                // Step 1: PLAN
                .mockResolvedValueOnce({
                    content: JSON.stringify({
                        domainArchetype: 'LAB_EXPERIMENT',
                        practiceTitle: 'Thực hành chuẩn độ axit-bazơ',
                    }),
                })
                // Step 2: WRITE
                .mockResolvedValueOnce({
                    content:
                        '## 1. Mục tiêu thực hành\n<!-- ILLUSTRATION: {"type": "mermaid", "description": "Quy trình chuẩn độ"} -->\n### Bước 1: Tráng buret',
                })
                // Step 3: ILLUSTRATE
                .mockResolvedValueOnce({
                    content: JSON.stringify([
                        {
                            position: 'sau mục 1',
                            type: 'mermaid',
                            caption: 'Sơ đồ quy trình chuẩn độ',
                            content: 'flowchart LR\n  A["Lấy mẫu"] --> B["Chuẩn độ"]',
                        },
                    ]),
                })
                // Step 4: REVIEW + FIX
                .mockResolvedValueOnce({
                    content:
                        '## 1. Mục tiêu thực hành\n\n![Sơ đồ quy trình chuẩn độ](/files/public/syllabus-textbook/syl-1/les-1/assets/practice_diagram_001.png)\n\n### Bước 1: Tráng buret',
                });

            await service.generatePracticeGuide('les-1', 'gemini-2.5-flash', undefined, 'user-1', undefined);

            // Verify Practice Guide saves assets with practice_ prefix so Textbook diagram_001.png is untouched
            expect(fileStorage.saveTextbookAsset).toHaveBeenCalledWith(
                'syl-1',
                'les-1',
                expect.any(Buffer),
                'practice_diagram_001.png',
            );

            // Verify final DB update writes ONLY practiceContent / practiceStatus / practicePhase
            const lastUpdateCall = prisma.syllabusLesson.update.mock.calls.at(-1)[0];
            expect(lastUpdateCall).toEqual({
                where: { id: 'les-1' },
                data: {
                    practiceContent: expect.stringContaining('practice_diagram_001.png'),
                    practiceStatus: 'done',
                    practicePhase: 'done',
                },
            });
        });
    });

    describe('DOCX Export, Typography & Path-Traversal Hardening', () => {
        it('exports Practice Guide Markdown to DOCX with A4 (3/2/2/2cm), TNR 13pt, 1.3 line spacing, 4pt after, exact table rules & path-traversal protection', async () => {
            const exportService = new SyllabusExportService();
            const buffer = await exportService.generatePracticeDocx(
                [
                    {
                        title: 'Bài 2: Thực hành truy vấn SQL cơ bản',
                        sortOrder: 1,
                        practiceContent: [
                            '| Thông tin bài thực hành | Nội dung chi tiết |',
                            '| --- | --- |',
                            '| **Số bài và tên bài** | Bài 02: Thực hành truy vấn SQL |',
                            '| **Thời lượng** | 2 tiết (90 phút) |',
                            '',
                            '## 1. Mục tiêu thực hành',
                            'Sinh viên viết được câu lệnh SELECT có điều kiện lọc WHERE (CLO2).',
                            '',
                            '![TraversalAttempt](/files/public/syllabus-textbook/../../../../etc/passwd)',
                            '',
                            '## 4. Nội dung và hướng dẫn thực hành',
                            '### 4.1. Nhiệm vụ 1: Truy vấn lọc sinh viên',
                            '**a. Yêu cầu:** Lọc sinh viên có GPA từ 3.2 trở lên.',
                            '```sql',
                            'SELECT student_code, full_name FROM students WHERE gpa >= 3.2;',
                            '```',
                            '',
                            '## 7. Tiêu chí đánh giá',
                            '| STT | Tiêu chí đánh giá | Trọng số | Điểm |',
                            '| --- | --- | --- | --- |',
                            '| 1 | Thao tác đúng quy trình | 40% | 4.0 |',
                            '| 2 | Giải thích được kết quả | 60% | 6.0 |',
                        ].join('\n'),
                    },
                ],
                'Cơ sở dữ liệu',
            );

            expect(Buffer.isBuffer(buffer)).toBe(true);
            expect(buffer.length).toBeGreaterThan(1000);
            expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');

            const tmpDocx = path.join(os.tmpdir(), `verify_practice_${Date.now()}.docx`);
            try {
                fs.writeFileSync(tmpDocx, buffer);
                const inspectJson = execFileSync(
                    'python3',
                    [
                        '-c',
                        [
                            'import json, sys',
                            'from docx import Document',
                            'from docx.oxml.ns import qn',
                            'doc = Document(sys.argv[1])',
                            'sec = doc.sections[0]',
                            'body_p = [p for p in doc.paragraphs if p.text.startswith("Sinh viên")][0]',
                            'body_sp = body_p._p.find(qn("w:pPr")).find(qn("w:spacing"))',
                            'body_rf = body_p.runs[0]._r.find(qn("w:rPr")).find(qn("w:rFonts"))',
                            'body_sz = body_p.runs[0]._r.find(qn("w:rPr")).find(qn("w:sz"))',
                            'has_traversal_leak = any("etc/passwd" in p.text or "TraversalAttempt" in p.text for p in doc.paragraphs)',
                            'tbl = doc.tables[1]',
                            'def cell_info(r, c):',
                            '    cell = tbl.rows[r].cells[c]',
                            '    p = cell.paragraphs[0]',
                            '    pPr = p._p.find(qn("w:pPr"))',
                            '    jc = pPr.find(qn("w:jc")).get(qn("w:val"))',
                            '    sp = pPr.find(qn("w:spacing"))',
                            '    va = cell._tc.find(qn("w:tcPr")).find(qn("w:vAlign")).get(qn("w:val"))',
                            '    return {"jc": jc, "va": va, "before": sp.get(qn("w:before")), "after": sp.get(qn("w:after")), "line": sp.get(qn("w:line"))}',
                            'print(json.dumps({',
                            '    "w_cm": round(sec.page_width.cm, 1),',
                            '    "h_cm": round(sec.page_height.cm, 1),',
                            '    "l_cm": round(sec.left_margin.cm, 1),',
                            '    "r_cm": round(sec.right_margin.cm, 1),',
                            '    "t_cm": round(sec.top_margin.cm, 1),',
                            '    "b_cm": round(sec.bottom_margin.cm, 1),',
                            '    "font": body_rf.get(qn("w:ascii")),',
                            '    "size_half_pt": body_sz.get(qn("w:val")),',
                            '    "body_after": body_sp.get(qn("w:after")),',
                            '    "body_line": body_sp.get(qn("w:line")),',
                            '    "has_traversal_leak": has_traversal_leak,',
                            '    "hdr_title": cell_info(0, 1),',
                            '    "stt_cell": cell_info(1, 0),',
                            '    "text_cell": cell_info(1, 1),',
                            '    "weight_cell": cell_info(1, 2),',
                            '    "score_cell": cell_info(1, 3),',
                            '}))',
                        ].join('\n'),
                        tmpDocx,
                    ],
                    { encoding: 'utf-8' },
                );

                const parsed = JSON.parse(inspectJson.trim());
                expect(parsed.has_traversal_leak).toBe(false);
                // A4 + Left 3cm, Right/Top/Bottom 2cm
                expect(parsed.w_cm).toBe(21.0);
                expect(parsed.h_cm).toBe(29.7);
                expect(parsed.l_cm).toBe(3.0);
                expect(parsed.r_cm).toBe(2.0);
                expect(parsed.t_cm).toBe(2.0);
                expect(parsed.b_cm).toBe(2.0);
                // TNR 13pt (26 half-pt), 1.3x line spacing (312), 4pt after (80 twips)
                expect(parsed.font).toBe('Times New Roman');
                expect(parsed.size_half_pt).toBe('26');
                expect(parsed.body_after).toBe('80');
                expect(parsed.body_line).toBe('312');
                // Table header centered, zero spacing, middle vertical alignment
                expect(parsed.hdr_title).toEqual({ jc: 'center', va: 'center', before: '0', after: '0', line: '240' });
                // Numeric columns centered, zero spacing, middle vertical alignment
                expect(parsed.stt_cell).toEqual({ jc: 'center', va: 'center', before: '0', after: '0', line: '240' });
                expect(parsed.weight_cell).toEqual({ jc: 'center', va: 'center', before: '0', after: '0', line: '240' });
                expect(parsed.score_cell).toEqual({ jc: 'center', va: 'center', before: '0', after: '0', line: '240' });
                // Text column left horizontally, center vertically ("trái ở giữa"), zero spacing
                expect(parsed.text_cell).toEqual({ jc: 'left', va: 'center', before: '0', after: '0', line: '240' });
            } finally {
                try { fs.unlinkSync(tmpDocx); } catch { /* ignore */ }
            }
        });
    });
});

