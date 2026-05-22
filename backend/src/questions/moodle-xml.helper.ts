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

interface ReviewQuestionData {
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
function escapeForCdata(text: string): string {
    // Split ]]> to prevent CDATA injection
    return text.replace(/]]>/g, ']]]]><![CDATA[>');
}

/**
 * Wrap text in CDATA HTML paragraph for Moodle questiontext/answer fields.
 */
function cdataHtml(text: string): string {
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
