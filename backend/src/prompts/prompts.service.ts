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

**Mục tiêu:** Chuyển hóa một outline đã có thành kịch bản chi tiết cho từng slide trong bài giảng PowerPoint (.pptx). Đồng thời, soạn sẵn lời giảng (transcript) cho từng slide.

**Input:**
- Tiêu đề: {title}
- Outline chi tiết:
{detailed_outline}

**Yêu cầu cho mỗi slide:**

1. **Ít chữ, giàu ý:**
   * Slide chỉ chứa **Tiêu đề** và **tối đa 2-3 ý chính** dưới dạng gạch đầu dòng ngắn gọn.
   * **Ngoại lệ:** Slide về **khái niệm/định nghĩa** có thể hiển thị đầy đủ nội dung.

2. **Tối đa hóa hình ảnh (Visual First):**
   * **Yêu cầu cốt lõi:** Với mỗi slide, bạn phải đề xuất một loại hình ảnh trực quan cụ thể.
   * **Định dạng:** "[Visual Idea]: Một sơ đồ tư duy (mind map) thể hiện các nhánh chính..."

3. **Ghi chú của diễn giả (Speaker Notes):**
   * Phần Transcript được đặt vào mục Speaker Notes của mỗi slide.

**Định dạng đầu ra (JSON):**
{
  "title": "Tên bài học",
  "slides": [
    {
      "slideIndex": 0,
      "slideType": "title",
      "title": "Tiêu đề bài học",
      "subtitle": "Tên môn học",
      "content": [],
      "visualIdea": null,
      "speakerNote": "Chào mừng các em đến với bài học..."
    },
    {
      "slideIndex": 1,
      "slideType": "agenda",
      "title": "Nội dung bài học",
      "content": ["Nội dung 1", "Nội dung 2", "Nội dung 3"],
      "visualIdea": null,
      "speakerNote": "Ở bài học ngày hôm nay chúng ta sẽ..."
    },
    {
      "slideIndex": 2,
      "slideType": "objectives",
      "title": "Mục tiêu bài học",
      "content": ["Mục tiêu 1", "Mục tiêu 2"],
      "visualIdea": "Sử dụng các icon như hình tấm bia, bậc thang...",
      "speakerNote": "Trước khi bắt đầu, chúng ta hãy cùng xem..."
    },
    {
      "slideIndex": 3,
      "slideType": "content",
      "title": "Tiêu đề mục",
      "content": ["Ý chính 1", "Ý chính 2"],
      "visualIdea": "Một sơ đồ tư duy (mind map) thể hiện...",
      "speakerNote": "Trong phần này chúng ta sẽ tìm hiểu về..."
    },
    {
      "slideIndex": -2,
      "slideType": "questions",
      "title": "Câu hỏi ôn tập",
      "content": ["Câu hỏi 1", "Câu hỏi 2"],
      "visualIdea": null,
      "speakerNote": "Để củng cố kiến thức..."
    },
    {
      "slideIndex": -1,
      "slideType": "summary",
      "title": "Tổng kết",
      "content": ["Tóm tắt 1", "Tóm tắt 2"],
      "visualIdea": null,
      "speakerNote": "Vậy là chúng ta đã hoàn thành..."
    }
  ]
}

**YÊU CẦU QUAN TRỌNG:**
- Mỗi mục trong outline = ít nhất 1 slide
- speakerNote phải tự nhiên, gần gũi như giảng bài trực tiếp
- Có câu chuyển tiếp giữa các slide
- Không đọc nguyên văn bullet points - diễn giải và bổ sung
- Thời lượng speakerNote: 1-3 phút/slide

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
4.  **Xử lý Nội dung:**
    * **Quy tắc Vàng (Ưu tiên số 1):** Nếu nội dung là một **định nghĩa, khái niệm cốt lõi, hoặc một trích dẫn trực tiếp** (ví dụ: có các từ 'là', 'được định nghĩa là', 'bao gồm',...), **BẠN PHẢI GIỮ NGUYÊN VĂN VÀ ĐẦY ĐỦ** nội dung đó trong phần "description". Các trường "emoji" và "point" phải để trống.
    * **Với các nội dung khác:** Phân tách thành các luận điểm rõ ràng. Mỗi luận điểm phải bao gồm:
        * **"emoji":** Chọn một biểu tượng emoji **tinh tế, mang tính học thuật** và liên quan trực tiếp đến nội dung. Tránh các emoji quá trẻ con hoặc gây xao nhãng.
        * **"point":** Rút ra **từ khóa (keyword) hoặc cụm từ cốt lõi** quan trọng nhất. Đây phải là thứ mà sinh viên cần ghi vào vở. Phải thật ngắn gọn.
        * **"description":** Diễn giải ngắn gọn (dưới 15 từ) cho "point". Sử dụng ngôn ngữ rõ ràng, có thể dùng phép ẩn dụ hoặc ví dụ đơn giản để sinh viên dễ hình dung.

5.  **Định dạng đầu ra:** Chỉ trả về một đối tượng JSON duy nhất, không thêm bất kỳ lời giải thích hay định dạng markdown nào khác.

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
      "point": "Từ khóa hoặc ý chính 1",
      "description": "Diễn giải cực kỳ ngắn gọn, dễ hiểu cho sinh viên."
    },
    {
      "emoji": "📈",
      "point": "Từ khóa hoặc ý chính 2",
      "description": "Diễn giải cực kỳ ngắn gọn, dễ hiểu cho sinh viên."
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
