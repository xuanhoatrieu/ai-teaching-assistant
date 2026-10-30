import { NotFoundException } from '@nestjs/common';
import { ExamSetService } from './exam-set.service';

describe('ExamSetService — Subject Multi-Lesson & Grounded Question Bank Pipeline (US-031)', () => {
    let service: ExamSetService;
    let mockPrisma: any;
    let mockAiProvider: any;
    let mockModelConfigService: any;
    let mockJobService: any;

    const ownerUserId = 'user-owner-1';

    beforeEach(() => {
        mockPrisma = {
            $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
            subject: {
                findUnique: jest.fn(),
            },
            pptxSubject: {
                findUnique: jest.fn(),
            },
            syllabusLesson: {
                findUnique: jest.fn(),
            },
            lesson: {
                findUnique: jest.fn(),
            },
            pptxAudioSession: {
                findUnique: jest.fn(),
            },
            examQuestionSet: {
                findMany: jest.fn(),
                findUnique: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            },
        };

        mockAiProvider = {
            generateText: jest.fn(),
        };

        mockModelConfigService = {
            getModelForTask: jest.fn().mockResolvedValue({ modelName: 'gemini-2.5-flash' }),
        };

        mockJobService = {
            createJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
            updateProgress: jest.fn().mockResolvedValue(undefined),
            completeJob: jest.fn().mockResolvedValue(undefined),
            failJob: jest.fn().mockResolvedValue(undefined),
        };

        service = new ExamSetService(
            mockPrisma,
            mockAiProvider,
            mockModelConfigService,
            mockJobService,
        );
    });

    describe('getLessonsOverview (Subject unified created-lessons discovery)', () => {
        it('unifies bridged SyllabusLesson + unbridged SyllabusLesson + standalone Lesson without duplicate prefixes and counts all 4 question tables', async () => {
            mockPrisma.subject.findUnique.mockResolvedValue({
                id: 'subj-1',
                userId: ownerUserId,
                name: 'Cơ sở dữ liệu',
                majorName: 'Công nghệ thông tin',
                expertiseArea: null,
                language: 'vi',
                syllabus: {
                    id: 'syl-1',
                    references: [
                        {
                            id: 'ref-1',
                            markdownContent: 'Chương 1: Tổng quan Cơ sở dữ liệu và hệ quản trị CSDL...',
                        },
                    ],
                    lessons: [
                        {
                            id: 'sl-1',
                            sortOrder: 0,
                            title: 'Bài 01: Tổng quan Cơ sở dữ liệu',
                            outline: '1.1 Khái niệm CSDL\n1.2 Hệ quản trị DBMS',
                            textbookContent: '# Bài 01: Tổng quan CSDL\nNội dung chi tiết...',
                            textbookPlan: '{"learningOutcomes":["Hiểu khái niệm CSDL"]}',
                            lessonId: 'lesson-1',
                        },
                        {
                            id: 'sl-2',
                            sortOrder: 1,
                            title: 'Mô hình Dữ liệu Quan hệ',
                            outline: '2.1 Quan hệ và bộ\n2.2 Khóa chính và khóa ngoại',
                            textbookContent: '# Bài 02: Mô hình Quan hệ\nĐịnh nghĩa khóa...',
                            textbookPlan: null,
                            lessonId: null, // Unbridged SyllabusLesson!
                        },
                        {
                            id: 'sl-3',
                            sortOrder: 2,
                            title: 'Bài 03',
                            outline: '3.1 Đại số quan hệ',
                            textbookContent: null,
                            textbookPlan: null,
                            lessonId: null,
                        },
                    ],
                },
                lessons: [
                    {
                        id: 'lesson-1',
                        title: 'Bài 01: Tổng quan Cơ sở dữ liệu',
                        outlineRaw: '1.1 Khái niệm CSDL',
                        detailedOutline: 'Dàn bài chi tiết bài 1',
                        slideScript: null,
                        createdAt: new Date('2026-09-01T00:00:00Z'),
                        syllabusLesson: { id: 'sl-1', sortOrder: 0 },
                        generatedContents: [{ id: 'gc-1', contentJson: '{"title":"Handout Bài 1"}' }],
                        questionBank: {
                            questionsJson: JSON.stringify([
                                { question: 'Q1', correctAnswer: 'A' },
                                { question: 'Q2', correctAnswer: 'B' },
                            ]),
                        },
                        _count: {
                            slides: 12,
                            slideAudios: 12,
                            reviewQuestions: 10,
                            englishQuestions: 2,
                            interactiveQuestions: 3,
                        },
                    },
                    {
                        id: 'lesson-standalone',
                        title: 'Bài 04: Ngôn ngữ SQL truy vấn nâng cao',
                        outlineRaw: null,
                        detailedOutline: null,
                        slideScript: 'Slide 1: Subquery và CTE...',
                        createdAt: new Date('2026-09-05T00:00:00Z'),
                        syllabusLesson: null,
                        generatedContents: [],
                        questionBank: null,
                        _count: {
                            slides: 0,
                            slideAudios: 0,
                            reviewQuestions: 5,
                            englishQuestions: 0,
                            interactiveQuestions: 1,
                        },
                    },
                ],
            });

            const res = await service.getLessonsOverview(ownerUserId, { subjectId: 'subj-1' });

            expect(res.subjectName).toBe('Cơ sở dữ liệu');
            expect(res.isEnglishSubject).toBe(true); // lesson-1 has englishQuestions > 0
            expect(res.lessons).toHaveLength(4);

            // 1. Bridged lesson
            const l1 = res.lessons[0];
            expect(l1.id).toBe('lesson-1');
            expect(l1.syllabusLessonId).toBe('sl-1');
            expect(l1.originType).toBe('bridged');
            expect(l1.displayTitle).toBe('Bài 01: Tổng quan Cơ sở dữ liệu'); // No duplicate "Bài 1: Bài 01..."
            expect(l1.questionBankTotal).toBe(15); // max(10 review, 2 qb) + 2 english + 3 interactive
            expect(l1.sourceBadges).toEqual(
                expect.arrayContaining([
                    '📗 Giáo trình',
                    '📊 12 Slides',
                    '🎙️ Lời giảng (12)',
                    '📋 Đề cương bài',
                    '📄 Handout',
                    '📎 Tài liệu TK',
                    '❓ Ngân hàng (15 câu)',
                ]),
            );

            // 2. Unbridged SyllabusLesson
            const l2 = res.lessons[1];
            expect(l2.id).toBe('sl:sl-2');
            expect(l2.syllabusLessonId).toBe('sl-2');
            expect(l2.lessonId).toBeNull();
            expect(l2.originType).toBe('syllabus');
            expect(l2.displayTitle).toBe('Bài 02: Mô hình Dữ liệu Quan hệ');
            expect(l2.hasContent).toBe(true);
            expect(l2.sourceBadges).toEqual(
                expect.arrayContaining(['📗 Giáo trình', '📋 Đề cương bài', '📎 Tài liệu TK']),
            );

            // 3. Bare "Bài 03" without topic does not become "Bài 03: Bài 03"
            const l3 = res.lessons[2];
            expect(l3.displayTitle).toBe('Bài 03');

            // 4. Standalone Lesson
            const l4 = res.lessons[3];
            expect(l4.id).toBe('lesson-standalone');
            expect(l4.originType).toBe('lesson');
            expect(l4.displayTitle).toBe('Bài 04: Ngôn ngữ SQL truy vấn nâng cao');
            expect(l4.questionBankTotal).toBe(6);
        });

        it('enforces fail-closed ownership check when userId does not own the Subject', async () => {
            mockPrisma.subject.findUnique.mockResolvedValue({
                id: 'subj-1',
                userId: 'another-user',
                name: 'Secret Subject',
                syllabus: null,
                lessons: [],
            });

            await expect(
                service.getLessonsOverview(ownerUserId, { subjectId: 'subj-1' }),
            ).rejects.toThrow(NotFoundException);
        });
    });

    describe('Per-lesson quota split, multi-source + full question bank extraction & strict selected-lesson boundary', () => {
        it('splits quota evenly across selected lessons, extracts Slide.optimizedContentJson + SlideAudio + Textbook + Handout + Lesson-Scoped Reference + Full 4-Table Question Bank, and blocks unselected lessons', async () => {
            // Subject has 3 created lessons; user selects ONLY lesson-1 and sl:sl-2 (leaving sl-3 UNSELECTED)
            mockPrisma.subject.findUnique.mockResolvedValue({
                id: 'subj-1',
                userId: ownerUserId,
                name: 'Hệ điều hành',
                majorName: 'Kỹ thuật phần mềm',
                expertiseArea: null,
                language: 'vi',
                syllabus: {
                    id: 'syl-os',
                    references: [
                        {
                            id: 'ref-os',
                            markdownContent: [
                                '# Chương 1: Tiến trình và Điều phối CPU\nTiến trình (Process) là chương trình đang thực thi trong bộ nhớ, gồm PCB, trạng thái Ready/Running/Blocked và thuật toán Round Robin điều phối CPU.',
                                '# Chương 3: Hệ thống File và Quản lý Đĩa từ\nCấu trúc Inode, bảng FAT32, NTFS và thuật toán lập lịch đầu đọc đĩa SCAN, C-SCAN trên ổ cứng.',
                            ].join('\n\n'),
                        },
                    ],
                    lessons: [
                        {
                            id: 'sl-1',
                            sortOrder: 0,
                            title: 'Bài 01: Tiến trình và Điều phối CPU',
                            outline: 'Khái niệm Tiến trình PCB, trạng thái Ready Running, thuật toán điều phối CPU Round Robin',
                            textbookContent: 'Giáo trình Bài 1: PCB lưu ngữ cảnh thanh ghi của tiến trình.',
                            textbookPlan: '{"keyTerms":["PCB","Round Robin"]}',
                            lessonId: 'lesson-1',
                        },
                        {
                            id: 'sl-2',
                            sortOrder: 1,
                            title: 'Bài 02: Đồng bộ hóa Tiến trình & Semaphore',
                            outline: 'Miền găng Critical Section, Mutex và Semaphore của Dijkstra',
                            textbookContent: 'Giáo trình Bài 2: Semaphore gồm hai thao tác nguyên tử wait(S) và signal(S).',
                            textbookPlan: null,
                            lessonId: null,
                        },
                        {
                            id: 'sl-3',
                            sortOrder: 2,
                            title: 'Bài 03: Hệ thống File và Quản lý Đĩa từ',
                            outline: 'Cấu trúc Inode, FAT32, NTFS và lập lịch đĩa SCAN, C-SCAN',
                            textbookContent: 'Giáo trình Bài 3: Inode và C-SCAN...',
                            textbookPlan: null,
                            lessonId: null,
                        },
                    ],
                },
                lessons: [
                    {
                        id: 'lesson-1',
                        title: 'Bài 01: Tiến trình và Điều phối CPU',
                        outlineRaw: 'Khái niệm Tiến trình PCB',
                        detailedOutline: 'Dàn bài mở rộng: So sánh Preemptive và Non-preemptive scheduling.',
                        slideScript: null,
                        createdAt: new Date('2026-09-01T00:00:00Z'),
                        syllabusLesson: { id: 'sl-1', sortOrder: 0 },
                        generatedContents: [
                            {
                                id: 'gc-h1',
                                contentJson: JSON.stringify({
                                    title: 'Tờ rơi Bài 1',
                                    summary: 'Công thức tính Turnaround Time = Completion Time - Arrival Time.',
                                }),
                            },
                        ],
                        questionBank: {
                            questionsJson: JSON.stringify([
                                {
                                    level: 2,
                                    question: 'Câu hỏi từ bảng QuestionBank: Khi lượng tử thời gian q quá lớn, Round Robin suy biến thành thuật toán nào?',
                                    correctAnswer: 'FCFS',
                                    optionB: 'SJF',
                                    optionC: 'SRTF',
                                    optionD: 'Priority',
                                },
                            ]),
                        },
                        _count: {
                            slides: 1,
                            slideAudios: 1,
                            reviewQuestions: 1,
                            englishQuestions: 1,
                            interactiveQuestions: 1,
                        },
                    },
                ],
            });

            // Detailed findUnique for lesson-1
            mockPrisma.lesson.findUnique.mockResolvedValue({
                id: 'lesson-1',
                title: 'Bài 01: Tiến trình và Điều phối CPU',
                outlineRaw: 'Khái niệm Tiến trình PCB',
                detailedOutline: 'Dàn bài mở rộng: So sánh Preemptive và Non-preemptive scheduling.',
                slideScript: null,
                subject: {
                    id: 'subj-1',
                    userId: ownerUserId,
                    name: 'Hệ điều hành',
                    majorName: 'Kỹ thuật phần mềm',
                    syllabus: {
                        lessons: [
                            {
                                id: 'sl-1',
                                sortOrder: 0,
                                title: 'Bài 01: Tiến trình và Điều phối CPU',
                                outline: 'Khái niệm Tiến trình PCB, trạng thái Ready Running, thuật toán điều phối CPU Round Robin',
                                lessonId: 'lesson-1',
                            },
                            {
                                id: 'sl-2',
                                sortOrder: 1,
                                title: 'Bài 02: Đồng bộ hóa Tiến trình & Semaphore',
                                outline: 'Miền găng Critical Section, Mutex và Semaphore của Dijkstra',
                                lessonId: null,
                            },
                            {
                                id: 'sl-3',
                                sortOrder: 2,
                                title: 'Bài 03: Hệ thống File và Quản lý Đĩa từ',
                                outline: 'Cấu trúc Inode, FAT32, NTFS và lập lịch đĩa SCAN, C-SCAN',
                                lessonId: null,
                            },
                        ],
                        references: [
                            {
                                id: 'ref-os',
                                fileName: 'giao-trinh-hdh.pdf',
                                markdownContent: [
                                    '# Chương 1: Tiến trình và Điều phối CPU\nTiến trình (Process) là chương trình đang thực thi trong bộ nhớ, gồm PCB, trạng thái Ready/Running/Blocked và thuật toán Round Robin điều phối CPU.',
                                    '# Chương 3: Hệ thống File và Quản lý Đĩa từ\nCấu trúc Inode, bảng FAT32, NTFS và thuật toán lập lịch đầu đọc đĩa SCAN, C-SCAN trên ổ cứng.',
                                ].join('\n\n'),
                            },
                        ],
                    },
                },
                syllabusLesson: {
                    id: 'sl-1',
                    sortOrder: 0,
                    title: 'Bài 01: Tiến trình và Điều phối CPU',
                    outline: 'Khái niệm Tiến trình PCB, trạng thái Ready Running, thuật toán điều phối CPU Round Robin',
                    textbookContent: 'Giáo trình Bài 1: PCB lưu ngữ cảnh thanh ghi của tiến trình.',
                    textbookPlan: '{"keyTerms":["PCB","Round Robin"]}',
                },
                slides: [
                    {
                        slideIndex: 1,
                        title: 'Cấu trúc khối PCB',
                        content: '', // Empty raw content — must extract from optimizedContentJson!
                        optimizedContentJson: JSON.stringify([
                            {
                                emoji: '🧠',
                                point: 'Program Counter',
                                description: 'Lưu địa chỉ lệnh kế tiếp của tiến trình',
                            },
                        ]),
                        speakerNote: 'Bản nháp lời giảng cũ',
                    },
                ],
                slideAudios: [
                    {
                        slideIndex: 1,
                        speakerNote: 'Lời giảng chuẩn Step 4: Thanh ghi Program Counter luôn được cập nhật khi Context Switch.',
                    },
                ],
                generatedContents: [
                    {
                        id: 'gc-h1',
                        type: 'HANDOUT',
                        contentJson: JSON.stringify({
                            title: 'Tờ rơi Bài 1',
                            summary: 'Công thức tính Turnaround Time = Completion Time - Arrival Time.',
                        }),
                    },
                ],
                reviewQuestions: [
                    {
                        level: 1,
                        questionOrder: 1,
                        question: 'PCB là viết tắt của cụm từ nào?',
                        correctAnswer: 'Process Control Block',
                        optionB: 'Program Counter Block',
                        optionC: 'Process CPU Bus',
                        optionD: 'Primary Control Buffer',
                        explanation: 'PCB là khối điều khiển tiến trình.',
                    },
                ],
                englishQuestions: [
                    {
                        difficulty: 2,
                        questionOrder: 1,
                        questionType: 'MC',
                        questionText: 'Which state comes directly after Ready when dispatched?',
                        dataJson: JSON.stringify({
                            options: [
                                { text: 'Running', isCorrect: true },
                                { text: 'Terminated', isCorrect: false },
                            ],
                        }),
                        explanation: 'Dispatcher moves process from Ready to Running.',
                    },
                ],
                interactiveQuestions: [
                    {
                        questionOrder: 1,
                        questionType: 'MC',
                        questionText: 'Context Switch tiêu tốn thời gian CPU hữu ích hay overhead?',
                        answersJson: JSON.stringify(['Overhead hệ thống', 'Thời gian tính toán ứng dụng']),
                    },
                ],
                questionBank: {
                    questionsJson: JSON.stringify([
                        {
                            level: 2,
                            question: 'Khi lượng tử thời gian q quá lớn, Round Robin suy biến thành thuật toán nào?',
                            correctAnswer: 'FCFS',
                            optionB: 'SJF',
                            optionC: 'SRTF',
                            optionD: 'Priority',
                        },
                    ]),
                },
            });

            // Detailed findUnique for unbridged sl-2
            mockPrisma.syllabusLesson.findUnique.mockResolvedValue({
                id: 'sl-2',
                sortOrder: 1,
                title: 'Bài 02: Đồng bộ hóa Tiến trình & Semaphore',
                outline: 'Miền găng Critical Section, Mutex và Semaphore của Dijkstra',
                textbookContent: 'Giáo trình Bài 2: Semaphore gồm hai thao tác nguyên tử wait(S) và signal(S).',
                textbookPlan: null,
                lessonId: null,
                lesson: null,
                syllabus: {
                    subject: {
                        id: 'subj-1',
                        userId: ownerUserId,
                        name: 'Hệ điều hành',
                        majorName: 'Kỹ thuật phần mềm',
                    },
                    lessons: [
                        {
                            id: 'sl-1',
                            sortOrder: 0,
                            title: 'Bài 01: Tiến trình và Điều phối CPU',
                            outline: 'Khái niệm Tiến trình PCB, trạng thái Ready Running, thuật toán điều phối CPU Round Robin',
                            lessonId: 'lesson-1',
                        },
                        {
                            id: 'sl-2',
                            sortOrder: 1,
                            title: 'Bài 02: Đồng bộ hóa Tiến trình & Semaphore',
                            outline: 'Miền găng Critical Section, Mutex và Semaphore của Dijkstra',
                            lessonId: null,
                        },
                        {
                            id: 'sl-3',
                            sortOrder: 2,
                            title: 'Bài 03: Hệ thống File và Quản lý Đĩa từ',
                            outline: 'Cấu trúc Inode, FAT32, NTFS và lập lịch đĩa SCAN, C-SCAN',
                            lessonId: null,
                        },
                    ],
                    references: [],
                },
            });

            const capturedPrompts: string[] = [];
            mockAiProvider.generateText.mockImplementation(async (prompt: string) => {
                capturedPrompts.push(prompt);
                // Return 4 candidate questions so we also verify quota slicing (3 for lesson 1, 2 for lesson 2)
                return {
                    content: JSON.stringify({
                        questions: [
                            {
                                level: 1,
                                sourceSection: 'Mục 1',
                                question: `Câu mới 1 (${capturedPrompts.length})?`,
                                correctAnswer: 'Đáp án A',
                                optionB: 'Đáp án B',
                                optionC: 'Đáp án C',
                                optionD: 'Đáp án D',
                                explanation: 'Giải thích 1',
                            },
                            {
                                level: 2,
                                sourceSection: 'Mục 2',
                                question: `Câu mới 2 (${capturedPrompts.length})?`,
                                correctAnswer: 'Đáp án A2',
                                optionB: 'Đáp án B2',
                                optionC: 'Đáp án C2',
                                optionD: 'Đáp án D2',
                                explanation: 'Giải thích 2',
                            },
                            {
                                level: 3,
                                sourceSection: 'Mục 3',
                                question: `Câu mới 3 (${capturedPrompts.length})?`,
                                correctAnswer: 'Đáp án A3',
                                optionB: 'Đáp án B3',
                                optionC: 'Đáp án C3',
                                optionD: 'Đáp án D3',
                                explanation: 'Giải thích 3',
                            },
                            {
                                level: 1,
                                sourceSection: 'Mục 4',
                                question: `Câu dư thừa 4 (${capturedPrompts.length})?`,
                                correctAnswer: 'Đáp án A4',
                                optionB: 'Đáp án B4',
                                optionC: 'Đáp án C4',
                                optionD: 'Đáp án D4',
                                explanation: 'Giải thích 4',
                            },
                        ],
                    }),
                };
            });

            mockPrisma.examQuestionSet.create.mockImplementation(async ({ data }: any) => ({
                id: 'exam-set-new',
                ...data,
            }));

            // Run generation for totalCount = 5 across 2 selected lessons (lesson-1 and sl:sl-2) -> 3 + 2 = 5!
            await (service as any).runGenerateExamSetBackground('job-1', ownerUserId, {
                name: 'Kiểm tra Bài 1 - Bài 2',
                categoryName: 'KT_Bai_1_2',
                subjectId: 'subj-1',
                mode: 'REVIEW',
                lessonIds: ['lesson-1', 'sl:sl-2'],
                totalCount: 5,
                level1: 2,
                level2: 2,
                level3: 1,
            });

            expect(capturedPrompts).toHaveLength(2);

            const promptLesson1 = capturedPrompts[0];
            // 1. Multi-source content verification for Lesson 1:
            expect(promptLesson1).toContain('Giáo trình Bài 1: PCB lưu ngữ cảnh thanh ghi của tiến trình.');
            expect(promptLesson1).toContain('Program Counter: Lưu địa chỉ lệnh kế tiếp của tiến trình'); // from Slide.optimizedContentJson!
            expect(promptLesson1).toContain('Lời giảng chuẩn Step 4: Thanh ghi Program Counter luôn được cập nhật khi Context Switch.'); // from SlideAudio!
            expect(promptLesson1).not.toContain('Bản nháp lời giảng cũ'); // SlideAudio prioritized over raw Slide.speakerNote
            expect(promptLesson1).toContain('Turnaround Time = Completion Time - Arrival Time'); // from HANDOUT!
            expect(promptLesson1).toContain('Chương 1: Tiến trình và Điều phối CPU'); // Scoped reference for Lesson 1!
            // Unselected Lesson 3 reference block MUST NOT leak into Lesson 1's reference passages!
            expect(promptLesson1).not.toContain('thuật toán lập lịch đầu đọc đĩa SCAN, C-SCAN trên ổ cứng');

            // 2. Full 4-table Question Bank included in Lesson 1 prompt:
            expect(promptLesson1).toContain('PCB là viết tắt của cụm từ nào?'); // ReviewQuestion
            expect(promptLesson1).toContain('Round Robin suy biến thành thuật toán nào?'); // QuestionBank.questionsJson
            expect(promptLesson1).toContain('Which state comes directly after Ready when dispatched?'); // EnglishQuestion
            expect(promptLesson1).toContain('Running [✓]'); // EnglishQuestion dataJson option
            expect(promptLesson1).toContain('Context Switch tiêu tốn thời gian CPU hữu ích hay overhead?'); // InteractiveQuestion

            // 3. Explicit forbidden unselected-lessons guard:
            expect(promptLesson1).toContain('[PHẠM VI CẤM — CÁC BÀI HỌC KHÔNG ĐƯỢC CHỌN TRONG ĐỀ KIỂM TRA NÀY]');
            expect(promptLesson1).toContain('Bài 03: Hệ thống File và Quản lý Đĩa từ');

            // 4. Unbridged SyllabusLesson (sl:sl-2) generated cleanly in prompt 2:
            const promptLesson2 = capturedPrompts[1];
            expect(promptLesson2).toContain('Giáo trình Bài 2: Semaphore gồm hai thao tác nguyên tử wait(S) và signal(S).');
            expect(promptLesson2).toContain('Bài 03: Hệ thống File và Quản lý Đĩa từ');

            // 5. Saved questions count is strictly 3 + 2 = 5 (evenly split & sliced to exact per-lesson quota!)
            expect(mockPrisma.examQuestionSet.create).toHaveBeenCalledTimes(1);
            const createPayload = mockPrisma.examQuestionSet.create.mock.calls[0][0].data;
            const savedQuestions = JSON.parse(createPayload.questionsJson);
            expect(savedQuestions).toHaveLength(5);
            expect(savedQuestions.filter((q: any) => q.sourceLessonId === 'lesson-1')).toHaveLength(3);
            expect(savedQuestions.filter((q: any) => q.sourceLessonId === 'sl:sl-2')).toHaveLength(2);
            expect(savedQuestions[0].sourceLessonTitle).toBe('Bài 01: Tiến trình và Điều phối CPU');
            expect(savedQuestions[3].sourceLessonTitle).toBe('Bài 02: Đồng bộ hóa Tiến trình & Semaphore');
        });

        it('apportionLevels guarantees level1 + level2 + level3 === count for all edge cases (including count = 1)', () => {
            for (const count of [0, 1, 2, 3, 5, 7, 11, 50]) {
                const res = (service as any).apportionLevels(count, 20, 20, 10);
                expect(res.level1 + res.level2 + res.level3).toBe(count);
                expect(res.level1).toBeGreaterThanOrEqual(0);
                expect(res.level2).toBeGreaterThanOrEqual(0);
                expect(res.level3).toBeGreaterThanOrEqual(0);
            }
            // Specifically verify old rounding bug case: count = 1, weights 50/50/0 must sum to 1 (not 2!)
            const edge = (service as any).apportionLevels(1, 50, 50, 0);
            expect(edge.level1 + edge.level2 + edge.level3).toBe(1);
        });
    });
});
