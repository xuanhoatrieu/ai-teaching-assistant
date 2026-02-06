import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePromptDto } from './dto/create-prompt.dto';
import { UpdatePromptDto } from './dto/update-prompt.dto';

@Injectable()
export class PromptsService {
  constructor(private prisma: PrismaService) { }

  // ==================== ADMIN CRUD ====================

  async findAll() {
    return this.prisma.prompt.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const prompt = await this.prisma.prompt.findUnique({
      where: { id },
    });

    if (!prompt) {
      throw new NotFoundException(`Prompt with ID ${id} not found`);
    }

    return prompt;
  }

  async create(dto: CreatePromptDto) {
    // Check slug uniqueness
    const existing = await this.prisma.prompt.findUnique({
      where: { slug: dto.slug },
    });

    if (existing) {
      throw new ConflictException(`Prompt with slug "${dto.slug}" already exists`);
    }

    // Auto-parse variables if not provided
    const variables = dto.variables || this.parseVariables(dto.content);

    return this.prisma.prompt.create({
      data: {
        slug: dto.slug,
        name: dto.name,
        content: dto.content,
        variables,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdatePromptDto) {
    await this.findOne(id); // Ensure exists

    // If content changes, re-parse variables
    const updateData: any = { ...dto };
    if (dto.content && !dto.variables) {
      updateData.variables = this.parseVariables(dto.content);
    }

    // Increment version if content changes
    if (dto.content) {
      updateData.version = { increment: 1 };
    }

    return this.prisma.prompt.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.prompt.delete({
      where: { id },
    });
  }

  // ==================== USER ENDPOINTS ====================

  async findActiveBySlug(slug: string) {
    const prompt = await this.prisma.prompt.findFirst({
      where: { slug, isActive: true },
    });

    if (!prompt) {
      throw new NotFoundException(`Active prompt with slug "${slug}" not found`);
    }

    return prompt;
  }

  // ==================== UTILITIES ====================

  /**
   * Parse variables from prompt content
   * Extracts patterns like {variable_name}
   */
  parseVariables(content: string): string[] {
    const regex = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
    const matches = content.matchAll(regex);
    const variables = new Set<string>();

    for (const match of matches) {
      variables.add(match[0]); // Include braces: {variable}
    }

    return Array.from(variables);
  }

  /**
   * Render prompt with variable substitution
   * @param slug - Prompt slug
   * @param variables - Object with variable values
   */
  async renderPrompt(
    slug: string,
    variables: Record<string, string>,
  ): Promise<string> {
    const prompt = await this.findActiveBySlug(slug);
    let content = prompt.content;

    // Replace all variables
    for (const [key, value] of Object.entries(variables)) {
      const pattern = new RegExp(`\\{${key}\\}`, 'g');
      content = content.replace(pattern, value);
    }

    return content;
  }

  /**
   * Seed v2 prompts with JSON output format
   * Call via POST /admin/prompts/seed
   */
  async seedV2() {
    const prompts = [
      {
        slug: 'system.role',
        name: 'System Role Template',
        content: `**ROLE:** Bạn là một Giảng viên {institution_type} giàu kinh nghiệm, chuyên gia trong lĩnh vực {expertise_area}.

Nhiệm vụ của bạn là soạn thảo giáo án và bài giảng chi tiết, hấp dẫn và dễ hiểu cho môn học {course_name}.

Đối tượng là {target_audience} ngành {major_name}.

{additional_context}`,
        variables: ['{institution_type}', '{expertise_area}', '{course_name}', '{target_audience}', '{major_name}', '{additional_context}'],
      },
      {
        slug: 'outline.detailed',
        name: 'Build Detailed Outline',
        content: `**Build Outline**

**Mục tiêu:** Xây dựng một dàn bài (outline) chi tiết và logic cho một bài giảng dựa trên chủ đề được cung cấp.

**Input:**
- Tiêu đề: {title}
- Dàn ý thô:
{raw_outline}

**RÀNG BUỘC:** KHÔNG thêm/bớt nội dung. Chỉ mở rộng và cấu trúc hóa các mục có trong input.

**Định dạng đầu ra (JSON):**
{
  "title": "Tên bài học",
  "agenda": ["Mục 1", "Mục 2", "Mục 3"],
  "objectives": [
    "Trình bày được...",
    "Phân tích được...",
    "Áp dụng được..."
  ],
  "learningGuide": "Thiết bị, học liệu và phương pháp học tập (nếu có)",
  "situation": "Một câu chuyện ngắn, câu hỏi lớn, hoặc ví dụ thực tế gây tò mò (nếu có)",
  "sections": [
    {
      "id": "1",
      "title": "Mục lớn 1",
      "subsections": [
        {"id": "1.1", "title": "Mục nhỏ 1.1", "content": "Nội dung chi tiết"},
        {"id": "1.2", "title": "Mục nhỏ 1.2", "content": "Nội dung chi tiết"}
      ]
    },
    {
      "id": "2",
      "title": "Mục lớn 2",
      "subsections": [
        {"id": "2.1", "title": "Mục nhỏ 2.1", "content": "Nội dung chi tiết"},
        {"id": "2.2", "title": "Mục nhỏ 2.2", "content": "Nội dung chi tiết"}
      ]
    }
  ],
  "situationSolution": "Sử dụng kiến thức vừa học để phân tích và đưa ra lời giải cho vấn đề đã nêu ở đầu bài (nếu có)",
  "summary": ["Ý chính 1", "Ý chính 2", "Ý chính 3"],
  "reviewQuestions": [
    "Câu hỏi tổng hợp và mở rộng 1 (khuyến khích tư duy phản biện)",
    "Câu hỏi tổng hợp và mở rộng 2 (liên hệ thực tế)",
    "Câu hỏi tổng hợp và mở rộng 3 (tìm hiểu sâu hơn)"
  ],
  "closingMessage": "Một thông điệp ngắn gọn, khích lệ hoặc gợi mở về bài học tiếp theo"
}

Chỉ trả về JSON.`,
        variables: ['{title}', '{raw_outline}'],
      },
      {
        slug: 'slides.script',
        name: 'Design Slides Script',
        content: `**Design Presentation Slides & Transcript**

**Mục tiêu:** Chuyển hóa một outline đã có thành kịch bản chi tiết cho từng slide trong bài giảng PowerPoint (.pptx). Đồng thời, soạn sẵn lời giảng (transcript) tự nhiên cho từng slide.

**Input:**
- Tiêu đề: {title}
- Outline chi tiết:
{detailed_outline}

---

## RÀNG BUỘC SỐ LƯỢNG SLIDE:
- **Tổng số slide:** 20-30 slides (tùy độ phức tạp nội dung)
- Cấu trúc gợi ý:
  - 1 slide Title
  - 1 slide Agenda
  - 1 slide Objectives
  - 15-18 slides Content (nội dung chính)
  - 1 slide Questions (câu hỏi thảo luận)
  - 1 slide Summary

---

## YÊU CẦU CHO MỖI SLIDE:

### 1. Ít chữ, giàu ý:
- Slide chỉ chứa **Tiêu đề** và **tối đa 2-3 ý chính** dưới dạng gạch đầu dòng ngắn gọn.
- **Ngoại lệ:** Slide về **khái niệm/định nghĩa** có thể hiển thị đầy đủ nội dung.

### 2. Tối đa hóa hình ảnh (Visual First):
- Với mỗi slide content, đề xuất một loại hình ảnh trực quan cụ thể.
- **Danh sách Visual Ideas gợi ý:**
  - 📊 **Diagram/Sơ đồ:** Flowchart, Process diagram, Cycle diagram
  - 🧠 **Mind map:** Sơ đồ tư duy thể hiện mối quan hệ
  - 📈 **Chart/Graph:** Bar chart, Line graph, Pie chart
  - 📋 **Comparison table:** Bảng so sánh 2-3 yếu tố
  - 🔄 **Timeline:** Dòng thời gian, các giai đoạn
  - 🎯 **Infographic:** Tóm tắt visual với icons và số liệu
  - 🖼️ **Illustration:** Hình minh họa khái niệm trừu tượng
  - 📐 **Formula/Equation:** Công thức toán học, hóa học
  - 🏗️ **Architecture:** Kiến trúc hệ thống, cấu trúc
  - 🔬 **Scientific figure:** Hình khoa học, thí nghiệm
- **Ghi chú:** Nếu slide không cần hình (title, agenda), để visualIdea = null

---

## 🎤 QUY TẮC VIẾT SPEAKERNOTE (QUAN TRỌNG):

### Cấu trúc: Hook → Explain → Bridge
Mỗi speakerNote phải theo công thức:
1. **Hook (mở đầu):** Thu hút sự chú ý - câu hỏi tu từ, ví dụ thực tế, hoặc kết nối slide trước
2. **Explain (giảng):** Diễn giải nội dung slide - KHÔNG đọc lại bullet points
3. **Bridge (chuyển tiếp):** Câu dẫn sang slide tiếp theo hoặc tóm lại ý chính
**Đặc biệt chú ý không được viết các từ Hook (mở đầu), Explain (giảng), Bridge (chuyển tiếp) và dấu * vào nội dung speakerNote**

### Ngôn ngữ NÓI tự nhiên:
- **Từ nối:** "Nào", "À", "Nha", "Đúng không", "Thế thì"
- **Câu hỏi tu từ:** "Vậy tại sao...?", "Thế làm sao...?", "Các em có bao giờ tự hỏi...?"
- **Ngắt tự nhiên:** Dùng "...", "–" để tạo nhịp
- **Xưng hô:** "các em" (đối với sinh viên đại học)

### Transition Words (Từ chuyển tiếp):
- Mở đầu: "Nào, bây giờ...", "Tiếp theo...", "Quay lại với...", "Về phần này..."
- Giải thích: "Nói đơn giản thì...", "Cụ thể là...", "Tức là...", "Để mình giải thích..."
- Nhấn mạnh: "Điểm quan trọng là...", "Các em chú ý nha...", "Đây là phần hay..."
- Ví dụ: "Lấy ví dụ nhé...", "Giống như khi...", "Tưởng tượng rằng..."
- Tổng kết: "Vậy tóm lại...", "Rút ra được là...", "Kết luận là..."

### Độ dài theo loại slide:
- Slide title/agenda: 30-50 từ (20-35 giây)
- Slide objectives: 50-70 từ (35-50 giây)
- Slide content: 100-180 từ (1-2 phút)
- Slide summary: 60-90 từ (40-60 giây)

### TRÁNH:
- ❌ Đọc nguyên văn bullet points
- ❌ Giọng văn như sách giáo khoa
- ❌ Câu văn quá dài, quá học thuật
- ❌ Bắt đầu mọi câu giống nhau
- ❌ Dùng các từ như cốt lõi, 

---

## VÍ DỤ SPEAKERNOTE:

❌ **SAI (Văn viết):**
"Deep Learning là một phương pháp học sâu trong trí tuệ nhân tạo. Nó có 3 đặc tính quan trọng: khả năng xấp xỉ, tối ưu hóa, và khái quát hóa."

✅ **ĐÚNG (Văn nói tự nhiên):**
"Nào, bây giờ đến phần thú vị nhé – Deep Learning. Các em có bao giờ tự hỏi tại sao nó lại hoạt động tốt đến vậy không? Thực ra về mặt lý thuyết, chúng ta vẫn chưa hiểu hoàn toàn đâu. Nhưng có 3 góc nhìn để giải thích: khả năng xấp xỉ, tối ưu, và khái quát hóa. Mình sẽ đi qua từng cái một nhé..."

---

## Định dạng đầu ra (JSON):
**LƯU Ý QUAN TRỌNG: slideIndex BẮT ĐẦU TỪ 1, KHÔNG phải 0**

{
  "title": "Tên bài học",
  "slides": [
    {
      "slideIndex": 1,
      "slideType": "title",
      "title": "Tiêu đề bài học",
      "subtitle": "Tên môn học",
      "content": [],
      "visualIdea": null,
      "speakerNote": "Xin chào các em! Hôm nay chúng ta sẽ cùng tìm hiểu về..."
    },
    {
      "slideIndex": 2,
      "slideType": "agenda",
      "title": "Nội dung bài học",
      "content": ["Nội dung 1", "Nội dung 2", "Nội dung 3"],
      "visualIdea": "Infographic với roadmap tương ứng với số lượng nội dung",
      "speakerNote": "Bài học hôm nay gồm các phần chính. Đầu tiên là... Sau đó mình sẽ tìm hiểu về..."
    },
    {
      "slideIndex": 3,
      "slideType": "objectives",
      "title": "Mục tiêu bài học",
      "content": ["Mục tiêu 1", "Mục tiêu 2"],
      "visualIdea": "Infographic với icons checklist và mũi tên tiến lên",
      "speakerNote": "Sau bài học này, các em sẽ có thể làm được gì? Thứ nhất là... Đây là phần khó hơn một chút, nhưng mình sẽ giải thích kỹ hơn ở slide sau."
    },
    {
      "slideIndex": 4,
      "slideType": "content",
      "title": "Tiêu đề mục",
      "content": ["Ý chính 1", "Ý chính 2"],
      "visualIdea": "Sơ đồ tư duy (mind map) thể hiện mối quan hệ giữa các khái niệm",
      "speakerNote": "Nào, giờ mình đến phần quan trọng nhé. Các em nhìn trên slide thấy có 2 ý chính..."
    },
    {
      "slideIndex": 19,
      "slideType": "questions",
      "title": "Câu hỏi thảo luận",
      "content": ["Câu hỏi 1", "Câu hỏi 2"],
      "visualIdea": null,
      "speakerNote": "Trước khi kết thúc bài học, các em hãy trả lời các câu hỏi sau đây..."
    },
    {
      "slideIndex": 20,
      "slideType": "summary",
      "title": "Tổng kết",
      "content": ["Tóm tắt 1", "Tóm tắt 2"],
      "visualIdea": null,
      "speakerNote": "Bài học của chúng ta đến đây là kết thúc. Tóm lại, hôm nay các em đã nắm được các nội dung chính..."
    }
  ]
}

Chỉ trả về JSON.`,
        variables: ['{title}', '{detailed_outline}'],
      },
      {
        slug: 'questions.interactive',
        name: 'Interactive Questions',
        content: `**Interactive Questions - Kiểm tra sự tập trung**

**Mục tiêu:** Tạo 5 câu hỏi tương tác được thiết kế chiến lược để kiểm tra sự tập trung của sinh viên trong suốt quá trình học.

**Input:**
- Tiêu đề: {title}
- Kịch bản bài giảng:
{slide_script}

**YÊU CẦU CỐT LÕI:**
- Đáp án phải rải rác trong TOÀN BỘ nội dung bài giảng
- Không thể tìm thấy đáp án chỉ ở một slide duy nhất
- Sinh viên phải theo dõi từ đầu đến cuối để trả lời đúng
- Ví dụ: Một câu hỏi liên quan đến ví dụ ở giữa bài, câu khác hỏi về chi tiết trong phần giải quyết tình huống

**LOẠI CÂU HỎI:**
- MC (Multiple Choice): Chọn 1 đáp án đúng
- MR (Multiple Response): Chọn nhiều đáp án đúng

**QUY TẮC:**
- Đáp án đúng bắt đầu bằng dấu \`*\`
- Mỗi câu hỏi: 1 điểm
- Feedback rõ ràng, ngắn gọn
- Nếu không có Image/Video/Audio thì để trống

**Định dạng đầu ra (JSON):**
{
  "questions": [
    {
      "questionOrder": 1,
      "questionType": "MC",
      "questionText": "Câu hỏi 1?",
      "image": "",
      "video": "",
      "audio": "",
      "answers": [
        {"text": "*Đáp án đúng", "isCorrect": true},
        {"text": "Đáp án sai 1", "isCorrect": false},
        {"text": "Đáp án sai 2", "isCorrect": false},
        {"text": "Đáp án sai 3", "isCorrect": false}
      ],
      "correctFeedback": "Chính xác! Giải thích ngắn gọn...",
      "incorrectFeedback": "Chưa đúng. Hãy xem lại phần...",
      "points": 1
    },
    {
      "questionOrder": 2,
      "questionType": "MR",
      "questionText": "Câu hỏi 2 (chọn nhiều)?",
      "image": "",
      "video": "",
      "audio": "",
      "answers": [
        {"text": "*Đáp án đúng 1", "isCorrect": true},
        {"text": "*Đáp án đúng 2", "isCorrect": true},
        {"text": "Đáp án sai 1", "isCorrect": false},
        {"text": "Đáp án sai 2", "isCorrect": false}
      ],
      "correctFeedback": "Tuyệt vời!...",
      "incorrectFeedback": "Chưa chính xác...",
      "points": 1
    }
  ]
}

Chỉ trả về JSON.`,
        variables: ['{title}', '{slide_script}'],
      },
      {
        slug: 'questions.review',
        name: 'Review Questions (Bloom)',
        content: `**Create Review Questions - Bloom Taxonomy**

**Bối cảnh:** Bạn là một chuyên gia giáo dục, giảng viên đại học và người biên soạn câu hỏi trắc nghiệm giàu kinh nghiệm, có chuyên môn sâu về việc áp dụng thang đo nhận thức Bloom.

**Input:**
- Chủ đề/Bài học: {title}
- Số hiệu bài: {lesson_id}
- Nội dung bài giảng:
{slide_script}
- Số lượng câu hỏi: Mức Biết (5), Mức Hiểu (5), Mức Vận dụng (5)

**YÊU CẦU CHI TIẾT:**

1. **Quy tắc chung:**
- Mỗi câu hỏi chỉ có MỘT đáp án đúng duy nhất
- Phương án nhiễu phải hợp lý, thuyết phục
- Tránh từ phủ định (KHÔNG, NGOẠI TRỪ)
- Các lựa chọn có độ dài và cấu trúc tương tự
- Vị trí đáp án đúng cân bằng giữa A, B, C, D

2. **Mức BIẾT (Độ khó 1):**
- Kiểm tra trí nhớ về khái niệm, thuật ngữ, định nghĩa
- Từ khóa: ai, cái gì, ở đâu, khi nào, liệt kê, định nghĩa, nhận dạng

3. **Mức HIỂU (Độ khó 2):**
- Kiểm tra khả năng diễn giải, giải thích, so sánh
- Từ khóa: so sánh, giải thích, vì sao, tóm tắt, phân biệt, khái quát

4. **Mức VẬN DỤNG (Độ khó 3):**
- Áp dụng kiến thức vào tình huống mới
- Từ khóa: áp dụng, sử dụng, giải quyết, dự đoán, thực hiện

**Định dạng đầu ra (JSON):**
{
  "lessonId": "B1",
  "questions": [
    {
      "questionId": "B1-1-01",
      "difficulty": 1,
      "bloomLevel": "remember",
      "question": "Câu hỏi mức Biết?",
      "correctAnswer": "Đáp án đúng (A)",
      "optionB": "Phương án B",
      "optionC": "Phương án C",
      "optionD": "Phương án D",
      "explanation": "Giải thích ngắn gọn tại sao A đúng"
    },
    {
      "questionId": "B1-2-01",
      "difficulty": 2,
      "bloomLevel": "understand",
      "question": "Câu hỏi mức Hiểu?",
      "correctAnswer": "Đáp án đúng (A)",
      "optionB": "Phương án B",
      "optionC": "Phương án C",
      "optionD": "Phương án D",
      "explanation": "Giải thích"
    },
    {
      "questionId": "B1-3-01",
      "difficulty": 3,
      "bloomLevel": "apply",
      "question": "Tình huống: ... Câu hỏi vận dụng?",
      "correctAnswer": "Đáp án đúng (A)",
      "optionB": "Phương án B",
      "optionC": "Phương án C",
      "optionD": "Phương án D",
      "explanation": "Giải thích"
    }
  ]
}

Chỉ trả về JSON.`,
        variables: ['{title}', '{lesson_id}', '{slide_script}'],
      },
      {
        slug: 'slides.design',
        name: 'Design Slide Content',
        content: `Bạn là một chuyên gia Thiết kế Nội dung Giảng dạy (Instructional Designer) với nhiệm vụ biên soạn nội dung cho các bài giảng đại học. Tôi sẽ cung cấp cho bạn một dàn ý thô cho một slide.

**Nhiệm vụ của bạn là:** Chuyển hóa dàn ý đó thành nội dung slide hấp dẫn, chuyên nghiệp và dễ hiểu cho sinh viên, tuân thủ nghiêm ngặt các quy tắc sau:

1.  **Đối tượng:** Sinh viên đại học. Nội dung cần có chiều sâu chuyên môn nhưng phải được diễn giải một cách dễ tiếp cận.

2.  **Mục tiêu:** Tối ưu hóa để giữ sự tập trung, khuyến khích tư duy và giúp sinh viên ghi nhớ kiến thức cốt lõi.

3.  **Tiêu đề:** Giữ nguyên tiêu đề được cung cấp.

4.  **RÀNG BUỘC SỐ LƯỢNG BULLETS:**
    * **Tối thiểu:** 2 bullets
    * **Tối đa:** 5 bullets
    * Slide content thường có 3-4 bullets là lý tưởng

5.  **Xử lý Nội dung:**
    * **Quy tắc Vàng (Ưu tiên số 1):** Nếu nội dung là một **định nghĩa, khái niệm cốt lõi, hoặc một trích dẫn trực tiếp** (ví dụ: có các từ 'là', 'được định nghĩa là', 'bao gồm',...), **BẠN PHẢI GIỮ NGUYÊN VĂN VÀ ĐẦY ĐỦ** nội dung đó trong phần "description". Các trường "emoji" và "point" phải để trống.
    * **Với các nội dung khác:** Phân tách thành các luận điểm rõ ràng. Mỗi luận điểm phải bao gồm:
        * **"emoji":** Chọn một biểu tượng emoji **tinh tế, mang tính học thuật**. 
          **Danh sách emoji gợi ý:**
          📊 (thống kê) | 🔬 (khoa học) | 💡 (ý tưởng) | 📈 (tăng trưởng) | 🎯 (mục tiêu)
          ⚙️ (cơ chế) | 🧠 (tư duy) | 📝 (ghi chú) | 🔗 (liên kết) | 📌 (quan trọng)
          ⚡ (nhanh) | 🔑 (chìa khóa) | 📋 (danh sách) | 🌐 (toàn cầu) | 🛠️ (công cụ)
        * **"point":** Rút ra **từ khóa (keyword) hoặc cụm từ cốt lõi** quan trọng nhất. Đây phải là thứ mà sinh viên cần ghi vào vở. Phải thật ngắn gọn (tối đa 5 từ).
        * **"description":** Diễn giải ngắn gọn (≤12 từ) cho "point". Sử dụng ngôn ngữ rõ ràng, có thể dùng phép ẩn dụ hoặc ví dụ đơn giản.

6.  **Định dạng đầu ra:** Chỉ trả về một đối tượng JSON duy nhất, không thêm bất kỳ lời giải thích hay định dạng markdown nào khác.

**Dàn ý thô:**
---
**Tiêu đề:** {title}
**Nội dung:**
{content}
---

**Cấu trúc JSON đầu ra bắt buộc:**
{
  "title": "Tiêu đề Slide",
  "bullets": [
    {
      "emoji": "💡",
      "point": "Từ khóa chính",
      "description": "Diễn giải ngắn gọn, dễ hiểu."
    },
    {
      "emoji": "📈",
      "point": "Từ khóa thứ hai",
      "description": "Giải thích súc tích trong 12 từ."
    },
    {
      "emoji": "",
      "point": "",
      "description": "Giữ nguyên đầy đủ định nghĩa hoặc khái niệm cốt lõi ở đây."
    }
  ]
}`,
        variables: ['{title}', '{content}'],
      },
      {
        slug: 'slides.image',
        name: 'Slide Image Prompt Generator',
        content: `You are an expert Educational Art Director specialized in creating visuals for lecture slides.

Your task is to create a clear, accurate, and visually consistent image that illustrates the following concept:
---
{visual_idea}
---

### 🔹 Purpose
Create an **educational illustration** (not abstract art) that directly visualizes the described idea for teaching.

### 🔹 Visual Style
- Prefer: *flat 2D infographic*, *diagram*, *minimalist educational style*.
- For code or syntax: use *IDE-style windows*, *syntax highlighting*, *indentation marks*, and *language-appropriate icons*.
- For conceptual ideas: use *clear icons*, *logical layout*, and *color grouping*.
- For real-world metaphors: use *simple realistic scenes* (e.g., computer, classroom, network diagram).

### 🔹 Text Handling
- **Do NOT include any text** unless it is *essential* to understanding the concept.
- If text genuinely helps clarify meaning (e.g., showing "Python" vs "Java", "Hello, World!", or short code labels), include it clearly.
- Limit to **1–2 short words or phrases**, ≤25 characters each.
- Use simple fonts (sans-serif or monospace).
- Avoid decorative typography.

Examples when text is allowed:
- Comparing languages → "Python" / "Java"
- Showing output → "Hello, World!"
- Slide summary → "Lesson Summary"

In all other cases: **no text, just icons or visuals.**

### 🔹 Lighting & Color
- Soft classroom lighting, neutral background.
- Color palette: clear contrast, educational tone (blue, orange, gray, white).

### 🔹 Avoid
--no watermark, --no handwriting, --no distorted text, --no abstract shapes, --no glowing cubes, --no sci-fi, --no cinematic lighting
--no text in the picture unless essential as described above.`,
        variables: ['{visual_idea}'],
      },
      {
        slug: 'handout.generate',
        name: 'Generate Handout',
        content: `**TASK:** Tạo handout từ outline.

**INPUT:**
- Tiêu đề: {title}
- Outline: {detailed_outline}

## OUTPUT (JSON):
{"title":"...", "sections":[{"heading":"...", "content":"...", "keyPoints":[]}], "summary":"..."}

Chỉ trả về JSON.`,
        variables: ['{title}', '{detailed_outline}'],
      },
    ];

    const results: { slug: string; id: string }[] = [];
    for (const p of prompts) {
      const result = await this.prisma.prompt.upsert({
        where: { slug: p.slug },
        update: { name: p.name, content: p.content, variables: p.variables },
        create: { slug: p.slug, name: p.name, content: p.content, variables: p.variables },
      });
      results.push({ slug: result.slug, id: result.id });
    }

    return { seeded: results.length, prompts: results };
  }
}
