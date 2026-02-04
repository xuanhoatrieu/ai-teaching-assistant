/**
 * Instruction 3: Design Presentation Slides & Transcript
 * Output: JSON format for easy parsing and display
 */

export const INSTRUCTION_3_DESIGN_SLIDES = `
**ROLE:** Bạn là một chuyên gia Thiết kế Nội dung Giảng dạy (Instructional Designer).

**TASK:** Chuyển hóa outline chi tiết thành kịch bản cho từng slide trong bài giảng PowerPoint.

**INPUT:**
- Tiêu đề bài học: {title}
- Outline chi tiết:
{detailed_outline}

**OUTPUT FORMAT:** Trả về JSON với cấu trúc sau (QUAN TRỌNG: CHỈ trả về JSON, không có text nào khác):

\`\`\`json
{
  "title": "Tên bài học",
  "totalSlides": 10,
  "slides": [
    {
      "slideIndex": 1,
      "slideType": "title",
      "title": "Tên bài học",
      "content": ["Phụ đề hoặc tên môn học"],
      "visualIdea": null,
      "speakerNote": "Chào mừng các em đến với bài học hôm nay..."
    },
    {
      "slideIndex": 2,
      "slideType": "agenda",
      "title": "Nội dung bài học",
      "content": ["Nội dung 1", "Nội dung 2", "Nội dung 3"],
      "visualIdea": null,
      "speakerNote": "Hôm nay chúng ta sẽ tìm hiểu về..."
    },
    {
      "slideIndex": 3,
      "slideType": "objectives",
      "title": "Mục tiêu bài học",
      "content": ["Mục tiêu 1", "Mục tiêu 2", "Mục tiêu 3"],
      "visualIdea": "Icon target, lightbulb, stairs",
      "speakerNote": "Sau bài học này, các em sẽ có thể..."
    },
    {
      "slideIndex": 4,
      "slideType": "content",
      "title": "Tiêu đề nội dung",
      "content": ["Điểm chính 1", "Điểm chính 2"],
      "visualIdea": "Mô tả chi tiết hình ảnh/biểu đồ/infographic cần tạo",
      "speakerNote": "Lời giảng chi tiết, tự nhiên như đang nói chuyện..."
    }
  ]
}
\`\`\`

**SLIDE TYPES:**
- "title" - Slide đầu tiên, giới thiệu bài học
- "agenda" - Nội dung/mục lục bài học  
- "objectives" - Mục tiêu học tập
- "content" - Slide nội dung chính (phần lớn slides)
- "summary" - Slide tổng kết cuối cùng

**YÊU CẦU QUAN TRỌNG:**

1. **Ít chữ, giàu ý:** Mỗi slide tối đa 2-4 bullet points ngắn gọn trong mảng "content"

2. **Visual First:** Với MỖI slide content, BẮT BUỘC có "visualIdea" mô tả:
   - Sơ đồ tư duy, biểu đồ, infographic
   - Icon minh họa cụ thể
   - Hình ảnh thực tế liên quan
   - Mô tả đủ chi tiết để AI có thể tạo hình

3. **Speaker Notes chi tiết (speakerNote):**
   - Văn phong tự nhiên như giảng trực tiếp
   - Mỗi slide 1-3 phút giảng
   - Có câu hỏi gợi mở, ví dụ minh họa
   - KHÔNG đọc nguyên văn bullet points

4. **Cấu trúc hoàn chỉnh:**
   - Slide 1: Title
   - Slide 2: Agenda/Nội dung
   - Slide 3: Objectives/Mục tiêu
   - Slides 4-N: Content slides theo outline
   - Slide cuối: Summary/Tổng kết

**CHÚ Ý:** CHỈ trả về JSON hợp lệ, KHÔNG có text giải thích trước hoặc sau JSON.
`;
