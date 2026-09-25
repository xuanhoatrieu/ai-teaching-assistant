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
function escapeForCdata(text: any): string {
    if (text === null || text === undefined) return '';
    if (typeof text === 'object') {
        try {
            return JSON.stringify(text);
        } catch {
            return String(text);
        }
    }
    // Split ]]> to prevent CDATA injection
    return String(text).replace(/]]>/g, ']]]]><![CDATA[>');
}

/**
 * Wrap text in CDATA HTML paragraph for Moodle questiontext/answer fields.
 */
function cdataHtml(text: any): string {
    return `<![CDATA[<p class="cell">${escapeForCdata(text)}</p>]]>`;
}

/**
 * Build a single multichoice question XML block.
 */
function buildQuestionXml(q: ReviewQuestionData): string {
    const feedbackParts = [`<strong>Đáp án đúng là: </strong>A. ${escapeForCdata(q.correctAnswer)}`];
    if (q.explanation) {
        feedbackParts.push(`<strong>Vì: </strong>${escapeForCdata(q.explanation)}`);
    }
    const feedbackHtml = feedbackParts.map((p) => `<p class="cell">${p}</p>`).join('\n      ');

    // Build question name: "B1-1-01: Nội dung câu hỏi" (truncate to 200 chars for readability)
    const questionPreview = q.question.length > 200 ? q.question.substring(0, 197) + '...' : q.question;
    const questionName = `${q.questionId}: ${questionPreview}`;

    return `  <question type="multichoice">
    <name><text>${escapeForCdata(questionName)}</text></name>
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
      <text>${cdataHtml(q.correctAnswer)}</text>
    </answer>
    <answer fraction="0" format="html">
      <text>${cdataHtml(q.optionB)}</text>
    </answer>
    <answer fraction="0" format="html">
      <text>${cdataHtml(q.optionC)}</text>
    </answer>
    <answer fraction="0" format="html">
      <text>${cdataHtml(q.optionD)}</text>
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
        .substring(0, 50);

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
 * Build Moodle XML for Multiple Choice / Multiple Response
 */
function buildEnglishMultichoiceXml(q: EnglishQuestionData, data: any): string {
    const isSingle = data.single !== false && q.questionType.toUpperCase() !== 'MR';
    const options: Array<{ text: string; isCorrect?: boolean; fraction?: number; feedback?: string }> =
        Array.isArray(data.options) ? data.options : [];

    const feedbackHtml = q.explanation ? `<p class="cell"><strong>Explanation: </strong>${escapeForCdata(q.explanation)}</p>` : '';

    let answersXml = '';

    if (isSingle) {
        // Single choice: Exactly 1 correct answer (100%), all others 0%
        const correctIdx = options.findIndex(o => o.isCorrect === true || (typeof o.fraction === 'number' && o.fraction > 0));
        const effectiveCorrectIdx = correctIdx >= 0 ? correctIdx : 0;

        answersXml = options.map((opt, idx) => {
            const isCorr = idx === effectiveCorrectIdx;
            const fraction = isCorr ? '100' : '0';
            const optFeedback = opt.feedback
                ? `\n      <feedback format="html"><text><![CDATA[<p>${escapeForCdata(opt.feedback)}</p>]]></text></feedback>`
                : '';

            return `    <answer fraction="${fraction}" format="html">
      <text>${cdataHtml(opt.text)}</text>${optFeedback}
    </answer>`;
        }).join('\n');
    } else {
        // Multiple Response (MR):
        // 1. Identify which options are correct
        const correctIndices = new Set<number>();
        options.forEach((opt, idx) => {
            if (opt.isCorrect === true || (typeof opt.fraction === 'number' && opt.fraction > 0)) {
                correctIndices.add(idx);
            }
        });

        // Fallback: at least one option must be correct
        if (correctIndices.size === 0 && options.length > 0) {
            correctIndices.add(0);
        }

        const correctCount = correctIndices.size;
        const incorrectCount = options.length - correctCount;

        // Exact Moodle allowable fractions
        const positiveFraction = MOODLE_POSITIVE_FRACTIONS[correctCount] || (100 / correctCount).toFixed(5);
        const negativeFraction = incorrectCount > 0
            ? (MOODLE_NEGATIVE_FRACTIONS[incorrectCount] || (-100 / incorrectCount).toFixed(5))
            : '0';

        answersXml = options.map((opt, idx) => {
            const isCorr = correctIndices.has(idx);
            const fraction = isCorr ? positiveFraction : negativeFraction;
            const optFeedback = opt.feedback
                ? `\n      <feedback format="html"><text><![CDATA[<p>${escapeForCdata(opt.feedback)}</p>]]></text></feedback>`
                : '';

            return `    <answer fraction="${fraction}" format="html">
      <text>${cdataHtml(opt.text)}</text>${optFeedback}
    </answer>`;
        }).join('\n');
    }

    const name = q.title || `ENG-${q.questionOrder || 1}: ${q.questionText.substring(0, 80)}`;

    return `  <question type="multichoice">
    <name><text>${escapeForCdata(name)}</text></name>
    <questiontext format="html">
      <text>${cdataHtml(q.questionText)}</text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${feedbackHtml}]]></text>
    </generalfeedback>
    <defaultgrade>${q.points || 1}.0000000</defaultgrade>
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
function buildEnglishMatchXml(q: EnglishQuestionData, data: any): string {
    const pairs: Array<any> = Array.isArray(data.pairs) ? data.pairs : [];
    const name = q.title || `MATCH-${q.questionOrder || 1}: ${q.questionText.substring(0, 80)}`;
    const feedbackHtml = q.explanation ? `<p class="cell"><strong>Explanation: </strong>${escapeForCdata(q.explanation)}</p>` : '';

    const subquestionsXml = pairs.map((pair) => {
        const sub = pair.subquestion ?? pair.left ?? pair.question ?? '';
        const ans = pair.answer ?? pair.right ?? pair.match ?? '';
        return `    <subquestion format="html">
      <text>${cdataHtml(sub)}</text>
      <answer>
        <text>${escapeForCdata(ans)}</text>
      </answer>
    </subquestion>`;
    }).join('\n');

    return `  <question type="match">
    <name><text>${escapeForCdata(name)}</text></name>
    <questiontext format="html">
      <text>${cdataHtml(q.questionText)}</text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${feedbackHtml}]]></text>
    </generalfeedback>
    <defaultgrade>${q.points || 1}.0000000</defaultgrade>
    <penalty>0.3333333</penalty>
    <shuffleanswers>true</shuffleanswers>
${subquestionsXml}
  </question>`;
}

/**
 * Build Moodle XML for Cloze (Embedded Answers)
 */
function buildEnglishClozeXml(q: EnglishQuestionData, data: any): string {
    const name = q.title || `CLOZE-${q.questionOrder || 1}: ${q.questionText.substring(0, 80)}`;
    let rawContent = data.clozeText || q.questionText;

    // Normalize all blank weights to 1 so Moodle doesn't sum weights as 1+2=3.00
    rawContent = rawContent.replace(/\{(\d+):(SHORTANSWER|MULTICHOICE)/g, '{1:$2');

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
    const feedbackHtml = q.explanation ? `<p class="cell"><strong>Explanation: </strong>${escapeForCdata(q.explanation)}</p>` : '';

    return `  <question type="cloze">
    <name><text>${escapeForCdata(name)}</text></name>
    <questiontext format="html">
      <text><![CDATA[${contentHtml}]]></text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${feedbackHtml}]]></text>
    </generalfeedback>
    <defaultgrade>${q.points || 1}.0000000</defaultgrade>
    <penalty>0.3333333</penalty>
  </question>`;
}

/**
 * Build Moodle XML for Short Answer
 */
function buildEnglishShortAnswerXml(q: EnglishQuestionData, data: any): string {
    const name = q.title || `SA-${q.questionOrder || 1}: ${q.questionText.substring(0, 80)}`;
    const answers: any[] = Array.isArray(data.acceptableAnswers)
        ? data.acceptableAnswers
        : data.correctAnswer ? [data.correctAnswer] : ['correct'];
    const feedbackHtml = q.explanation ? `<p class="cell"><strong>Explanation: </strong>${escapeForCdata(q.explanation)}</p>` : '';

    const answersXml = answers.map((ans) => {
        const text = typeof ans === 'object' ? JSON.stringify(ans) : String(ans);
        return `    <answer fraction="100" format="moodle_auto_format">
      <text>${escapeForCdata(text)}</text>
      <feedback format="html"><text><![CDATA[<p>Correct!</p>]]></text></feedback>
    </answer>`;
    }).join('\n');

    return `  <question type="shortanswer">
    <name><text>${escapeForCdata(name)}</text></name>
    <questiontext format="html">
      <text>${cdataHtml(q.questionText)}</text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${feedbackHtml}]]></text>
    </generalfeedback>
    <defaultgrade>${q.points || 1}.0000000</defaultgrade>
    <penalty>0.3333333</penalty>
    <usecase>0</usecase>
${answersXml}
    <answer fraction="0" format="moodle_auto_format">
      <text>*</text>
      <feedback format="html"><text><![CDATA[<p>Incorrect answer.</p>]]></text></feedback>
    </answer>
  </question>`;
}

/**
 * Build Moodle XML for True / False
 */
function buildEnglishTrueFalseXml(q: EnglishQuestionData, data: any): string {
    const name = q.title || `TF-${q.questionOrder || 1}: ${q.questionText.substring(0, 80)}`;
    const isTrue = data.correctAnswer === true || String(data.correctAnswer).toLowerCase() === 'true';
    const feedbackHtml = q.explanation ? `<p class="cell"><strong>Explanation: </strong>${escapeForCdata(q.explanation)}</p>` : '';

    return `  <question type="truefalse">
    <name><text>${escapeForCdata(name)}</text></name>
    <questiontext format="html">
      <text>${cdataHtml(q.questionText)}</text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${feedbackHtml}]]></text>
    </generalfeedback>
    <defaultgrade>${q.points || 1}.0000000</defaultgrade>
    <penalty>1.0000000</penalty>
    <answer fraction="${isTrue ? 100 : 0}" format="moodle_auto_format">
      <text>true</text>
      <feedback format="html"><text><![CDATA[<p>${isTrue ? 'Correct!' : 'Incorrect.'}</p>]]></text></feedback>
    </answer>
    <answer fraction="${isTrue ? 0 : 100}" format="moodle_auto_format">
      <text>false</text>
      <feedback format="html"><text><![CDATA[<p>${!isTrue ? 'Correct!' : 'Incorrect.'}</p>]]></text></feedback>
    </answer>
  </question>`;
}

/**
 * Build Moodle XML for Essay / Analysis
 */
function buildEnglishEssayXml(q: EnglishQuestionData, data: any): string {
    const name = q.title || `ESSAY-${q.questionOrder || 1}: ${q.questionText.substring(0, 80)}`;
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

    const lines = data.responseFieldLines || 15;

    return `  <question type="essay">
    <name><text>${escapeForCdata(name)}</text></name>
    <questiontext format="html">
      <text>${cdataHtml(q.questionText)}</text>
    </questiontext>
    <defaultgrade>${q.points || 2}.0000000</defaultgrade>
    <penalty>0.0000000</penalty>
    <responseformat>editor</responseformat>
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
export function buildEnglishQuestionXml(q: EnglishQuestionData): string {
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
            return buildEnglishMatchXml(q, data);
        case 'CLOZE':
            return buildEnglishClozeXml(q, data);
        case 'SHORTANSWER':
        case 'SA':
            return buildEnglishShortAnswerXml(q, data);
        case 'TRUEFALSE':
        case 'TF':
            return buildEnglishTrueFalseXml(q, data);
        case 'ESSAY':
            return buildEnglishEssayXml(q, data);
        case 'MC':
        case 'MR':
        case 'MULTICHOICE':
        default:
            return buildEnglishMultichoiceXml(q, data);
    }
}

/**
 * Build complete Moodle XML from an array of EnglishQuestion records.
 */
export function buildEnglishMoodleXml(
    questions: EnglishQuestionData[],
    lessonTitle: string,
): string {
    const lessonSlug = lessonTitle
        .replace(/[^\w\sàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi, '')
        .replace(/\s+/g, '_')
        .substring(0, 50);

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
        parts.push(`  <!-- Type: ${type} (${list.length} questions) -->`);
        for (const q of list) {
            parts.push(buildEnglishQuestionXml(q));
            parts.push('');
        }
    }

    parts.push('</quiz>');
    return parts.join('\n');
}

