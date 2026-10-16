import {
    stripOptionPrefix,
    cleanExplanation,
    buildMoodleXml,
    ReviewQuestionData,
} from './moodle-xml.helper';

describe('moodle-xml.helper', () => {
    describe('stripOptionPrefix', () => {
        it('should strip standard letter prefixes (A., B., C., D.)', () => {
            expect(stripOptionPrefix('A. What do you do with your friends?')).toBe('What do you do with your friends?');
            expect(stripOptionPrefix('B. What are you do with your friends?')).toBe('What are you do with your friends?');
            expect(stripOptionPrefix('C. What do you does with your friends?')).toBe('What do you does with your friends?');
            expect(stripOptionPrefix('D. What does you do with your friends?')).toBe('What does you do with your friends?');
        });

        it('should strip nested / duplicate prefixes like "A. A. ..."', () => {
            expect(stripOptionPrefix('A. A. What do you do with your friends?')).toBe('What do you do with your friends?');
            expect(stripOptionPrefix('B. B. What are you do with your friends?')).toBe('What are you do with your friends?');
        });

        it('should strip parenthesis prefixes like "(A) " or "[B] "', () => {
            expect(stripOptionPrefix('(A) Những hoạt động giải trí')).toBe('Những hoạt động giải trí');
            expect(stripOptionPrefix('[B] Những công việc toàn thời gian')).toBe('Những công việc toàn thời gian');
            expect(stripOptionPrefix('C) Những môn học bắt buộc')).toBe('Những môn học bắt buộc');
        });

        it('should strip colon and hyphen prefixes like "A: " or "A - "', () => {
            expect(stripOptionPrefix('A: Phương án đúng')).toBe('Phương án đúng');
            expect(stripOptionPrefix('A - Phương án đúng')).toBe('Phương án đúng');
        });

        it('should strip number prefixes like "1. " or "2) "', () => {
            expect(stripOptionPrefix('1. Hà Nội')).toBe('Hà Nội');
            expect(stripOptionPrefix('2) Đà Nẵng')).toBe('Đà Nẵng');
        });

        it('should not strip normal words starting with A', () => {
            expect(stripOptionPrefix('Artificial Intelligence')).toBe('Artificial Intelligence');
            expect(stripOptionPrefix('Apple and banana')).toBe('Apple and banana');
            expect(stripOptionPrefix('Always do your best')).toBe('Always do your best');
        });

        it('should handle null, undefined, or empty values', () => {
            expect(stripOptionPrefix(null)).toBe('');
            expect(stripOptionPrefix(undefined)).toBe('');
            expect(stripOptionPrefix('')).toBe('');
        });
    });

    describe('cleanExplanation', () => {
        it('should clean "Vì: A đúng vì..." to neutral explanation', () => {
            const input = 'Vì: A đúng vì “hobbies” là các hoạt động con người làm trong thời gian rảnh để vui/giải trí.';
            const result = cleanExplanation(input);
            expect(result).toBe('“hobbies” là các hoạt động con người làm trong thời gian rảnh để vui/giải trí.');
            expect(result).not.toContain('A đúng vì');
        });

        it('should clean "Vì: A đúng vì câu hỏi hiện tại đơn..."', () => {
            const input = 'Vì: A đúng vì câu hỏi hiện tại đơn với “you” dùng “do”, sau đó là động từ nguyên mẫu “do”.';
            const result = cleanExplanation(input);
            expect(result).toBe('Câu hỏi hiện tại đơn với “you” dùng “do”, sau đó là động từ nguyên mẫu “do”.');
            expect(result).not.toContain('A đúng vì');
        });

        it('should clean Vietnamese variations like "Phương án A là đáp án đúng vì", "Chọn A vì"', () => {
            expect(cleanExplanation('Phương án A là đáp án đúng vì nội dung chuẩn')).toBe('Nội dung chuẩn');
            expect(cleanExplanation('Đáp án A đúng do quy tắc ngữ pháp')).toBe('Quy tắc ngữ pháp');
            expect(cleanExplanation('Chọn A vì cấu trúc câu')).toBe('Cấu trúc câu');
            expect(cleanExplanation('Giải thích: A đúng vì mệnh đề quan hệ')).toBe('Mệnh đề quan hệ');
        });

        it('should clean English variations like "Option A is correct because"', () => {
            expect(cleanExplanation('Option A is correct because it uses present simple')).toBe('It uses present simple');
            expect(cleanExplanation('Answer A is correct as defined in the textbook')).toBe('Defined in the textbook');
        });

        it('should preserve neutral explanations', () => {
            const neutral = 'Trong thì hiện tại đơn với chủ ngữ số nhiều, ta dùng trợ động từ "do".';
            expect(cleanExplanation(neutral)).toBe(neutral);
        });
    });

    describe('buildMoodleXml', () => {
        it('should generate Moodle XML without double lettering and without hardcoded A in feedback', () => {
            const questions: ReviewQuestionData[] = [
                {
                    questionId: 'B1-1-01',
                    level: 1,
                    question: 'Bạn muốn hỏi bạn mình thường làm gì với bạn bè. Câu nào đúng?',
                    correctAnswer: 'A. What do you do with your friends?',
                    optionB: 'B. What are you do with your friends?',
                    optionC: 'C. What does you do with your friends?',
                    optionD: 'D. What do you does with your friends?',
                    explanation: 'Vì: A đúng vì câu hỏi hiện tại đơn với "you" dùng "do", sau đó là động từ nguyên mẫu "do".',
                },
            ];

            const xml = buildMoodleXml(questions, 'Lesson 01');

            // 1. Verify XML structure
            expect(xml).toContain('<question type="multichoice">');
            expect(xml).toContain('<shuffleanswers>true</shuffleanswers>');
            expect(xml).toContain('<answernumbering>ABCD</answernumbering>');

            // 2. Negative proof: MUST NOT contain hardcoded "Đáp án đúng là: </strong>A."
            expect(xml).not.toContain('Đáp án đúng là: </strong>A.');
            expect(xml).not.toContain('A đúng vì');

            // 3. Negative proof: Answers MUST NOT have duplicate prefix like "A. What do you do" inside CDATA
            expect(xml).not.toContain('<p class="cell">A. What do you do with your friends?</p>');
            expect(xml).not.toContain('<p class="cell">B. What are you do with your friends?</p>');

            // 4. Positive proof: Answers MUST have cleaned text
            expect(xml).toContain('<p class="cell">What do you do with your friends?</p>');
            expect(xml).toContain('<p class="cell">What are you do with your friends?</p>');
            expect(xml).toContain('<p class="cell">What does you do with your friends?</p>');
            expect(xml).toContain('<p class="cell">What do you does with your friends?</p>');

            // 5. Positive proof: Feedback MUST contain clean answer text and clean explanation
            expect(xml).toContain('<strong>Đáp án đúng: </strong>What do you do with your friends?');
            expect(xml).toContain('<strong>Giải thích: </strong>Câu hỏi hiện tại đơn với "you" dùng "do", sau đó là động từ nguyên mẫu "do".');
        });
    });
});
