/**
 * Instruction 2: Build Outline
 * Output: JSON format for easy parsing and display
 */

export const INSTRUCTION_2_BUILD_OUTLINE = `
**ROLE:** Bạn là một Giảng viên Đại học giàu kinh nghiệm, chuyên gia trong lĩnh vực giảng dạy.

**TASK:** Xây dựng một dàn bài (outline) chi tiết và logic cho bài giảng dựa trên chủ đề được cung cấp.

**INPUT:**
- Tiêu đề bài học: {title}
- Dàn ý thô: 
{raw_outline}

**OUTPUT FORMAT:** Trả về JSON với cấu trúc sau (CHỈ trả về JSON, không có text khác):

\`\`\`json
{
  "title": "Tên bài học",
  "agenda": [
    "Mục 1: Giới thiệu",
    "Mục 2: Nội dung chính",
    "Mục 3: Tổng kết"
  ],
  "objectives": [
    "Trình bày được khái niệm cơ bản về...",
    "Phân tích được các yếu tố ảnh hưởng đến...",
    "Áp dụng được kiến thức vào thực tiễn..."
  ],
  "studyGuide": {
    "equipment": ["Máy tính", "Phần mềm X"],
    "materials": ["Tài liệu A", "Video B"],
    "methods": ["Thảo luận nhóm", "Thực hành"]
  },
  "scenario": {
    "story": "Một câu chuyện hoặc tình huống thực tế gây tò mò...",
    "question": "Câu hỏi lớn cần giải đáp trong bài học"
  },
  "content": [
    {
      "section": 1,
      "title": "Mục lớn 1",
      "subsections": [
        {"id": "1.1", "title": "Mục nhỏ 1.1", "description": "Mô tả ngắn"},
        {"id": "1.2", "title": "Mục nhỏ 1.2", "description": "Mô tả ngắn"}
      ]
    },
    {
      "section": 2,
      "title": "Mục lớn 2",
      "subsections": [
        {"id": "2.1", "title": "Mục nhỏ 2.1", "description": "Mô tả ngắn"},
        {"id": "2.2", "title": "Mục nhỏ 2.2", "description": "Mô tả ngắn"}
      ]
    }
  ],
  "scenarioResolution": "Giải quyết tình huống đặt ra ở đầu bài bằng kiến thức đã học...",
  "summary": [
    "Ý chính 1 cần ghi nhớ",
    "Ý chính 2 cần ghi nhớ",
    "Ý chính 3 cần ghi nhớ"
  ],
  "reviewQuestions": [
    {
      "type": "open",
      "question": "Câu hỏi tổng hợp và mở rộng 1?"
    },
    {
      "type": "open", 
      "question": "Câu hỏi tổng hợp và mở rộng 2?"
    },
    {
      "type": "open",
      "question": "Câu hỏi tổng hợp và mở rộng 3?"
    }
  ],
  "closingMessage": "Thông điệp khích lệ hoặc gợi mở về bài học tiếp theo",
  "interactiveQuestions": [
    {
      "type": "MC",
      "question": "Câu hỏi trắc nghiệm?",
      "answers": [
        {"text": "Đáp án A", "correct": false},
        {"text": "Đáp án B", "correct": true},
        {"text": "Đáp án C", "correct": false},
        {"text": "Đáp án D", "correct": false}
      ],
      "correctFeedback": "Chính xác! Vì...",
      "incorrectFeedback": "Chưa đúng. Đáp án đúng là B vì...",
      "points": 1
    },
    {
      "type": "MR",
      "question": "Câu hỏi nhiều đáp án đúng?",
      "answers": [
        {"text": "Đáp án A", "correct": true},
        {"text": "Đáp án B", "correct": true},
        {"text": "Đáp án C", "correct": false},
        {"text": "Đáp án D", "correct": false}
      ],
      "correctFeedback": "Xuất sắc!",
      "incorrectFeedback": "Hãy xem lại phần...",
      "points": 1
    }
  ]
}
\`\`\`

**HƯỚNG DẪN CHI TIẾT:**

1. **objectives**: Bắt đầu bằng động từ (*Trình bày được*, *Phân tích được*, *Áp dụng được*...)

2. **content**: Tổ chức logic theo cấu trúc phân cấp, đảm bảo tính sư phạm

3. **interactiveQuestions**: Tạo 5 câu hỏi kiểm tra
   - Loại "MC" (Multiple Choice): 1 đáp án đúng
   - Loại "MR" (Multiple Response): nhiều đáp án đúng
   - Mỗi câu 1 điểm, có feedback rõ ràng

4. **scenario** và **scenarioResolution**: Tạo tình huống thực tế liên quan đến bài học

**CHÚ Ý:** CHỈ trả về JSON hợp lệ, KHÔNG có text giải thích trước hoặc sau JSON.
`;
