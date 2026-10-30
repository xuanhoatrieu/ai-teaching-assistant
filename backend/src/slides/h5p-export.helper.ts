/**
 * H5P Course Presentation Package Generator
 * 
 * Generates an H5P compliant archive (.h5p) ready for Moodle's native H5P activity.
 * Bundles slide images, structured text content bullets, narration audio, 
 * extra sample audio, and interactive quizzes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveLocalMediaFile } from './scorm-export.helper';
import { normalizeInteractiveQuestions } from '../questions/moodle-xml.helper';

const archiver = require('archiver');

export interface H5pExportOptions {
    templateId?: string;
    templateName?: string;
    titleBgUrl?: string;
    contentBgUrl?: string;
    bgOption?: string; // 'tuaf_clean' | 'tuaf_full' | 'minimal' | 'custom'
    theme?: string; // 'light' | 'dark'
    hasTitleBg?: boolean;
    hasContentBg?: boolean;
    titleBgFilename?: string;
    contentBgFilename?: string;
}

function escapeHtml(str: string): string {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function getAudioMime(filePath?: string): string {
    const ext = path.extname(filePath || '').toLowerCase();
    switch (ext) {
        case '.wav':
            return 'audio/wav';
        case '.ogg':
            return 'audio/ogg';
        case '.m4a':
        case '.mp4':
            return 'audio/mp4';
        case '.webm':
            return 'audio/webm';
        default:
            return 'audio/mpeg';
    }
}

export function getImageMime(filePath?: string): string {
    const ext = path.extname(filePath || '').toLowerCase();
    switch (ext) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.webp':
            return 'image/webp';
        case '.gif':
            return 'image/gif';
        case '.svg':
            return 'image/svg+xml';
        default:
            return 'image/png';
    }
}

export function generateH5pJson(lessonTitle: string): string {
    return JSON.stringify({
        title: lessonTitle || 'Bài giảng tương tác',
        language: 'vi',
        mainLibrary: 'H5P.CoursePresentation',
        embedTypes: ['iframe'],
        license: 'U',
        defaultLanguage: 'vi',
        preloadedDependencies: [
            { machineName: 'H5P.CoursePresentation', majorVersion: 1, minorVersion: 25 },
            { machineName: 'H5P.JoubelUI', majorVersion: 1, minorVersion: 3 },
            { machineName: 'H5P.AdvancedText', majorVersion: 1, minorVersion: 1 },
            { machineName: 'H5P.Image', majorVersion: 1, minorVersion: 1 },
            { machineName: 'H5P.Audio', majorVersion: 1, minorVersion: 5 },
            { machineName: 'H5P.MultiChoice', majorVersion: 1, minorVersion: 16 },
            { machineName: 'FontAwesome', majorVersion: 4, minorVersion: 5 },
        ]
    }, null, 2);
}

export function generateH5pContentJson(lessonTitle: string, slides: any[], options?: H5pExportOptions): string {
    const isDarkTheme = options?.theme === 'dark';
    const isMinimal = options?.bgOption === 'minimal';
    const isTuafBranded = !options?.bgOption || options?.bgOption === 'tuaf_clean' || options?.bgOption === 'tuaf_full';
    const isTuafFullTitle = options?.bgOption === 'tuaf_full' && Boolean(options?.hasTitleBg);
    const isTuafFullContent = options?.bgOption === 'tuaf_full' && Boolean(options?.hasContentBg);
    const useLightBodySurface = !isDarkTheme || isTuafFullContent;
    const titleColor = isDarkTheme ? '#52b788' : '#005a36';
    const pointColor = useLightBodySurface ? '#0f172a' : '#ffffff';
    const descColor = useLightBodySurface ? '#334155' : '#cbd5e1';
    const textColor = useLightBodySurface ? '#1e293b' : '#f8fafc';
    const bodyTopY = isTuafFullContent ? 17 : 14;
    const bodyHeight = isTuafFullContent ? 79 : 82;

    const h5pSlides = slides.map((s, idx) => {
        const elements: any[] = [];

        // 1. Check interactive quiz questions
        let questions: any[] = [];
        let interaction: any = null;
        if (s.interactiveData) {
            try {
                interaction = typeof s.interactiveData === 'string' ? JSON.parse(s.interactiveData) : s.interactiveData;
                if (Array.isArray(interaction.questions)) {
                    questions = normalizeInteractiveQuestions(interaction.questions);
                }
            } catch (e) {}
        }
        const hasQuiz = questions.length > 0;
        const isCheckpoint = s.slideType === 'checkpoint_quiz' || (interaction && (interaction.activityType === 'checkpoint_quiz' || interaction.isCheckpoint === true));
        const hideSolutions = isCheckpoint || (interaction && interaction.hideSolutions === true);
        const passScore = (interaction && interaction.passScore !== undefined)
            ? Number(interaction.passScore)
            : (isCheckpoint ? Math.max(1, Math.min(questions.length, 4)) : 0);
        const fallbackSlideIndex = (interaction && interaction.fallbackSlideIndex !== undefined)
            ? Number(interaction.fallbackSlideIndex)
            : Math.max(1, s.slideIndex - 1);

        const layoutType = s.layoutType || (isCheckpoint ? 'checkpoint_gate' : (s.extraAudioUrl ? 'audio_lab' : 'split_standard'));

        // 2. Extract bullets / text content
        let bullets: Array<{ emoji?: string; point: string; description?: string }> = [];
        if (Array.isArray(s.bullets)) {
            bullets = s.bullets;
        } else if (s.optimizedContentJson) {
            try {
                const opt = typeof s.optimizedContentJson === 'string' ? JSON.parse(s.optimizedContentJson) : s.optimizedContentJson;
                if (Array.isArray(opt.bullets)) bullets = opt.bullets;
                else if (Array.isArray(opt)) bullets = opt;
            } catch (e) {}
        }
        if (bullets.length === 0 && s.content) {
            const lines = Array.isArray(s.content) ? s.content : (typeof s.content === 'string' ? s.content.split('\n') : []);
            bullets = lines
                .filter((l: any) => typeof l === 'string' && l.trim())
                .map((l: string) => ({
                    emoji: '📌',
                    point: l.replace(/^[-*•]\s*/, '').trim(),
                    description: '',
                }));
        }

        const suppressCoverAiImage = isTuafFullTitle && idx === 0 && layoutType !== 'full_slide_canvas';
        const hasBullets = bullets.length > 0;
        const hasImage = !suppressCoverAiImage && !!s.h5pImagePath;
        const hasAudio = !!s.h5pAudioPath;
        const hasSampleAudio = !!s.h5pSampleAudioPath;
        const slideTitleText = s.title || `Slide ${s.slideIndex}`;

        // Helper: Image Element (dynamic MIME)
        const addImageElement = (x: number, y: number, width: number, height: number) => {
            if (!hasImage) return;
            elements.push({
                x, y, width, height,
                action: {
                    library: 'H5P.Image 1.1',
                    params: {
                        contentName: 'Slide Visual',
                        file: {
                            path: s.h5pImagePath,
                            mime: getImageMime(s.h5pImagePath),
                            copyright: { license: 'U' },
                            width: 1920,
                            height: 1080
                        },
                        alt: slideTitleText
                    },
                    subContentId: `img_${idx}`
                }
            });
        };

        // Helper: Compact top-right Narration Audio Button (dynamic MIME)
        const addNarrationAudioButton = (customY?: number) => {
            if (!hasAudio) return;
            const audioY = customY !== undefined ? customY : (isTuafFullContent && idx > 0 ? 4.5 : 2.5);
            elements.push({
                x: 93.5,
                y: audioY,
                width: 4,
                height: 6,
                action: {
                    library: 'H5P.Audio 1.5',
                    params: {
                        playerMode: 'minimalistic',
                        fitToWrapper: false,
                        controls: false,
                        autoplay: false,
                        title: 'Nghe lời giảng',
                        files: [
                            {
                                path: s.h5pAudioPath,
                                mime: getAudioMime(s.h5pAudioPath),
                                copyright: { license: 'U' }
                            }
                        ]
                    },
                    subContentId: `audio_narration_${idx}`
                }
            });
        };

        // Helper: Quiz Element
        const addQuizElement = (quizX: number, quizY: number, quizWidth: number, quizHeight: number) => {
            if (!hasQuiz) return;
            const firstQ = questions[0];
            const qType = (firstQ.type || 'MC').toUpperCase();
            let typeBadgeHtml = '';
            let isMultipleResponse = false;
            let optionsToUse: string[] = Array.isArray(firstQ.options) ? [...firstQ.options] : [];
            let displayQuestionText = String(firstQ.question || '');
            let overrideCorrectAnswers: string[] | null = null;

            if (qType === 'TF') {
                typeBadgeHtml = '<span style="background: rgba(14, 165, 233, 0.15); color: #0369a1; font-size: 0.75em; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">Đúng / Sai</span>';
                if (!optionsToUse || optionsToUse.length < 2) {
                    optionsToUse = ['Đúng', 'Sai'];
                }
            } else if (qType === 'MR') {
                isMultipleResponse = true;
                typeBadgeHtml = '<span style="background: rgba(168, 85, 247, 0.15); color: #7e22ce; font-size: 0.75em; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">Chọn nhiều đáp án</span>';
            } else if (qType === 'FIB') {
                typeBadgeHtml = '<span style="background: rgba(245, 158, 11, 0.15); color: #b45309; font-size: 0.75em; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">Chọn từ điền khuyết</span>';
            } else if (qType === 'MATCH') {
                typeBadgeHtml = '<span style="background: rgba(236, 72, 153, 0.15); color: #be185d; font-size: 0.75em; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">Nối cặp</span>';
            } else if (qType === 'ORDER') {
                typeBadgeHtml = '<span style="background: rgba(6, 182, 212, 0.15); color: #0e7490; font-size: 0.75em; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">Sắp xếp từ</span>';
                if ((!optionsToUse || optionsToUse.length === 0) && firstQ.correctSentence) {
                    optionsToUse = [firstQ.correctSentence];
                }
            } else if (qType === 'CLOZE') {
                typeBadgeHtml = '<span style="background: rgba(217, 70, 239, 0.15); color: #a21caf; font-size: 0.75em; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">Chọn từ điền hội thoại</span>';
                const rawPassage = String(firstQ.passage || firstQ.questionText || '');
                if (rawPassage) {
                    let bNum = 0;
                    const blankAnswers: string[] = [];
                    const maskedPassage = rawPassage.replace(/\[([^\]]+)\]/g, (_m, inner) => {
                        bNum++;
                        const primary = String(inner).split('|')[0].trim();
                        blankAnswers.push(primary);
                        return `(${bNum}) [.....]`;
                    });
                    displayQuestionText = `${displayQuestionText ? displayQuestionText + ' — ' : ''}${maskedPassage.replace(/\r?\n/g, ' / ')}`;

                    if (optionsToUse.length === 0 && blankAnswers.length > 0) {
                        const distractors: string[] = Array.isArray(firstQ.distractors) ? firstQ.distractors : [];
                        if (blankAnswers.length === 1) {
                            const corr = blankAnswers[0];
                            optionsToUse = [corr, ...distractors.filter((d) => d.toLowerCase() !== corr.toLowerCase()).slice(0, 3)];
                            overrideCorrectAnswers = [corr];
                        } else {
                            const formatTuple = (arr: string[]) => arr.map((w, i) => `(${i + 1}) ${w}`).join(' — ');
                            const corrTuple = formatTuple(blankAnswers);
                            const pool = [...blankAnswers, ...distractors];
                            const wrongTuples: string[] = [];
                            for (let shift = 1; shift <= 3 && pool.length >= blankAnswers.length; shift++) {
                                const candidate = blankAnswers.map((_, i) => pool[(i + shift) % pool.length]);
                                const tup = formatTuple(candidate);
                                if (tup.toLowerCase() !== corrTuple.toLowerCase() && !wrongTuples.includes(tup)) {
                                    wrongTuples.push(tup);
                                }
                            }
                            optionsToUse = [corrTuple, ...wrongTuples];
                            overrideCorrectAnswers = [corrTuple];
                        }
                    }
                }
            } else {
                typeBadgeHtml = '<span style="background: rgba(99, 102, 241, 0.15); color: #4338ca; font-size: 0.75em; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">Chọn 1 đáp án</span>';
            }

            const correctAnswersList: string[] = overrideCorrectAnswers
                ? overrideCorrectAnswers
                : (isMultipleResponse
                    ? (firstQ.correctAnswers || [firstQ.correctAnswer || ''])
                    : [firstQ.correctAnswer || '']);

            elements.push({
                x: quizX,
                y: quizY,
                width: quizWidth,
                height: quizHeight,
                action: {
                    library: 'H5P.MultiChoice 1.16',
                    params: {
                        question: `<p style="font-size: 1.05em; font-weight: 700; color: #0f172a; margin: 0 0 10px 0;">${escapeHtml(displayQuestionText)} ${typeBadgeHtml}</p>`,
                        answers: optionsToUse.map((opt: string) => {
                            const cleanOpt = opt.trim().toLowerCase();
                            const isCorrect = correctAnswersList.some(ca => (ca || '').trim().toLowerCase() === cleanOpt);
                            return {
                                text: `<div>${escapeHtml(opt)}</div>`,
                                correct: isCorrect,
                                tipsAndFeedback: {
                                    tip: '',
                                    chosenFeedback: isCorrect
                                        ? `<div>✅ Chính xác! ${escapeHtml(firstQ.explanation || '')}</div>`
                                        : (hideSolutions
                                            ? `<div>❌ Chưa chính xác. Vui lòng xem lại nội dung tại Slide ${fallbackSlideIndex} để ôn tập!</div>`
                                            : `<div>❌ Chưa đúng. ${escapeHtml(firstQ.explanation || '')}</div>`)
                                }
                            };
                        }),
                        behaviour: {
                            enableRetry: true,
                            enableSolutionsButton: !hideSolutions,
                            singlePoint: !isMultipleResponse,
                            randomAnswers: false,
                            showSolutionsRequiresInput: true
                        },
                        UI: {
                            checkAnswerButton: 'Kiểm tra',
                            showSolutionButton: 'Xem đáp án',
                            tryAgainButton: 'Thử lại'
                        }
                    },
                    subContentId: `quiz_${idx}`
                }
            });
        };

        // Full-Slide Canvas Layout (100% faithful original PowerPoint visual rendering, including Slide 1 cover)
        if (layoutType === 'full_slide_canvas' && hasImage) {
            if (hasQuiz) {
                elements.push({
                    x: 3,
                    y: 3,
                    width: hasAudio ? 89 : 94,
                    height: 8,
                    action: {
                        library: 'H5P.AdvancedText 1.1',
                        params: {
                            text: `<h2 style="margin: 0; padding: 0; font-size: 1.3em; line-height: 1.25; color: ${titleColor}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 700;">${escapeHtml(slideTitleText)}</h2>`
                        },
                        subContentId: `title_${idx}`
                    }
                });
                addImageElement(2, 13, 47, hasSampleAudio ? 73 : 83);
                if (hasSampleAudio) {
                    elements.push({
                        x: 2,
                        y: 87,
                        width: 47,
                        height: 10,
                        action: {
                            library: 'H5P.Audio 1.5',
                            params: {
                                playerMode: 'full',
                                fitToWrapper: true,
                                controls: true,
                                autoplay: false,
                                title: s.extraAudioName || 'Đoạn audio mẫu thực hành',
                                files: [{ path: s.h5pSampleAudioPath, mime: getAudioMime(s.h5pSampleAudioPath), copyright: { license: 'U' } }]
                            },
                            subContentId: `sample_audio_${idx}`
                        }
                    });
                }
                addQuizElement(51, 13, 47, 83);
            } else {
                addImageElement(0, 0, 100, hasSampleAudio ? 86 : 100);
                if (hasSampleAudio) {
                    elements.push({
                        x: 8,
                        y: 88,
                        width: 84,
                        height: 10,
                        action: {
                            library: 'H5P.Audio 1.5',
                            params: {
                                playerMode: 'full',
                                fitToWrapper: true,
                                controls: true,
                                autoplay: false,
                                title: s.extraAudioName || 'Đoạn audio mẫu thực hành',
                                files: [{ path: s.h5pSampleAudioPath, mime: getAudioMime(s.h5pSampleAudioPath), copyright: { license: 'U' } }]
                            },
                            subContentId: `sample_audio_${idx}`
                        }
                    });
                }
            }
            addNarrationAudioButton();
            return {
                elements,
                keywords: [{ main: slideTitleText }]
            };
        }

        // Special Layout for Slide 1 with TUAF Original Cover Background #1 (tuaf_full):
        // Suppress AI image, badge, and subtitles; display ONLY lesson title centered in middle green stage (matching PPTX _add_title_slide)
        if (idx === 0 && isTuafFullTitle && !hasQuiz) {
            const coverTitleText = (s.title && !/^slide\s*1$/i.test(String(s.title).trim()))
                ? s.title
                : (lessonTitle || slideTitleText);

            elements.push({
                x: 10,
                y: 34,
                width: 76,
                height: 32,
                action: {
                    library: 'H5P.AdvancedText 1.1',
                    params: {
                        text: `<div style="height: 100%; min-height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; background: transparent; font-family: Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                            <h1 style="margin: 0; padding: 0; font-size: 2.35em; line-height: 1.3; color: #ffffff; font-weight: 700; text-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);">${escapeHtml(coverTitleText)}</h1>
                        </div>`
                    },
                    subContentId: `title_${idx}`
                }
            });

            addNarrationAudioButton(23.5);

            return { elements, keywords: [{ main: coverTitleText }] };
        }

        // Special Layout for Slide 1 (idx === 0: Traditional Cover / Title Slide when no quiz is attached)
        if (idx === 0 && !hasQuiz) {
            const badgeBg = isDarkTheme ? 'rgba(45, 106, 79, 0.35)' : 'rgba(0, 90, 54, 0.12)';
            const badgeColor = isDarkTheme ? '#95d5b2' : '#005a36';
            const subtitleHtml = hasBullets
                ? `<div style="margin-top: 14px;">${bullets.map(b => {
                    const pt = (b.point || '').trim();
                    const ds = (b.description || '').trim();
                    const line = (ds && ds.toLowerCase() !== pt.toLowerCase()) ? (pt ? `${pt} — ${ds}` : ds) : pt;
                    return line ? `<p style="margin: 6px 0 0 0; font-size: 1.05em; color: ${descColor}; line-height: 1.45;">${escapeHtml(line)}</p>` : '';
                }).join('')}</div>`
                : '';

            const titleBadgeLabel = isMinimal
                ? '🎓 HỌC LIỆU SỐ TƯƠNG TÁC • BÀI GIẢNG ĐIỆN TỬ'
                : '🌱 ĐẠI HỌC NÔNG LÂM THÁI NGUYÊN • BÀI GIẢNG ĐIỆN TỬ';

            // 1. Centered Title Card
            elements.push({
                x: 6,
                y: hasBullets ? 22 : 30,
                width: 88,
                height: hasBullets ? 56 : 40,
                action: {
                    library: 'H5P.AdvancedText 1.1',
                    params: {
                        text: `<div style="text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                            <div style="display: inline-block; padding: 4px 16px; border-radius: 999px; background: ${badgeBg}; color: ${badgeColor}; font-size: 0.9em; font-weight: 700; margin-bottom: 18px;">${titleBadgeLabel}</div>
                            <h1 style="margin: 0; padding: 0; font-size: 2.4em; line-height: 1.35; color: ${titleColor}; font-weight: 800;">${escapeHtml(slideTitleText)}</h1>
                            ${subtitleHtml}
                        </div>`
                    },
                    subContentId: `title_${idx}`
                }
            });

            // 2. Narration Audio Button (plays audio for slide 1!)
            addNarrationAudioButton();

            return { elements, keywords: [{ main: slideTitleText }] };
        }

        // 3. Slide Title (For tuaf_full content slides: transparent box, white centered text aligned inside top green banner 0..15.46%)
        if (isTuafFullContent) {
            elements.push({
                x: 9,
                y: 2.2,
                width: 82,
                height: 11,
                action: {
                    library: 'H5P.AdvancedText 1.1',
                    params: {
                        text: `<div style="height: 100%; min-height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; background: transparent;">
                            <h2 style="margin: 0; padding: 0; font-size: 1.4em; line-height: 1.25; color: #ffffff; font-family: Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 700; text-align: center;">${escapeHtml(slideTitleText)}</h2>
                        </div>`
                    },
                    subContentId: `title_${idx}`
                }
            });
        } else {
            elements.push({
                x: 3,
                y: 3,
                width: hasAudio ? 89 : 94,
                height: 8,
                action: {
                    library: 'H5P.AdvancedText 1.1',
                    params: {
                        text: `<h2 style="margin: 0; padding: 0; font-size: 1.3em; line-height: 1.25; color: ${titleColor}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 700;">${escapeHtml(slideTitleText)}</h2>`
                    },
                    subContentId: `title_${idx}`
                }
            });
        }

        // 4. Narration Audio Button (Compact top-right icon, not stretched)
        addNarrationAudioButton();

        // 5. Build Content Text HTML without <ul>/<li> to avoid browser bullet circles,
        // and avoid printing duplicate description when identical to point
        let contentHtml = '';
        if (hasBullets) {
            const bulletGap = bullets.length <= 3 ? '22px' : '14px';
            const itemsHtml = bullets.map(b => {
                const point = (b.point || '').trim();
                const desc = (b.description || '').trim();
                const isDistinct = desc && desc.toLowerCase() !== point.toLowerCase();
                const emoji = b.emoji || '📌';

                return `
                    <div style="margin-bottom: ${bulletGap}; line-height: 1.5; color: ${textColor};">
                        <p style="margin: 0 0 4px 0; font-size: 1.05em; line-height: 1.35;">
                            <span style="font-size: 1.15em; margin-right: 6px;">${emoji}</span>
                            <strong style="color: ${pointColor};">${escapeHtml(point)}</strong>
                        </p>
                        ${isDistinct ? `<p style="margin: 0 0 0 26px; font-size: 0.9em; color: ${descColor}; line-height: 1.45;">${escapeHtml(desc)}</p>` : ''}
                    </div>
                `;
            }).join('');

            contentHtml = `
                <div style="height: 100%; min-height: 100%; display: flex; flex-direction: column; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-sizing: border-box; padding-top: 4px;">
                    ${itemsHtml}
                </div>
            `;
        }

        // 6. Layout Routing based on layoutType:
        if (layoutType === 'checkpoint_gate' || (hasQuiz && isCheckpoint)) {
            // Layout 1: Checkpoint Gate (Full-width Mastery Gate)
            const gateTopY = isTuafFullContent ? 17 : 13;
            const gateQuizY = isTuafFullContent ? 28 : 25;
            const gateQuizH = isTuafFullContent ? 68 : 71;
            elements.push({
                x: 6,
                y: gateTopY,
                width: 88,
                height: 10,
                action: {
                    library: 'H5P.AdvancedText 1.1',
                    params: {
                        text: `
                            <div style="background: rgba(99, 102, 241, 0.08); border-left: 4px solid #6366f1; border-radius: 6px; padding: 8px 14px; font-family: -apple-system, sans-serif; font-size: 0.9em; color: #1e293b; line-height: 1.4;">
                                <strong>🎯 Kiểm tra chặn bài (Mastery Gate):</strong> Đạt ít nhất <strong>${passScore}/${questions.length} câu</strong> để mở khóa bài học tiếp theo. Nếu chưa đạt, bạn cần quay lại <strong>Slide ${fallbackSlideIndex}</strong> để ôn tập.
                            </div>
                        `
                    },
                    subContentId: `gate_banner_${idx}`
                }
            });
            addQuizElement(6, gateQuizY, 88, gateQuizH);

        } else if (layoutType === 'audio_lab' || hasSampleAudio) {
            // Layout 2: Audio Lab (Central sample audio + prompt/quiz)
            const audioBarY = bodyTopY;
            const audioContentY = bodyTopY + 11;
            const audioContentH = 95 - audioContentY;
            elements.push({
                x: 8,
                y: audioBarY,
                width: 84,
                height: 9,
                action: {
                    library: 'H5P.Audio 1.5',
                    params: {
                        playerMode: 'full',
                        fitToWrapper: true,
                        controls: true,
                        autoplay: false,
                        title: s.extraAudioName || 'Đoạn audio mẫu thực hành',
                        files: [{ path: s.h5pSampleAudioPath, mime: getAudioMime(s.h5pSampleAudioPath), copyright: { license: 'U' } }]
                    },
                    subContentId: `sample_audio_${idx}`
                }
            });

            if (hasQuiz) {
                elements.push({
                    x: 8,
                    y: audioContentY,
                    width: 42,
                    height: audioContentH,
                    action: {
                        library: 'H5P.AdvancedText 1.1',
                        params: { text: contentHtml },
                        subContentId: `content_${idx}`
                    }
                });
                addQuizElement(52, audioContentY, 42, audioContentH);
            } else {
                elements.push({
                    x: 8,
                    y: audioContentY,
                    width: 84,
                    height: audioContentH,
                    action: {
                        library: 'H5P.AdvancedText 1.1',
                        params: { text: contentHtml },
                        subContentId: `content_${idx}`
                    }
                });
            }

        } else if (layoutType === 'split_reversed') {
            // Layout 3: Split Reversed (Left Image, Right Text)
            addImageElement(4, bodyTopY, 45, bodyHeight);
            elements.push({
                x: 51,
                y: bodyTopY,
                width: 45,
                height: bodyHeight,
                action: {
                    library: 'H5P.AdvancedText 1.1',
                    params: { text: contentHtml },
                    subContentId: `content_${idx}`
                }
            });

        } else if (layoutType === 'comparison_3col') {
            // Layout 4: Comparison 3 Columns (Bento Cards)
            const cardsHtml = bullets.map(b => `
                <div style="background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 8px; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px;">
                    <div style="font-size: 1.05em; font-weight: 700; color: #1e293b; border-bottom: 1px solid rgba(0,0,0,0.06); padding-bottom: 6px;">
                        <span>${b.emoji || '📌'}</span> ${escapeHtml(b.point)}
                    </div>
                    <div style="font-size: 0.9em; color: #475569; line-height: 1.45;">
                        ${escapeHtml(b.description || '')}
                    </div>
                </div>
            `).join('');

            const comparisonHtml = `
                <div style="height: 100%; min-height: 100%; display: flex; flex-direction: column; justify-content: center; box-sizing: border-box;">
                    <div style="display: grid; grid-template-columns: repeat(${Math.min(3, Math.max(1, bullets.length))}, 1fr); gap: 14px; font-family: -apple-system, sans-serif; padding-top: 6px;">
                        ${cardsHtml}
                    </div>
                </div>
            `;

            elements.push({
                x: 4,
                y: bodyTopY,
                width: 92,
                height: bodyHeight,
                action: {
                    library: 'H5P.AdvancedText 1.1',
                    params: { text: comparisonHtml },
                    subContentId: `comparison_${idx}`
                }
            });

        } else if (layoutType === 'hero_infographic') {
            // Layout 5: Hero Infographic (Large visual on top, takeaway bullets below)
            if (hasImage) {
                const heroImgH = isTuafFullContent ? 48 : 50;
                const heroTextY = bodyTopY + heroImgH + 2;
                addImageElement(6, bodyTopY, 88, heroImgH);
                elements.push({
                    x: 6,
                    y: heroTextY,
                    width: 88,
                    height: 96 - heroTextY,
                    action: {
                        library: 'H5P.AdvancedText 1.1',
                        params: { text: contentHtml },
                        subContentId: `content_${idx}`
                    }
                });
            } else {
                elements.push({
                    x: 6,
                    y: bodyTopY,
                    width: 88,
                    height: bodyHeight,
                    action: {
                        library: 'H5P.AdvancedText 1.1',
                        params: { text: contentHtml },
                        subContentId: `content_${idx}`
                    }
                });
            }

        } else if (layoutType === 'process_steps') {
            // Layout 6: Process Steps (Numbered Timeline)
            const stepsHtml = bullets.map((b, bIdx) => `
                <div style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; background: rgba(248, 250, 252, 0.8); border: 1px solid rgba(226, 232, 240, 1); border-radius: 8px; padding: 10px 14px;">
                    <div style="width: 24px; height: 24px; border-radius: 50%; background: #6366f1; color: #fff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        ${bIdx + 1}
                    </div>
                    <div>
                        <div style="font-size: 0.95em; font-weight: 600; color: #0f172a; margin-bottom: 2px;">
                            ${b.emoji || '⚡'} ${escapeHtml(b.point)}
                        </div>
                        <div style="font-size: 0.85em; color: #475569; line-height: 1.4;">
                            ${escapeHtml(b.description || '')}
                        </div>
                    </div>
                </div>
            `).join('');

            const timelineHtml = `
                <div style="height: 100%; min-height: 100%; display: flex; flex-direction: column; justify-content: center; box-sizing: border-box; font-family: -apple-system, sans-serif; padding-top: 4px;">
                    ${stepsHtml}
                </div>
            `;

            elements.push({
                x: 4,
                y: bodyTopY,
                width: hasImage ? 46 : 92,
                height: bodyHeight,
                action: {
                    library: 'H5P.AdvancedText 1.1',
                    params: { text: timelineHtml },
                    subContentId: `timeline_${idx}`
                }
            });

            if (hasImage) {
                addImageElement(52, bodyTopY, 44, bodyHeight);
            }

        } else {
            // Layout 7: Split Standard (Text on Left, Image/Quiz on Right) - Default
            if (hasQuiz) {
                if (hasBullets) {
                    elements.push({
                        x: 4,
                        y: bodyTopY,
                        width: 46,
                        height: bodyHeight,
                        action: {
                            library: 'H5P.AdvancedText 1.1',
                            params: { text: contentHtml },
                            subContentId: `content_${idx}`
                        }
                    });
                    addQuizElement(52, bodyTopY, 44, bodyHeight);
                } else if (hasImage) {
                    addImageElement(4, bodyTopY, 46, bodyHeight);
                    addQuizElement(52, bodyTopY, 44, bodyHeight);
                } else {
                    addQuizElement(6, bodyTopY, 88, bodyHeight);
                }
            } else if (hasBullets && hasImage) {
                elements.push({
                    x: 4,
                    y: bodyTopY,
                    width: 46,
                    height: bodyHeight,
                    action: {
                        library: 'H5P.AdvancedText 1.1',
                        params: { text: contentHtml },
                        subContentId: `content_${idx}`
                    }
                });
                addImageElement(52, bodyTopY, 44, bodyHeight);
            } else if (hasImage) {
                addImageElement(8, bodyTopY, 84, bodyHeight);
            } else if (hasBullets) {
                elements.push({
                    x: 10,
                    y: bodyTopY,
                    width: 80,
                    height: bodyHeight,
                    action: {
                        library: 'H5P.AdvancedText 1.1',
                        params: { text: contentHtml },
                        subContentId: `content_${idx}`
                    }
                });
            }
        }

        if (hasQuiz && !elements.some((el: any) => String(el?.action?.library || '').startsWith('H5P.MultiChoice'))) {
            addQuizElement(52, 18, 44, 76);
        }

        return {
            elements,
            keywords: [{ main: slideTitleText }]
        };
    });

    const firstSlideIsFullCanvas =
        slides.length > 0 &&
        slides[0]?.layoutType === 'full_slide_canvas' &&
        Boolean(slides[0]?.h5pImagePath);

    // Check if title slide has custom title background
    if (!firstSlideIsFullCanvas && options?.hasTitleBg && options.titleBgFilename && h5pSlides.length > 0) {
        (h5pSlides[0] as any).slideBackgroundSelector = {
            fillType: 'image',
            imageSlideBackground: {
                path: options.titleBgFilename,
                mime: getImageMime(options.titleBgFilename),
                copyright: {
                    title: isTuafBranded ? 'TUAF Title Background' : 'Slide Title Background',
                    license: 'U'
                },
                width: 1920,
                height: 1080
            }
        };
    }

    // Add subtle TUAF branding header to title slide in clean mode (skip if Slide 1 is already a full-bleed PowerPoint cover canvas)
    if (!firstSlideIsFullCanvas && (!options?.bgOption || options?.bgOption === 'tuaf_clean') && h5pSlides.length > 0) {
        h5pSlides[0].elements.unshift({
            x: 4,
            y: 3,
            width: 92,
            height: 6,
            action: {
                library: 'H5P.AdvancedText 1.1',
                params: {
                    text: `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 0.85em; font-weight: 800; color: ${isDarkTheme ? '#95d5b2' : '#005a36'}; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 2px solid ${isDarkTheme ? '#52b788' : '#005a36'}; padding-bottom: 4px;">🌿 TRƯỜNG ĐẠI HỌC NÔNG LÂM THÁI NGUYÊN</div>`
                },
                subContentId: 'tuaf_header_badge'
            }
        });
    }

    // Global background configuration
    let globalBackgroundSelector: any = {
        fillType: 'fill',
        fillColor: isDarkTheme ? '#0b1120' : '#ffffff'
    };

    if (options?.hasContentBg && options.contentBgFilename) {
        globalBackgroundSelector = {
            fillType: 'image',
            imageGlobalBackground: {
                path: options.contentBgFilename,
                mime: getImageMime(options.contentBgFilename),
                copyright: {
                    title: isTuafBranded ? 'TUAF Background' : 'Slide Background',
                    license: 'U'
                },
                width: 1920,
                height: 1080
            }
        };
    } else {
        globalBackgroundSelector = {
            fillType: 'fill',
            fillColor: isDarkTheme ? '#0b1120' : '#ffffff'
        };
    }

    return JSON.stringify({
        presentation: {
            slides: h5pSlides,
            keywordListEnabled: true,
            keywordListAlwaysShow: false,
            keywordListAutoHide: false,
            keywordListOpacity: 90,
            globalBackgroundSelector
        },
        override: {
            activeSurface: false,
            hideSummarySlide: false,
            summarySlideSolutionButton: true,
            summarySlideRetryButton: true,
            enablePrintButton: false,
            social: {
                showFacebookShare: false,
                showTwitterShare: false,
                showGoogleShare: false
            }
        },
        l10n: {
            slide: 'Trang',
            score: 'Điểm',
            yourScore: 'Điểm của bạn',
            maxScore: 'Điểm tối đa',
            total: 'Tổng cộng',
            totalScore: 'Tổng điểm',
            showSolutions: 'Xem đáp án',
            retry: 'Làm lại',
            exportAnswers: 'Xuất câu trả lời',
            hideKeywords: 'Ẩn mục lục slide',
            showKeywords: 'Hiện mục lục slide',
            fullscreen: 'Toàn màn hình',
            exitFullscreen: 'Thoát toàn màn hình',
            prevSlide: 'Slide trước',
            nextSlide: 'Slide tiếp theo',
            currentSlide: 'Slide hiện tại',
            lastSlide: 'Slide cuối cùng',
            solutionModeTitle: 'Thoát chế độ xem đáp án',
            solutionModeText: 'Chế độ xem đáp án',
            summaryMultipleTaskText: 'Nhiều bài tập',
            scoreMessage: 'Bạn đạt :achieved trên :max điểm',
            shareFacebook: 'Chia sẻ Facebook',
            shareTwitter: 'Chia sẻ Twitter',
            shareGoogle: 'Chia sẻ Google+',
            summary: 'Tổng kết bài học',
            solutionsButtonTitle: 'Xem lời giải',
            printTitle: 'In bài giảng',
            printIngress: 'Bạn muốn in bài giảng này như thế nào?',
            printAllSlides: 'In toàn bộ slide',
            printCurrentSlide: 'In slide hiện tại',
            noTitle: 'Không có tiêu đề',
            accessibilitySlideNavigationExplanation: 'Dùng phím mũi tên trái và phải để chuyển slide',
            accessibilityCanvasLabel: 'Khung trình chiếu bài giảng. Dùng mũi tên trái và phải để chuyển slide.',
            accessibilityProgressBarLabel: 'Chọn slide để hiển thị',
            containsNotCompleted: '@slideName có bài tập tương tác chưa hoàn thành',
            containsCompleted: '@slideName có bài tập tương tác đã hoàn thành',
            slideCount: 'Slide @index / @total',
            containsOnlyCorrect: '@slideName đã trả lời đúng toàn bộ',
            containsIncorrectAnswers: '@slideName có câu trả lời chưa đúng',
            shareResult: 'Chia sẻ kết quả',
            accessibilityTotalScore: 'Bạn đạt tổng cộng @score trên @maxScore điểm',
            accessibilityEnteredFullscreen: 'Đã vào chế độ toàn màn hình',
            accessibilityExitedFullscreen: 'Đã thoát chế độ toàn màn hình',
            confirmDialogHeader: 'Nộp câu trả lời của bạn?',
            confirmDialogText: 'Thao tác này sẽ nộp kết quả làm bài của bạn, bạn có muốn tiếp tục?',
            confirmDialogConfirmText: 'Nộp bài và xem kết quả'
        }
    }, null, 2);
}

export async function packageH5pZip(
    lessonTitle: string, 
    slides: any[], 
    outputStream: any,
    options?: H5pExportOptions
): Promise<void> {
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(outputStream);

    const packagedSlides = slides.map(s => ({ ...s }));
    const opts: H5pExportOptions = { ...(options || {}) };

    // Pack background images if full image mode or custom template requested
    if (opts.bgOption === 'tuaf_full' || (opts.bgOption === 'custom' && (opts.titleBgUrl || opts.contentBgUrl))) {
        if (opts.titleBgUrl) {
            const resolvedTitleBg = resolveLocalMediaFile(opts.titleBgUrl);
            if (resolvedTitleBg && fs.existsSync(resolvedTitleBg)) {
                const ext = path.extname(resolvedTitleBg) || '.png';
                archive.file(resolvedTitleBg, { name: `content/images/h5p_title_bg${ext}` });
                opts.hasTitleBg = true;
                opts.titleBgFilename = `images/h5p_title_bg${ext}`;
            }
        }
        if (opts.contentBgUrl) {
            const resolvedContentBg = resolveLocalMediaFile(opts.contentBgUrl);
            if (resolvedContentBg && fs.existsSync(resolvedContentBg)) {
                const ext = path.extname(resolvedContentBg) || '.png';
                archive.file(resolvedContentBg, { name: `content/images/h5p_content_bg${ext}` });
                opts.hasContentBg = true;
                opts.contentBgFilename = `images/h5p_content_bg${ext}`;
            }
        }
    }

    for (let sIdx = 0; sIdx < packagedSlides.length; sIdx++) {
        const slide = packagedSlides[sIdx];
        const isTuafFullCoverSlide =
            opts.bgOption === 'tuaf_full' &&
            opts.hasTitleBg &&
            sIdx === 0 &&
            slide.layoutType !== 'full_slide_canvas';

        // 1. Pack Slide Image into content/images/ (suppress AI cover image on Slide 1 when using TUAF original cover #1)
        if (!isTuafFullCoverSlide && slide.imageUrl) {
            const localImgPath = resolveLocalMediaFile(slide.imageUrl);
            if (localImgPath) {
                const ext = path.extname(localImgPath) || '.png';
                const relativeName = `images/slide_${String(slide.slideIndex).padStart(2, '0')}${ext}`;
                archive.file(localImgPath, { name: `content/${relativeName}` });
                slide.h5pImagePath = relativeName;
            }
        }

        // 2. Pack Narration Audio into content/audios/
        if (slide.audioUrl) {
            const localAudioPath = resolveLocalMediaFile(slide.audioUrl);
            if (localAudioPath) {
                const ext = path.extname(localAudioPath) || '.mp3';
                const relativeName = `audios/narration_${String(slide.slideIndex).padStart(2, '0')}${ext}`;
                archive.file(localAudioPath, { name: `content/${relativeName}` });
                slide.h5pAudioPath = relativeName;
            }
        }

        // 3. Pack Extra Sample Audio into content/audios/
        if (slide.extraAudioUrl) {
            const localExtraPath = resolveLocalMediaFile(slide.extraAudioUrl);
            if (localExtraPath) {
                const ext = path.extname(localExtraPath) || '.mp3';
                const relativeName = `audios/sample_${String(slide.slideIndex).padStart(2, '0')}${ext}`;
                archive.file(localExtraPath, { name: `content/${relativeName}` });
                slide.h5pSampleAudioPath = relativeName;
            }
        }
    }

    archive.append(generateH5pJson(lessonTitle), { name: 'h5p.json' });
    archive.append(generateH5pContentJson(lessonTitle, packagedSlides, opts), { name: 'content/content.json' });

    await archive.finalize();
}
