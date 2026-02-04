/**
 * Instruction 4: Create Question Bank
 * Source: prompt_gemini.md
 */

export const INSTRUCTION_4_QUESTIONS = `
**ROLE:** Bạn là một chuyên gia giáo dục và biên soạn câu hỏi trắc nghiệm giàu kinh nghiệm.

**TASK:** Tạo bộ câu hỏi trắc nghiệm chất lượng cao dựa trên nội dung bài học.

**INPUT:**
- Tiêu đề bài học: {title}
- Nội dung chi tiết:
{detailed_outline}

**SỐ LƯỢNG CÂU HỎI:**
- Mức độ **Biết** (Độ khó 1): {level1_count} câu
- Mức độ **Hiểu** (Độ khó 2): {level2_count} câu
- Mức độ **Vận dụng** (Độ khó 3): {level3_count} câu

**YÊU CẦU:**

1. **Câu hỏi Mức độ BIẾT (Độ khó 1):**
   - Kiểm tra trí nhớ về khái niệm, định nghĩa, thuật ngữ
   - Từ khóa: ai, cái gì, ở đâu, khi nào, định nghĩa, liệt kê, nhận biết

2. **Câu hỏi Mức độ HIỂU (Độ khó 2):**
   - Kiểm tra khả năng giải thích, so sánh, phân biệt
   - Từ khóa: so sánh, giải thích, vì sao, tóm tắt, phân biệt

3. **Câu hỏi Mức độ VẬN DỤNG (Độ khó 3):**
   - Kiểm tra khả năng áp dụng vào tình huống mới
   - Từ khóa: áp dụng, sử dụng, giải quyết, dự đoán

**QUY TẮC:**
- Mỗi câu hỏi chỉ có MỘT đáp án đúng
- Các phương án sai phải có tính hợp lý, thuyết phục
- Tránh từ phủ định (KHÔNG, NGOẠI TRỪ)
- Các phương án có độ dài tương tự nhau

**FORMAT ĐẦU RA (Bảng Markdown):**

| Question ID | Question | Correct Answer (A) | Option B | Option C | Option D | Explanation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |

**QUY TẮC Question ID:**
- Format: [Bài]-[Độ khó]-[Số thứ tự]
- Ví dụ: B1-1-01, B1-1-02 (Bài 1, độ khó 1, câu 1, 2)
- Ví dụ: B1-2-01 (Bài 1, độ khó 2, câu 1)
- Ví dụ: B1-3-01 (Bài 1, độ khó 3, câu 1)

**Đáp án đúng LUÔN đặt ở cột "Correct Answer (A)".**
`;
