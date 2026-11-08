import {
    applyTargetSlideCountToPrompt,
    buildAdjustSlideCountPrompt,
    extractSlideScriptObject,
    normalizeAndEnforceSlideScriptCount,
    sanitizeTargetSlideCount,
} from './slide-script-budget.helper';

describe('Step 3 Slide Script Budget & Condense/Expand Helper', () => {
    describe('sanitizeTargetSlideCount', () => {
        it('returns undefined for empty or invalid values and clamps valid numbers into [4, 60]', () => {
            expect(sanitizeTargetSlideCount(undefined)).toBeUndefined();
            expect(sanitizeTargetSlideCount(null)).toBeUndefined();
            expect(sanitizeTargetSlideCount('')).toBeUndefined();
            expect(sanitizeTargetSlideCount(0)).toBeUndefined();
            expect(sanitizeTargetSlideCount(-5)).toBeUndefined();
            expect(sanitizeTargetSlideCount(2)).toBe(4);
            expect(sanitizeTargetSlideCount(20)).toBe(20);
            expect(sanitizeTargetSlideCount('15')).toBe(15);
            expect(sanitizeTargetSlideCount(99)).toBe(60);
        });
    });

    describe('applyTargetSlideCountToPrompt', () => {
        it('replaces hardcoded 20-35 slides instructions and appends strict target slide count budget', () => {
            const basePrompt = `## RÀNG BUỘC SỐ LƯỢNG SLIDE:
- **Tổng số slide:** 20-35 slides (tùy độ phức tạp nội dung)
- Cấu trúc gợi ý:
  - 1 slide Title
  - 20-30 slides Content (nội dung chính)`;

            const result = applyTargetSlideCountToPrompt(basePrompt, 20);
            expect(result).not.toContain('20-35 slides');
            expect(result).not.toContain('20-30 slides Content');
            expect(result).toContain('ĐÚNG 20 slides');
            expect(result).toContain('15 slides Content (nội dung chính)');
            expect(result).toContain('BẮT BUỘC PHẢI CÓ ĐÚNG 20 SLIDE');
        });
    });

    describe('normalizeAndEnforceSlideScriptCount', () => {
        const buildSampleDeck = (count: number) => {
            const slides = Array.from({ length: count }, (_, i) => {
                if (i === 0) {
                    return {
                        slideIndex: 0, // intentionally 0-based to test normalization
                        slideType: 'title',
                        title: 'Bài giảng Quản trị học',
                        content: [],
                        visualIdea: null,
                        speakerNote: 'Chào mừng sinh viên',
                    };
                }
                if (i === count - 1) {
                    return {
                        slideIndex: i,
                        slideType: 'summary',
                        title: 'Tổng kết bài học',
                        content: ['Tóm tắt trọng tâm 1', 'Tóm tắt trọng tâm 2'],
                        visualIdea: 'Summary infographic',
                        speakerNote: null,
                    };
                }
                return {
                    slideIndex: i,
                    slideType: 'content',
                    title: `Chủ đề ${i}`,
                    content: [
                        `Khái niệm cốt lõi của chủ đề ${i}`,
                        `Ứng dụng thực tế của chủ đề ${i}`,
                        `Ví dụ minh họa cho chủ đề ${i}`,
                    ],
                    visualIdea: `Sơ đồ minh họa chủ đề ${i}`,
                    speakerNote: `Lời giảng cho chủ đề ${i}`,
                };
            });
            return '```json\n' + JSON.stringify({ title: 'Bài giảng Quản trị học', slides }, null, 2) + '\n```';
        };

        it('condenses a 30-slide deck down to exact 20 slides while preserving cover, summary, sequential 1..20 indices, and core bullets', () => {
            const raw30 = buildSampleDeck(30);
            const result = normalizeAndEnforceSlideScriptCount(raw30, 20, 'Bài giảng Quản trị học');

            expect(result.adjustedFromCount).toBe(30);
            expect(result.slideCount).toBe(20);

            const parsed = extractSlideScriptObject(result.jsonString);
            expect(parsed).not.toBeNull();
            expect(parsed!.slides).toHaveLength(20);
            expect(parsed!.totalSlides).toBe(20);

            // Check 1-based sequential slideIndex 1..20
            parsed!.slides.forEach((s, idx) => {
                expect(s.slideIndex).toBe(idx + 1);
            });

            // Cover slide and summary slide preserved
            expect(parsed!.slides[0].slideType).toBe('title');
            expect(parsed!.slides[19].slideType).toBe('summary');

            // Verify content from merged slides was preserved, not dropped
            const allText = JSON.stringify(parsed!.slides);
            expect(allText).toContain('Chủ đề 1');
            expect(allText).toContain('Chủ đề 28');
        });

        it('expands a 12-slide deck up to exact 20 slides with sequential 1..20 indices', () => {
            const raw12 = buildSampleDeck(12);
            const result = normalizeAndEnforceSlideScriptCount(raw12, 20, 'Bài giảng Quản trị học');

            expect(result.adjustedFromCount).toBe(12);
            expect(result.slideCount).toBe(20);

            const parsed = extractSlideScriptObject(result.jsonString);
            expect(parsed).not.toBeNull();
            expect(parsed!.slides).toHaveLength(20);
            parsed!.slides.forEach((s, idx) => {
                expect(s.slideIndex).toBe(idx + 1);
            });
            expect(parsed!.slides[0].slideType).toBe('title');
            expect(parsed!.slides[19].slideType).toBe('summary');
        });

        it('normalizes 0-based slideIndex to 1..N without changing slide count when targetSlideCount is omitted', () => {
            const raw15 = buildSampleDeck(15);
            const result = normalizeAndEnforceSlideScriptCount(raw15);
            expect(result.slideCount).toBe(15);
            const parsed = JSON.parse(result.jsonString);
            expect(parsed.slides[0].slideIndex).toBe(1);
            expect(parsed.slides[14].slideIndex).toBe(15);
        });
    });

    describe('buildAdjustSlideCountPrompt', () => {
        it('generates condensing prompt when target < current and expanding prompt when target > current', () => {
            const condensePrompt = buildAdjustSlideCountPrompt({
                lessonTitle: 'Kinh tế vĩ mô',
                detailedOutline: '{"sections":[]}',
                currentSlideScriptJson: '{"slides":[]}',
                currentCount: 30,
                targetSlideCount: 20,
            });
            expect(condensePrompt).toContain('CÔ ĐỌNG');
            expect(condensePrompt).toContain('30 -> 20 slide');
            expect(condensePrompt).toContain('"totalSlides": 20');

            const expandPrompt = buildAdjustSlideCountPrompt({
                lessonTitle: 'Kinh tế vĩ mô',
                currentSlideScriptJson: '{"slides":[]}',
                currentCount: 12,
                targetSlideCount: 18,
            });
            expect(expandPrompt).toContain('MỞ RỘNG');
            expect(expandPrompt).toContain('12 -> 18 slide');
        });
    });
});
