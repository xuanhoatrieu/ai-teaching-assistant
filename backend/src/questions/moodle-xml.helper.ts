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
        .replace(/\{1:(?:SHORTANSWER|MULTICHOICE)[^}]*\}/gi, '___')
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

/** Escape Moodle Cloze special characters inside an embedded answer. */
function escapeClozeAnswer(text: string): string {
    return text.replace(/([}#~\/"\\])/g, '\\$1');
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
 * Exported as essay (manual grading) when the data cannot form a valid auto-graded
 * question. The known answer key (if any) is kept in the grader information.
 */
function essayFallback(q: EnglishQuestionData, data: any, lessonCode: string, answerKey: string[]): string {
    const keyText = answerKey.filter((k) => k && k.trim()).join(' | ');
    const graderInfo = keyText
        ? `Đáp án tham khảo: ${keyText}${q.explanation ? `\n${q.explanation}` : ''}`
        : (data?.graderInfo || data?.rubric || q.explanation || '');
    return buildEnglishEssayXml(q, { ...data, graderInfo }, lessonCode);
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

/**
 * Build Moodle XML for Matching question
 */
function buildEnglishMatchXml(q: EnglishQuestionData, data: any, lessonCode: string = 'B01'): string {
    const rawPairs: Array<any> = Array.isArray(data.pairs) ? data.pairs : [];
    const pairs = rawPairs
        .map((pair) => ({
            sub: String(pair?.subquestion ?? pair?.left ?? pair?.question ?? pair?.term ?? ''),
            ans: String(pair?.answer ?? pair?.right ?? pair?.match ?? pair?.definition ?? '').trim(),
        }))
        // Moodle: a sub-question with an empty answer returns a "notice", which makes
        // importprocess() return early -> every question after it is silently NOT imported.
        .filter((p) => plainText(p.sub) !== '' && p.ans !== '');

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
    for (const extra of toCleanStringList(data.rightOptions ?? data.distractors)) {
        if (used.has(extra)) continue;
        used.add(extra);
        subquestionsXml.push(`    <subquestion format="html">
      <text></text>
      <answer>
        <text>${escapeXmlText(extra)}</text>
      </answer>
    </subquestion>`);
    }

    return `  <question type="match">
    <name><text>${escapeXmlText(name)}</text></name>
    <questiontext format="html">
      <text>${cdataHtml(q.questionText)}</text>
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
const CLOZE_VALID_TYPES = new Set(
    CLOZE_TYPE_DEF.replace(/[()]/g, '').split('|'),
);
const CLOZE_SA_TYPES = new Set(['SHORTANSWER', 'SA', 'MW', 'SHORTANSWER_C', 'SAC', 'MWC']);
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

/**
 * Repair common AI mistakes in embedded answers before validation:
 *  - lowercase / unknown type ({1:shortanswer:...}, {1:FILL:...}) -> SHORTANSWER
 *  - short answer without "=" ({1:SHORTANSWER:word}) -> every alternative is accepted
 *  - multichoice with a single (correct) option -> SHORTANSWER
 *  - weights other than 1 -> 1 (Moodle sums weights: 1+2 = 3.00 marks)
 */
function repairClozeTokens(text: string): string {
    return text.replace(CLOZE_LOOSE_TOKEN_RE, (_full, _weight: string, rawType: string, body: string) => {
        let type = rawType.toUpperCase();
        if (!CLOZE_VALID_TYPES.has(type)) type = 'SHORTANSWER';
        let alts = splitClozeAlternatives(body).map((a) => a.trim()).filter((a) => a !== '' && a !== '=');
        const hasMark = (a: string) => /^(=|%-?[0-9]+(?:[.,][0-9]*)?%)/.test(a);

        if (!CLOZE_SA_TYPES.has(type) && type !== 'NUMERICAL' && type !== 'NM' && alts.length === 1) {
            type = 'SHORTANSWER';
        }
        if ((CLOZE_SA_TYPES.has(type) || type === 'NUMERICAL' || type === 'NM') && !alts.some((a) => a.startsWith('=') || /^%100%/.test(a))) {
            alts = alts.map((a) => (hasMark(a) ? a : `=${a}`));
        }
        return `{1:${type}:${alts.join('~')}}`;
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

function buildEmbeddedShortAnswer(variants: string[]): string {
    return `{1:SHORTANSWER:${variants.map((v) => `=${escapeClozeAnswer(v)}`).join('~')}}`;
}

/**
 * Build Moodle XML for Cloze (Embedded Answers)
 */
function buildEnglishClozeXml(q: EnglishQuestionData, data: any, lessonCode: string = 'B01'): string {
    const name = formatEnglishQuestionName(q, lessonCode, 'CLOZE');
    let rawContent: string = stripInvalidXmlChars(String(data.clozeText || q.questionText || ''));
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

    // No embedded answers at all: fill raw "___" blanks from the answer key.
    if (!new RegExp(CLOZE_LOOSE_TOKEN_RE.source).test(rawContent)) {
        const blankCount = (rawContent.match(RAW_BLANK_RE) || []).length;
        if (blankCount > 0 && key.length >= blankCount) {
            let idx = 0;
            rawContent = rawContent.replace(RAW_BLANK_RE, () => buildEmbeddedShortAnswer(key[idx++]));
        }
    }

    rawContent = repairClozeTokens(rawContent);

    // Moodle aborts the WHOLE import on an invalid Cloze question. If it still is not
    // valid, degrade this single question instead: short answer (key known) or essay.
    if (validateClozeText(rawContent).length > 0) {
        return key.length > 0
            ? buildEnglishShortAnswerXml(q, data, lessonCode)
            : essayFallback(q, data, lessonCode, []);
    }

    // Extract instruction from questionText if present
    let instruction = '';
    if (q.questionText && q.questionText.includes('“')) {
        const parts = q.questionText.split('“');
        if (parts[0] && parts[0].trim()) {
            instruction = parts[0].replace(/^GRAM-\d+[^:]*:\s*/, '').trim();
        }
    } else if (q.questionText && q.questionText.includes('"')) {
        const parts = q.questionText.split('"');
        if (parts[0] && parts[0].trim()) {
            instruction = parts[0].replace(/^GRAM-\d+[^:]*:\s*/, '').trim();
        }
    }
    if (!instruction) {
        instruction = 'Hoàn thành câu/đoạn văn sau bằng cách chia dạng đúng của từ:';
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

/**
 * Build Moodle XML for Short Answer
 */
function buildEnglishShortAnswerXml(q: EnglishQuestionData, data: any, lessonCode: string = 'B01'): string {
    const name = formatEnglishQuestionName(q, lessonCode, 'SA');
    // Flatten all acceptable variants (dedupe, case-insensitive since usecase=0)
    const seen = new Set<string>();
    const answers = extractAnswerKey(data).flat().filter((a) => {
        const k = a.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    // Previously this fell back to the literal answer "correct", so students typing the real
    // answer got 0 points. Without an answer key, export as essay (manual grading) instead.
    if (answers.length === 0) {
        return buildEnglishEssayXml(q, data, lessonCode);
    }

    const cleanedExplanation = cleanExplanation(q.explanation);
    const feedbackHtml = cleanedExplanation ? `<p class="cell"><strong>Explanation: </strong>${escapeForCdata(cleanedExplanation)}</p>` : '';

    const answersXml = answers.map((text) => {
        // "*" is a wildcard in Moodle short answers; a literal asterisk must be escaped.
        return `    <answer fraction="100" format="moodle_auto_format">
      <text>${escapeXmlText(text.replace(/\*/g, '\\*'))}</text>
      <feedback format="html"><text><![CDATA[<p>Correct!</p>]]></text></feedback>
    </answer>`;
    }).join('\n');

    return `  <question type="shortanswer">
    <name><text>${escapeXmlText(name)}</text></name>
    <questiontext format="html">
      <text>${cdataHtml(q.questionText)}</text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${feedbackHtml}]]></text>
    </generalfeedback>
    <defaultgrade>${formatGrade(q.points, 1)}</defaultgrade>
    <penalty>0.3333333</penalty>
    <usecase>0</usecase>
${answersXml}
    <answer fraction="0" format="moodle_auto_format">
      <text>*</text>
      <feedback format="html"><text><![CDATA[<p>Incorrect answer.</p>]]></text></feedback>
    </answer>
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
        // Unknown key: previously exported as "false" silently (possibly wrong key).
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

const ESSAY_RESPONSE_FORMATS = new Set(['editor', 'editorfilepicker', 'plain', 'monospaced', 'noinline']);

/**
 * Build Moodle XML for Essay / Analysis
 */
function buildEnglishEssayXml(q: EnglishQuestionData, data: any, lessonCode: string = 'B01'): string {
    const name = formatEnglishQuestionName(q, lessonCode, 'ESSAY');
    let graderInfoStr = '';
    const rawGrader = data.graderInfo || data.rubric;
    if (typeof rawGrader === 'object' && rawGrader !== null) {
        const total = rawGrader.totalPoints ? `Total Points: ${rawGrader.totalPoints} pts\n` : '';
        const criteria = Array.isArray(rawGrader.criteria)
            ? rawGrader.criteria.map((c: any, i: number) => {
                const cName = c.criterion || c.name || `Criterion ${i + 1}`;
                const cPts = c.points !== undefined ? ` (${c.points} pts)` : '';
                const cDesc = c.description || c.desc || '';
                return `• ${cName}${cPts}${cDesc ? `: ${cDesc}` : ''}`;
            }).join('\n')
            : JSON.stringify(rawGrader);
        graderInfoStr = `${total}${criteria}`;
    } else if (rawGrader) {
        graderInfoStr = String(rawGrader);
    } else if (q.explanation) {
        graderInfoStr = String(q.explanation);
    }

    // Integer DB column: a non-numeric value makes the insert (and the whole import) fail.
    const parsedLines = parseInt(String(data.responseFieldLines ?? ''), 10);
    const lines = Number.isFinite(parsedLines) ? Math.min(Math.max(parsedLines, 5), 40) : 15;
    const responseFormat = ESSAY_RESPONSE_FORMATS.has(String(data.responseFormat)) ? String(data.responseFormat) : 'editor';

    return `  <question type="essay">
    <name><text>${escapeXmlText(name)}</text></name>
    <questiontext format="html">
      <text>${cdataHtml(q.questionText)}</text>
    </questiontext>
    <defaultgrade>${formatGrade(q.points, 2)}</defaultgrade>
    <penalty>0.0000000</penalty>
    <responseformat>${responseFormat}</responseformat>
    <responserequired>1</responserequired>
    <responsefieldlines>${lines}</responsefieldlines>
    <graderinfo format="html">
      <text><![CDATA[<p><strong>Scoring Guide / Answer Key:</strong><br/>${escapeForCdata(graderInfoStr).replace(/\n/g, '<br/>')}</p>]]></text>
    </graderinfo>
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

    const type = (q.questionType || 'MC').toUpperCase();

    switch (type) {
        case 'MATCH':
        case 'MATCHING':
            return buildEnglishMatchXml(q, data, lessonCode);
        case 'CLOZE':
            return buildEnglishClozeXml(q, data, lessonCode);
        case 'SHORTANSWER':
        case 'SA':
            return buildEnglishShortAnswerXml(q, data, lessonCode);
        case 'TRUEFALSE':
        case 'TF':
            return buildEnglishTrueFalseXml(q, data, lessonCode);
        case 'ESSAY':
            return buildEnglishEssayXml(q, data, lessonCode);
        case 'MC':
        case 'MR':
        case 'MULTICHOICE':
        default:
            return buildEnglishMultichoiceXml(q, data, lessonCode);
    }
}

/**
 * Build complete Moodle XML from an array of EnglishQuestion records.
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

    // Group by question type for clean structure
    const grouped = new Map<string, EnglishQuestionData[]>();
    for (const q of questions) {
        const type = (q.questionType || 'MC').toUpperCase();
        if (!grouped.has(type)) grouped.set(type, []);
        grouped.get(type)!.push(q);
    }

    for (const [type, list] of grouped.entries()) {
        parts.push(`  <!-- Type: ${commentSafe(type)} (${list.length} questions) -->`);
        for (const q of list) {
            parts.push(buildEnglishQuestionXml(q, lessonCode));
            parts.push('');
        }
    }

    parts.push('</quiz>');
    return parts.join('\n');
}

