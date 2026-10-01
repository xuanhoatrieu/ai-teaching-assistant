/**
 * H5P Course Presentation Package Generator
 * 
 * Generates an H5P compliant archive (.h5p) ready for Moodle's native H5P activity.
 * Bundles slide images, structured text content bullets, narration audio, 
 * extra sample audio, and interactive quizzes.
 */

import * as path from 'path';
import { resolveLocalMediaFile } from './scorm-export.helper';

const archiver = require('archiver');

function escapeHtml(str: string): string {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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

export function generateH5pContentJson(lessonTitle: string, slides: any[]): string {
    const h5pSlides = slides.map((s, idx) => {
        const elements: any[] = [];

        // 1. Check interactive quiz questions
        let questions: any[] = [];
        let interaction: any = null;
        if (s.interactiveData) {
            try {
                interaction = typeof s.interactiveData === 'string' ? JSON.parse(s.interactiveData) : s.interactiveData;
                if (Array.isArray(interaction.questions)) questions = interaction.questions;
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

        const hasBullets = bullets.length > 0;
        const hasImage = !!s.h5pImagePath;
        const hasAudio = !!s.h5pAudioPath;
        const hasSampleAudio = !!s.h5pSampleAudioPath;

        // 3. Slide Title (Single-line clean header, no redundant 'Slide X' stacking)
        const slideTitleText = s.title || `Slide ${s.slideIndex}`;
        elements.push({
            x: 3,
            y: 3,
            width: hasAudio ? 89 : 94,
            height: 8,
            action: {
                library: 'H5P.AdvancedText 1.1',
                params: {
                    text: `<h2 style="margin: 0; padding: 0; font-size: 1.3em; line-height: 1.25; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 700;">${escapeHtml(slideTitleText)}</h2>`
                },
                subContentId: `title_${idx}`
            }
        });

        // 4. Narration Audio Button (Compact top-right icon, not stretched)
        if (hasAudio) {
            elements.push({
                x: 93.5,
                y: 2.5,
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
                                mime: 'audio/mpeg',
                                copyright: { license: 'U' }
                            }
                        ]
                    },
                    subContentId: `audio_narration_${idx}`
                }
            });
        }

        // 5. Build Content Text HTML without <ul>/<li> to avoid browser bullet circles,
        // and avoid printing duplicate description when identical to point
        let contentHtml = '';
        if (hasBullets) {
            const itemsHtml = bullets.map(b => {
                const point = (b.point || '').trim();
                const desc = (b.description || '').trim();
                const isDistinct = desc && desc.toLowerCase() !== point.toLowerCase();
                const emoji = b.emoji || '📌';

                return `
                    <div style="margin-bottom: 16px; line-height: 1.5; color: #1e293b;">
                        <p style="margin: 0 0 4px 0; font-size: 1.05em; line-height: 1.35;">
                            <span style="font-size: 1.15em; margin-right: 6px;">${emoji}</span>
                            <strong style="color: #0f172a;">${escapeHtml(point)}</strong>
                        </p>
                        ${isDistinct ? `<p style="margin: 0 0 0 26px; font-size: 0.9em; color: #475569; line-height: 1.45;">${escapeHtml(desc)}</p>` : ''}
                    </div>
                `;
            }).join('');

            contentHtml = `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding-top: 4px;">
                    ${itemsHtml}
                </div>
            `;
        }

        // Helper: Image Element
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
                            mime: 'image/png',
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

        // Helper: Quiz Element
        const addQuizElement = (quizX: number, quizY: number, quizWidth: number, quizHeight: number) => {
            if (!hasQuiz) return;
            const firstQ = questions[0];
            const qType = (firstQ.type || 'MC').toUpperCase();
            let typeBadgeHtml = '';
            let isMultipleResponse = false;
            let optionsToUse: string[] = firstQ.options || [];

            if (qType === 'TF') {
                typeBadgeHtml = '<span style="background: rgba(14, 165, 233, 0.15); color: #0369a1; font-size: 0.75em; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">Đúng / Sai</span>';
                if (!optionsToUse || optionsToUse.length < 2) {
                    optionsToUse = ['Đúng', 'Sai'];
                }
            } else if (qType === 'MR') {
                isMultipleResponse = true;
                typeBadgeHtml = '<span style="background: rgba(168, 85, 247, 0.15); color: #7e22ce; font-size: 0.75em; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">Chọn nhiều đáp án</span>';
            } else if (qType === 'FIB') {
                typeBadgeHtml = '<span style="background: rgba(245, 158, 11, 0.15); color: #b45309; font-size: 0.75em; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">Điền khuyết</span>';
            } else {
                typeBadgeHtml = '<span style="background: rgba(99, 102, 241, 0.15); color: #4338ca; font-size: 0.75em; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">Chọn 1 đáp án</span>';
            }

            const correctAnswersList: string[] = isMultipleResponse
                ? (firstQ.correctAnswers || [firstQ.correctAnswer || ''])
                : [firstQ.correctAnswer || ''];

            elements.push({
                x: quizX,
                y: quizY,
                width: quizWidth,
                height: quizHeight,
                action: {
                    library: 'H5P.MultiChoice 1.16',
                    params: {
                        question: `<p style="font-size: 1.05em; font-weight: 700; color: #0f172a; margin: 0 0 10px 0;">${escapeHtml(firstQ.question)} ${typeBadgeHtml}</p>`,
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

        // 6. Layout Routing based on layoutType:
        if (layoutType === 'checkpoint_gate' || (hasQuiz && isCheckpoint)) {
            // Layout 1: Checkpoint Gate (Full-width Mastery Gate)
            elements.push({
                x: 6,
                y: 13,
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
            addQuizElement(6, 25, 88, 71);

        } else if (layoutType === 'audio_lab' || hasSampleAudio) {
            // Layout 2: Audio Lab (Central sample audio + prompt/quiz)
            elements.push({
                x: 8,
                y: 14,
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
                        files: [{ path: s.h5pSampleAudioPath, mime: 'audio/mpeg', copyright: { license: 'U' } }]
                    },
                    subContentId: `sample_audio_${idx}`
                }
            });

            if (hasQuiz) {
                elements.push({
                    x: 8,
                    y: 25,
                    width: 42,
                    height: 70,
                    action: {
                        library: 'H5P.AdvancedText 1.1',
                        params: { text: contentHtml },
                        subContentId: `content_${idx}`
                    }
                });
                addQuizElement(52, 25, 42, 70);
            } else {
                elements.push({
                    x: 8,
                    y: 25,
                    width: 84,
                    height: 70,
                    action: {
                        library: 'H5P.AdvancedText 1.1',
                        params: { text: contentHtml },
                        subContentId: `content_${idx}`
                    }
                });
            }

        } else if (layoutType === 'split_reversed') {
            // Layout 3: Split Reversed (Left Image, Right Text)
            addImageElement(4, 14, 45, 82);
            elements.push({
                x: 51,
                y: 14,
                width: 45,
                height: 82,
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
                <div style="display: grid; grid-template-columns: repeat(${Math.min(3, Math.max(1, bullets.length))}, 1fr); gap: 14px; font-family: -apple-system, sans-serif; padding-top: 6px;">
                    ${cardsHtml}
                </div>
            `;

            elements.push({
                x: 4,
                y: 14,
                width: 92,
                height: 82,
                action: {
                    library: 'H5P.AdvancedText 1.1',
                    params: { text: comparisonHtml },
                    subContentId: `comparison_${idx}`
                }
            });

        } else if (layoutType === 'hero_infographic') {
            // Layout 5: Hero Infographic (Large visual on top, takeaway bullets below)
            if (hasImage) {
                addImageElement(6, 14, 88, 50);
                elements.push({
                    x: 6,
                    y: 66,
                    width: 88,
                    height: 30,
                    action: {
                        library: 'H5P.AdvancedText 1.1',
                        params: { text: contentHtml },
                        subContentId: `content_${idx}`
                    }
                });
            } else {
                elements.push({
                    x: 6,
                    y: 14,
                    width: 88,
                    height: 82,
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
                <div style="font-family: -apple-system, sans-serif; padding-top: 4px;">
                    ${stepsHtml}
                </div>
            `;

            elements.push({
                x: 4,
                y: 14,
                width: hasImage ? 46 : 92,
                height: 82,
                action: {
                    library: 'H5P.AdvancedText 1.1',
                    params: { text: timelineHtml },
                    subContentId: `timeline_${idx}`
                }
            });

            if (hasImage) {
                addImageElement(52, 14, 44, 82);
            }

        } else {
            // Layout 7: Split Standard (Text on Left, Image on Right) - Default
            if (hasBullets && hasImage) {
                elements.push({
                    x: 4,
                    y: 14,
                    width: 46,
                    height: 82,
                    action: {
                        library: 'H5P.AdvancedText 1.1',
                        params: { text: contentHtml },
                        subContentId: `content_${idx}`
                    }
                });
                addImageElement(52, 14, 44, 82);
            } else if (hasImage) {
                addImageElement(8, 14, 84, 82);
            } else if (hasBullets) {
                elements.push({
                    x: 8,
                    y: 14,
                    width: 84,
                    height: 82,
                    action: {
                        library: 'H5P.AdvancedText 1.1',
                        params: { text: contentHtml },
                        subContentId: `content_${idx}`
                    }
                });
            }
        }

        return {
            elements,
            keywords: [{ main: slideTitleText }]
        };
    });

    return JSON.stringify({
        presentation: {
            slides: h5pSlides,
            keywordListEnabled: true,
            globalBackgroundSelector: {
                fillType: 'fill',
                fillColor: '#f8fafc'
            }
        }
    }, null, 2);
}

export async function packageH5pZip(lessonTitle: string, slides: any[], outputStream: any): Promise<void> {
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(outputStream);

    const packagedSlides = slides.map(s => ({ ...s }));

    for (const slide of packagedSlides) {
        // 1. Pack Slide Image into content/images/
        if (slide.imageUrl) {
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
    archive.append(generateH5pContentJson(lessonTitle, packagedSlides), { name: 'content/content.json' });

    await archive.finalize();
}
