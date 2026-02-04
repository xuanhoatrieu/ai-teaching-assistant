/**
 * Slide Content Generation Prompt
 * Used for generating PPTX slide scripts from lesson outline
 */

export const SLIDE_PROMPT_TEMPLATE = `
Bạn là một giảng viên có kinh nghiệm, chuyên tạo nội dung bài giảng PowerPoint chất lượng cao.

## YÊU CẦU:
Dựa trên đề cương bài giảng sau, hãy tạo nội dung chi tiết cho từng slide PowerPoint.

## ĐỀ CƯƠNG BÀI GIẢNG:
{outline}

## ĐỊNH DẠNG OUTPUT (JSON):
{
  "title": "Tiêu đề bài giảng",
  "totalSlides": <số lượng slide>,
  "slides": [
    {
      "slideNumber": 1,
      "type": "title",
      "title": "Tiêu đề slide",
      "content": ["Điểm 1", "Điểm 2", "Điểm 3"],
      "speakerNotes": "Ghi chú cho người trình bày",
      "imagePrompt": "Mô tả hình ảnh minh họa nếu cần"
    }
  ]
}

## QUY TẮC:
1. Mỗi slide tối đa 5-6 điểm nội dung
2. Nội dung súc tích, dễ hiểu
3. Có slide mở đầu và slide tổng kết
4. Thêm imagePrompt cho các slide cần minh họa
5. Speaker notes chi tiết để người trình bày có thể đọc

Chỉ trả về JSON, không thêm text khác.
`;

/**
 * Extract variables needed for the slide prompt
 */
export function getSlidePromptVariables(): string[] {
  return ['outline'];
}

/**
 * Render the slide prompt with actual values
 */
export function renderSlidePrompt(outline: string): string {
  return SLIDE_PROMPT_TEMPLATE.replace('{outline}', outline);
}

export default {
  template: SLIDE_PROMPT_TEMPLATE,
  getVariables: getSlidePromptVariables,
  render: renderSlidePrompt,
};
