/**
 * Language Instruction Generator for AI Prompts
 * 
 * Generates the {output_language_instruction} block to inject into instruction prompts.
 * All prompts are written in English for better model performance.
 * This block controls the OUTPUT language of the generated content.
 * 
 * Modes:
 * - "vi"    : All output in Vietnamese (default, backward compatible)
 * - "en"    : All output in English
 * - "vi-en" : Bilingual - Slide text in English, Speaker Notes in Vietnamese
 */

export function getOutputLanguageInstruction(language: string): string {
    switch (language) {
        case 'en':
            return `**OUTPUT LANGUAGE:** ALL output content MUST be in English. 
This includes: titles, bullet points, speaker notes, questions, answers, feedback, and all text fields in the JSON.`;

        case 'vi-en':
            return `**OUTPUT LANGUAGE — BILINGUAL MODE:**
- Slide titles and bullet content: MUST be in **English**
- Speaker notes (speakerNote): MUST be in **Vietnamese (Tiếng Việt)**
  - Write speaker notes as if a Vietnamese lecturer is explaining English-language slides to Vietnamese students
  - Use natural, conversational Vietnamese teaching style
- Questions, answers, and feedback: MUST be in **English** (matching the language of the slide text)
- Objectives, agenda items: MUST be in **English**
- Summary points: MUST be in **English**
- Closing message: MUST be in **Vietnamese**`;

        case 'vi':
        default:
            return `**OUTPUT LANGUAGE:** ALL output content MUST be in Vietnamese (Tiếng Việt).
This includes: titles, bullet points, speaker notes, questions, answers, feedback, and all text fields in the JSON.
Use natural, academic Vietnamese appropriate for university-level instruction.`;
    }
}

/**
 * Get a brief language label for logging
 */
export function getLanguageLabel(language: string): string {
    switch (language) {
        case 'en': return '🇬🇧 English';
        case 'vi-en': return '🇻🇳🇬🇧 Bilingual';
        case 'vi':
        default: return '🇻🇳 Vietnamese';
    }
}

const VIETNAMESE_CHAR_REGEX = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

const SYSTEM_BOILERPLATE_PATTERNS = [
    /\[Bài tập nghe từ file âm thanh:[^\]]*\]/gi,
    /\[Tài liệu hình ảnh đính kèm:[^\]]*\]/gi,
    /Trạm\s+kiểm\s+soát\s+kiến\s+thức(?:\s*\(Slide\s*\d+\))?/gi,
    /Điểm\s+kiểm\s+tra\s+kiến\s+thức(?:\s*\((?:Sau\s+)?Slide\s*\d+\))?/gi,
    /Hoạt\s+động\s+tương\s+tác\s+kiểm\s+tra\s+kiến\s+thức\s+từ\s+Slide\s+\d+\s+đến\s+Slide\s+\d+\.?/gi,
    /===\s*NỘI DUNG CÁC SLIDE BÀI GIẢNG\s*===/gi,
    /===\s*TÀI LIỆU BỔ SUNG\s*\/?\s*GIÁO TRÌNH\s*===/gi,
    /^(?:Tiêu đề|Nội dung|Lời giảng|Tên bài học|Môn học)\s*:/gim,
];

/**
 * Clean boilerplate wrappers before detecting language of slide/source text
 */
export function cleanTextForLanguageDetection(rawText: string): string {
    if (!rawText) return '';
    let cleaned = String(rawText);
    for (const pattern of SYSTEM_BOILERPLATE_PATTERNS) {
        cleaned = cleaned.replace(pattern, ' ');
    }
    return cleaned.trim();
}

/**
 * Detect whether a piece of text is primarily English ('en') or Vietnamese ('vi').
 * In natural Vietnamese text, 50%–85% of words contain Vietnamese diacritics.
 * If text has >= 2 alphabetic words and < 15% of words contain Vietnamese diacritics, it is classified as 'en'.
 */
export function detectTextLanguage(rawText: string | null | undefined, fallback: 'en' | 'vi' = 'vi'): 'en' | 'vi' {
    const cleaned = cleanTextForLanguageDetection(rawText || '');
    if (!cleaned) return fallback;

    const words = cleaned.match(/[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]{2,}/g) || [];
    if (words.length < 2) return fallback;

    let viWordCount = 0;
    for (const word of words) {
        if (VIETNAMESE_CHAR_REGEX.test(word)) {
            viWordCount++;
        }
    }

    const viRatio = viWordCount / words.length;
    return viRatio < 0.15 ? 'en' : 'vi';
}

/**
 * Extract only the visible slide text (titles, bullet points, optimized content)
 * without speaker notes (since bilingual lessons may have English slides + Vietnamese speaker notes).
 */
export function extractSlideVisibleText(slides: Array<any> | null | undefined): string {
    if (!Array.isArray(slides) || slides.length === 0) return '';
    const chunks: string[] = [];

    for (const s of slides) {
        if (!s) continue;
        if (typeof s.title === 'string' && s.title.trim()) {
            chunks.push(s.title.trim());
        }

        // Optimized bullets (either array or JSON string)
        let optBullets: any[] | null = null;
        if (Array.isArray(s.optimizedContent)) {
            optBullets = s.optimizedContent;
        } else if (typeof s.optimizedContentJson === 'string' && s.optimizedContentJson.trim()) {
            try {
                const parsed = JSON.parse(s.optimizedContentJson);
                if (Array.isArray(parsed)) optBullets = parsed;
            } catch {
                // ignore
            }
        } else if (Array.isArray(s.optimizedContentJson)) {
            optBullets = s.optimizedContentJson;
        }

        if (optBullets && optBullets.length > 0) {
            for (const b of optBullets) {
                if (b && typeof b === 'object') {
                    if (b.point) chunks.push(String(b.point));
                    if (b.description) chunks.push(String(b.description));
                }
            }
        }

        if (Array.isArray(s.content)) {
            chunks.push(s.content.filter(Boolean).join(' '));
        } else if (typeof s.content === 'string' && s.content.trim()) {
            chunks.push(s.content.trim());
        }
    }

    return cleanTextForLanguageDetection(chunks.join('\n'));
}

/**
 * Resolve the target language ('en' | 'vi') for generating interactive/review questions:
 * 1. Explicit user choice ('en' or 'vi') via UI selector takes highest priority.
 * 2. In 'auto' mode (or when not specified):
 *    - Inspect visible text on the target slides / source text first: if slide text is English, return 'en'.
 *    - Otherwise fall back to subject/session language ('en' or 'vi-en' -> 'en', 'vi' -> 'vi').
 */
export function resolveQuestionLanguage(params: {
    requestedLanguage?: string | null;
    explicitChoice?: string | null;
    subjectLanguage?: string | null;
    sessionLanguage?: string | null;
    subjectOrSessionLanguage?: string | null;
    sourceText?: string | null;
    slideVisibleText?: string | null;
    slides?: Array<any> | null;
}): 'en' | 'vi' {
    const req = (params.requestedLanguage || params.explicitChoice || '').trim().toLowerCase();
    if (req === 'en') return 'en';
    if (req === 'vi') return 'vi';

    const subjLang = (params.subjectLanguage || params.subjectOrSessionLanguage || '').trim().toLowerCase();
    const sessLang = (params.sessionLanguage || params.subjectOrSessionLanguage || '').trim().toLowerCase();
    const configFallback: 'en' | 'vi' =
        subjLang === 'en' || subjLang === 'vi-en' || sessLang === 'en' ? 'en' : 'vi';

    // Check visible text on slides first if provided
    const visibleSlideText = extractSlideVisibleText(params.slides);
    const cleanedSource = cleanTextForLanguageDetection(params.slideVisibleText || params.sourceText || '');

    const textToInspect = visibleSlideText.length >= 10
        ? visibleSlideText
        : (cleanedSource || visibleSlideText);

    const words = textToInspect.match(/[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]{2,}/g) || [];
    if (words.length >= 2) {
        return detectTextLanguage(textToInspect, configFallback);
    }

    return configFallback;
}
