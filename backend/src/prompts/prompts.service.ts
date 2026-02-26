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
        content: `**Design Presentation Slides**

**Mục tiêu:** Chuyển hóa một outline đã có thành kịch bản chi tiết cho từng slide trong bài giảng PowerPoint (.pptx). Chỉ tập trung vào NỘI DUNG SLIDE và GỢI Ý HÌNH ẢNH. Lời giảng (speaker notes) sẽ được tạo riêng ở bước sau.

**Input:**
- Tiêu đề: {title}
- Outline chi tiết:
{detailed_outline}

---

## RÀNG BUỘC SỐ LƯỢNG SLIDE:
- **Tổng số slide:** 20-35 slides (tùy độ phức tạp nội dung)
- Cấu trúc gợi ý:
  - 1 slide Title
  - 1 slide Agenda
  - 1 slide Objectives
  - 20-30 slides Content (nội dung chính)
  - 1 slide Questions (câu hỏi thảo luận)
  - 1 slide Summary
- **KHÔNG tạo slide riêng cho:** Thiết bị & phương pháp học, Hướng dẫn học tập (learningGuide). Những nội dung này đã có trong outline, KHÔNG cần đưa vào slide.

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
      "speakerNote": null
    },
    {
      "slideIndex": 2,
      "slideType": "agenda",
      "title": "Nội dung bài học",
      "content": ["Nội dung 1", "Nội dung 2", "Nội dung 3",...],
      "visualIdea": "Infographic với roadmap tương ứng với số lượng nội dung",
      "speakerNote": null
    },
    {
      "slideIndex": 3,
      "slideType": "objectives",
      "title": "Mục tiêu bài học",
      "content": ["Mục tiêu 1", "Mục tiêu 2",...],
      "visualIdea": "Infographic với icons checklist và mũi tên tiến lên",
      "speakerNote": null
    },
    {
      "slideIndex": 4,
      "slideType": "content",
      "title": "Tiêu đề mục",
      "content": ["Ý chính 1", "Ý chính 2",...],
      "visualIdea": "Sơ đồ tư duy (mind map) thể hiện mối quan hệ giữa các khái niệm",
      "speakerNote": null
    },
    {
      "slideIndex": ...,
      "slideType": "questions",
      "title": "Câu hỏi thảo luận",
      "content": ["Câu hỏi 1", "Câu hỏi 2"],
      "visualIdea": null,
      "speakerNote": null
    },
    {
      "slideIndex": ...,
      "slideType": "summary",
      "title": "Tổng kết",
      "content": ["Tóm tắt 1", "Tóm tắt 2"],
      "visualIdea": "Thank you for listening",
      "speakerNote": null
    }
  ]
}

Chỉ trả về JSON.`,
        variables: ['{title}', '{detailed_outline}'],
      },
      {
        slug: 'slides.speaker-notes',
        name: 'Generate Speaker Notes',
        content: `**Generate Speaker Notes (Lời Giảng) - Bước 1: Tạo Nội Dung**

**Mục tiêu:** Soạn lời giảng (transcript/speaker notes) cho từng slide dựa trên nội dung slide đã có. Tập trung vào NỘI DUNG đầy đủ, chính xác. Văn phong và tối ưu TTS sẽ được xử lý ở bước sau.

**Input:**
- Tiêu đề bài học: {title}
- Nội dung các slides:
{slides_content}

---

## ⚠️ YÊU CẦU BẮT BUỘC VỀ ĐỘ DÀI (CRITICAL):

| Loại slide | Số từ TỐI THIỂU | Thời lượng nói |
|-----------|-----------------|----------------|
| title/agenda | 100 từ | 40-60 giây |
| objectives | 100 từ | 40-60 giây |
| **content** | **200 từ** | **1.5-2 phút** |
| summary | 100 từ | 40-60 giây |

⛔ NẾU SPEAKERNOTE CỦA SLIDE CONTENT DƯỚI 200 TỪ → BẠN ĐÃ LÀM SAI. PHẢI VIẾT LẠI DÀI HƠN.
⛔ Mỗi slide content phải có ĐỦ 3 phần: mở đầu + giảng giải chi tiết + chuyển tiếp.

---

## 🎤 QUY TẮC VIẾT SPEAKERNOTE:

### Cấu trúc bắt buộc: Mở đầu → Giảng giải → Chuyển tiếp
1. **Mở đầu (1-2 câu):** Nối tiếp slide trước bằng 1 câu ngắn, ĐƠN GIẢN. Ví dụ: "Tiếp theo, chúng ta xem...", "Phần này nói về...", "Bây giờ đến phần...". KHÔNG mở đầu phóng đại kiểu "Hãy bắt đầu bằng tình huống rất thực tế" hay "Để cảm nhận sức mạnh của".
2. **Giảng giải (phần chính, chiếm 70-80% nội dung):** Diễn giải từng ý trong slide - KHÔNG đọc lại bullet points mà phải GIẢI THÍCH, cho ví dụ, phân tích
3. **Chuyển tiếp (1-2 câu):** Tóm ý chính và dẫn sang slide tiếp theo

**Đặc biệt chú ý: Không được viết các từ "Mở đầu", "Giảng giải", "Chuyển tiếp" và dấu * vào nội dung speakerNote. Viết liền mạch tự nhiên.**

### Phần giảng giải PHẢI bao gồm:
- Giải thích rõ ràng từng ý trong slide (không bỏ sót)
- Ít nhất 1-2 ví dụ minh họa cụ thể
- Phân tích ngắn để làm rõ ý nghĩa
- Kết nối logic giữa các ý với nhau
- Nhấn mạnh điểm quan trọng cần ghi nhớ

## 🗣️ VĂN PHONG:
- Viết như transcript bài giảng đại học — giọng BÌNH THƯỜNG, tự nhiên
- Giọng văn = giảng viên đang nói chuyện bình thường với sinh viên trong lớp
- KHÔNG phải: MC event, diễn giả truyền cảm hứng, YouTuber, quảng cáo, bài văn nghị luận
- Trực tiếp, rõ ràng, đi thẳng vào nội dung chuyên môn
- KHÔNG dùng tính từ nhấn mạnh thừa ("rất thực tế", "vô cùng quan trọng", "cực kỳ cần thiết")
- KHÔNG dùng ẩn dụ, hình tượng, so sánh văn chương, cường điệu hóa

### TRÁNH:
- ❌ Đọc nguyên văn bullet points
- ❌ Viết quá ngắn gọn, thiếu giải thích
- ❌ Bắt đầu mọi câu giống nhau
- ❌ Dùng quá nhiều câu hỏi tu từ
- ❌ Câu mở đầu phóng đại: "Hãy bắt đầu bằng...", "Để thấy động lực...", "Một điều không thể phủ nhận..."

---

## VÍ DỤ SPEAKERNOTE CHO SLIDE CONTENT (~220 từ):

❌ **SAI (Quá ngắn, chỉ ~50 từ):**
"Deep Learning là một phương pháp học sâu trong trí tuệ nhân tạo. Nó có 3 đặc tính quan trọng: khả năng xấp xỉ, tối ưu hóa, và khái quát hóa."

✅ **ĐÚNG (Đủ dài, ~220 từ):**
"Tiếp theo là Deep Learning. Giới nghiên cứu vẫn chưa hiểu hoàn toàn tại sao Deep Learning hoạt động tốt, nhưng có 3 góc nhìn chính giúp giải thích được phần nào.

Đầu tiên là khả năng xấp xỉ. Nói đơn giản, một mạng neural đủ lớn có thể xấp xỉ bất kỳ hàm số nào. Điều này có nghĩa là về mặt lý thuyết, Deep Learning có thể học được mọi mối quan hệ trong dữ liệu.

Thứ hai là khả năng tối ưu. Mặc dù bài toán tối ưu trong Deep Learning phức tạp với hàng triệu tham số, nhưng các thuật toán gradient descent vẫn tìm được lời giải tốt. Ví dụ như khi huấn luyện mô hình nhận diện hình ảnh, dù có hàng triệu trọng số cần điều chỉnh, quá trình training vẫn hội tụ được.

Cuối cùng là khả năng khái quát hóa. Mô hình có thể hoạt động tốt trên dữ liệu chưa từng thấy, không chỉ dữ liệu đã dùng để huấn luyện. Chúng ta sẽ đi sâu vào từng phần ở các slide tiếp theo."

---

## Định dạng đầu ra (JSON):

{
  "speakerNotes": [
    {
      "slideIndex": 1,
      "speakerNote": "Xin chào các em. Hôm nay chúng ta sẽ cùng tìm hiểu về..."
    },
    {
      "slideIndex": 2,
      "speakerNote": "Bài học hôm nay gồm các phần chính. Đầu tiên là..."
    }
  ]
}

⚠️ NHẮC LẠI: Mỗi speakerNote cho slide content phải TỐI THIỂU 200 từ. Giải thích đầy đủ tất cả các ý trong slide. Kiểm tra lại trước khi trả kết quả.

Chỉ trả về JSON.`,
        variables: ['{title}', '{slides_content}'],
      },
      {
        slug: 'slides.optimize-notes',
        name: 'Optimize & QA Speaker Notes',
        content: `**Tối Ưu & Kiểm Duyệt Speaker Notes - Bước 2**

**Mục tiêu:** Kiểm duyệt chất lượng, sửa ngôn ngữ cường điệu/ẩn dụ và tối ưu từ cho tts.

**Input:**
- Nội dung các slides gốc (để cross-check):
{slides_content}

- Speaker notes hiện tại (từ Bước 1):
{speaker_notes}

---

## ⛔ NGUYÊN TẮC BẮT BUỘC — ĐỌC KỸ TRƯỚC KHI LÀM

1. **GIỮ NGUYÊN cấu trúc đoạn văn:** Giữ nguyên số đoạn, số câu, thứ tự câu, cách dẫn dắt narrative
2. **CHỈ ĐƯỢC THÊM, KHÔNG ĐƯỢC BỚT:** Nếu phát hiện thiếu nội dung → thêm câu mới
3. **SỐ TỪ OUTPUT >= 95% SỐ TỪ INPUT:** Vi phạm quy tắc này = THẤT BẠI
4. **Tất cả các câu có sử dụng phép so sánh, ẩn dụ, cường điệu, tính từ nhấn mạnh,.. phải được thay thế bằng từ ngữ trực tiếp, tự nhiên, phù hợp với văn phong giảng viên đại học.**
5. **GIỌNG VĂN = GIẢNG VIÊN BÌNH THƯỜNG:** Mọi câu phải nghe như giảng viên đang giải thích, KHÔNG phải diễn giả/MC/quảng cáo. Thay ẩn dụ, cường điệu, tính từ nhấn mạnh thừa bằng từ trực tiếp (xem chi tiết Nhiệm vụ 1).
---

## ✅ NHIỆM VỤ 1 (ƯU TIÊN CAO NHẤT): CHUẨN HÓA GIỌNG VĂN

⚠️ ĐÂY LÀ NHIỆM VỤ QUAN TRỌNG NHẤT. Nếu output vẫn còn giọng phóng đại = THẤT BẠI.

**Tiêu chuẩn:** Giọng giảng viên đại học nói chuyện BÌNH THƯỜNG trong lớp.

**Đọc TỪNG CÂU và tự hỏi:** "Câu này nghe như giảng viên bình thường hay như diễn giả/MC/quảng cáo?"
- Nếu nghe như **diễn giả truyền cảm hứng, MC event, quảng cáo, bài văn nghị luận** → viết lại bằng giọng bình thường
- Nếu nghe như **giảng viên đang giải thích** → giữ nguyên

**Các dấu hiệu cần sửa (KHÔNG cần nhớ hết — dùng nguyên tắc trên để tự nhận biết):**
- Câu mở đầu slide dài dòng, phóng đại → rút gọn thành 1 câu ngắn trực tiếp
- Ẩn dụ, hình tượng, so sánh văn chương (giải phẫu, mổ xẻ, chinh phục, chìa khóa vàng, cánh cửa...)
- Tính từ nhấn mạnh thừa (rất, vô cùng, cực kỳ, thực sự...)
- Giọng quảng cáo (không thể thiếu, không ai phủ nhận, đáng kinh ngạc...)
- Cường điệu (hack não, thần kỳ, bùng nổ, kinh điển, muôn thuở...)
- Suồng sã liên tiếp (Nào, À, Nha, nhé dùng quá nhiều)

**Ví dụ (trước → sau):**
❌ "Hãy bắt đầu bằng một tình huống rất thực tế để thấy động lực của chủ đề hôm nay. Khi lắp một chiếc PC..."
✅ "Chúng ta xem xét tình huống sau. Khi lắp một chiếc PC..."

❌ "Đây chính là chìa khóa vàng để mở ra cánh cửa của môn Cấu trúc dữ liệu."
✅ "Đây là nền tảng cho môn Cấu trúc dữ liệu."

❌ "Code sẽ rối rắm như một mớ dây điện, và việc debug sẽ là cơn ác mộng."
✅ "Code sẽ khó đọc, khó bảo trì, và việc tìm lỗi sẽ khó khăn."

**Lưu ý:** Chỉ sửa cách diễn đạt, GIỮ NGUYÊN ý nghĩa và cấu trúc đoạn văn.

---

## ✅ NHIỆM VỤ 2: KIỂM DUYỆT CHẤT LƯỢNG

So khớp speaker notes với slide content gốc để phát hiện và sửa lỗi:

| Vấn đề | Cách xử lý |
|--------|------------|
| Slide content có 4 ý, speaker note chỉ giải thích 2 | Bổ sung giải thích cho 2 ý còn thiếu |
| Speaker note < 200 từ (slide content) | Viết bổ sung thêm ví dụ, giải thích chi tiết hơn |
| Speaker note < 100 từ (slide title/agenda/summary) | Viết bổ sung |
| Thiếu ví dụ minh họa | Thêm ít nhất 1 ví dụ |
| Giải thích sai hoặc mâu thuẫn với slide | Sửa cho đúng |

---

## ✅ NHIỆM VỤ 3: TỐI ƯU CHO ĐỌC THÀNH LỜI (TTS)

Speaker notes sẽ được đọc thành lời bằng TTS. Chuyển đổi MỌI nội dung kỹ thuật sang dạng đọc thành tiếng tự nhiên.

### Quy tắc chuyển đổi mã nguồn sang lời nói:
- Tên hàm/biến tiếng Việt có dấu gạch dưới → đọc bằng lời, KHÔNG giữ nguyên tên code
- Tên hàm/biến tiếng Anh dài hoặc có dấu gạch dưới → diễn giải bằng lời
- Toán tử → viết bằng từ ("bằng", "nhỏ hơn", "lớn hơn", "không bằng")
- Câu lệnh code → diễn giải thành câu tiếng Việt tự nhiên

**Ví dụ:**
❌ \`tinh_tong(a, b)\` → ✅ "hàm tính tổng, nhận hai tham số a và b"
❌ \`*args\` và \`**kwargs\` → ✅ "star args" và "double star kwargs" hoặc "tham số vị trí động" và "tham số từ khóa động"
❌ \`tao_hinh_chu_nhat(chieu_dai=10, chieu_rong=20)\` → ✅ "hàm tạo hình chữ nhật, với chiều dài bằng 10 và chiều rộng bằng 20"
❌ \`if n <= 1: return 1\` → ✅ "nếu n nhỏ hơn hoặc bằng 1 thì trả về 1"
❌ \`factorial(n-1)\` → ✅ "gọi lại hàm factorial với tham số n trừ 1"

### Quy tắc về từ viết tắt (ưu tiên từ trên xuống):
1. **Viết tắt tiếng Việt → viết đầy đủ tiếng Việt:**
   CLB → "câu lạc bộ", ĐH → "đại học", GV → "giảng viên", SV → "sinh viên", CNTT → "công nghệ thông tin", CSDL → "cơ sở dữ liệu"

2. **Viết tắt tiếng Anh có nghĩa tiếng Việt tương đương → dùng tiếng Việt:**
   EOL → "ký tự cuối dòng", EOF → "cuối tập tin", OS → "hệ điều hành", IDE → "môi trường phát triển", OOP → "lập trình hướng đối tượng"

3. **Viết tắt tiếng Anh phổ biến trong ngành → giữ nguyên (TTS tự đọc):**
   CPU, RAM, SSD, API, HTML, CSS, SQL, HTTP, JSON, XML

### ⚠️ KHÔNG TÁCH TỪ VIẾT TẮT THÀNH TỪNG KÝ TỰ:
- ❌ KHÔNG viết: "p y" (tách py thành p y)
- ✅ GIỮ NGUYÊN: "py", "js", "ts", "cpp", "exe", "dll"
- Từ viết tắt 2-4 ký tự KHÔNG có trong danh sách mở rộng → giữ nguyên, KHÔNG tách

---

## Định dạng đầu ra (JSON):

{
  "speakerNotes": [
    {
      "slideIndex": 1,
      "speakerNote": "Speaker note đã được kiểm duyệt, sửa ngôn ngữ, và tối ưu cho TTS..."
    }
  ]
}

⚠️ KIỂM TRA CUỐI CÙNG:
1. Số từ output >= 95% input? Nếu không → thêm nội dung.
2. Có câu nào bị xóa không? Nếu có → thêm lại.
3. Có đoạn narrative nào bị chuyển thành liệt kê không? Nếu có → viết lại dạng narrative.
Chỉ trả về JSON.`,
        variables: ['{slides_content}', '{speaker_notes}'],
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
- MR (Multiple Response): 5-8 đáp án tổng (2-4 đúng + 3-4 sai)

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
        {"text": "*Đáp án đúng ...", "isCorrect": true},
        {"text": "Đáp án sai 1", "isCorrect": false},
        {"text": "Đáp án sai 2", "isCorrect": false},
        {"text": "Đáp án sai ...", "isCorrect": false}
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
- Nội dung bài giảng (slide script):
{slide_script}

- Số lượng câu hỏi theo mức độ:
  + Mức Biết (Remember): {count_level1} câu
  + Mức Hiểu (Understand): {count_level2} câu
  + Mức Vận dụng (Apply): {count_level3} câu

---

## ⚠️ RÀNG BUỘC QUAN TRỌNG - BẮT BUỘC TUÂN THỦ:

### 🚫 TUYỆT ĐỐI KHÔNG ĐƯỢC:
- Tạo câu hỏi về nội dung KHÔNG CÓ trong slide script được cung cấp
- Thêm thông tin, số liệu, ví dụ không được đề cập trong bài giảng
- Suy diễn hoặc mở rộng kiến thức ngoài phạm vi bài học
- Tạo câu hỏi về kiến thức nền tảng chung không được giảng dạy
- Sử dụng cụm từ trích dẫn/tham chiếu ngược đến bài giảng trong câu hỏi, đáp án hoặc giải thích.
  CẤM HOÀN TOÀN các cụm từ: "Theo bài giảng", "Trong bài học", "Được nhắc đến trong",
  "Bài giảng nhấn mạnh", "Giảng viên hướng dẫn", "Trong phần X của bài", "Slide X trình bày",
  "Như đã học", "Được đề cập", "Theo nội dung bài"
  → Câu hỏi phải đứng ĐỘC LẬP như một câu hỏi kiểm tra kiến thức thông thường.
  Ví dụ:
    ❌ SAI: "Theo bài giảng, Python là ngôn ngữ thuộc loại nào?"
    ✅ ĐÚNG: "Python là ngôn ngữ lập trình thuộc loại nào?"

### ✅ CHỈ ĐƯỢC PHÉP:
- Tạo câu hỏi DỰA TRÊN NỘI DUNG CÓ TRONG slide script
- Sử dụng thuật ngữ, định nghĩa, ví dụ ĐÃ ĐƯỢC ĐỀ CẬP
- Kiểm tra kiến thức mà sinh viên ĐÃ ĐƯỢC HỌC trong bài

---

**YÊU CẦU CHI TIẾT:**

1. **Quy tắc chung:**
- Mỗi câu hỏi chỉ có MỘT đáp án đúng duy nhất
- Phương án nhiễu phải hợp lý, thuyết phục
- Tránh từ phủ định (KHÔNG, NGOẠI TRỪ)
- Các lựa chọn có độ dài và cấu trúc tương tự
- Vị trí đáp án đúng cân bằng giữa A, B, C, D

2. **Mức BIẾT (Độ khó 1):**
- Kiểm tra trí nhớ về khái niệm, thuật ngữ, định nghĩa ĐÃ ĐƯỢC GIẢNG
- Từ khóa: ai, cái gì, ở đâu, khi nào, liệt kê, định nghĩa, nhận dạng

3. **Mức HIỂU (Độ khó 2):**
- Kiểm tra khả năng diễn giải, giải thích, so sánh NỘI DUNG BÀI HỌC
- Từ khóa: so sánh, giải thích, vì sao, tóm tắt, phân biệt, khái quát

4. **Mức VẬN DỤNG (Độ khó 3):**
- Áp dụng kiến thức TRONG BÀI vào tình huống mới
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
        variables: ['{title}', '{lesson_id}', '{slide_script}', '{count_level1}', '{count_level2}', '{count_level3}'],
      },
      {
        slug: 'slides.design',
        name: 'Design Slide Content',
        content: `## NHIỆM VỤ
Format nội dung thô thành JSON bullets cho PowerPoint slide.

## ⚠️ RÀNG BUỘC TUYỆT ĐỐI
- CHỈ ĐƯỢC sử dụng thông tin từ NỘI DUNG được cung cấp bên dưới
- KHÔNG ĐƯỢC thêm kiến thức mới, số liệu mới, hoặc ý tưởng mới
- KHÔNG ĐƯỢC sáng tạo nội dung ngoài phạm vi INPUT
- Giữ nguyên tiêu đề được cung cấp

## QUY TẮC FORMAT
1. Tạo 3-5 bullets từ nội dung được cung cấp
2. Mỗi bullet gồm:
   - emoji: biểu tượng phù hợp (�🔬🎯⚙️🧠📝)
   - point: Tối ưu ngắn gọn từ các nội dung
   - description: giải thích ngắn gọn, dễ hiểu DỰA TRÊN NỘI DUNG
3. Nếu là định nghĩa/khái niệm: emoji="" point="" description=nội dung đầy đủ

## INPUT
---
**Tiêu đề:** {title}
**Nội dung cần format:**
{content}
---

## OUTPUT (JSON only)
{
  "title": "Giữ nguyên tiêu đề từ input",
  "bullets": [
    {"emoji": "💡", "point": "Từ khóa từ input", "description": "Giải thích từ input"}
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
      { visual_idea }
    ---

### 🔹 Purpose
Create an ** educational illustration ** (not abstract art) that directly visualizes the described idea for teaching.

### 🔹 Visual Style
      - Prefer: * flat 2D infographic *, * diagram *, * minimalist educational style *.
- For code or syntax: use * IDE - style windows *, * syntax highlighting *, * indentation marks *, and * language - appropriate icons *.
- For conceptual ideas: use * clear icons *, * logical layout *, and * color grouping *.
- For real - world metaphors: use * simple realistic scenes * (e.g., computer, classroom, network diagram).

### 🔹 Text Handling
      - ** Do NOT include any text ** unless it is * essential * to understanding the concept.
- If text genuinely helps clarify meaning(e.g., showing "Python" vs "Java", "Hello, World!", or short code labels), include it clearly.
- Limit to ** 1–2 short words or phrases **, ≤25 characters each.
- Use simple fonts(sans - serif or monospace).
- Avoid decorative typography.

Examples when text is allowed:
    - Comparing languages → "Python" / "Java"
      - Showing output → "Hello, World!"
        - Slide summary → "Lesson Summary"

In all other cases: ** no text, just icons or visuals.**

### 🔹 Lighting & Color
      - Soft classroom lighting, neutral background.
- Color palette: clear contrast, educational tone(blue, orange, gray, white).

### 🔹 Avoid
    --no watermark, --no handwriting, --no distorted text, --no abstract shapes, --no glowing cubes, --no sci - fi, --no cinematic lighting
    --no text in the picture unless essential as described above.`,
        variables: ['{visual_idea}'],
      },
      {
        slug: 'handout.generate',
        name: 'Generate Handout',
        content: `** TASK:** Tạo handout từ outline.

** INPUT:**
      - Tiêu đề: { title }
    - Outline: { detailed_outline }

## OUTPUT(JSON):
    { "title": "...", "sections": [{ "heading": "...", "content": "...", "keyPoints": [] }], "summary": "..." }

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
