/**
 * Instruction 3: Design Presentation Slides & Transcript (English version)
 * Output language controlled by {output_language_instruction} from PromptComposerService
 * This file is a REFERENCE — runtime prompts are loaded from the database
 */

export const INSTRUCTION_3_DESIGN_SLIDES = `
**TASK:** Transform the detailed outline into a slide-by-slide script for a PowerPoint presentation.

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

## SLIDE TYPES:
- "title" - Opening slide introducing the lesson
- "agenda" - Table of contents / lesson overview
- "objectives" - Learning objectives
- "content" - Main content slides (majority of slides)
- "summary" - Closing summary slide

---

## OUTPUT FORMAT (JSON):

\`\`\`json
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
      "speakerNote": "Welcome to today's lesson..."
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
\`\`\`

Return ONLY valid JSON, no other text.
`;
