/**
 * Instruction 2: Build Outline (English version)
 * Output language controlled by {output_language_instruction} from PromptComposerService
 * This file is a REFERENCE — runtime prompts are loaded from the database
 */

export const INSTRUCTION_2_BUILD_OUTLINE = `
**TASK:** Build a detailed and logically structured outline for the lesson.

**INPUT:**
- Lesson title: {title}
- Raw outline:
{raw_outline}

---

## ⚠️ CRITICAL CONSTRAINTS

1. **DO NOT ADD NEW CONTENT:** Only expand and elaborate on items already in the raw outline.
2. **DO NOT OMIT:** Every item in the raw outline MUST appear in the output.
3. **DO NOT INVENT:** Do not add topics or concepts beyond the scope of the input.

---

{output_language_instruction}

---

## OUTPUT FORMAT (JSON):

\`\`\`json
{
  "title": "{title}",
  "agenda": ["Topic 1", "Topic 2", "..."],
  "objectives": [
    "Describe the fundamentals of...",
    "Analyze the factors affecting...",
    "Apply knowledge to practical situations..."
  ],
  "learningGuide": "Equipment, learning materials, and study methods",
  "situation": "A short story or thought-provoking question to hook student interest",
  "sections": [
    {
      "id": "1",
      "title": "Major Section 1",
      "subsections": [
        {"id": "1.1", "title": "Subsection 1.1", "keyPoints": ["Key point 1", "Key point 2"]},
        {"id": "1.2", "title": "Subsection 1.2", "keyPoints": ["..."]}
      ]
    }
  ],
  "situationSolution": "Resolution of the opening scenario using lesson knowledge",
  "summary": ["Key takeaway 1", "Key takeaway 2", "Key takeaway 3"],
  "reviewQuestions": [
    "Open-ended review question 1?",
    "Open-ended review question 2?",
    "Open-ended review question 3?"
  ],
  "closingMessage": "Motivational closing message or preview of next lesson"
}
\`\`\`

Return ONLY valid JSON, no other text.
`;
