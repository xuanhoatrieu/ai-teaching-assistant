-- Migration: Rewrite all instruction prompts from Vietnamese to English
-- System prompts in English for better AI model performance
-- Output language is controlled by {output_language_instruction} injected by PromptComposerService
-- Run: psql -U ata_user -d ai_teaching -f prisma/migrations/rewrite_prompts_english.sql

-- ==============================================================
-- 1. System Role Template (EN)
-- ==============================================================
UPDATE prompts SET
  content = '**ROLE:** You are an experienced {institution_type} lecturer and expert in {expertise_area}.

Your task is to create detailed, engaging, and easy-to-understand lesson plans and lecture materials for the course {course_name}.

Target audience: {target_audience} majoring in {major_name}.

{additional_context}

{output_language_instruction}',
  variables = ARRAY['{institution_type}', '{expertise_area}', '{course_name}', '{target_audience}', '{major_name}', '{additional_context}', '{output_language_instruction}'],
  version = version + 1,
  updated_at = NOW()
WHERE slug = 'system.role';

-- ==============================================================
-- 2. Outline Detailed Prompt (EN)
-- ==============================================================
UPDATE prompts SET
  content = '**TASK:** Build a detailed and logically structured outline for the lesson.

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

```json
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
```

Return ONLY valid JSON, no other text.',
  variables = ARRAY['{title}', '{raw_outline}', '{output_language_instruction}'],
  version = version + 1,
  updated_at = NOW()
WHERE slug = 'outline.detailed';

-- ==============================================================
-- 3. Slides Script Prompt (EN)
-- ==============================================================
UPDATE prompts SET
  content = '**TASK:** Transform the detailed outline into a slide-by-slide script for a PowerPoint presentation.

**INPUT:**
- Lesson title: {title}
- Detailed outline:
{detailed_outline}

---

## ⚠️ MANDATORY CONSTRAINTS

> **CRITICAL:** You MUST NOT add or remove content.

1. **EACH SECTION** in the outline → **AT LEAST 1 SLIDE**
2. **DO NOT CREATE SLIDES** about content not in the outline
3. **SPEAKER NOTES** must only explain existing content, do not add new knowledge
4. **EXAMPLES** only illustrate knowledge from the outline

---

{output_language_instruction}

---

## REQUIREMENTS:

1. **Minimal text, rich meaning:** Slides should only contain a title and max 2-3 concise key points.
2. **Visual First:** Every content slide MUST have a specific visualIdea.
3. **Detailed Speaker Notes:** Natural lecturing style, as if speaking in class.
4. **Duration:** Each slide approximately 1-3 minutes.

---

## OUTPUT FORMAT (JSON):

```json
{
  "title": "{title}",
  "totalSlides": 15,
  "slides": [
    {
      "slideIndex": 0,
      "slideType": "title",
      "title": "Lesson Title",
      "subtitle": "Course Name",
      "content": [],
      "visualIdea": null,
      "speakerNote": "Welcome to today''s lesson..."
    },
    {
      "slideIndex": 1,
      "slideType": "agenda",
      "title": "Lesson Agenda",
      "content": ["Topic 1", "Topic 2", "Topic 3"],
      "visualIdea": null,
      "speakerNote": "Today we will explore..."
    },
    {
      "slideIndex": 2,
      "slideType": "objectives",
      "title": "Learning Objectives",
      "content": ["Objective 1", "Objective 2"],
      "visualIdea": "Icons: target, lightbulb, ascending steps",
      "speakerNote": "By the end of this lesson, you will be able to..."
    },
    {
      "slideIndex": 3,
      "slideType": "content",
      "title": "Section title from outline",
      "content": ["Key point 1", "Key point 2"],
      "visualIdea": "Mind map / Chart / Infographic describing the concept",
      "speakerNote": "Detailed explanation in natural lecturing style..."
    }
  ],
  "coverageCheck": {
    "inputSections": ["Section 1", "Section 2"],
    "mappedSlides": {"Section 1": [3, 4], "Section 2": [5, 6, 7]}
  }
}
```

Return ONLY valid JSON, no other text.',
  variables = ARRAY['{title}', '{detailed_outline}', '{output_language_instruction}'],
  version = version + 1,
  updated_at = NOW()
WHERE slug = 'slides.script';

-- ==============================================================
-- 4. Interactive Questions Prompt (EN)
-- ==============================================================
UPDATE prompts SET
  content = '**TASK:** Create 5 interactive questions to check student engagement during the lesson.

**INPUT:**
- Lesson title: {title}
- Slide script:
{slide_script}

---

## ⚠️ QUESTION CREATION RULES

1. **ONLY ASK ABOUT PRESENTED CONTENT:**
   - Questions MUST come from existing slide content
   - Each question MUST reference a specific slideIndex

2. **DO NOT ASK:**
   - Knowledge outside the lesson
   - Complex reasoning questions

3. **PURPOSE:** Check if students are FOLLOWING along, not testing background knowledge

---

{output_language_instruction}

---

## OUTPUT FORMAT (JSON):

```json
{
  "questions": [
    {
      "questionOrder": 1,
      "questionType": "MC",
      "questionText": "Question content?",
      "relatedSlideIndex": 5,
      "answers": [
        {"text": "Option A", "isCorrect": true},
        {"text": "Option B", "isCorrect": false},
        {"text": "Option C", "isCorrect": false},
        {"text": "Option D", "isCorrect": false}
      ],
      "correctFeedback": "Correct! Because...",
      "incorrectFeedback": "Not quite. The correct answer is...",
      "points": 1
    },
    {
      "questionOrder": 2,
      "questionType": "MR",
      "questionText": "Select ALL correct answers...",
      "relatedSlideIndex": 8,
      "answers": [
        {"text": "Option A", "isCorrect": true},
        {"text": "Option B", "isCorrect": true},
        {"text": "Option C", "isCorrect": false},
        {"text": "Option D", "isCorrect": false}
      ],
      "correctFeedback": "Excellent!",
      "incorrectFeedback": "Review slide...",
      "points": 1
    }
  ]
}
```

- MC = Multiple Choice (1 correct answer)
- MR = Multiple Response (multiple correct answers)

Return ONLY valid JSON, no other text.',
  variables = ARRAY['{title}', '{slide_script}', '{output_language_instruction}'],
  version = version + 1,
  updated_at = NOW()
WHERE slug = 'questions.interactive';

-- ==============================================================
-- 5. Review Questions Prompt (EN)
-- ==============================================================
UPDATE prompts SET
  content = '**TASK:** Create a comprehensive set of review multiple-choice questions following Bloom''s Taxonomy.

**INPUT:**
- Lesson title: {title}
- Slide script:
{slide_script}

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
- **correctAnswer is the correct answer**, other options are incorrect

---

## OUTPUT FORMAT (JSON):

```json
{
  "questions": [
    {
      "questionId": "B1-1-01",
      "questionOrder": 1,
      "level": 1,
      "question": "Question content?",
      "correctAnswer": "The correct answer (A)",
      "optionB": "Option B",
      "optionC": "Option C",
      "optionD": "Option D",
      "explanation": "Explanation of why A is correct..."
    },
    {
      "questionId": "B1-2-01",
      "questionOrder": 2,
      "level": 2,
      "question": "Compare X and Y?",
      "correctAnswer": "The key difference is...",
      "optionB": "...",
      "optionC": "...",
      "optionD": "...",
      "explanation": "..."
    }
  ]
}
```

**Question ID format:** B{lesson}-{level}-{order}
- B1-1-01 = Lesson 1, Level 1, Question 1
- B1-2-01 = Lesson 1, Level 2, Question 1

Return ONLY valid JSON, no other text.',
  variables = ARRAY['{title}', '{slide_script}', '{level1_count}', '{level2_count}', '{level3_count}', '{output_language_instruction}'],
  version = version + 1,
  updated_at = NOW()
WHERE slug = 'questions.review';

-- ==============================================================
-- 6. Slides Optimize Content (EN)
-- ==============================================================
UPDATE prompts SET
  content = '**TASK:** Optimize slide content into concise, easy-to-read bullet points.

**INPUT:**
- Slide title: {title}
- Original content: {content}
- Lesson title: {lesson_title}

---

{output_language_instruction}

---

## REQUIREMENTS:

1. **Maximum 4 bullet points** — each bullet has:
   - 1 relevant emoji
   - 1 concise point (max 10 words)
   - 1 explanatory description (max 20 words)

2. **Bullet points must:**
   - Be concise and readable on a slide
   - Preserve the meaning of the original content
   - Not add new knowledge

3. **Choose appropriate emojis:**
   - 📌 Important point
   - 💡 Ideas, tips
   - ⚠️ Warnings, cautions
   - ✅ Requirements, conditions
   - 🔑 Key concepts
   - 📊 Data, statistics
   - 🎯 Goals, outcomes

---

## OUTPUT FORMAT (JSON Array):

```json
[
  {
    "emoji": "📌",
    "point": "Concise title",
    "description": "Brief explanation of this point"
  },
  {
    "emoji": "💡",
    "point": "Important idea",
    "description": "Explanation of the idea"
  }
]
```

Return ONLY the JSON array, no other text.',
  variables = ARRAY['{title}', '{content}', '{lesson_title}', '{output_language_instruction}'],
  version = version + 1,
  updated_at = NOW()
WHERE slug = 'slides.optimize_content';

-- ==============================================================
-- 7. Handout Generation (EN)
-- ==============================================================
UPDATE prompts SET
  content = '**TASK:** Create a comprehensive study handout/ebook from the detailed outline.

**INPUT:**
- Lesson title: {title}
- Detailed outline:
{detailed_outline}

---

{output_language_instruction}

---

## OUTPUT FORMAT (JSON):

```json
{
  "title": "{title}",
  "subject": "Course name",
  "sections": [
    {
      "heading": "Section heading",
      "content": "Detailed content in markdown with **bold**, *italic*, and bullet points",
      "keyPoints": ["Key point 1", "Key point 2"],
      "examples": ["Practical example 1", "Practical example 2"]
    }
  ],
  "summary": "Summary of the main lesson content",
  "reviewQuestions": [
    "Review question 1?",
    "Review question 2?"
  ]
}
```

## RULES:
1. Provide detailed content with clear explanations of concepts
2. Include practical, real-world examples
3. Each section should have keyPoints to highlight important information
4. Use markdown formatting within content fields

Return ONLY valid JSON, no other text.',
  variables = ARRAY['{title}', '{detailed_outline}', '{output_language_instruction}'],
  version = version + 1,
  updated_at = NOW()
WHERE slug = 'handout.generate';

-- ==============================================================
-- Verify
-- ==============================================================
SELECT slug, name, version, is_active FROM prompts ORDER BY slug;
