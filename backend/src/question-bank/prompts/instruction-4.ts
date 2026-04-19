/**
 * Instruction 4: Create Question Bank (English version)
 * Output language controlled by {output_language_instruction} from PromptComposerService
 * This file is a REFERENCE — runtime prompts are loaded from the database
 */

export const INSTRUCTION_4_QUESTIONS = `
**TASK:** Create a comprehensive set of review multiple-choice questions following Bloom's Taxonomy.

**INPUT:**
- Lesson title: {title}
- Detailed content:
{detailed_outline}

**NUMBER OF QUESTIONS:**
- **Knowledge** level (Level 1): {level1_count} questions
- **Comprehension** level (Level 2): {level2_count} questions
- **Application** level (Level 3): {level3_count} questions

---

## REQUIREMENTS BY LEVEL:

1. **KNOWLEDGE Level (Level 1):**
   - Tests recall of concepts, definitions, terminology
   - Keywords: who, what, where, when, define, list, identify

2. **COMPREHENSION Level (Level 2):**
   - Tests ability to explain, compare, distinguish
   - Keywords: compare, explain, why, summarize, differentiate

3. **APPLICATION Level (Level 3):**
   - Tests ability to apply knowledge to new situations
   - Keywords: apply, use, solve, predict, demonstrate

---

{output_language_instruction}

---

## RULES:
- Each question has EXACTLY ONE correct answer
- Wrong options must be plausible and convincing
- Avoid negative phrasing (NOT, EXCEPT)
- Options should be similar in length

## FORMAT (Markdown Table):

| Question ID | Question | Correct Answer (A) | Option B | Option C | Option D | Explanation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |

**Question ID Convention:**
- Format: [Lesson]-[Level]-[Order]
- Example: B1-1-01, B1-1-02 (Lesson 1, Level 1, Questions 1, 2)
- Example: B1-2-01 (Lesson 1, Level 2, Question 1)
- Example: B1-3-01 (Lesson 1, Level 3, Question 1)

**The correct answer is ALWAYS placed in the "Correct Answer (A)" column.**
`;
