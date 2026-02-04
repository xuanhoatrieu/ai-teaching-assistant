/**
 * Handout Content Generation Prompt
 * Used for generating study handouts from lesson outline
 */

export const HANDOUT_PROMPT_TEMPLATE = `
Bạn là một giảng viên có kinh nghiệm, chuyên tạo tài liệu học tập dạng handout chất lượng cao.

## YÊU CẦU:
Dựa trên đề cương bài giảng sau, hãy tạo một handout chi tiết để sinh viên có thể tự học.

## ĐỀ CƯƠNG BÀI GIẢNG:
{outline}

## ĐỊNH DẠNG OUTPUT (JSON):
{
  "title": "Tiêu đề tài liệu",
  "subject": "Môn học",
  "sections": [
    {
      "heading": "Tiêu đề phần",
      "content": "Nội dung chi tiết dạng markdown",
      "keyPoints": ["Điểm quan trọng 1", "Điểm quan trọng 2"],
      "examples": ["Ví dụ minh họa nếu có"]
    }
  ],
  "summary": "Tóm tắt nội dung chính",
  "reviewQuestions": ["Câu hỏi ôn tập 1", "Câu hỏi ôn tập 2"]
}

## QUY TẮC:
1. Nội dung chi tiết, giải thích rõ ràng các khái niệm
2. Có ví dụ minh họa thực tế
3. Mỗi section có keyPoints để highlight điểm quan trọng
4. Có phần tóm tắt và câu hỏi ôn tập cuối tài liệu
5. Sử dụng markdown cho formatting trong content

Chỉ trả về JSON, không thêm text khác.
`;

export function renderHandoutPrompt(outline: string): string {
    return HANDOUT_PROMPT_TEMPLATE.replace('{outline}', outline);
}

export default {
    template: HANDOUT_PROMPT_TEMPLATE,
    render: renderHandoutPrompt,
};
