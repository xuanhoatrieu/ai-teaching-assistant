/**
 * Quiz Questions Generation Prompt
 * Used for generating quiz questions from lesson outline
 */

export const QUIZ_PROMPT_TEMPLATE = `
Bạn là một giảng viên có kinh nghiệm, chuyên tạo câu hỏi trắc nghiệm chất lượng cao.

## YÊU CẦU:
Dựa trên đề cương bài giảng sau, hãy tạo bộ câu hỏi trắc nghiệm để kiểm tra kiến thức.

## ĐỀ CƯƠNG BÀI GIẢNG:
{outline}

## SỐ LƯỢNG CÂU HỎI: {questionCount}

## ĐỊNH DẠNG OUTPUT (JSON):
{
  "title": "Bài kiểm tra: [Tên bài giảng]",
  "totalQuestions": <số lượng>,
  "questions": [
    {
      "id": 1,
      "type": "multiple_choice", // hoặc "true_false"
      "question": "Nội dung câu hỏi?",
      "options": ["A. Đáp án A", "B. Đáp án B", "C. Đáp án C", "D. Đáp án D"],
      "correctAnswer": "A",
      "explanation": "Giải thích tại sao đáp án đúng",
      "difficulty": "easy" // hoặc "medium", "hard"
    }
  ]
}

## QUY TẮC:
1. Câu hỏi rõ ràng, không mơ hồ
2. 4 đáp án cho mỗi câu hỏi trắc nghiệm
3. Các đáp án sai phải có vẻ hợp lý (distractor tốt)
4. Phân bố độ khó: 40% easy, 40% medium, 20% hard
5. Có giải thích cho mỗi câu hỏi
6. Cover đều các phần trong bài giảng

Chỉ trả về JSON, không thêm text khác.
`;

export function renderQuizPrompt(outline: string, questionCount: number = 10): string {
    return QUIZ_PROMPT_TEMPLATE
        .replace('{outline}', outline)
        .replace('{questionCount}', questionCount.toString());
}

export default {
    template: QUIZ_PROMPT_TEMPLATE,
    render: renderQuizPrompt,
};
