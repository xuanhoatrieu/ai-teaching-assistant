import {
    getOutputLanguageInstruction,
    detectTextLanguage,
    extractSlideVisibleText,
    resolveQuestionLanguage,
} from './language-instruction';
import { normalizeInteractiveQuestions } from '../questions/moodle-xml.helper';

describe('Multilingual Interactive Question Resolution (US-034)', () => {
    describe('detectTextLanguage', () => {
        it('detects English slide content even when wrapped in Vietnamese prompt metadata', () => {
            const slideText = `
                [SLIDE_INDEX: 1] [TYPE: content]
                Title: Introduction to Phonetics and Phonology
                • Articulatory phonetics studies how speech sounds are produced in the vocal tract.
                • Phonology examines how sounds function within a particular language system.
            `;
            expect(detectTextLanguage(slideText)).toBe('en');
        });

        it('detects Vietnamese slide content with diacritics', () => {
            const slideText = `
                Slide 1: Khái niệm về Kinh tế học vĩ mô
                • Tổng sản phẩm quốc nội (GDP) đo lường giá trị thị trường của hàng hóa và dịch vụ.
                • Chính sách tài khóa và chính sách tiền tệ giúp ổn định nền kinh tế.
            `;
            expect(detectTextLanguage(slideText)).toBe('vi');
        });
    });

    describe('extractSlideVisibleText', () => {
        it('extracts title, content bullets, and optimizedContent Json without speaker notes', () => {
            const slides = [
                {
                    title: 'Lexical Semantics & Sense Relations',
                    content: ['Synonymy and antonymy in modern English', 'Hyponymy and meronymy hierarchies'],
                    speakerNote: 'Ở phần này chúng ta sẽ tìm hiểu về ngữ nghĩa từ vựng trong tiếng Anh.',
                },
            ];
            const visible = extractSlideVisibleText(slides);
            expect(visible).toContain('Lexical Semantics');
            expect(visible).not.toContain('chúng ta sẽ tìm hiểu');
            expect(detectTextLanguage(visible)).toBe('en');
        });
    });

    describe('resolveQuestionLanguage', () => {
        it('honors explicit user selection (en or vi) regardless of slide text', () => {
            expect(
                resolveQuestionLanguage({
                    explicitChoice: 'en',
                    slideVisibleText: 'Bài giảng tiếng Việt hoàn toàn về lịch sử.',
                    subjectOrSessionLanguage: 'vi',
                }),
            ).toBe('en');

            expect(
                resolveQuestionLanguage({
                    explicitChoice: 'vi',
                    slideVisibleText: ' Complete English lecture on Machine Learning and Neural Networks.',
                    subjectOrSessionLanguage: 'en',
                }),
            ).toBe('vi');
        });

        it('auto-detects English when slide text is in English even if subject language is vi or vi-en', () => {
            const englishSlides = `
                Slide 1: Object-Oriented Programming Principles
                Encapsulation, Inheritance, Polymorphism, and Abstraction are the four pillars of OOP.
            `;
            expect(
                resolveQuestionLanguage({
                    explicitChoice: 'auto',
                    slideVisibleText: englishSlides,
                    subjectOrSessionLanguage: 'vi',
                }),
            ).toBe('en');

            expect(
                resolveQuestionLanguage({
                    explicitChoice: 'auto',
                    slideVisibleText: englishSlides,
                    subjectOrSessionLanguage: 'vi-en',
                }),
            ).toBe('en');
        });

        it('returns en when subject language is en', () => {
            expect(
                resolveQuestionLanguage({
                    explicitChoice: 'auto',
                    slideVisibleText: '',
                    subjectOrSessionLanguage: 'en',
                }),
            ).toBe('en');
        });

        it('returns vi when slide text and subject language are Vietnamese', () => {
            expect(
                resolveQuestionLanguage({
                    explicitChoice: 'auto',
                    slideVisibleText: 'Chương 1: Tổng quan về quản trị doanh nghiệp và chiến lược kinh doanh.',
                    subjectOrSessionLanguage: 'vi',
                }),
            ).toBe('vi');
        });
    });

    describe('normalizeInteractiveQuestions language-aware TF normalization', () => {
        it('normalizes TF questions to True / False when targetLang is en', () => {
            const raw = [
                {
                    type: 'TF',
                    question: 'All vowels in English are voiced sounds.',
                    options: ['Đúng', 'Sai'],
                    correctAnswer: 'Đúng',
                },
            ];
            const normalized = normalizeInteractiveQuestions(raw, 'en');
            expect(normalized[0].options).toEqual(['True', 'False']);
            expect(normalized[0].correctAnswer).toBe('True');
        });

        it('normalizes TF questions to Đúng / Sai when targetLang is vi', () => {
            const raw = [
                {
                    type: 'TF',
                    question: 'Hà Nội là thủ đô của Việt Nam.',
                    options: ['True', 'False'],
                    correctAnswer: 'True',
                },
            ];
            const normalized = normalizeInteractiveQuestions(raw, 'vi');
            expect(normalized[0].options).toEqual(['Đúng', 'Sai']);
            expect(normalized[0].correctAnswer).toBe('Đúng');
        });
    });

    describe('getOutputLanguageInstruction', () => {
        it('instructs bilingual mode to write questions, answers, and feedback in English matching slide text', () => {
            const instruction = getOutputLanguageInstruction('vi-en');
            expect(instruction).toContain('Questions, answers, and feedback: MUST be in **English**');
        });
    });
});
