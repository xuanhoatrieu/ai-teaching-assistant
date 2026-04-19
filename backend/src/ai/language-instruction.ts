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
- Questions and answers: MUST be in **Vietnamese (Tiếng Việt)**
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
