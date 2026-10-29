import * as fs from 'fs';
import * as path from 'path';
import {
    generateScormManifest,
    generateScormPlayerHtml,
    resolveLocalMediaFile,
} from './scorm-export.helper';
import {
    generateH5pContentJson,
    getAudioMime,
    getImageMime,
} from './h5p-export.helper';

describe('SCORM 1.2 & H5P Full-Slide Canvas and Media Security Helpers', () => {
    describe('resolveLocalMediaFile path traversal guard', () => {
        const tempTestDir = path.join(process.cwd(), 'uploads', '__jest_scorm_test__');
        const tempTestFile = path.join(tempTestDir, 'full_slide_00.png');

        beforeAll(() => {
            fs.mkdirSync(tempTestDir, { recursive: true });
            fs.writeFileSync(tempTestFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        });

        afterAll(() => {
            if (fs.existsSync(tempTestDir)) {
                fs.rmSync(tempTestDir, { recursive: true, force: true });
            }
        });

        it('resolves valid /uploads/... file paths inside the workspace uploads directory (positive proof)', () => {
            const resolved = resolveLocalMediaFile('/uploads/__jest_scorm_test__/full_slide_00.png?t=123');
            expect(resolved).toBe(path.resolve(tempTestFile));
        });

        it('rejects path traversal, percent-encoded traversal, null bytes, and arbitrary absolute paths (negative proof)', () => {
            expect(resolveLocalMediaFile('/uploads/../../etc/passwd')).toBeNull();
            expect(resolveLocalMediaFile('/uploads/%2e%2e/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
            expect(resolveLocalMediaFile('/etc/passwd')).toBeNull();
            expect(resolveLocalMediaFile('/uploads/__jest_scorm_test__/full_slide_00.png\0.txt')).toBeNull();
        });
    });

    describe('SCORM 1.2 Player HTML (full_slide_canvas & Step 5 interactive layouts)', () => {
        it('renders full_slide_canvas for both cover slide (idx=0) and content slides while preserving interactive checkpoint gates', () => {
            const slides = [
                {
                    slideIndex: 1,
                    slideType: 'title',
                    layoutType: 'full_slide_canvas',
                    title: 'UNIT 1: ENGLISH PHONETICS & PHONOLOGY',
                    content: ['Lecturer: Nguyen Van A'],
                    imageUrl: 'images/slide_01.png',
                    audioUrl: 'audio/slide_01.wav',
                },
                {
                    slideIndex: 2,
                    slideType: 'content',
                    layoutType: 'full_slide_canvas',
                    title: 'Vowel Chart /iː/ vs /ɪ/',
                    content: ['Minimal pairs table'],
                    imageUrl: 'images/slide_02.png',
                    audioUrl: 'audio/slide_02.wav',
                    extraAudioUrl: 'audio/sample_02.mp3',
                    extraAudioName: 'Minimal Pair Pronunciation',
                },
                {
                    slideIndex: 3,
                    slideType: 'checkpoint_quiz',
                    layoutType: 'checkpoint_gate',
                    title: 'Kiểm tra chặn bài',
                    content: [],
                    interactiveData: JSON.stringify({
                        isCheckpoint: true,
                        passScore: 1,
                        fallbackSlideIndex: 2,
                        questions: [
                            {
                                type: 'MC',
                                question: 'Which word contains the long vowel /iː/?',
                                options: ['ship', 'sheep', 'sit', 'set'],
                                correctAnswer: 'sheep',
                            },
                        ],
                    }),
                },
            ];

            const html = generateScormPlayerHtml('Phonetics Lesson 1', slides, {
                bgOption: 'tuaf_clean',
                theme: 'light',
            });

            expect(html).toContain('is-full-canvas-slide');
            expect(html).toContain('full-slide-canvas-stage');
            expect(html).toContain('toggleFullSlideStage()');
            expect(html).toContain('"layoutType":"full_slide_canvas"');
            expect(html).toContain('"layoutType":"checkpoint_gate"');
            expect(html).toContain('audio/slide_01.wav');

            const manifest = generateScormManifest('session-123', 'Phonetics Lesson 1', [
                'index.html',
                'images/slide_01.png',
                'audio/slide_01.wav',
            ]);
            expect(manifest).toContain('<file href="images/slide_01.png" />');
            expect(manifest).toContain('<file href="audio/slide_01.wav" />');
        });

        it('renders subtitle lines on traditional non-canvas cover slides without breaking Step 5 cover slides', () => {
            const html = generateScormPlayerHtml('Bài 1: Nhập môn', [
                {
                    slideIndex: 1,
                    slideType: 'title',
                    layoutType: 'split_standard',
                    title: 'HỌC PHẦN: NGỮ ÂM HỌC',
                    content: ['Giảng viên: TS. Nguyễn Văn A', 'Khoa Ngoại ngữ'],
                },
            ]);
            expect(html).toContain('title-slide-subtitles');
            expect(html).toContain('Giảng viên: TS. Nguyễn Văn A');
        });
    });

    describe('H5P Course Presentation Content JSON (full_slide_canvas & dynamic MIME)', () => {
        it('maps dynamic audio and image MIME types accurately', () => {
            expect(getAudioMime('audios/narration_01.wav')).toBe('audio/wav');
            expect(getAudioMime('audios/narration_01.mp3')).toBe('audio/mpeg');
            expect(getAudioMime('audios/sample_01.ogg')).toBe('audio/ogg');
            expect(getImageMime('images/slide_01.png')).toBe('image/png');
            expect(getImageMime('images/slide_01.jpg')).toBe('image/jpeg');
            expect(getImageMime('images/slide_01.webp')).toBe('image/webp');
        });

        it('renders full-bleed H5P.Image (0,0,100,100) for full_slide_canvas cover & content slides without obscuring Slide 1 with tuaf_header_badge', () => {
            const contentJsonStr = generateH5pContentJson(
                'Phonetics Lesson 1',
                [
                    {
                        slideIndex: 1,
                        layoutType: 'full_slide_canvas',
                        title: 'Cover Slide',
                        h5pImagePath: 'images/slide_01.png',
                        h5pAudioPath: 'audios/narration_01.wav',
                    },
                    {
                        slideIndex: 2,
                        layoutType: 'full_slide_canvas',
                        title: 'Slide with Quiz',
                        h5pImagePath: 'images/slide_02.jpg',
                        h5pAudioPath: 'audios/narration_02.mp3',
                        interactiveData: JSON.stringify({
                            questions: [
                                {
                                    type: 'MC',
                                    question: 'Choose /iː/:',
                                    options: ['bit', 'beat'],
                                    correctAnswer: 'beat',
                                },
                            ],
                        }),
                    },
                ],
                { bgOption: 'tuaf_clean', theme: 'light' },
            );

            const parsed = JSON.parse(contentJsonStr);
            const h5pSlides = parsed.presentation.slides;
            expect(h5pSlides).toHaveLength(2);

            // Slide 1: Full-bleed image + WAV narration button, NO tuaf_header_badge overlay
            const slide0Elements = h5pSlides[0].elements;
            expect(slide0Elements.some((el: any) => el.subContentId === 'tuaf_header_badge')).toBe(false);
            const coverImg = slide0Elements.find((el: any) => el.action?.library === 'H5P.Image 1.1');
            expect(coverImg).toBeDefined();
            expect(coverImg.x).toBe(0);
            expect(coverImg.y).toBe(0);
            expect(coverImg.width).toBe(100);
            expect(coverImg.height).toBe(100);
            expect(coverImg.action.params.file.mime).toBe('image/png');

            const coverAudio = slide0Elements.find((el: any) => el.action?.library === 'H5P.Audio 1.5');
            expect(coverAudio).toBeDefined();
            expect(coverAudio.action.params.files[0].mime).toBe('audio/wav');

            // Slide 2: Split full-slide image on left + MultiChoice quiz on right + JPEG/MP3 MIME
            const slide1Elements = h5pSlides[1].elements;
            const slide1Img = slide1Elements.find((el: any) => el.action?.library === 'H5P.Image 1.1');
            const slide1Quiz = slide1Elements.find((el: any) => el.action?.library === 'H5P.MultiChoice 1.16');
            const slide1Audio = slide1Elements.find((el: any) => el.action?.library === 'H5P.Audio 1.5');
            expect(slide1Img.width).toBe(47);
            expect(slide1Img.action.params.file.mime).toBe('image/jpeg');
            expect(slide1Quiz.x).toBe(51);
            expect(slide1Audio.action.params.files[0].mime).toBe('audio/mpeg');
        });

        it('upgrades FIB and CLOZE interactive questions into selectable Word Chips / Inline Dropdowns in SCORM 1.2 & H5P (no free-text typing)', () => {
            const interactiveSlides = [
                {
                    slideIndex: 1,
                    slideType: 'checkpoint_quiz',
                    layoutType: 'checkpoint_gate',
                    title: 'Grammar Checkpoint',
                    interactiveData: JSON.stringify({
                        isCheckpoint: true,
                        passScore: 2,
                        fallbackSlideIndex: 1,
                        questions: [
                            {
                                id: 'q1',
                                type: 'FIB',
                                question: 'Yesterday, I [.....] (go) to the library.',
                                correctAnswer: 'went',
                            },
                            {
                                id: 'q2',
                                type: 'CLOZE',
                                question: 'Chọn từ thích hợp cho đoạn hội thoại:',
                                passage: 'A: Good morning, how are [you]?\nB: I am [fine], thank you.',
                            },
                        ],
                    }),
                },
            ];

            // 1. SCORM 1.2 verification: normalized SLIDES JSON contains 4 FIB options & CLOZE distractors, and player uses fib-word-chip & cloze-inline-select
            const scormHtml = generateScormPlayerHtml('Grammar Lesson', interactiveSlides);
            expect(scormHtml).toContain('fib-word-chip');
            expect(scormHtml).toContain('selectGateFIBChip');
            expect(scormHtml).toContain('checkFIBChipPractice');
            expect(scormHtml).toContain('cloze-inline-select');
            expect(scormHtml).toContain('"correctAnswer":"went"');
            expect(scormHtml).toContain('"went"');
            expect(scormHtml).toContain('"distractors":[');

            // 2. H5P verification: both FIB and CLOZE produce H5P.MultiChoice 1.16 with >= 4 selectable answers and 1 correct choice
            const h5pFibJson = JSON.parse(generateH5pContentJson('Grammar FIB', interactiveSlides));
            const fibQuizEl = h5pFibJson.presentation.slides[0].elements.find(
                (el: any) => el.action?.library === 'H5P.MultiChoice 1.16',
            );
            expect(fibQuizEl).toBeDefined();
            expect(fibQuizEl.action.params.answers.length).toBe(4);
            expect(fibQuizEl.action.params.answers.filter((a: any) => a.correct).length).toBe(1);

            const h5pClozeJson = JSON.parse(
                generateH5pContentJson('Grammar CLOZE', [
                    {
                        slideIndex: 1,
                        title: 'Dialogue Cloze',
                        interactiveData: JSON.stringify({
                            questions: [
                                {
                                    id: 'q1',
                                    type: 'CLOZE',
                                    question: 'Hoàn thành hội thoại:',
                                    passage: 'A: How are [you]?\nB: I am [fine], thanks.',
                                },
                            ],
                        }),
                    },
                ]),
            );
            const clozeQuizEl = h5pClozeJson.presentation.slides[0].elements.find(
                (el: any) => el.action?.library === 'H5P.MultiChoice 1.16',
            );
            expect(clozeQuizEl).toBeDefined();
            expect(clozeQuizEl.action.params.answers.length).toBeGreaterThanOrEqual(2);
            expect(clozeQuizEl.action.params.answers.filter((a: any) => a.correct).length).toBe(1);
        });

        it('completely removes Đại học Nông Lâm / TUAF branding text in minimal mode while keeping it in tuaf_clean mode', () => {
            const sampleLessonSlides = [
                {
                    slideIndex: 1,
                    slideType: 'title',
                    title: 'Introduction to Artificial Intelligence',
                    content: ['Module 1 — Fundamentals'],
                },
                {
                    slideIndex: 2,
                    slideType: 'content',
                    title: 'Machine Learning Basics',
                    content: ['Supervised learning', 'Unsupervised learning'],
                },
            ];

            // Minimal mode (for external institutions): ZERO Nông Lâm / Thái Nguyên text in SCORM & H5P
            const scormMinimal = generateScormPlayerHtml('Introduction to AI', sampleLessonSlides, {
                bgOption: 'minimal',
                theme: 'light',
            });
            expect(scormMinimal).not.toMatch(/đại học nông lâm|nông lâm|thái nguyên/i);
            expect(scormMinimal).not.toContain('<div class="tuaf-header-brand">');
            expect(scormMinimal).toContain('HỌC LIỆU SỐ TƯƠNG TÁC');

            const h5pMinimalRaw = generateH5pContentJson('Introduction to AI', sampleLessonSlides, {
                bgOption: 'minimal',
                theme: 'light',
            });
            expect(h5pMinimalRaw).not.toMatch(/đại học nông lâm|nông lâm|thái nguyên|tuaf/i);
            expect(h5pMinimalRaw).toContain('HỌC LIỆU SỐ TƯƠNG TÁC');

            // Default TUAF Clean mode: keeps university branding
            const scormTuaf = generateScormPlayerHtml('Introduction to AI', sampleLessonSlides, {
                bgOption: 'tuaf_clean',
                theme: 'light',
            });
            expect(scormTuaf).toContain('ĐẠI HỌC NÔNG LÂM THÁI NGUYÊN');

            const h5pTuafRaw = generateH5pContentJson('Introduction to AI', sampleLessonSlides, {
                bgOption: 'tuaf_clean',
                theme: 'light',
            });
            expect(h5pTuafRaw).toContain('ĐẠI HỌC NÔNG LÂM THÁI NGUYÊN');
        });
    });
});
