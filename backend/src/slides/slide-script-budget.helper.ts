export interface NormalizedSlideScriptItem {
    slideIndex: number;
    slideType: string;
    title: string;
    subtitle?: string;
    content: string[];
    visualIdea: string | null;
    speakerNote: string | null;
}

export interface ExtractedSlideScriptObject {
    title?: string;
    totalSlides?: number;
    slides: NormalizedSlideScriptItem[];
    coverageCheck?: any;
}

/**
 * Validates and clamps a user-provided targetSlideCount into [4, 60].
 * Returns undefined if not provided or invalid.
 */
export function sanitizeTargetSlideCount(raw?: number | string | null): number | undefined {
    if (raw === undefined || raw === null || raw === '') {
        return undefined;
    }
    const num = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(num) || num <= 0) {
        return undefined;
    }
    return Math.max(4, Math.min(60, Math.round(num)));
}

/**
 * Injects a strict target slide count budget into the `slides.script` prompt,
 * replacing any conflicting default "20-35 slides" instructions.
 */
export function applyTargetSlideCountToPrompt(basePrompt: string, targetSlideCount?: number): string {
    const target = sanitizeTargetSlideCount(targetSlideCount);
    if (!target) {
        return basePrompt;
    }

    let contentSlideCount: number;
    let structureLines: string[];

    if (target <= 6) {
        contentSlideCount = Math.max(2, target - 2);
        structureLines = [
            `  - 1 slide Title (slideIndex = 1)`,
            `  - ${contentSlideCount} slides Content (nội dung chính & mục tiêu cốt lõi)`,
            `  - 1 slide Summary (tổng kết bài học, slideIndex = ${target})`,
        ];
    } else if (target <= 10) {
        contentSlideCount = target - 3;
        structureLines = [
            `  - 1 slide Title (slideIndex = 1)`,
            `  - 1 slide Objectives (gộp Nội dung & Mục tiêu bài học, slideIndex = 2)`,
            `  - ${contentSlideCount} slides Content (nội dung chính, slideIndex = 3..${target - 1})`,
            `  - 1 slide Summary (gộp Tổng kết & Câu hỏi ôn tập, slideIndex = ${target})`,
        ];
    } else {
        contentSlideCount = target - 5;
        structureLines = [
            `  - 1 slide Title (slideIndex = 1)`,
            `  - 1 slide Agenda (slideIndex = 2)`,
            `  - 1 slide Objectives (slideIndex = 3)`,
            `  - ${contentSlideCount} slides Content (nội dung chính, slideIndex = 4..${target - 2})`,
            `  - 1 slide Questions (câu hỏi thảo luận, slideIndex = ${target - 1})`,
            `  - 1 slide Summary (tổng kết, slideIndex = ${target})`,
        ];
    }

    let updated = basePrompt
        .replace(/20-35\s*slides\s*\([^)]*\)/gi, `ĐÚNG ${target} slides (theo giới hạn người dùng chỉ định)`)
        .replace(/20-30\s*slides\s*Content\s*\([^)]*\)/gi, `${contentSlideCount} slides Content (nội dung chính)`);

    const constraintBlock = `

---

## 🎯 RÀNG BUỘC BẮT BUỘC VỀ SỐ LƯỢNG SLIDE (CRITICAL SLIDE COUNT CONSTRAINT):
- Người dùng yêu cầu kịch bản này **BẮT BUỘC PHẢI CÓ ĐÚNG ${target} SLIDE** (\`"totalSlides": ${target}\`, mảng \`"slides"\` có đúng **${target} phần tử**, đánh số \`slideIndex\` liên tục từ \`1\` đến \`${target}\`).
- Phân bổ cấu trúc bắt buộc cho đúng ${target} slide:
${structureLines.join('\n')}
- **Quy tắc co giãn thông minh theo Outline:**
  1. Nếu Outline có nhiều mục nhỏ hơn ${contentSlideCount} slide Content: Hãy **GỘP (group/condense)** các mục nhỏ cùng chủ đề vào chung 1 slide (mỗi slide 2-4 gạch đầu dòng súc tích), đảm bảo **bao phủ 100% các mục chính trong Outline** mà không vượt quá ${target} slide.
  2. Nếu Outline có ít mục hơn ${contentSlideCount} slide Content: Hãy **CHIA NHỎ (split/elaborate)** các mục lớn thành các slide chuyên sâu (Khái niệm, Phân tích bản chất, Ví dụ thực tiễn) để đạt đúng ${target} slide.
  3. Tuyệt đối KHÔNG trả về nhiều hơn hoặc ít hơn ${target} slide.`;

    return `${updated}${constraintBlock}`;
}

/**
 * Builds an AI prompt to condense or expand an existing slide script to exact `targetSlideCount` slides.
 */
export function buildAdjustSlideCountPrompt(params: {
    lessonTitle: string;
    detailedOutline?: string | null;
    currentSlideScriptJson: string;
    currentCount: number;
    targetSlideCount: number;
    roleAndLanguageHeader?: string;
}): string {
    const {
        lessonTitle,
        detailedOutline,
        currentSlideScriptJson,
        currentCount,
        targetSlideCount,
        roleAndLanguageHeader,
    } = params;

    const target = sanitizeTargetSlideCount(targetSlideCount) || 20;
    const isCondensing = target < currentCount;
    const actionLabel = isCondensing
        ? `CÔ ĐỌNG (rút gọn & gộp thông minh) từ ${currentCount} slide xuống ĐÚNG ${target} slide`
        : target > currentCount
            ? `MỞ RỘNG (chi tiết hóa & tách hợp lý) từ ${currentCount} slide lên ĐÚNG ${target} slide`
            : `CHUẨN HÓA LẠI giữ nguyên ĐÚNG ${target} slide`;

    const outlineSection = detailedOutline
        ? `\n**OUTLINE CHI TIẾT CỦA BÀI HỌC (để đối chiếu bảo toàn 100% các mục kiến thức):**\n${detailedOutline}\n`
        : '';

    const strategyInstructions = isCondensing
        ? `1. **Chiến lược GỘP & CÔ ĐỌNG (${currentCount} -> ${target} slide):**
   - Giữ Slide 1 là trang bìa (\`"slideType": "title"\`) và Slide cuối cùng (${target}) là trang tổng kết (\`"slideType": "summary"\`).
   - Gộp các slide nội dung (\`content\`) có liên quan hoặc thuộc cùng một mục lớn lại với nhau để tổng số slide giảm từ ${currentCount} xuống **ĐÚNG ${target} slide**.
   - Khi gộp 2-3 slide thành 1 slide: hãy tổng hợp các ý chính thành **2 đến 4 gạch đầu dòng súc tích, học thuật**, giữ lại đầy đủ thuật ngữ/khái niệm quan trọng (tuyệt đối không làm mất nội dung cốt lõi của Outline).
   - Chọn hoặc kết hợp \`visualIdea\` trực quan nhất cho slide sau khi gộp.
   - Nếu slide gốc có \`speakerNote\`, hãy gộp mạch lạc; nếu là \`null\` thì giữ \`null\`.`
        : `1. **Chiến lược MỞ RỘNG & CHI TIẾT HÓA (${currentCount} -> ${target} slide):**
   - Giữ Slide 1 là trang bìa (\`"slideType": "title"\`) và Slide cuối cùng (${target}) là trang tổng kết (\`"slideType": "summary"\`).
   - Tách các slide nội dung (\`content\`) đang chứa nhiều ý hoặc mở rộng các mục trong Outline thành các slide chuyên sâu hơn (ví dụ: Khái niệm & Bản chất, Cơ chế/Quy trình, Ví dụ thực tế/Ứng dụng) để tổng số slide đạt **ĐÚNG ${target} slide**.
   - Mỗi slide mới phải có \`title\` rõ ràng, \`content\` gồm 2-3 gạch đầu dòng ngắn gọn và \`visualIdea\` cụ thể.`;

    const header = roleAndLanguageHeader ? `${roleAndLanguageHeader}\n\n---\n\n` : '';

    return `${header}**TASK:** ${actionLabel} cho bài giảng "${lessonTitle}".

${outlineSection}
**KỊCH BẢN SLIDE HIỆN TẠI (${currentCount} slides):**
${currentSlideScriptJson}

---

## ⚠️ YÊU CẦU BẮT BUỘC (CRITICAL RULES):
${strategyInstructions}
2. **Định dạng & Đánh số thứ tự:**
   - Mảng \`"slides"\` trong JSON kết quả **PHẢI CÓ ĐÚNG ${target} PHẦN TỬ** (\`"totalSlides": ${target}\`).
   - Đánh số \`"slideIndex"\` liên tục bắt đầu từ \`1\` đến \`${target}\` (1, 2, 3, ..., ${target}).
   - Giữ nguyên ngôn ngữ của kịch bản hiện tại.
   - Chỉ trả về JSON hợp lệ theo đúng cấu trúc dưới đây, không kèm lời giải thích ngoài JSON:

\`\`\`json
{
  "title": ${JSON.stringify(lessonTitle)},
  "totalSlides": ${target},
  "slides": [
    {
      "slideIndex": 1,
      "slideType": "title",
      "title": "...",
      "content": [],
      "visualIdea": null,
      "speakerNote": null
    }
  ]
}
\`\`\``;
}

function normalizeBulletsArray(rawContent: any): string[] {
    if (Array.isArray(rawContent)) {
        return rawContent
            .map((item) => (typeof item === 'string' ? item.replace(/^[-*•]\s*/, '').trim() : String(item ?? '').trim()))
            .filter(Boolean);
    }
    if (typeof rawContent === 'string' && rawContent.trim()) {
        return rawContent
            .split('\n')
            .map((line) => line.replace(/^[-*•]\s*/, '').trim())
            .filter(Boolean);
    }
    return [];
}

/**
 * Safely extracts and normalizes the slide script JSON object from an AI response or raw JSON string.
 */
export function extractSlideScriptObject(rawScript: string): ExtractedSlideScriptObject | null {
    if (!rawScript || typeof rawScript !== 'string') {
        return null;
    }

    let jsonStr = rawScript.trim();
    const jsonStartTag = jsonStr.indexOf('```json');
    if (jsonStartTag !== -1) {
        const contentStart = jsonStartTag + '```json'.length;
        const lastBackticks = jsonStr.lastIndexOf('```');
        if (lastBackticks > contentStart) {
            jsonStr = jsonStr.substring(contentStart, lastBackticks).trim();
        }
    } else {
        const plainStart = jsonStr.indexOf('```');
        if (plainStart !== -1 && plainStart < 20) {
            const newlineIdx = jsonStr.indexOf('\n', plainStart);
            const contentStart = newlineIdx !== -1 ? newlineIdx + 1 : plainStart + 3;
            const lastBackticks = jsonStr.lastIndexOf('```');
            if (lastBackticks > contentStart) {
                jsonStr = jsonStr.substring(contentStart, lastBackticks).trim();
            }
        }
    }

    let parsed: any = null;
    try {
        parsed = JSON.parse(jsonStr);
    } catch {
        // Fallback: try extracting from first '{' to last '}'
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            try {
                parsed = JSON.parse(jsonStr.substring(firstBrace, lastBrace + 1));
            } catch {
                return null;
            }
        } else {
            return null;
        }
    }

    const rawSlides = Array.isArray(parsed) ? parsed : parsed?.slides;
    if (!Array.isArray(rawSlides) || rawSlides.length === 0) {
        return null;
    }

    const slides: NormalizedSlideScriptItem[] = rawSlides.map((s: any, idx: number) => {
        const item: NormalizedSlideScriptItem = {
            slideIndex: idx + 1,
            slideType: String(s?.slideType || s?.slide_type || (idx === 0 ? 'title' : 'content')).trim(),
            title: String(s?.title || `Slide ${idx + 1}`).trim(),
            content: normalizeBulletsArray(s?.content),
            visualIdea: s?.visualIdea ?? s?.visual_idea ?? s?.['Visual Idea'] ?? null,
            speakerNote: s?.speakerNote ?? s?.speaker_note ?? s?.['Speaker Notes'] ?? null,
        };
        if (s?.subtitle && typeof s.subtitle === 'string') {
            item.subtitle = s.subtitle.trim();
        }
        return item;
    });

    return {
        title: typeof parsed?.title === 'string' ? parsed.title : undefined,
        totalSlides: slides.length,
        slides,
        coverageCheck: parsed?.coverageCheck,
    };
}

function mergeTwoSlideItems(a: NormalizedSlideScriptItem, b: NormalizedSlideScriptItem): NormalizedSlideScriptItem {
    const aTitle = (a.title || '').trim();
    const bTitle = (b.title || '').trim();
    let mergedTitle = aTitle || bTitle;
    if (aTitle && bTitle && aTitle.toLowerCase() !== bTitle.toLowerCase()) {
        if (aTitle.toLowerCase().includes(bTitle.toLowerCase())) {
            mergedTitle = aTitle;
        } else if (bTitle.toLowerCase().includes(aTitle.toLowerCase())) {
            mergedTitle = bTitle;
        } else if (b.slideType === 'summary') {
            mergedTitle = bTitle;
        } else if (a.slideType === 'objectives' || b.slideType === 'objectives') {
            mergedTitle = `${aTitle} & ${bTitle}`;
        } else {
            mergedTitle = `${aTitle} & ${bTitle}`;
        }
    }

    // Combine unique bullets without dropping knowledge
    const seen = new Set<string>();
    const combinedBullets: string[] = [];
    for (const line of [...a.content, ...b.content]) {
        const norm = line.trim().toLowerCase();
        if (norm && !seen.has(norm)) {
            seen.add(norm);
            combinedBullets.push(line.trim());
        }
    }

    // If combined bullets exceed 5, compact pairs of bullets so slide stays readable while preserving all points
    while (combinedBullets.length > 5) {
        const last = combinedBullets.pop()!;
        const prev = combinedBullets.pop()!;
        combinedBullets.push(`${prev}; ${last}`);
    }

    const mergedType =
        b.slideType === 'summary' || a.slideType === 'summary'
            ? 'summary'
            : a.slideType === 'title'
                ? b.slideType || 'content'
                : a.slideType || 'content';

    const mergedVisual = a.visualIdea && b.visualIdea && a.visualIdea !== b.visualIdea
        ? `${a.visualIdea}; kết hợp ${b.visualIdea}`
        : (a.visualIdea || b.visualIdea || null);

    const mergedNote = [a.speakerNote, b.speakerNote]
        .map((n) => (n || '').trim())
        .filter(Boolean)
        .join('\n\n') || null;

    return {
        slideIndex: a.slideIndex,
        slideType: mergedType,
        title: mergedTitle,
        ...(a.subtitle ? { subtitle: a.subtitle } : {}),
        content: combinedBullets,
        visualIdea: mergedVisual,
        speakerNote: mergedNote,
    };
}

function stripPartSuffix(title: string): string {
    return title
        .replace(/\s*\((?:Phần|Part)\s*\d+\)\s*$/i, '')
        .replace(/\s*-\s*(?:Phần|Part)\s*\d+\s*$/i, '')
        .trim();
}

/**
 * Normalizes a slideScript JSON string and deterministically enforces `targetSlideCount`
 * when specified (merging adjacent content slides if AI generated too many, or splitting
 * dense content slides if AI generated too few).
 */
export function normalizeAndEnforceSlideScriptCount(
    rawScript: string,
    targetSlideCount?: number,
    fallbackTitle?: string,
): { jsonString: string; slideCount: number; adjustedFromCount: number } {
    const extracted = extractSlideScriptObject(rawScript);
    if (!extracted || extracted.slides.length === 0) {
        return {
            jsonString: rawScript,
            slideCount: 0,
            adjustedFromCount: 0,
        };
    }

    const slides = extracted.slides.map((s) => ({ ...s, content: [...s.content] }));
    const adjustedFromCount = slides.length;
    const target = sanitizeTargetSlideCount(targetSlideCount);

    if (target && slides.length !== target) {
        // Case 1: Condense / merge down to target
        while (slides.length > target && slides.length > 1) {
            let bestPairIdx = -1;
            let bestScore = Number.POSITIVE_INFINITY;

            // Priority 1: Adjacent 'content' slides (never touching Slide 0 cover)
            for (let i = 1; i < slides.length - 1; i++) {
                if (slides[i].slideType === 'content' && slides[i + 1].slideType === 'content') {
                    const score = slides[i].content.length + slides[i + 1].content.length;
                    if (score <= bestScore) {
                        bestScore = score;
                        bestPairIdx = i;
                    }
                }
            }

            // Priority 2: Merge questions + summary at the end
            if (bestPairIdx === -1 && slides.length >= 3) {
                for (let i = slides.length - 2; i >= 1; i--) {
                    const t1 = slides[i].slideType;
                    const t2 = slides[i + 1].slideType;
                    if (
                        (t1 === 'questions' && t2 === 'summary') ||
                        (t1 === 'agenda' && t2 === 'objectives') ||
                        (t1 === 'content' || t2 === 'content')
                    ) {
                        bestPairIdx = i;
                        break;
                    }
                }
            }

            // Priority 3: Any two non-title slides, or last two slides
            if (bestPairIdx === -1) {
                bestPairIdx = slides.length > 2 ? slides.length - 2 : 0;
            }

            const merged = mergeTwoSlideItems(slides[bestPairIdx], slides[bestPairIdx + 1]);
            slides.splice(bestPairIdx, 2, merged);
        }

        // Case 2: Expand / split up to target
        let splitPass = 0;
        while (slides.length < target && splitPass < 60) {
            splitPass++;
            let bestSplitIdx = -1;
            let maxBullets = 1;

            // Find content slide with the most bullets (>= 2)
            for (let i = 1; i < slides.length; i++) {
                if (slides[i].slideType === 'content' && slides[i].content.length > maxBullets) {
                    maxBullets = slides[i].content.length;
                    bestSplitIdx = i;
                }
            }

            // Fallback: any slide with >= 2 bullets
            if (bestSplitIdx === -1) {
                for (let i = 1; i < slides.length; i++) {
                    if (slides[i].content.length >= 2) {
                        bestSplitIdx = i;
                        break;
                    }
                }
            }

            if (bestSplitIdx !== -1) {
                const orig = slides[bestSplitIdx];
                const mid = Math.ceil(orig.content.length / 2);
                const firstHalf = orig.content.slice(0, mid);
                const secondHalf = orig.content.slice(mid);
                const baseTitle = stripPartSuffix(orig.title);

                const slideA: NormalizedSlideScriptItem = {
                    ...orig,
                    title: `${baseTitle} (Phần 1)`,
                    content: firstHalf,
                };
                const slideB: NormalizedSlideScriptItem = {
                    ...orig,
                    title: `${baseTitle} (Phần 2)`,
                    content: secondHalf,
                    speakerNote: null,
                };
                slides.splice(bestSplitIdx, 1, slideA, slideB);
            } else {
                // Fallback when all slides have <= 1 bullet: expand the last content slide
                let insertIdx = slides.length - 1;
                for (let i = slides.length - 1; i >= 1; i--) {
                    if (slides[i].slideType === 'content') {
                        insertIdx = i;
                        break;
                    }
                }
                const source = slides[insertIdx] || slides[slides.length - 1];
                const baseTitle = stripPartSuffix(source.title);
                const companionSlide: NormalizedSlideScriptItem = {
                    slideIndex: insertIdx + 2,
                    slideType: 'content',
                    title: `${baseTitle} - Phân tích & Ứng dụng`,
                    content: source.content.length > 0
                        ? [...source.content]
                        : [`Phân tích chi tiết và ví dụ thực tiễn về ${baseTitle}`],
                    visualIdea: source.visualIdea || `Infographic minh họa thực tiễn cho ${baseTitle}`,
                    speakerNote: null,
                };
                slides.splice(insertIdx + 1, 0, companionSlide);
            }
        }
    }

    // Re-index 1..N sequentially
    slides.forEach((s, idx) => {
        s.slideIndex = idx + 1;
    });

    const outputObj: Record<string, any> = {
        title: extracted.title || fallbackTitle || slides[0]?.title || 'Bài giảng',
        totalSlides: slides.length,
        slides,
    };
    if (extracted.coverageCheck) {
        outputObj.coverageCheck = extracted.coverageCheck;
    }

    return {
        jsonString: JSON.stringify(outputObj, null, 2),
        slideCount: slides.length,
        adjustedFromCount,
    };
}
