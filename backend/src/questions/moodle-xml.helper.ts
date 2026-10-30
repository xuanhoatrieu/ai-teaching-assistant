/**
 * Moodle XML Export Helper
 *
 * Generates Moodle-compatible XML from ReviewQuestion[] data.
 * XML follows the standard Moodle multichoice format with CDATA-wrapped HTML.
 * Questions are grouped by Bloom's Taxonomy level into categories:
 *   - muc_1_biet (Remember)
 *   - muc_2_hieu (Understand)
 *   - muc_3_van_dung (Apply)
 */

export interface ReviewQuestionData {
    questionId: string;
    level: number;
    question: string;
    correctAnswer: string;
    optionB: string;
    optionC: string;
    optionD: string;
    explanation?: string | null;
}

/**
 * Escape special XML characters in text content.
 * CDATA blocks handle most cases, but we still need to sanitize
 * any stray ]]> sequences inside the content.
 */
export function escapeForCdata(text: any): string {
    if (text === null || text === undefined) return '';
    if (typeof text === 'object') {
        try {
            return JSON.stringify(text);
        } catch {
            return String(text);
        }
    }
    // Split ]]> to prevent CDATA injection
    return stripInvalidXmlChars(String(text)).replace(/]]>/g, ']]]]><![CDATA[>');
}

/**
 * Remove characters that are illegal in XML 1.0 even inside CDATA
 * (C0 control chars except TAB/LF/CR). They make Moodle's parser abort.
 */
function stripInvalidXmlChars(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

/**
 * Escape text for a plain XML text node (NOT wrapped in CDATA), e.g. <name><text>.
 * Without this, an "&" or "<" in a question name breaks the whole import file
 * (Moodle: "Error parsing XML: XML_ERR_NAME_REQUIRED").
 */
export function escapeXmlText(text: any): string {
    if (text === null || text === undefined) return '';
    const str = typeof text === 'object' ? escapeForCdata(text) : String(text);
    return stripInvalidXmlChars(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Wrap text in CDATA HTML paragraph for Moodle questiontext/answer fields.
 */
function cdataHtml(text: any): string {
    return `<![CDATA[<p class="cell">${escapeForCdata(text)}</p>]]>`;
}

/**
 * Strips option prefixes like "A. ", "A) ", "(A) ", "[A] ", "A - ", "1. " from answer text.
 * Prevents double-lettering when Moodle adds <answernumbering> (e.g. avoiding "A. A. ...").
 * Loops until all nested/duplicated prefixes are removed.
 */
export function stripOptionPrefix(text: any): string {
    if (text === null || text === undefined) return '';
    const original = (typeof text === 'object' ? JSON.stringify(text) : String(text)).trim();
    if (!original) return '';

    let cur = original;
    let prev = '';
    while (cur !== prev) {
        prev = cur;
        cur = cur
            .replace(/^\s*\(\s*[A-Ja-j\d]+\s*\)\s*/, '')
            .replace(/^\s*\[\s*[A-Ja-j\d]+\s*\]\s*/, '')
            .replace(/^\s*[A-Ja-j\d]+\s*[\.\)\:\-]\s+/, '')
            .replace(/^\s*[A-Da-d]\s*[\.\)]\s*(?=[^\s\d\.\)])/, '')
            .trim();
    }

    return cur || original;
}

/**
 * Cleans explanation text by removing letter-dependent phrases like:
 * "Vì: A đúng vì...", "A đúng vì...", "Phương án A đúng vì...", "Chọn A vì...",
 * converting them to neutral statements suitable for randomized/shuffled choices.
 */
export function cleanExplanation(text: any): string {
    if (text === null || text === undefined) return '';
    let str = (typeof text === 'object' ? JSON.stringify(text) : String(text)).trim();
    if (!str) return '';

    // Remove leading labels like "Vì:", "Giải thích:", "Explanation:", "Gợi ý:"
    str = str.replace(/^(?:Vì|Giải thích|Explanation|Gợi ý)\s*:\s*/i, '').trim();

    // Strip letter-based phrases at the start
    // e.g. "Vì A đúng vì...", "A đúng vì...", "Phương án A là đáp án đúng vì...", "Đáp án A đúng do...", "Chọn A vì..."
    str = str.replace(/^(?:vì\s+)?(?:phương án|lựa chọn|đáp án|câu)?\s*[A-Da-d]\s+(?:là\s+(?:đáp án\s+)?(?:chính xác|đúng)(?:\s+nhất)?|đúng)\s*(?:vì|do|bởi vì|\s*,\s*vì|\s*:|\s*-)\s*/i, '');
    str = str.replace(/^(?:vì\s+)?(?:phương án|lựa chọn|đáp án|câu)?\s*[A-Da-d]\s+(?:sai|không đúng)\s*(?:vì|do|bởi vì|\s*,\s*vì|\s*:|\s*-)\s*/i, '');
    str = str.replace(/^chọn\s+[A-Da-d]\s+(?:vì|do|bởi vì)\s*/i, '');
    str = str.replace(/^(?:Option|Answer)?\s*[A-Da-d]\s+is\s+(?:the\s+)?(?:correct|right)(?:\s+answer)?\s*(?:because|as|since|\s*:\s*)\s*/i, '');
    str = str.replace(/^(?:Option|Answer)?\s*[A-Da-d]\s+is\s+(?:incorrect|wrong)\s*(?:because|as|since|\s*:\s*)\s*/i, '');

    // Capitalize first character
    if (str.length > 0) {
        str = str.charAt(0).toUpperCase() + str.slice(1);
    }
    return str;
}

/**
 * Build a single multichoice question XML block.
 */
function buildQuestionXml(q: ReviewQuestionData): string {
    const cleanCorrect = stripOptionPrefix(q.correctAnswer);
    const cleanB = stripOptionPrefix(q.optionB);
    const cleanC = stripOptionPrefix(q.optionC);
    const cleanD = stripOptionPrefix(q.optionD);
    const explanation = cleanExplanation(q.explanation);

    const feedbackParts: string[] = [];
    if (cleanCorrect) {
        feedbackParts.push(`<strong>Đáp án đúng: </strong>${escapeForCdata(cleanCorrect)}`);
    }
    if (explanation) {
        feedbackParts.push(`<strong>Giải thích: </strong>${escapeForCdata(explanation)}`);
    }
    const feedbackHtml = feedbackParts.map((p) => `<p class="cell">${p}</p>`).join('\n      ');

    // Build question name: "B1-1-01: Nội dung câu hỏi" (truncate to 200 chars for readability)
    const questionPreview = q.question.length > 200 ? q.question.substring(0, 197) + '...' : q.question;
    const questionName = `${q.questionId}: ${questionPreview}`;

    return `  <question type="multichoice">
    <name><text>${escapeXmlText(questionName)}</text></name>
    <questiontext format="html">
      <text>${cdataHtml(q.question)}</text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${feedbackHtml}]]></text>
    </generalfeedback>
    <defaultgrade>1.0000000</defaultgrade>
    <penalty>0.3333333</penalty>
    <hidden>0</hidden>
    <single>true</single>
    <shuffleanswers>true</shuffleanswers>
    <answernumbering>ABCD</answernumbering>
    <answer fraction="100" format="html">
      <text>${cdataHtml(cleanCorrect)}</text>
    </answer>
    <answer fraction="0" format="html">
      <text>${cdataHtml(cleanB)}</text>
    </answer>
    <answer fraction="0" format="html">
      <text>${cdataHtml(cleanC)}</text>
    </answer>
    <answer fraction="0" format="html">
      <text>${cdataHtml(cleanD)}</text>
    </answer>
  </question>`;
}

/**
 * Build a category marker XML block for Moodle.
 */
function buildCategoryXml(lessonSlug: string, levelSlug: string): string {
    return `  <question type="category">
    <category>
      <text>$course$/top/${lessonSlug}/${levelSlug}</text>
    </category>
  </question>`;
}

const LEVEL_CONFIG: Record<number, { slug: string; label: string }> = {
    1: { slug: 'muc_1_biet', label: 'Mức 1 - Biết (Remember)' },
    2: { slug: 'muc_2_hieu', label: 'Mức 2 - Hiểu (Understand)' },
    3: { slug: 'muc_3_van_dung', label: 'Mức 3 - Vận dụng (Apply)' },
};

/**
 * Build complete Moodle XML from an array of ReviewQuestions.
 *
 * @param questions - Array of review questions from DB
 * @param lessonTitle - Lesson title for category path
 * @returns Complete XML string ready for download
 */
export function buildMoodleXml(
    questions: ReviewQuestionData[],
    lessonTitle: string,
): string {
    // Create a URL-safe slug from lesson title
    const lessonSlug = lessonTitle
        .replace(/[^\w\sàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi, '')
        .replace(/\s+/g, '_')
        .substring(0, 50)
        .replace(/^_+|_+$/g, '') || 'lesson';

    // Group questions by Bloom's level
    const grouped = new Map<number, ReviewQuestionData[]>();
    for (const q of questions) {
        const level = q.level || 1;
        if (!grouped.has(level)) grouped.set(level, []);
        grouped.get(level)!.push(q);
    }

    // Build XML
    const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<quiz>', ''];

    // Process levels 1, 2, 3 in order
    for (const level of [1, 2, 3]) {
        const levelQuestions = grouped.get(level);
        if (!levelQuestions || levelQuestions.length === 0) continue;

        const config = LEVEL_CONFIG[level] || LEVEL_CONFIG[1];

        parts.push(`  <!-- ${config.label} (${levelQuestions.length} câu) -->`);
        parts.push(buildCategoryXml(lessonSlug, config.slug));
        parts.push('');

        for (const q of levelQuestions) {
            parts.push(buildQuestionXml(q));
            parts.push('');
        }
    }

    parts.push('</quiz>');
    return parts.join('\n');
}

// ==================== ENGLISH QUESTIONS POLYMORPHIC XML BUILDER ====================

export interface EnglishQuestionData {
    id: string;
    questionOrder: number;
    questionType: string; // MC, MR, MATCH, CLOZE, SHORTANSWER, TRUEFALSE, ESSAY
    subDiscipline?: string | null;
    difficulty?: number;
    title?: string | null;
    questionText: string;
    dataJson: string; // JSON with options/pairs/blanks/keys/rubric
    explanation?: string | null;
    points?: number;
}

/**
 * Moodle predefined grade options (percentages as numbers/strings)
 */
const MOODLE_POSITIVE_FRACTIONS: Record<number, string> = {
    1: '100',
    2: '50',
    3: '33.33333',
    4: '25',
    5: '20',
    6: '16.66667',
    7: '14.28571',
    8: '12.5',
    9: '11.11111',
    10: '10',
};

const MOODLE_NEGATIVE_FRACTIONS: Record<number, string> = {
    1: '-100',
    2: '-50',
    3: '-33.33333',
    4: '-25',
    5: '-20',
    6: '-16.66667',
    7: '-14.28571',
    8: '-12.5',
    9: '-11.11111',
    10: '-10',
};

/**
 * Extract and normalize lesson number and title.
 * Automatically pads single-digit lesson numbers (< 10) with leading zero (e.g., 'Bài 1' -> 'Bài 01', 'bai2' -> 'Bài 02').
 * Returns { lessonCode: 'B01', normalizedTitle: 'Bài 01 - Giới thiệu', lessonNumber: 1 }.
 */
export function extractAndNormalizeLesson(rawTitle: string): {
    lessonCode: string;
    normalizedTitle: string;
    lessonNumber: number;
} {
    if (!rawTitle || typeof rawTitle !== 'string') {
        return { lessonCode: 'B01', normalizedTitle: 'Bài 01', lessonNumber: 1 };
    }

    let cleaned = rawTitle.replace(/\.pptx$/i, '').trim();

    // 1. Try to find lesson number from common patterns
    let lessonNum: number | null = null;
    const patterns = [
        /(?:bài|bai|lesson|unit|chương|chuong)\s*0*(\d+)/i,
        /\bB0*(\d+)\b/i,
        /(?:^|[\s_\-])0*(\d+)(?:[\s.:_\-]|$)/,
    ];

    for (const pat of patterns) {
        const m = cleaned.match(pat);
        if (m && m[1]) {
            lessonNum = parseInt(m[1], 10);
            break;
        }
    }

    if (lessonNum === null || isNaN(lessonNum) || lessonNum <= 0) {
        lessonNum = 1;
    }

    const paddedNum = String(lessonNum).padStart(2, '0');
    const lessonCode = 'B' + paddedNum;

    // 2. Normalize the title string so any single digit (<10) is padded to 2 digits
    let normalizedTitle = cleaned;

    // Replace 'Bài 1', 'Bai 2', 'Lesson 3', 'Unit 4', 'Chương 5' with single digit
    normalizedTitle = normalizedTitle.replace(
        /(bài|bai|lesson|unit|chương|chuong)\s*(\d)(?!\d)/gi,
        (_match, prefix, digit) => prefix + ' ' + String(digit).padStart(2, '0'),
    );

    // Replace leading number like '1. ', '2 - ', '3: '
    normalizedTitle = normalizedTitle.replace(
        /^(\s*)(\d)([\s.:\-_])/g,
        (_match, space, digit, delim) => space + String(digit).padStart(2, '0') + delim,
    );

    // If title has no 'Bài' or 'Lesson' or 'Unit' but was just 'bai02' -> 'Bài 02'
    if (/^bai\s*0*\d+$/i.test(cleaned)) {
        normalizedTitle = 'Bài ' + paddedNum;
    }

    return { lessonCode, normalizedTitle, lessonNumber: lessonNum };
}

/**
 * Format question name for Moodle XML (Cách 1):
 * Format: `${lessonCode}-${qCode}: ${preview}`
 * e.g., "B01-ENG-01: What is the principal array object provided by NumPy?"
 */
export function formatEnglishQuestionName(
    q: EnglishQuestionData,
    lessonCode: string = 'B01',
    defaultTypePrefix: string = 'ENG',
): string {
    const orderNum = q.questionOrder || 1;
    const paddedOrder = String(orderNum).padStart(2, '0');

    // Extract or build question code (e.g. ENG-01, MATCH-01, PHON-01)
    let qCode = '';
    if (q.title && q.title.trim()) {
        const titleTrimmed = q.title.trim();
        // If title already has something like "ENG-1" or "PHON-2" or "ENG-01" or "ENG 1"
        const match = titleTrimmed.match(/^([A-Za-z]+)[-_ ]*0*(\d+)/);
        if (match) {
            const prefix = match[1].toUpperCase();
            const num = String(match[2]).padStart(2, '0');
            qCode = `${prefix}-${num}`;
        } else {
            qCode = titleTrimmed.length <= 15 ? titleTrimmed : `${defaultTypePrefix}-${paddedOrder}`;
        }
    } else {
        qCode = `${defaultTypePrefix}-${paddedOrder}`;
    }

    // Clean question preview (strip cloze brackets/HTML/excess whitespace, limit to 80 chars)
    let preview = (q.questionText || '')
        .replace(/\{\d+:[A-Za-z_]+:[^}]*\}/gi, '___')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (preview.length > 80) {
        preview = preview.substring(0, 77) + '...';
    }

    if (!preview) {
        return `${lessonCode}-${qCode}`;
    }

    return `${lessonCode}-${qCode}: ${preview}`;
}

function toCleanStringList(value: any): string[] {
    const list = Array.isArray(value) ? value : (value !== undefined && value !== null ? [value] : []);
    return list
        .map((v) => (typeof v === 'object' && v !== null ? (v.text ?? v.answer ?? v.value ?? '') : v))
        .map((v) => String(v ?? '').trim())
        .filter((v) => v.length > 0);
}

// ==================== IMPORT-SAFETY HELPERS ====================
// Every rule below mirrors a check in Moodle 4.x that aborts the WHOLE import
// ("Stop on error" is on by default), see question/format.php importprocess(),
// qtype_*::save_question_options() and qtype_multianswer_validate_question().

/** Moodle DB columns are numeric: "1.5.0000000" or "NaN.0000000" makes the insert fail. */
function formatGrade(points: any, fallback: number): string {
    const n = Number(points);
    return (Number.isFinite(n) && n > 0 ? n : fallback).toFixed(7);
}

/** Text without HTML tags/whitespace, used only to decide whether something is "empty". */
function plainText(value: any): string {
    return String(value ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
}

/** Safe content for an XML comment ("--" is illegal inside comments). */
function commentSafe(text: string): string {
    return String(text).replace(/-{2,}/g, '-').replace(/[<>]/g, '');
}

/**
 * Returns empty string when the data cannot form a valid auto-graded question
 * so Moodle XML export strictly contains 100% auto-gradable questions (never <question type="essay">).
 */
function essayFallback(_q: EnglishQuestionData, _data: any, _lessonCode: string, _answerKey: string[]): string {
    return '';
}

// ---------- Multiple choice ----------

interface NormalizedOption { text: string; correct: boolean; feedback?: string }

const OPTION_LETTERS = 'ABCDEFGHIJ';

function normalizeOptions(data: any): NormalizedOption[] {
    const rawList = Array.isArray(data?.options) ? data.options
        : Array.isArray(data?.choices) ? data.choices
        : Array.isArray(data?.answers) ? data.answers : [];

    const options: NormalizedOption[] = rawList.map((o: any) => {
        if (o === null || o === undefined) return { text: '', correct: false };
        if (typeof o !== 'object') return { text: stripOptionPrefix(String(o)), correct: false };
        const rawText = o.text ?? o.option ?? o.label ?? o.value ?? o.answer ?? o.content ?? '';
        const text = stripOptionPrefix(typeof rawText === 'object' ? JSON.stringify(rawText) : String(rawText));
        const frac = typeof o.fraction === 'string' ? parseFloat(o.fraction) : o.fraction;
        const correct = o.isCorrect === true || o.correct === true || o.isCorrect === 'true'
            || (typeof frac === 'number' && frac > 0);
        return { text, correct, feedback: o.feedback ? cleanExplanation(o.feedback) : undefined };
    });

    // Answer key given separately: correctAnswer = "B" | 1 | "text" | ["A","C"]
    if (!options.some((o) => o.correct)) {
        const keys = toCleanStringList(data?.correctAnswers ?? data?.correctAnswer ?? data?.answer);
        for (const key of keys) {
            const letterIdx = /^[A-J]$/i.test(key) ? OPTION_LETTERS.indexOf(key.toUpperCase()) : -1;
            const numIdx = /^\d+$/.test(key) ? parseInt(key, 10) : -1;
            const byText = options.findIndex((o) => plainText(o.text).toLowerCase() === stripOptionPrefix(key).toLowerCase());
            const idx = byText >= 0 ? byText : (letterIdx >= 0 ? letterIdx : (numIdx >= 0 && numIdx < options.length ? numIdx : -1));
            if (idx >= 0 && options[idx]) options[idx].correct = true;
        }
    }

    // Moodle silently drops answers whose text is empty -> they must not count.
    return options.filter((o) => plainText(o.text) !== '');
}

/**
 * Build Moodle XML for Multiple Choice / Multiple Response
 */
function buildEnglishMultichoiceXml(q: EnglishQuestionData, data: any, lessonCode: string = 'B01'): string {
    const isSingle = data.single !== false && q.questionType.toUpperCase() !== 'MR';
    const options = normalizeOptions(data);
    const correctOptions = options.filter((o) => o.correct);

    // Moodle: "at least 2 answers" (error -> whole import aborted).
    // No identifiable correct option: previously option A was silently marked correct
    // (wrong answer key). Export for manual grading instead.
    if (options.length < 2 || correctOptions.length === 0) {
        return essayFallback(q, data, lessonCode, correctOptions.map((o) => plainText(o.text)));
    }

    const cleanedExplanation = cleanExplanation(q.explanation);
    const feedbackHtml = cleanedExplanation ? `<p class="cell"><strong>Explanation: </strong>${escapeForCdata(cleanedExplanation)}</p>` : '';

    let fractions: string[];
    if (isSingle) {
        // Single choice: exactly 1 correct answer (100%), all others 0% (first correct wins).
        const correctIdx = options.findIndex((o) => o.correct);
        fractions = options.map((_, idx) => (idx === correctIdx ? '100' : '0'));
    } else {
        const correctCount = correctOptions.length;
        const incorrectCount = options.length - correctCount;
        // Fractions must be in Moodle's fixed grade list, otherwise "invalid grade" aborts the import.
        const positiveFraction = MOODLE_POSITIVE_FRACTIONS[correctCount];
        if (!positiveFraction) {
            return essayFallback(q, data, lessonCode, correctOptions.map((o) => plainText(o.text)));
        }
        const negativeFraction = incorrectCount > 0 ? (MOODLE_NEGATIVE_FRACTIONS[incorrectCount] || '0') : '0';
        fractions = options.map((o) => (o.correct ? positiveFraction : negativeFraction));
    }

    const answersXml = options.map((opt, idx) => {
        const optFeedback = opt.feedback
            ? `\n      <feedback format="html"><text><![CDATA[<p>${escapeForCdata(opt.feedback)}</p>]]></text></feedback>`
            : '';
        return `    <answer fraction="${fractions[idx]}" format="html">
      <text>${cdataHtml(opt.text)}</text>${optFeedback}
    </answer>`;
    }).join('\n');

    const name = formatEnglishQuestionName(q, lessonCode, 'ENG');

    return `  <question type="multichoice">
    <name><text>${escapeXmlText(name)}</text></name>
    <questiontext format="html">
      <text>${cdataHtml(q.questionText)}</text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${feedbackHtml}]]></text>
    </generalfeedback>
    <defaultgrade>${formatGrade(q.points, 1)}</defaultgrade>
    <penalty>0.3333333</penalty>
    <single>${isSingle ? 'true' : 'false'}</single>
    <shuffleanswers>true</shuffleanswers>
    <answernumbering>ABCD</answernumbering>
${answersXml}
  </question>`;
}

export interface MatchPair {
    sub: string;
    ans: string;
}

/**
 * Check if the question text indicates a matching/pairing intent.
 */
export function isMatchingQuestionText(text?: string | null): boolean {
    if (!text) return false;
    const lower = text.trim().toLowerCase();
    return (
        lower.startsWith('ghép') ||
        lower.startsWith('nối') ||
        lower.startsWith('hãy ghép') ||
        lower.startsWith('hãy nối') ||
        lower.startsWith('match') ||
        lower.startsWith('pair') ||
        lower.startsWith('connect') ||
        lower.includes('ghép mỗi') ||
        lower.includes('nối mỗi') ||
        lower.includes('ghép các') ||
        lower.includes('nối các') ||
        lower.includes('ghép cặp') ||
        lower.includes('nối cặp') ||
        lower.includes('match each') ||
        lower.includes('match the following')
    );
}

/**
 * Parse pairs from bulleted or numbered text lines if the AI embedded pairs in question text / explanation.
 * e.g. "1. Term A: Definition A\n2. Term B - Definition B"
 */
function parsePairsFromText(text: string): MatchPair[] {
    if (!text || typeof text !== 'string') return [];
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed: MatchPair[] = [];
    const delimRegex = /\s*(?:[-–—→\:]|->|\t|\|)\s*/;

    for (const rawLine of lines) {
        // Strip leading numbering/bullets: "1.", "1)", "(1)", "a.", "- ", "* "
        const line = rawLine.replace(/^(?:[\d]+[\.\)]|\([A-Za-z\d]+\)|[A-Za-z][\.\)]|[\*\-\•])\s*/, '').trim();
        const parts = line.split(delimRegex);
        if (parts.length >= 2) {
            const left = parts[0].trim();
            const right = parts.slice(1).join(' - ').trim();
            if (plainText(left).length > 0 && right.length > 0 && left.length < 200 && right.length < 300) {
                parsed.push({ sub: left, ans: right });
            }
        }
    }
    return parsed.length >= 2 ? parsed : [];
}

/**
 * Clean question prompt text when pairs were extracted directly from the question text
 * to avoid leaking the answers in the question prompt.
 */
function cleanMatchingQuestionText(text: string, pairs: MatchPair[], extractedFromText: boolean): string {
    if (!extractedFromText || !text) return text;
    const lines = text.split(/\r?\n/);
    const keptLines: string[] = [];
    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        const isPairLine = pairs.some((p) => trimmed.includes(p.sub) && trimmed.includes(p.ans));
        if (!isPairLine) {
            keptLines.push(rawLine);
        }
    }
    const result = keptLines.join('\n').trim();
    return result || text;
}

/**
 * Robustly extract matching pairs from diverse JSON structures generated by AI:
 * - data.pairs: [{ left, right }]
 * - data.matchingPairs, data.matches, data.items, data.subquestions
 * - data as an Array directly
 * - Parallel arrays: columnA & columnB, left & right, terms & definitions
 * - Key-value map: { "term": "definition" }
 * - Text fallback: lines in questionText / explanation
 */
export function extractMatchPairs(data: any, questionText?: string, explanation?: string): { pairs: MatchPair[]; fromText: boolean } {
    let rawList: any[] = [];
    let fromText = false;

    // 1. Direct array or properties containing pairs
    if (Array.isArray(data)) {
        rawList = data;
    } else if (typeof data === 'object' && data !== null) {
        rawList = Array.isArray(data.pairs) ? data.pairs
            : Array.isArray(data.matchingPairs) ? data.matchingPairs
            : Array.isArray(data.matches) ? data.matches
            : Array.isArray(data.items) ? data.items
            : Array.isArray(data.subquestions) ? data.subquestions
            : Array.isArray(data.options) && data.options.some((o: any) => typeof o === 'object' && (o.left || o.subquestion || o.match || o.term || o.columnA || o.right || o.definition || o.component || o.function)) ? data.options
            : [];

        // 1.2 Two parallel arrays: columnA & columnB, or left & right, or terms & definitions
        if (rawList.length === 0) {
            const leftList = Array.isArray(data.columnA) ? data.columnA
                : Array.isArray(data.left) ? data.left
                : Array.isArray(data.terms) ? data.terms
                : Array.isArray(data.questions) ? data.questions
                : Array.isArray(data.components) ? data.components
                : null;
            const rightList = Array.isArray(data.columnB) ? data.columnB
                : Array.isArray(data.right) ? data.right
                : Array.isArray(data.definitions) ? data.definitions
                : Array.isArray(data.answers) ? data.answers
                : Array.isArray(data.functions) ? data.functions
                : null;
            if (leftList && rightList && leftList.length > 0 && rightList.length > 0) {
                const minLen = Math.min(leftList.length, rightList.length);
                rawList = [];
                for (let i = 0; i < minLen; i++) {
                    rawList.push({ left: leftList[i], right: rightList[i] });
                }
            }
        }

        // 1.3 Key-value object mapping: e.g. { "term1": "def1", "term2": "def2" }
        if (rawList.length === 0 && data.pairs && typeof data.pairs === 'object' && !Array.isArray(data.pairs)) {
            rawList = Object.entries(data.pairs).map(([k, v]) => ({ left: k, right: v }));
        }
        if (rawList.length === 0 && data.matchingPairs && typeof data.matchingPairs === 'object' && !Array.isArray(data.matchingPairs)) {
            rawList = Object.entries(data.matchingPairs).map(([k, v]) => ({ left: k, right: v }));
        }
    }

    // 2. Map items to { sub, ans } supporting multiple synonym key names and 2-key objects
    const qKeys = ['subquestion', 'sub', 'left', 'term', 'question', 'prompt', 'item', 'concept', 'statement', 'A', 'columnA', 'key', 'name'];
    const aKeys = ['answer', 'ans', 'right', 'definition', 'match', 'target', 'description', 'function', 'meaning', 'component', 'value', 'B', 'columnB'];

    let pairs: MatchPair[] = rawList
        .map((pair) => {
            if (!pair || typeof pair !== 'object') return { sub: '', ans: '' };

            const keys = Object.keys(pair);
            let sub = '';
            let ans = '';

            const foundSubKey = keys.find((k) => qKeys.includes(k.toLowerCase()));
            const foundAnsKey = keys.find((k) => aKeys.includes(k.toLowerCase()) && k !== foundSubKey);

            if (foundSubKey && foundAnsKey) {
                sub = String(pair[foundSubKey] ?? '').trim();
                ans = String(pair[foundAnsKey] ?? '').trim();
            } else if (keys.length === 2) {
                sub = String(pair[keys[0]] ?? '').trim();
                ans = String(pair[keys[1]] ?? '').trim();
            } else {
                sub = String(
                    pair.subquestion ??
                    pair.left ??
                    pair.term ??
                    pair.question ??
                    pair.prompt ??
                    pair.item ??
                    pair.concept ??
                    pair.component ??
                    pair.statement ??
                    pair.A ??
                    pair.columnA ??
                    pair.key ??
                    pair.name ??
                    ''
                ).trim();

                ans = String(
                    pair.answer ??
                    pair.right ??
                    pair.definition ??
                    pair.match ??
                    pair.target ??
                    pair.description ??
                    pair.function ??
                    pair.meaning ??
                    pair.component ??
                    pair.B ??
                    pair.columnB ??
                    pair.value ??
                    ''
                ).trim();
            }

            return { sub, ans };
        })
        .filter((p) => plainText(p.sub) !== '' && p.ans !== '');

    // 3. Fallback: Parse from text if pairs are empty or < 2 and text has bulleted pairs
    if (pairs.length < 2 && questionText) {
        const textPairs = parsePairsFromText(questionText);
        if (textPairs.length >= 2) {
            pairs = textPairs;
            fromText = true;
        }
    }

    if (pairs.length < 2 && explanation) {
        const textPairs = parsePairsFromText(explanation);
        if (textPairs.length >= 2) {
            pairs = textPairs;
        }
    }

    return { pairs, fromText };
}

/**
 * Build Moodle XML for Matching question
 */
function buildEnglishMatchXml(
    q: EnglishQuestionData,
    data: any,
    lessonCode: string = 'B01',
    preExtracted?: { pairs: MatchPair[]; fromText: boolean },
): string {
    const { pairs, fromText } = preExtracted || extractMatchPairs(data, q.questionText, q.explanation || '');

    if (pairs.length < 2) {
        return essayFallback(q, data, lessonCode, pairs.map((p) => `${plainText(p.sub)} → ${p.ans}`));
    }

    const name = formatEnglishQuestionName(q, lessonCode, 'MATCH');
    const cleanedExplanation = cleanExplanation(q.explanation);
    const feedbackHtml = cleanedExplanation ? `<p class="cell"><strong>Explanation: </strong>${escapeForCdata(cleanedExplanation)}</p>` : '';

    const subquestionsXml = pairs.map((p) => `    <subquestion format="html">
      <text>${cdataHtml(p.sub)}</text>
      <answer>
        <text>${escapeXmlText(p.ans)}</text>
      </answer>
    </subquestion>`);

    // Extra right-hand options (distractors) = sub-question with empty text, supported by Moodle.
    const used = new Set(pairs.map((p) => p.ans));
    for (const extra of toCleanStringList(data?.rightOptions ?? data?.distractors)) {
        if (used.has(extra)) continue;
        used.add(extra);
        subquestionsXml.push(`    <subquestion format="html">
      <text></text>
      <answer>
        <text>${escapeXmlText(extra)}</text>
      </answer>
    </subquestion>`);
    }

    const finalQuestionText = cleanMatchingQuestionText(q.questionText, pairs, fromText);

    return `  <question type="match">
    <name><text>${escapeXmlText(name)}</text></name>
    <questiontext format="html">
      <text>${cdataHtml(finalQuestionText)}</text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${feedbackHtml}]]></text>
    </generalfeedback>
    <defaultgrade>${formatGrade(q.points, 1)}</defaultgrade>
    <penalty>0.3333333</penalty>
    <shuffleanswers>true</shuffleanswers>
${subquestionsXml.join('\n')}
  </question>`;
}

// ---------- Cloze (embedded answers) ----------
// Exact port of Moodle's parser regexes (question/type/multianswer/questiontype.php).

const CLOZE_TYPE_DEF =
    '(NUMERICAL|NM)|(MULTICHOICE|MC)|(MULTICHOICE_V|MCV)|(MULTICHOICE_H|MCH)|' +
    '(SHORTANSWER|SA|MW)|(SHORTANSWER_C|SAC|MWC)|' +
    '(MULTICHOICE_S|MCS)|(MULTICHOICE_VS|MCVS)|(MULTICHOICE_HS|MCHS)|' +
    '(MULTIRESPONSE|MR)|(MULTIRESPONSE_H|MRH)|(MULTIRESPONSE_S|MRS)|(MULTIRESPONSE_HS|MRHS)';
const CLOZE_ALT_SRC =
    String.raw`(=|%(-?[0-9]+(?:[.,][0-9]*)?)%)?` +
    String.raw`(.+?(?<!\\|&|&amp;)(?=[~#}]|$))` +
    String.raw`(#(.*?(?<!\\)(?=[~}]|$)))?`;
const CLOZE_ANSWER_SRC =
    String.raw`\{([0-9]*):(` + CLOZE_TYPE_DEF + String.raw`):(` +
    CLOZE_ALT_SRC + '(~' + CLOZE_ALT_SRC + String.raw`)*)\}`;
const CLOZE_NUMBER_RE = /^-?(([0-9]+[.,]?[0-9]*|[.,][0-9]+)([eE][-+]?[0-9]+)?)(:-?(([0-9]+[.,]?[0-9]*|[.,][0-9]+)([eE][-+]?[0-9]+)?))?$/;
/** Anything that looks like an embedded answer, even malformed: {1:shortanswer:word} */
const CLOZE_LOOSE_TOKEN_RE = /\{(\d*):([A-Za-z_]+):([^{}]*)\}/g;
/** Raw blanks the AI sometimes leaves instead of embedded answers: "___" */
const RAW_BLANK_RE = /_{2,}/g;

/**
 * Same checks as qtype_multianswer_validate_question(). Returns [] when Moodle will accept it.
 */
export function validateClozeText(text: string): string[] {
    const errors: string[] = [];
    let count = 0;
    for (const m of text.matchAll(new RegExp(CLOZE_ANSWER_SRC, 'gs'))) {
        count++;
        const isNumerical = !!m[3];
        const isMultiResponse = !!(m[12] || m[13] || m[14] || m[15]);
        const isMultiChoice = isMultiResponse || !!(m[4] || m[5] || m[6] || m[9] || m[10] || m[11]);
        const altRe = new RegExp('~?' + CLOZE_ALT_SRC, 's');
        let remaining = m[16];
        let answers = 0;
        let hasFullMark = false;
        let alt: RegExpExecArray | null;
        while (remaining && (alt = altRe.exec(remaining)) && alt[0].length > 0) {
            const fraction = alt[1] === '=' ? 1 : (alt[2] ? 0.01 * parseFloat(alt[2].replace(',', '.')) : 0);
            const answer = (alt[3] || '').trim();
            if (answer !== '') {
                answers++;
                if (isNumerical && !(CLOZE_NUMBER_RE.test(answer) || answer === '*')) {
                    errors.push(`#${count}: numerical answer "${answer}" is not a number`);
                }
                if (fraction === 1 || (isMultiResponse && fraction > 0)) hasFullMark = true;
            }
            remaining = remaining.slice(alt.index + alt[0].length);
        }
        if (isMultiChoice && answers < 2) errors.push(`#${count}: multichoice needs at least 2 answers`);
        else if (answers === 0) errors.push(`#${count}: no answer`);
        if (!hasFullMark) errors.push(`#${count}: no 100% answer`);
    }
    if (count === 0) errors.push('no embedded answers');
    return errors;
}

/** Split Cloze alternatives on "~" that is not escaped with a backslash. */
function splitClozeAlternatives(body: string): string[] {
    return body.split(/(?<!\\)~/);
}

/** Unescape Moodle Cloze escaped characters for clean text comparison / distractor generation. */
function unescapeClozeOption(text: string): string {
    return text.replace(/\\([}#~\/"\\])/g, '$1').trim();
}

/**
 * Escape Moodle Cloze option delimiters (~, #, }) without mangling IPA slashes (/tʃ/).
 * Also strips trailing unescaped backslashes that would escape the closing "}" or "~".
 */
function escapeClozeOption(text: string): string {
    const cleaned = String(text ?? '').trim().replace(/\\+$/, '');
    return cleaned.replace(/([}#~])/g, '\\$1');
}

const IRREGULAR_VERBS: Record<string, { v3s: string; past: string; pp: string; ing: string }> = {
    be: { v3s: 'is', past: 'was', pp: 'been', ing: 'being' },
    do: { v3s: 'does', past: 'did', pp: 'done', ing: 'doing' },
    go: { v3s: 'goes', past: 'went', pp: 'gone', ing: 'going' },
    have: { v3s: 'has', past: 'had', pp: 'had', ing: 'having' },
    leave: { v3s: 'leaves', past: 'left', pp: 'left', ing: 'leaving' },
    drive: { v3s: 'drives', past: 'drove', pp: 'driven', ing: 'driving' },
    sleep: { v3s: 'sleeps', past: 'slept', pp: 'slept', ing: 'sleeping' },
    write: { v3s: 'writes', past: 'wrote', pp: 'written', ing: 'writing' },
    take: { v3s: 'takes', past: 'took', pp: 'taken', ing: 'taking' },
    make: { v3s: 'makes', past: 'made', pp: 'made', ing: 'making' },
    see: { v3s: 'sees', past: 'saw', pp: 'seen', ing: 'seeing' },
    come: { v3s: 'comes', past: 'came', pp: 'come', ing: 'coming' },
    eat: { v3s: 'eats', past: 'ate', pp: 'eaten', ing: 'eating' },
    drink: { v3s: 'drinks', past: 'drank', pp: 'drunk', ing: 'drinking' },
    speak: { v3s: 'speaks', past: 'spoke', pp: 'spoken', ing: 'speaking' },
    buy: { v3s: 'buys', past: 'bought', pp: 'bought', ing: 'buying' },
    teach: { v3s: 'teaches', past: 'taught', pp: 'taught', ing: 'teaching' },
    think: { v3s: 'thinks', past: 'thought', pp: 'thought', ing: 'thinking' },
    run: { v3s: 'runs', past: 'ran', pp: 'run', ing: 'running' },
    begin: { v3s: 'begins', past: 'began', pp: 'begun', ing: 'beginning' },
    give: { v3s: 'gives', past: 'gave', pp: 'given', ing: 'giving' },
    know: { v3s: 'knows', past: 'knew', pp: 'known', ing: 'knowing' },
    read: { v3s: 'reads', past: 'read', pp: 'read', ing: 'reading' },
    find: { v3s: 'finds', past: 'found', pp: 'found', ing: 'finding' },
    tell: { v3s: 'tells', past: 'told', pp: 'told', ing: 'telling' },
    feel: { v3s: 'feels', past: 'felt', pp: 'felt', ing: 'feeling' },
    keep: { v3s: 'keeps', past: 'kept', pp: 'kept', ing: 'keeping' },
    meet: { v3s: 'meets', past: 'met', pp: 'met', ing: 'meeting' },
    send: { v3s: 'sends', past: 'sent', pp: 'sent', ing: 'sending' },
    spend: { v3s: 'spends', past: 'spent', pp: 'spent', ing: 'spending' },
    build: { v3s: 'builds', past: 'built', pp: 'built', ing: 'building' },
};

const CLOSED_CLASS_DISTRACTORS: Record<string, string[]> = {
    do: ['does', 'did', 'are'],
    does: ['do', 'did', 'is'],
    did: ['do', 'does', 'was'],
    am: ['is', 'are', 'was'],
    is: ['are', 'am', 'was'],
    are: ['is', 'am', 'were'],
    was: ['were', 'is', 'are'],
    were: ['was', 'are', 'is'],
    have: ['has', 'had', 'are'],
    has: ['have', 'had', 'is'],
    had: ['have', 'has', 'was'],
    will: ['would', 'can', 'shall'],
    would: ['will', 'could', 'should'],
    can: ['could', 'must', 'may'],
    could: ['can', 'should', 'might'],
    should: ['must', 'would', 'could'],
    must: ['should', 'can', 'may'],
    a: ['an', 'the', 'some'],
    an: ['a', 'the', 'any'],
    the: ['a', 'an', 'some'],
    in: ['on', 'at', 'by'],
    on: ['in', 'at', 'to'],
    at: ['in', 'on', 'for'],
    to: ['for', 'at', 'in'],
    for: ['since', 'to', 'by'],
    since: ['for', 'from', 'during'],
    from: ['to', 'by', 'with'],
    with: ['by', 'from', 'for'],
    by: ['with', 'at', 'on'],
    and: ['but', 'or', 'so'],
    but: ['and', 'so', 'because'],
    because: ['although', 'so', 'unless'],
    although: ['because', 'despite', 'unless'],
    while: ['when', 'during', 'until'],
    when: ['while', 'since', 'until'],
    right: ['left', 'top', 'center'],
    left: ['right', 'bottom', 'center'],
    true: ['false', 'none', 'null'],
    false: ['true', 'none', 'null'],
    who: ['which', 'whom', 'whose'],
    which: ['who', 'where', 'whose'],
    where: ['when', 'which', 'who'],
    whose: ['who', 'whom', 'which'],
};

function matchAnswerCasing(candidate: string, reference: string): string {
    if (!candidate || !reference) return candidate;
    if (reference === reference.toUpperCase() && /[A-Z]/.test(reference)) {
        return candidate.toUpperCase();
    }
    if (/^[A-Z]/.test(reference) && reference.slice(1) === reference.slice(1).toLowerCase()) {
        return candidate.charAt(0).toUpperCase() + candidate.slice(1);
    }
    return candidate;
}

function buildSpellingEquivalents(word: string): string[] {
    const low = word.trim().toLowerCase();
    const eq = new Set<string>([low]);
    eq.add(low.replace(/lling\b/g, 'ling').replace(/lled\b/g, 'led'));
    eq.add(low.replace(/([^l])ling\b/g, '$1lling').replace(/([^l])led\b/g, '$1lled'));
    eq.add(low.replace(/our\b/g, 'or'));
    eq.add(low.replace(/ise\b/g, 'ize'));
    eq.add(low.replace(/ize\b/g, 'ise'));
    return Array.from(eq);
}

function conjugateVerbForms(rawBase: string): { base: string; v3s: string; past: string; ing: string; pp: string } {
    const clean = rawBase.trim().toLowerCase().replace(/^to\s+/, '');
    const parts = clean.split(/\s+/);
    const head = parts[0] || clean;
    const tail = parts.length > 1 ? ' ' + parts.slice(1).join(' ') : '';

    if (IRREGULAR_VERBS[head]) {
        const irr = IRREGULAR_VERBS[head];
        return {
            base: head + tail,
            v3s: irr.v3s + tail,
            past: irr.past + tail,
            ing: irr.ing + tail,
            pp: irr.pp + tail,
        };
    }

    let v3s = `${head}s`;
    if (/(?:s|sh|ch|x|z|o)$/.test(head)) v3s = `${head}es`;
    else if (/[^aeiou]y$/.test(head)) v3s = `${head.slice(0, -1)}ies`;

    let past = `${head}ed`;
    if (head.endsWith('e')) past = `${head}d`;
    else if (/[^aeiou]y$/.test(head)) past = `${head.slice(0, -1)}ied`;

    let ing = `${head}ing`;
    if (head.endsWith('ie')) ing = `${head.slice(0, -2)}ying`;
    else if (head.endsWith('e') && !head.endsWith('ee')) ing = `${head.slice(0, -1)}ing`;

    return {
        base: head + tail,
        v3s: v3s + tail,
        past: past + tail,
        ing: ing + tail,
        pp: past + tail,
    };
}

/**
 * Generates 3 plausible, distinct distractors for a fill-in-the-blank answer
 * so legacy SHORTANSWER/FIB items upgrade cleanly into fair selectable choices.
 */
export function generateContextualDistractors(
    correctAnswer: string,
    afterText: string = '',
    fullText: string = '',
    extraExclude: string[] = [],
): string[] {
    const cleanCorrect = String(correctAnswer ?? '').trim();
    if (!cleanCorrect) return ['Option B', 'Option C', 'Option D'];

    const exclude = new Set<string>();
    for (const item of [cleanCorrect, ...extraExclude]) {
        for (const eq of buildSpellingEquivalents(item)) {
            exclude.add(eq);
        }
    }

    const picked: string[] = [];
    const tryAdd = (cand: string, preserveExactCase: boolean = false) => {
        const formatted = preserveExactCase ? cand.trim() : matchAnswerCasing(cand.trim(), cleanCorrect);
        if (!formatted) return;
        const eqs = buildSpellingEquivalents(formatted);
        if (eqs.some((e) => exclude.has(e))) return;
        picked.push(formatted);
        eqs.forEach((e) => exclude.add(e));
    };

    // 1. Numeric answers (e.g. 3, 96, 1, 0.5)
    if (/^-?\d+(?:[.,]\d+)?$/.test(cleanCorrect)) {
        const num = Number(cleanCorrect.replace(',', '.'));
        if (Number.isInteger(num)) {
            if (num === 0) ['1', '2', '-1', '4'].forEach((c) => tryAdd(c, true));
            else if (num === 1) ['0', '2', '3', '-1'].forEach((c) => tryAdd(c, true));
            else if (num > 12) {
                [
                    String(Math.max(1, Math.floor(num / 2))),
                    String(num * 2),
                    String(num + 4),
                    String(Math.max(1, num - 4)),
                ].forEach((c) => tryAdd(c, true));
            } else {
                [String(Math.max(0, num - 1)), String(num + 1), String(num + 2), String(num * 2)].forEach((c) =>
                    tryAdd(c, true),
                );
            }
        } else {
            [String(Number((num * 2).toFixed(2))), String(Number((num + 1).toFixed(2))), '0', '1'].forEach((c) =>
                tryAdd(c, true),
            );
        }
        if (picked.length >= 3) return picked.slice(0, 3);
    }

    // 2. Parenthesized base-word hint immediately after the blank, e.g. "(visit)", "(check in)", "(do)"
    const parenMatch = afterText.match(/^\s*\(([^()]{1,35})\)/);
    if (parenMatch) {
        const baseHint = parenMatch[1].trim();
        const notPrefix = /^not\s+/i.test(baseHint);
        const coreVerb = baseHint.replace(/^not\s+/i, '').trim();
        const forms = conjugateVerbForms(coreVerb);

        // Inverted question pattern: e.g. "are you doing" with "(do)"
        const invMatch = cleanCorrect.match(/^(am|is|are|was|were|do|does|did|have|has|had)\s+(i|you|we|they|he|she|it)\s+(.+)$/i);
        if (invMatch) {
            const subj = invMatch[2].toLowerCase();
            [
                `do ${subj} ${forms.base}`,
                `does ${subj} ${forms.base}`,
                `did ${subj} ${forms.base}`,
                `are ${subj} ${forms.ing}`,
                `were ${subj} ${forms.ing}`,
                `have ${subj} ${forms.pp}`,
            ].forEach((c) => tryAdd(c));
        } else if (notPrefix) {
            [
                `do not ${forms.base}`,
                `does not ${forms.base}`,
                `did not ${forms.base}`,
                `is not ${forms.ing}`,
                `was not ${forms.ing}`,
            ].forEach((c) => tryAdd(c));
        } else {
            [
                forms.base,
                forms.v3s,
                forms.past,
                `is ${forms.ing}`,
                `are ${forms.ing}`,
                `am ${forms.ing}`,
                `was ${forms.ing}`,
                `were ${forms.ing}`,
                forms.ing,
                `has ${forms.pp}`,
            ].forEach((c) => tryAdd(c));
        }
        if (picked.length >= 3) return picked.slice(0, 3);
    }

    // 3. Closed-class grammar word lookup (auxiliaries, prepositions, articles, pronouns, etc.)
    const lowerCorrect = cleanCorrect.toLowerCase();
    if (CLOSED_CLASS_DISTRACTORS[lowerCorrect]) {
        CLOSED_CLASS_DISTRACTORS[lowerCorrect].forEach((c) => tryAdd(c));
        if (picked.length >= 3) return picked.slice(0, 3);
    }

    // 4. Multi-word auxiliary + participle / gerund phrases without parenthesized hint (e.g. "was driving", "is travelling")
    const auxPhrase = cleanCorrect.match(/^(am|is|are|was|were|has|have|had|will)\s+([a-z]+(?:\s+[a-z]+)?)$/i);
    if (auxPhrase) {
        const aux = auxPhrase[1].toLowerCase();
        const rest = auxPhrase[2];
        const stemGuess = rest
            .replace(/([bcdfghjklmnpqrstvwxyz])\1ing\b/i, '$1')
            .replace(/ing\b/i, '')
            .replace(/ed\b/i, '');
        const forms = conjugateVerbForms(stemGuess || rest);
        const swapAux = aux === 'is' ? 'was' : aux === 'was' ? 'is' : aux === 'are' ? 'were' : aux === 'am' ? 'was' : 'is';
        [`${swapAux} ${rest}`, forms.base, forms.v3s, forms.past, `has ${forms.pp}`].forEach((c) => tryAdd(c));
        if (picked.length >= 3) return picked.slice(0, 3);
    }

    // 5. Single inflected English word heuristic (-ed, -ing, -s) or contextual content words
    if (/^[A-Za-z]+$/.test(cleanCorrect)) {
        if (lowerCorrect.endsWith('ed') && lowerCorrect.length > 4) {
            const stem = lowerCorrect.replace(/ied$/, 'y').replace(/ed$/, '');
            const forms = conjugateVerbForms(stem);
            [forms.base, forms.v3s, forms.ing, `is ${forms.ing}`].forEach((c) => tryAdd(c));
        } else if (lowerCorrect.endsWith('ing') && lowerCorrect.length > 5) {
            const stem = lowerCorrect.replace(/([bcdfghjklmnpqrstvwxyz])\1ing$/, '$1').replace(/ing$/, '');
            const forms = conjugateVerbForms(stem);
            [forms.base, forms.v3s, forms.past].forEach((c) => tryAdd(c));
        } else if (lowerCorrect.endsWith('s') && lowerCorrect.length > 3 && !lowerCorrect.endsWith('ss')) {
            const stem = lowerCorrect.replace(/ies$/, 'y').replace(/es$/, '').replace(/s$/, '');
            const forms = conjugateVerbForms(stem);
            [forms.base, forms.past, forms.ing].forEach((c) => tryAdd(c));
        }
    }

    // 6. Extract plausible distinct words from surrounding passage if still short
    if (picked.length < 3 && fullText) {
        const stripped = fullText
            .replace(/\{\d+:[A-Za-z_]+:[^}]*\}/g, ' ')
            .replace(/<[^>]+>/g, ' ');
        const tokens = stripped.match(/[A-Za-zÀ-ỹ][A-Za-zÀ-ỹ-]{2,20}/g) || [];
        for (const tok of tokens) {
            if (picked.length >= 3) break;
            tryAdd(tok);
        }
    }

    // 7. Guaranteed fallback so MULTICHOICE_S always has >= 4 distinct choices
    const genericFallbacks = ['none of these', 'not applicable', 'other form', 'alternative'];
    for (const fb of genericFallbacks) {
        if (picked.length >= 3) break;
        tryAdd(fb);
    }

    return picked.slice(0, 3);
}

/**
 * Normalizes Interactive Slide Quiz questions (FIB & CLOZE) so every FIB question
 * has selectable word-chip `options` (4 choices) and every CLOZE passage has `distractors`.
 */
export function normalizeInteractiveQuestions(questions: any[]): any[] {
    if (!Array.isArray(questions)) return [];
    return questions.map((rawQ, qIdx) => {
        if (!rawQ || typeof rawQ !== 'object') return rawQ;
        const q = { ...rawQ };
        const qType = String(q.type || 'MC').toUpperCase();

        if (qType === 'FIB') {
            const correct = String(
                q.correctAnswer ?? (Array.isArray(q.correctAnswers) ? q.correctAnswers[0] : '') ?? '',
            ).trim();
            const existingOpts = Array.isArray(q.options)
                ? q.options.map((o: any) => String(o ?? '').trim()).filter(Boolean)
                : [];

            if (correct && existingOpts.length < 2) {
                const qText = String(q.question || '');
                const blankMatch = qText.match(/\[\.{2,}\]|_{2,}/);
                const afterBlank = blankMatch && blankMatch.index !== undefined
                    ? qText.slice(blankMatch.index + blankMatch[0].length)
                    : '';
                const distractors = generateContextualDistractors(
                    correct,
                    afterBlank,
                    qText,
                    Array.isArray(q.correctAnswers) ? q.correctAnswers : [correct],
                );
                const combined = [correct, ...distractors];
                // Deterministic rotation by question index so correct answer is not always first
                const shift = (qIdx + combined[0].length) % combined.length;
                q.options = [...combined.slice(shift), ...combined.slice(0, shift)];
                q.correctAnswer = correct;
            } else if (correct && existingOpts.length >= 2) {
                if (!existingOpts.some((o: string) => o.toLowerCase() === correct.toLowerCase())) {
                    q.options = [correct, ...existingOpts.slice(0, 3)];
                } else {
                    q.options = existingOpts;
                }
            }
        } else if (qType === 'CLOZE') {
            const rawPassage = String(q.passage || q.questionText || q.question || '');
            const blankMatches = [...rawPassage.matchAll(/\[([^\]]+)\]/g)];
            const allCorrectWords: string[] = [];
            for (const m of blankMatches) {
                m[1].split('|').map((s) => s.trim()).filter(Boolean).forEach((w) => {
                    if (!allCorrectWords.includes(w)) allCorrectWords.push(w);
                });
            }
            const existingDistractors = Array.isArray(q.distractors)
                ? q.distractors.map((d: any) => String(d ?? '').trim()).filter(Boolean)
                : [];
            if (existingDistractors.length === 0 && allCorrectWords.length > 0) {
                const collected: string[] = [];
                for (const cw of allCorrectWords) {
                    const cands = generateContextualDistractors(cw, '', rawPassage, [...allCorrectWords, ...collected]);
                    for (const c of cands) {
                        if (collected.length >= 3) break;
                        if (!collected.some((x) => x.toLowerCase() === c.toLowerCase())) {
                            collected.push(c);
                        }
                    }
                    if (collected.length >= 3) break;
                }
                q.distractors = collected;
            }
        }

        return q;
    });
}

/**
 * Extract the answer key as a list of blanks, each with its acceptable variants.
 * Supports the shapes the AI actually returns:
 *   - answers: [{ position, acceptableAnswers: [...] }, ...]   (CLOZE)
 *   - answers / blanks: ['word1', 'word2']                      (one variant per blank)
 *   - acceptableAnswers / correctAnswers / acceptedAnswers: [...] (single blank, many variants)
 *   - correctAnswer / answer: 'word' | ['word', ...]
 */
function extractAnswerKey(data: any): string[][] {
    const perBlank = Array.isArray(data?.answers) ? data.answers : (Array.isArray(data?.blanks) ? data.blanks : null);
    if (perBlank && perBlank.length > 0) {
        const isStructured = perBlank.some((b: any) => typeof b === 'object' && b !== null);
        if (isStructured) {
            return [...perBlank]
                .sort((a: any, b: any) => (Number(a?.position) || 0) - (Number(b?.position) || 0))
                .map((b: any) => toCleanStringList(b?.acceptableAnswers ?? b?.answers ?? b?.answer ?? b?.correctAnswer ?? b?.text))
                .filter((variants: string[]) => variants.length > 0);
        }
        return toCleanStringList(perBlank).map((v) => [v]);
    }

    const variants = toCleanStringList(
        data?.acceptableAnswers ?? data?.correctAnswers ?? data?.acceptedAnswers ?? data?.correctAnswer ?? data?.answer,
    );
    return variants.length > 0 ? [variants] : [];
}

/** Extract per-blank explicit distractors if provided in dataJson. */
function extractPerBlankDistractors(data: any, blankIdx: number): string[] {
    const perBlank = Array.isArray(data?.answers) ? data.answers : (Array.isArray(data?.blanks) ? data.blanks : null);
    if (perBlank && perBlank[blankIdx] && typeof perBlank[blankIdx] === 'object') {
        const item = perBlank[blankIdx];
        const explicit = toCleanStringList(item.distractors ?? item.wrongAnswers ?? item.options);
        if (explicit.length > 0) return explicit;
    }
    return toCleanStringList(data?.distractors);
}

function buildEmbeddedMultichoice(variants: string[], distractors: string[]): string {
    const primary = variants[0] || '';
    const cleanDistractors = distractors.filter((d) => d && d.trim().toLowerCase() !== primary.trim().toLowerCase());
    const allParts = [`=${escapeClozeOption(primary)}`, ...cleanDistractors.map((d) => escapeClozeOption(d))];
    return `{1:MULTICHOICE_S:${allParts.join('~')}}`;
}

/**
 * Upgrades and repairs Cloze embedded tokens so 100% of blanks use Moodle's
 * shuffled selectable dropdown `{1:MULTICHOICE_S:=Correct~Wrong1~Wrong2~Wrong3}`
 * (or preserves explicit radio/multi-response choice tokens) — NEVER forcing
 * students into unfair free-text `{1:SHORTANSWER:...}` typing.
 */
export function upgradeClozeToMultichoice(text: string, data?: any): string {
    let working = String(text ?? '');
    const key = extractAnswerKey(data);

    // 1. If there are no {1:TYPE:...} tokens yet, fill raw "___" blanks first
    if (!new RegExp(CLOZE_LOOSE_TOKEN_RE.source).test(working)) {
        const blankCount = (working.match(RAW_BLANK_RE) || []).length;
        if (blankCount > 0 && key.length >= blankCount) {
            let rawIdx = 0;
            working = working.replace(RAW_BLANK_RE, (_m, offset: number) => {
                const bIdx = rawIdx++;
                const variants = key[bIdx] || [''];
                const afterText = working.slice(offset + _m.length);
                const explicit = extractPerBlankDistractors(data, bIdx);
                const distractors =
                    explicit.length >= 2
                        ? explicit
                        : generateContextualDistractors(variants[0], afterText, working, variants);
                return buildEmbeddedMultichoice(variants, distractors);
            });
        }
    }

    // 2. Normalize and upgrade every Cloze token to selectable choices
    let blankIdx = 0;
    return working.replace(CLOZE_LOOSE_TOKEN_RE, (fullMatch, _weight: string, rawType: string, body: string, offset: number) => {
        const currentIdx = blankIdx++;
        const afterText = working.slice(offset + fullMatch.length);
        const upperType = rawType.toUpperCase();

        // Preserve explicit MULTIRESPONSE or horizontal/vertical radio buttons if valid; otherwise use shuffled dropdown MULTICHOICE_S
        const isMultiResponse = /^(MULTIRESPONSE|MR|MRH|MRS|MRHS)$/.test(upperType);
        const isHorizontalRadio = /^(MULTICHOICE_H|MCH|MULTICHOICE_HS|MCHS)$/.test(upperType);
        const isVerticalRadio = /^(MULTICHOICE_V|MCV|MULTICHOICE_VS|MCVS)$/.test(upperType);
        const isChoiceToken =
            isMultiResponse ||
            isHorizontalRadio ||
            isVerticalRadio ||
            /^(MULTICHOICE|MC|MULTICHOICE_S|MCS)$/.test(upperType);

        const rawAlts = splitClozeAlternatives(body)
            .map((a) => a.trim())
            .filter((a) => a !== '' && a !== '=');

        if (rawAlts.length === 0) return fullMatch;

        // Keep multiresponse intact after fixing weight to 1
        if (isMultiResponse && rawAlts.length >= 2) {
            return `{1:${upperType}:${rawAlts.join('~')}}`;
        }

        const parsedAlts = rawAlts.map((alt) => {
            // Strip optional feedback "#..." when inspecting answer text, preserve feedback if present on choice tokens
            const fbMatch = alt.match(/^(.*?)(?<!\\)(#.*)$/s);
            const core = fbMatch ? fbMatch[1] : alt;
            const feedback = fbMatch ? fbMatch[2] : '';

            let isCorrect = false;
            let answerPart = core;
            const markMatch = core.match(/^(=|%(-?[0-9]+(?:[.,][0-9]*)?)%)(.*)$/s);
            if (markMatch) {
                const pct = markMatch[1] === '=' ? 100 : parseFloat((markMatch[2] || '0').replace(',', '.'));
                isCorrect = pct >= 100;
                answerPart = markMatch[3];
            } else if (!isChoiceToken) {
                // In SHORTANSWER without explicit "=", every listed variant was intended as correct
                isCorrect = true;
            }
            return {
                text: unescapeClozeOption(answerPart),
                isCorrect,
                feedback,
            };
        }).filter((item) => item.text !== '');

        if (parsedAlts.length === 0) return fullMatch;

        // Ensure at least one correct choice exists
        if (!parsedAlts.some((a) => a.isCorrect)) {
            parsedAlts[0].isCorrect = true;
        }

        const primaryCorrect = parsedAlts.find((a) => a.isCorrect)!;
        const allAcceptableVariants = [
            ...parsedAlts.filter((a) => a.isCorrect).map((a) => a.text),
            ...(key[currentIdx] || []),
        ];

        const excludeEquivs = new Set<string>();
        for (const v of allAcceptableVariants) {
            buildSpellingEquivalents(v).forEach((eq) => excludeEquivs.add(eq));
        }

        const distractors: Array<{ text: string; feedback: string }> = [];
        for (const alt of parsedAlts) {
            if (alt.isCorrect) continue;
            const eqs = buildSpellingEquivalents(alt.text);
            if (eqs.some((e) => excludeEquivs.has(e))) continue;
            distractors.push({ text: alt.text, feedback: alt.feedback });
            eqs.forEach((e) => excludeEquivs.add(e));
        }

        // Supplement explicit distractors from dataJson if token had none (e.g. upgraded from SHORTANSWER)
        if (distractors.length === 0) {
            for (const d of extractPerBlankDistractors(data, currentIdx)) {
                const eqs = buildSpellingEquivalents(d);
                if (eqs.some((e) => excludeEquivs.has(e))) continue;
                distractors.push({ text: d, feedback: '' });
                eqs.forEach((e) => excludeEquivs.add(e));
            }
        }

        // Supplement contextual distractors so MULTICHOICE_S always has >= 2 (typically 4) choices
        if (distractors.length === 0) {
            const generated = generateContextualDistractors(
                primaryCorrect.text,
                afterText,
                working,
                allAcceptableVariants,
            );
            for (const g of generated) {
                const eqs = buildSpellingEquivalents(g);
                if (eqs.some((e) => excludeEquivs.has(e))) continue;
                distractors.push({ text: g, feedback: '' });
                eqs.forEach((e) => excludeEquivs.add(e));
            }
        }

        const targetType = isHorizontalRadio
            ? 'MULTICHOICE_HS'
            : isVerticalRadio
              ? 'MULTICHOICE_VS'
              : 'MULTICHOICE_S';

        const formattedCorrect = `=${escapeClozeOption(primaryCorrect.text)}${primaryCorrect.feedback}`;
        const formattedDistractors = distractors.map(
            (d) => `${escapeClozeOption(d.text)}${d.feedback}`,
        );

        return `{1:${targetType}:${[formattedCorrect, ...formattedDistractors].join('~')}}`;
    });
}

/**
 * Build Moodle XML for Cloze (Embedded Answers — 100% Shuffled Dropdown Choices)
 */
function buildEnglishClozeXml(q: EnglishQuestionData, data: any, lessonCode: string = 'B01'): string {
    const name = formatEnglishQuestionName(q, lessonCode, 'CLOZE');
    let rawContent: string = stripInvalidXmlChars(String(data.clozeText || data.rawCloze || q.questionText || ''));
    const key = (() => {
        let k = extractAnswerKey(data);
        const blankCount = (rawContent.match(RAW_BLANK_RE) || []).length;
        // Last resort: quoted words in the explanation, e.g. `"So" introduces the effect...`
        // Only used when the number of short quoted words matches the number of blanks exactly.
        if (k.length === 0 && q.explanation && blankCount > 0) {
            const quoted = [...String(q.explanation).matchAll(/["“]([^"”]{1,40})["”]/g)]
                .map((m) => m[1].trim())
                .filter((w) => w && w.split(/\s+/).length <= 4);
            if (quoted.length === blankCount) k = quoted.map((w) => [w]);
        }
        return k;
    })();

    const enrichedData = key.length > 0 && !data?.answers && !data?.blanks
        ? { ...data, answers: key.map((acceptableAnswers, idx) => ({ position: idx + 1, acceptableAnswers })) }
        : data;

    rawContent = upgradeClozeToMultichoice(rawContent, enrichedData);

    // Moodle aborts the WHOLE import on an invalid Cloze question.
    // If no embedded answer token exists yet but an answer key is available, append embedded blank(s).
    if (validateClozeText(rawContent).length > 0 && key.length > 0) {
        const appendedTokens = key.map((variants, idx) => {
            const distractors = generateContextualDistractors(variants[0], '', rawContent, variants);
            return buildEmbeddedMultichoice(variants, extractPerBlankDistractors(enrichedData, idx).length >= 2 ? extractPerBlankDistractors(enrichedData, idx) : distractors);
        });
        rawContent = `${rawContent.trim()} ${appendedTokens.join(' ')}`;
        rawContent = upgradeClozeToMultichoice(rawContent, enrichedData);
    }

    // If still invalid, skip this question instead of degrading to shortanswer/essay.
    if (validateClozeText(rawContent).length > 0) {
        return '';
    }

    // Extract instruction from questionText if present, avoiding duplicate prefix inside rawContent
    let instruction = '';
    const qTextStr = String(q.questionText || '');
    for (const quoteChar of ['“', '"']) {
        if (qTextStr.includes(quoteChar)) {
            const parts = qTextStr.split(quoteChar);
            const prefix = (parts[0] || '').replace(/^GRAM-\d+[^:]*:\s*/, '').trim();
            if (prefix && !prefix.includes('{1:')) {
                instruction = prefix;
                // Strip duplicate prefix if rawContent also started with the exact same instruction
                if (rawContent.startsWith(parts[0])) {
                    rawContent = rawContent.slice(parts[0].length).replace(/^[“"]\s*/, '').replace(/\s*[”"]$/, '');
                }
                break;
            }
        }
    }
    // Upgrade legacy free-text wording ("Viết...", "chia động từ...") to selection wording
    if (!instruction || /^(?:Viết|Điền|Hoàn thành.*chia)/i.test(instruction)) {
        instruction = 'Chọn phương án đúng cho mỗi chỗ trống để hoàn thành câu/đoạn văn sau:';
    }

    const contentHtml = `<p><strong>${escapeForCdata(instruction)}</strong></p>\n<p class="cell">${escapeForCdata(rawContent)}</p>`;
    const cleanedExplanation = cleanExplanation(q.explanation);
    const feedbackHtml = cleanedExplanation ? `<p class="cell"><strong>Explanation: </strong>${escapeForCdata(cleanedExplanation)}</p>` : '';

    return `  <question type="cloze">
    <name><text>${escapeXmlText(name)}</text></name>
    <questiontext format="html">
      <text><![CDATA[${contentHtml}]]></text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${feedbackHtml}]]></text>
    </generalfeedback>
    <defaultgrade>${formatGrade(q.points, 1)}</defaultgrade>
    <penalty>0.3333333</penalty>
  </question>`;
}

const TRUE_WORDS = new Set(['true', 't', '1', 'yes', 'đúng', 'dung', 'right', 'correct']);
const FALSE_WORDS = new Set(['false', 'f', '0', 'no', 'sai', 'wrong', 'incorrect']);

/**
 * Build Moodle XML for True / False
 */
function buildEnglishTrueFalseXml(q: EnglishQuestionData, data: any, lessonCode: string = 'B01'): string {
    const rawKey = data.correctAnswer ?? data.answer ?? data.correct ?? data.isTrue;
    const keyWord = typeof rawKey === 'boolean' ? String(rawKey) : String(rawKey ?? '').trim().toLowerCase();
    if (!TRUE_WORDS.has(keyWord) && !FALSE_WORDS.has(keyWord)) {
        // Unknown key: skip instead of exporting wrong answer key.
        return essayFallback(q, data, lessonCode, []);
    }
    const isTrue = TRUE_WORDS.has(keyWord);

    const name = formatEnglishQuestionName(q, lessonCode, 'TF');
    const cleanedExplanation = cleanExplanation(q.explanation);
    const feedbackHtml = cleanedExplanation ? `<p class="cell"><strong>Explanation: </strong>${escapeForCdata(cleanedExplanation)}</p>` : '';
    const fbTrue = data.feedbackTrue ? escapeForCdata(data.feedbackTrue) : (isTrue ? 'Correct!' : 'Incorrect.');
    const fbFalse = data.feedbackFalse ? escapeForCdata(data.feedbackFalse) : (!isTrue ? 'Correct!' : 'Incorrect.');

    return `  <question type="truefalse">
    <name><text>${escapeXmlText(name)}</text></name>
    <questiontext format="html">
      <text>${cdataHtml(q.questionText)}</text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${feedbackHtml}]]></text>
    </generalfeedback>
    <defaultgrade>${formatGrade(q.points, 1)}</defaultgrade>
    <penalty>1.0000000</penalty>
    <answer fraction="${isTrue ? 100 : 0}" format="moodle_auto_format">
      <text>true</text>
      <feedback format="html"><text><![CDATA[<p>${fbTrue}</p>]]></text></feedback>
    </answer>
    <answer fraction="${isTrue ? 0 : 100}" format="moodle_auto_format">
      <text>false</text>
      <feedback format="html"><text><![CDATA[<p>${fbFalse}</p>]]></text></feedback>
    </answer>
  </question>`;
}

/**
 * Polymorphic dispatcher for English questions
 */
export function buildEnglishQuestionXml(q: EnglishQuestionData, lessonCode: string = 'B01'): string {
    let data: any = {};
    try {
        data = typeof q.dataJson === 'string' ? JSON.parse(q.dataJson) : q.dataJson || {};
    } catch {
        data = {};
    }

    let type = (q.questionType || 'MC').toUpperCase();

    // AUTO-RECOVERY: If marked as ESSAY/SHORTANSWER/MC/other but intent is clearly matching AND valid pairs exist, route to MATCH
    const extracted = extractMatchPairs(data, q.questionText, q.explanation || '');
    if (type !== 'MATCH' && type !== 'MATCHING') {
        if ((type === 'ESSAY' || isMatchingQuestionText(q.questionText)) && extracted.pairs.length >= 2) {
            type = 'MATCH';
        }
    }

    // AUTO-RECOVERY: If marked as ESSAY/SHORTANSWER but actually has valid multiple-choice options, route to MC
    if (type === 'ESSAY' || type === 'SHORTANSWER' || type === 'SA') {
        const opts = normalizeOptions(data);
        if (opts.length >= 2 && opts.some((o) => o.correct)) {
            type = 'MC';
        } else if ((type === 'SHORTANSWER' || type === 'SA') && RAW_BLANK_RE.test(q.questionText || '') && extractAnswerKey(data).length > 0) {
            // Convert fill-in-the-blank sentence with "___" to CLOZE
            type = 'CLOZE';
        } else {
            // Strictly exclude ESSAY and SHORTANSWER from Moodle XML so Quizzes are 100% auto-graded
            return '';
        }
    }

    switch (type) {
        case 'MATCH':
        case 'MATCHING':
            return buildEnglishMatchXml(q, data, lessonCode, extracted);
        case 'CLOZE':
            return buildEnglishClozeXml(q, data, lessonCode);
        case 'TRUEFALSE':
        case 'TF':
            return buildEnglishTrueFalseXml(q, data, lessonCode);
        case 'MC':
        case 'MR':
        case 'MULTICHOICE':
        default:
            return buildEnglishMultichoiceXml(q, data, lessonCode);
    }
}

/**
 * Build complete Moodle XML from an array of EnglishQuestion records.
 * Strictly exports only 100% auto-gradable Moodle question types (MC, MR, MATCH, CLOZE, TRUEFALSE).
 */
export function buildEnglishMoodleXml(
    questions: EnglishQuestionData[],
    lessonTitle: string,
): string {
    const { lessonCode, normalizedTitle } = extractAndNormalizeLesson(lessonTitle);

    const lessonSlug = normalizedTitle
        .replace(/[^\w\sàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi, '')
        .replace(/\s+/g, '_')
        .substring(0, 50)
        .replace(/^_+|_+$/g, '') || lessonCode;

    const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<quiz>', ''];

    // Category marker
    parts.push(`  <!-- Category: English Studies / Linguistics -->`);
    parts.push(`  <question type="category">
    <category>
      <text>$course$/top/${lessonSlug}/English_Questions</text>
    </category>
  </question>`);
    parts.push('');

    // Group by question type for clean structure, keeping only valid auto-gradable XML blocks
    const grouped = new Map<string, string[]>();
    for (const q of questions) {
        const xmlBlock = buildEnglishQuestionXml(q, lessonCode);
        if (!xmlBlock || !xmlBlock.trim()) continue;
        const type = (q.questionType || 'MC').toUpperCase();
        if (!grouped.has(type)) grouped.set(type, []);
        grouped.get(type)!.push(xmlBlock);
    }

    for (const [type, xmlBlocks] of grouped.entries()) {
        if (xmlBlocks.length === 0) continue;
        parts.push(`  <!-- Type: ${commentSafe(type)} (${xmlBlocks.length} questions) -->`);
        for (const block of xmlBlocks) {
            parts.push(block);
            parts.push('');
        }
    }

    parts.push('</quiz>');
    return parts.join('\n');
}

/**
 * Convert an exam title or category string into a clean ASCII/underscore Moodle category name,
 * e.g. "Kiểm tra Giữa kỳ - Bài 1 đến Bài 6" -> "Kiem_tra_Giua_ky_Bai_1_den_Bai_6"
 */
export function toMoodleCategorySlug(rawName: string): string {
    if (!rawName || !rawName.trim()) return 'Exam_Questions';
    const noDiacritics = rawName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D');
    return (
        noDiacritics
            .replace(/[^A-Za-z0-9\s_-]/g, ' ')
            .trim()
            .replace(/[\s-]+/g, '_')
            .replace(/_+/g, '_')
            .substring(0, 80)
            .replace(/^_+|_+$/g, '') || 'Exam_Questions'
    );
}

export type ExamMoodleCategoryMode = 'single' | 'bloom' | 'lesson';

function renderSingleExamQuestionXml(
    q: any,
    index: number,
    mode: 'REVIEW' | 'ENGLISH',
    categorySlug: string,
): string {
    if (String(mode).toUpperCase() === 'ENGLISH') {
        const rawTitle = String(q.title || q.questionId || '').trim();
        let lessonCode = q.sourceLessonTitle
            ? extractAndNormalizeLesson(String(q.sourceLessonTitle)).lessonCode
            : 'EX';
        let cleanTitle = rawTitle || `${q.questionType || 'ENG'}-${String(index + 1).padStart(2, '0')}`;

        // Normalize exam generator titles like "B1-MC-C01 (Topic)" so formatEnglishQuestionName
        // produces unique "B01-MC-01: ..." instead of colliding on "B-01"
        const examTitleMatch = rawTitle.match(/^B0*(\d+)[-_]+([A-Za-z]+)[-_]+C?0*(\d+)/i);
        if (examTitleMatch) {
            lessonCode = `B${String(parseInt(examTitleMatch[1], 10) || 1).padStart(2, '0')}`;
            const qTypeCode = examTitleMatch[2].toUpperCase();
            const seqCode = String(parseInt(examTitleMatch[3], 10) || index + 1).padStart(2, '0');
            cleanTitle = `${qTypeCode}-${seqCode}`;
        }

        const engQ: EnglishQuestionData = {
            id: q.id || `EX-${index + 1}`,
            questionOrder: q.questionOrder ?? index + 1,
            questionType: q.questionType || 'MC',
            subDiscipline: q.subDiscipline || 'GENERAL',
            difficulty: q.difficulty || q.level || 1,
            title: cleanTitle,
            questionText: q.questionText || q.question || '',
            dataJson:
                typeof q.dataJson === 'string'
                    ? q.dataJson
                    : JSON.stringify(q.data || q.dataJson || {}),
            explanation: q.explanation || '',
            points: q.points || 1,
        };
        return buildEnglishQuestionXml(engQ, lessonCode);
    }

    const questionStem = String(q.question || q.questionText || '').trim();
    const correctAnswer = String(q.correctAnswer || '').trim();
    const optionB = String(q.optionB || '').trim();
    if (!plainText(questionStem) || !plainText(correctAnswer) || !plainText(optionB)) {
        return '';
    }

    const revQ: ReviewQuestionData = {
        questionId:
            q.questionId || q.title || `${categorySlug}-${String(index + 1).padStart(2, '0')}`,
        level: q.level || q.difficulty || 1,
        question: questionStem,
        correctAnswer,
        optionB,
        optionC: String(q.optionC || '-').trim() || '-',
        optionD: String(q.optionD || '-').trim() || '-',
        explanation: q.explanation || '',
    };
    return buildQuestionXml(revQ);
}

/**
 * Build Moodle XML for a Multi-Lesson Exam Set, inheriting 100% of buildQuestionXml(),
 * buildEnglishQuestionXml(), LEVEL_CONFIG (muc_1_biet / muc_2_hieu / muc_3_van_dung),
 * and Moodle 4.x import-safety checks.
 *
 * Supports 3 category organization modes:
 * - 'single': 1 unified category `$course$/top/{categorySlug}`
 * - 'bloom': grouped into 3 Bloom subcategories `$course$/top/{categorySlug}/muc_1_biet|muc_2_hieu|muc_3_van_dung` (same as buildMoodleXml)
 * - 'lesson': grouped by source lesson `$course$/top/{categorySlug}/{lessonSlug}`
 */
export function buildExamMoodleXml(
    questions: any[],
    categoryName: string,
    mode: 'REVIEW' | 'ENGLISH' = 'REVIEW',
    categoryMode: ExamMoodleCategoryMode = 'single',
): string {
    const categorySlug = toMoodleCategorySlug(categoryName);
    const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<quiz>', ''];

    if (categoryMode === 'bloom') {
        const grouped = new Map<number, string[]>();
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const xmlBlock = renderSingleExamQuestionXml(q, i, mode, categorySlug);
            if (!xmlBlock || !xmlBlock.trim()) continue;
            const rawLvl = Number(q.level || q.difficulty || 1);
            const level = [1, 2, 3].includes(rawLvl) ? rawLvl : 1;
            if (!grouped.has(level)) grouped.set(level, []);
            grouped.get(level)!.push(xmlBlock);
        }

        for (const level of [1, 2, 3]) {
            const blocks = grouped.get(level);
            if (!blocks || blocks.length === 0) continue;
            const config = LEVEL_CONFIG[level] || LEVEL_CONFIG[1];
            parts.push(`  <!-- ${commentSafe(config.label)} (${blocks.length} câu) -->`);
            parts.push(`  <question type="category">`);
            parts.push(`    <category>`);
            parts.push(
                `      <text>$course$/top/${escapeXmlText(categorySlug)}/${escapeXmlText(config.slug)}</text>`,
            );
            parts.push(`    </category>`);
            parts.push(`  </question>`);
            parts.push('');
            for (const block of blocks) {
                parts.push(block);
                parts.push('');
            }
        }
    } else if (categoryMode === 'lesson') {
        const grouped = new Map<string, { label: string; slug: string; blocks: string[] }>();
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const xmlBlock = renderSingleExamQuestionXml(q, i, mode, categorySlug);
            if (!xmlBlock || !xmlBlock.trim()) continue;
            const rawLesson = String(q.sourceLessonTitle || 'Bai_hoc').trim();
            const lessonSlug = toMoodleCategorySlug(rawLesson);
            if (!grouped.has(lessonSlug)) {
                grouped.set(lessonSlug, { label: rawLesson, slug: lessonSlug, blocks: [] });
            }
            grouped.get(lessonSlug)!.blocks.push(xmlBlock);
        }

        for (const group of grouped.values()) {
            if (group.blocks.length === 0) continue;
            parts.push(`  <!-- Lesson: ${commentSafe(group.label)} (${group.blocks.length} câu) -->`);
            parts.push(`  <question type="category">`);
            parts.push(`    <category>`);
            parts.push(
                `      <text>$course$/top/${escapeXmlText(categorySlug)}/${escapeXmlText(group.slug)}</text>`,
            );
            parts.push(`    </category>`);
            parts.push(`  </question>`);
            parts.push('');
            for (const block of group.blocks) {
                parts.push(block);
                parts.push('');
            }
        }
    } else {
        const validBlocks: string[] = [];
        for (let i = 0; i < questions.length; i++) {
            const xmlBlock = renderSingleExamQuestionXml(questions[i], i, mode, categorySlug);
            if (xmlBlock && xmlBlock.trim()) {
                validBlocks.push(xmlBlock);
            }
        }

        parts.push(`  <!-- Exam Category: ${commentSafe(categorySlug)} (${validBlocks.length} questions) -->`);
        parts.push(`  <question type="category">`);
        parts.push(`    <category>`);
        parts.push(`      <text>$course$/top/${escapeXmlText(categorySlug)}</text>`);
        parts.push(`    </category>`);
        parts.push(`  </question>`);
        parts.push('');

        for (const block of validBlocks) {
            parts.push(block);
            parts.push('');
        }
    }

    parts.push('</quiz>');
    return parts.join('\n');
}

/**
 * Backward-compatible alias for single-category exam Moodle XML export
 */
export function buildSingleCategoryExamMoodleXml(
    questions: any[],
    categoryName: string,
    mode: 'REVIEW' | 'ENGLISH' = 'REVIEW',
    categoryMode: ExamMoodleCategoryMode = 'single',
): string {
    return buildExamMoodleXml(questions, categoryName, mode, categoryMode);
}


