import {
    stripOptionPrefix,
    cleanExplanation,
    buildMoodleXml,
    ReviewQuestionData,
    isMatchingQuestionText,
    extractMatchPairs,
    buildEnglishQuestionXml,
    buildEnglishMoodleXml,
    EnglishQuestionData,
    toMoodleCategorySlug,
    buildSingleCategoryExamMoodleXml,
    validateClozeText,
    upgradeClozeToMultichoice,
    normalizeInteractiveQuestions,
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

    describe('Matching Question Improvements & Auto-Recovery', () => {
        it('isMatchingQuestionText should identify matching intent correctly', () => {
            expect(isMatchingQuestionText('Ghép mỗi thành phần với chức năng phù hợp.')).toBe(true);
            expect(isMatchingQuestionText('Ghép mỗi câu trong presentation model với thành phần tương ứng.')).toBe(true);
            expect(isMatchingQuestionText('Nối mỗi khái niệm với định nghĩa đúng:')).toBe(true);
            expect(isMatchingQuestionText('Match each term with its definition.')).toBe(true);
            expect(isMatchingQuestionText('Hãy ghép các cặp sau:')).toBe(true);
            expect(isMatchingQuestionText('Chọn đáp án đúng nhất')).toBe(false);
            expect(isMatchingQuestionText('What is the main function of numpy?')).toBe(false);
        });

        it('extractMatchPairs should extract pairs from data.matchingPairs', () => {
            const data = {
                matchingPairs: [
                    { left: 'Thành phần A', right: 'Chức năng A' },
                    { left: 'Thành phần B', right: 'Chức năng B' },
                ],
            };
            const result = extractMatchPairs(data);
            expect(result.pairs).toHaveLength(2);
            expect(result.pairs[0]).toEqual({ sub: 'Thành phần A', ans: 'Chức năng A' });
            expect(result.pairs[1]).toEqual({ sub: 'Thành phần B', ans: 'Chức năng B' });
        });

        it('extractMatchPairs should extract pairs from diverse key names (component / function, term / definition)', () => {
            const data = {
                items: [
                    { component: 'Presentation Model', function: 'Quản lý trạng thái và logic hiển thị' },
                    { component: 'View', function: 'Hiển thị giao diện người dùng' },
                    { component: 'Data Model', function: 'Lưu trữ và xử lý nghiệp vụ dữ liệu' },
                ],
            };
            const result = extractMatchPairs(data);
            expect(result.pairs).toHaveLength(3);
            expect(result.pairs[0].sub).toBe('Presentation Model');
            expect(result.pairs[0].ans).toBe('Quản lý trạng thái và logic hiển thị');
        });

        it('extractMatchPairs should extract pairs from parallel arrays (columnA / columnB)', () => {
            const data = {
                columnA: ['Model', 'View', 'Controller'],
                columnB: ['Dữ liệu', 'Giao diện', 'Điều hướng'],
            };
            const result = extractMatchPairs(data);
            expect(result.pairs).toHaveLength(3);
            expect(result.pairs[0]).toEqual({ sub: 'Model', ans: 'Dữ liệu' });
            expect(result.pairs[2]).toEqual({ sub: 'Controller', ans: 'Điều hướng' });
        });

        it('extractMatchPairs should extract pairs from bulleted question text when data is missing', () => {
            const text = `Ghép mỗi thành phần với chức năng phù hợp:
1. Presentation Model - Lưu trữ trạng thái UI
2. View - Hiển thị giao diện
3. Service - Gọi API xử lý dữ liệu`;
            const result = extractMatchPairs({}, text);
            expect(result.pairs).toHaveLength(3);
            expect(result.fromText).toBe(true);
            expect(result.pairs[0]).toEqual({ sub: 'Presentation Model', ans: 'Lưu trữ trạng thái UI' });
        });

        it('buildEnglishQuestionXml should export valid matching XML even when stored under data.matchingPairs', () => {
            const q: EnglishQuestionData = {
                id: 'B01-MATCH-01',
                questionOrder: 12,
                questionType: 'MATCH',
                questionText: 'Ghép mỗi thành phần với chức năng phù hợp.',
                dataJson: JSON.stringify({
                    matchingPairs: [
                        { left: 'Thành phần A', right: 'Chức năng 1' },
                        { left: 'Thành phần B', right: 'Chức năng 2' },
                        { left: 'Thành phần C', right: 'Chức năng 3' },
                    ],
                }),
                explanation: 'Mỗi thành phần đảm nhiệm một vai trò riêng biệt.',
                points: 1,
            };

            const xml = buildEnglishQuestionXml(q, 'B01');

            // Positive proof: MUST export as match question with subquestions
            expect(xml).toContain('<question type="match">');
            expect(xml).toContain('<subquestion format="html">');
            expect(xml).toContain('<text><![CDATA[<p class="cell">Thành phần A</p>]]></text>');
            expect(xml).toContain('<text>Chức năng 1</text>');
            expect(xml).toContain('<text><![CDATA[<p class="cell">Thành phần B</p>]]></text>');
            expect(xml).toContain('<text>Chức năng 2</text>');

            // Negative proof: MUST NOT fallback to essay question
            expect(xml).not.toContain('<question type="essay">');
            expect(xml).not.toContain('<responseformat>');
        });

        it('buildEnglishQuestionXml should AUTO-RECOVER questions incorrectly marked as ESSAY when matching intent and pairs exist', () => {
            // Case identical to Câu 12 / Câu 13 from user report:
            const q: EnglishQuestionData = {
                id: 'B01-ESSAY-12',
                questionOrder: 12,
                questionType: 'ESSAY', // Misclassified as ESSAY by AI
                questionText: 'Ghép mỗi câu trong presentation model với thành phần tương ứng.',
                dataJson: JSON.stringify({
                    items: [
                        { statement: 'Lưu trữ state của view', component: 'Presentation Model' },
                        { statement: 'Render các widget giao diện', component: 'View' },
                    ],
                }),
                points: 1,
            };

            const xml = buildEnglishQuestionXml(q, 'B01');

            // Positive proof: Auto-recovered to match question
            expect(xml).toContain('<question type="match">');
            expect(xml).toContain('<subquestion format="html">');
            expect(xml).toContain('Lưu trữ state của view');
            expect(xml).toContain('Presentation Model');

            // Negative proof: MUST NOT export as essay (no TinyMCE text area on Moodle!)
            expect(xml).not.toContain('<question type="essay">');
        });

        it('buildEnglishMoodleXml should strictly exclude ESSAY and open-ended SHORTANSWER questions so 100% of quiz questions are auto-graded', () => {
            const questions: EnglishQuestionData[] = [
                {
                    id: '1',
                    questionOrder: 1,
                    questionType: 'MC',
                    questionText: 'Which of the following is a voiceless bilabial plosive?',
                    dataJson: JSON.stringify({
                        options: [
                            { text: '/p/', isCorrect: true },
                            { text: '/b/', isCorrect: false },
                            { text: '/t/', isCorrect: false },
                            { text: '/d/', isCorrect: false },
                        ],
                    }),
                    points: 1,
                },
                {
                    id: '2',
                    questionOrder: 2,
                    questionType: 'ESSAY',
                    questionText: 'Viết một đoạn ngắn từ 4 đến 6 câu về một nhân viên khách sạn.',
                    dataJson: JSON.stringify({
                        responseFormat: 'essay',
                        graderInfo: { totalPoints: 5, criteria: [] },
                    }),
                    points: 5,
                },
                {
                    id: '3',
                    questionOrder: 3,
                    questionType: 'SHORTANSWER',
                    questionText: 'Tự đặt một câu tiếng Anh dùng quá khứ tiếp diễn với when.',
                    dataJson: JSON.stringify({
                        acceptableAnswers: ['I was cooking when the phone rang.'],
                    }),
                    points: 1,
                },
                {
                    id: '4',
                    questionOrder: 4,
                    questionType: 'SHORTANSWER',
                    questionText: 'Viết trợ động từ thích hợp: “___ you usually travel by train?”',
                    dataJson: JSON.stringify({
                        acceptableAnswers: ['Do'],
                    }),
                    points: 1,
                },
            ];

            const xml = buildEnglishMoodleXml(questions, 'Unit 1');

            // Positive proof: MC question and blank-upgraded CLOZE question are included using shuffled dropdown MULTICHOICE_S (never free-text SHORTANSWER)
            expect(xml).toContain('<question type="multichoice">');
            expect(xml).toContain('<question type="cloze">');
            expect(xml).toContain('{1:MULTICHOICE_S:=Do~Does~Did~Are}');

            // Negative proof: Zero essay, standalone shortanswer, or embedded SHORTANSWER tokens in XML
            expect(xml).not.toContain('<question type="essay">');
            expect(xml).not.toContain('<question type="shortanswer">');
            expect(xml).not.toContain('SHORTANSWER:');
            expect(xml).not.toContain('Viết một đoạn ngắn từ 4 đến 6 câu');
            expect(xml).not.toContain('Tự đặt một câu tiếng Anh');
        });

        it('upgradeClozeToMultichoice & buildEnglishQuestionXml should guarantee 100% Moodle-valid MULTICHOICE_S tokens without leaking spelling variants as distractors', () => {
            // 1. Verb conjugation with UK/US spelling variants: US variant "is traveling" MUST NOT become a wrong distractor!
            const rawVerbCloze =
                'She usually {1:SHORTANSWER:=travels} (travel) by train, but today she {1:SHORTANSWER:=is travelling~=is traveling} (travel) by bus.';
            const upgradedVerb = upgradeClozeToMultichoice(rawVerbCloze);
            expect(validateClozeText(upgradedVerb)).toEqual([]);
            expect(upgradedVerb).toContain('{1:MULTICHOICE_S:=travels~');
            expect(upgradedVerb).toContain('{1:MULTICHOICE_S:=is travelling~');
            const secondClause = upgradedVerb.split('today she ')[1] || '';
            expect(secondClause).not.toContain('is traveling');
            expect(upgradedVerb).not.toContain('SHORTANSWER');

            // 2. Phonetics IPA symbols with slashes (/tʃ/) must not be mangled into \/tʃ\/ and must pass Moodle validator
            const ipaCloze = 'The voiceless post-alveolar affricate is {1:MULTICHOICE_S:=/tʃ/~/ʃ/~/dʒ/~/θ/}.';
            const upgradedIpa = upgradeClozeToMultichoice(ipaCloze);
            expect(validateClozeText(upgradedIpa)).toEqual([]);
            expect(upgradedIpa).toContain('=/tʃ/~/ʃ/~/dʒ/~/θ/');

            // 3. Numeric blanks (e.g. NumPy / technical lessons) upgrade cleanly to 4-option MULTICHOICE_S
            const numCloze = 'For a float32 array with shape (2, 3, 4), ndim is {1:SHORTANSWER:=3} and nbytes is {1:SHORTANSWER:=96}.';
            const upgradedNum = upgradeClozeToMultichoice(numCloze);
            expect(validateClozeText(upgradedNum)).toEqual([]);
            expect(upgradedNum).toContain('{1:MULTICHOICE_S:=3~');
            expect(upgradedNum).toContain('{1:MULTICHOICE_S:=96~');

            // 4. Interactive slide FIB & CLOZE normalization guarantees 4 options and distractors
            const normalizedInteractive = normalizeInteractiveQuestions([
                {
                    id: 'q1',
                    type: 'FIB',
                    question: 'Yesterday, I _____ (go) to the library.',
                    correctAnswer: 'went',
                },
                {
                    id: 'q2',
                    type: 'CLOZE',
                    question: 'Chọn từ thích hợp:',
                    passage: 'A: Hello, how are [you]?\nB: I am [fine], thanks.',
                },
            ]);
            expect(normalizedInteractive[0].options).toHaveLength(4);
            expect(normalizedInteractive[0].options).toContain('went');
            expect(normalizedInteractive[1].distractors.length).toBeGreaterThanOrEqual(3);
        });

        it('buildSingleCategoryExamMoodleXml should place all exam questions into a single Moodle category', () => {
            expect(toMoodleCategorySlug('Giữa Kỳ - Bài 1 đến Bài 6')).toBe('Giua_Ky_Bai_1_den_Bai_6');

            const reviewQs = [
                {
                    questionId: 'GK-01',
                    level: 1,
                    question: 'Câu hỏi bài 1?',
                    correctAnswer: 'Đáp án đúng 1',
                    optionB: 'Sai B',
                    optionC: 'Sai C',
                    optionD: 'Sai D',
                },
                {
                    questionId: 'GK-02',
                    level: 3,
                    question: 'Câu hỏi bài 6?',
                    correctAnswer: 'Đáp án đúng 6',
                    optionB: 'Sai B',
                    optionC: 'Sai C',
                    optionD: 'Sai D',
                },
            ];
            const xmlReview = buildSingleCategoryExamMoodleXml(reviewQs, 'Giua_Ky_Bai_1_6', 'REVIEW');
            const catMatches = xmlReview.match(/<question type="category">/g) || [];
            expect(catMatches.length).toBe(1);
            expect(xmlReview).toContain('<text>$course$/top/Giua_Ky_Bai_1_6</text>');
            expect(xmlReview).toContain('Câu hỏi bài 1?');
            expect(xmlReview).toContain('Câu hỏi bài 6?');

            const engQs = [
                {
                    id: '1',
                    questionOrder: 1,
                    questionType: 'TRUEFALSE',
                    title: 'GK-TF-01',
                    questionText: 'Present simple is used for timetables.',
                    dataJson: JSON.stringify({ correctAnswer: true }),
                },
                {
                    id: '2',
                    questionOrder: 2,
                    questionType: 'ESSAY',
                    title: 'GK-ESSAY-02',
                    questionText: 'Write an essay.',
                    dataJson: JSON.stringify({}),
                },
            ];
            const xmlEng = buildSingleCategoryExamMoodleXml(engQs, 'Giua_Ky_Bai_1_6', 'ENGLISH');
            const engCatMatches = xmlEng.match(/<question type="category">/g) || [];
            expect(engCatMatches.length).toBe(1);
            expect(xmlEng).toContain('<text>$course$/top/Giua_Ky_Bai_1_6</text>');
            expect(xmlEng).toContain('<question type="truefalse">');
            expect(xmlEng).not.toContain('<question type="essay">');
        });
    });
});

