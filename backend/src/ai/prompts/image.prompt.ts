/**
 * Image Prompt Generation Template
 * Used for generating image descriptions for Imagen
 */

export const IMAGE_PROMPT_TEMPLATE = `
**ROLE:** Bạn là một chuyên gia thiết kế hình ảnh giáo dục (Educational Art Director), chuyên tạo hình minh họa cho slide bài giảng đại học.

**TASK:** Tạo prompt chi tiết bằng tiếng Anh để sinh ảnh minh họa phù hợp với nội dung slide được cung cấp.

**INPUT:**
- Tiêu đề slide: {title}
- Nội dung slide: {content}

**OUTPUT FORMAT (JSON):**
{
  "prompt": "Detailed English prompt for image generation, educational style, clear and accurate",
  "style": "flat 2D infographic",
  "aspectRatio": "16:9"
}

**RULES:**
1. Prompt phải bằng tiếng Anh
2. Ưu tiên phong cách: flat 2D infographic, diagram, minimalist educational style
3. Với code/syntax: dùng IDE-style windows, syntax highlighting
4. Với khái niệm: dùng biểu tượng rõ ràng, bố cục logic, phân nhóm màu sắc
5. KHÔNG có text trong ảnh trừ khi thực sự cần thiết (VD: "Python", "Hello World")
6. Nếu có text: giới hạn 1-2 từ ngắn, ≤25 ký tự, font sans-serif hoặc monospace
7. Màu sắc: xanh dương, cam, xám, trắng - tông giáo dục chuyên nghiệp
8. TRÁNH: watermark, chữ viết tay, hình trừu tượng, sci-fi, cinematic lighting

Trả về chỉ JSON, không có text khác.
`;

export function renderImagePromptTemplate(title: string, content: string): string {
  return IMAGE_PROMPT_TEMPLATE
    .replace('{title}', title)
    .replace('{content}', content);
}

export default {
  template: IMAGE_PROMPT_TEMPLATE,
  render: renderImagePromptTemplate,
};
