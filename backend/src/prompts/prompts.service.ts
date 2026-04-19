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
        content: `**Generate Speaker Notes (Lecture Transcript) — Step 1: Create Content**

Act as a professional university lecturer and presenter.
Rewrite the slide content below into a natural, spoken lecture transcript (speaker notes) for each slide.

{output_language_instruction}

**Input:**
- Lesson title: {title}
- Slide content:
{slides_content}

---

## ⚠️ MANDATORY LENGTH REQUIREMENTS (CRITICAL):

| Slide type | MINIMUM word count | Speaking duration |
|-----------|-------------------|-------------------|
| title/agenda | 100 words | 40-60 seconds |
| objectives | 100 words | 40-60 seconds |
| **content** | **200 words** | **1.5-2 minutes** |
| summary | 100 words | 40-60 seconds |

⛔ IF a content slide's speaker note is under 200 words → YOU HAVE FAILED. Rewrite it longer.
⛔ Each content slide MUST have all 3 parts: opening + detailed explanation + transition.

---

## 🎤 WRITING RULES:

### Required structure: Opening → Explanation → Transition
1. **Opening (1-2 sentences):** Connect from the previous slide with a SHORT, SIMPLE sentence. Example: "Next, let's look at...", "This section covers...", "Now we move to...". DO NOT start with exaggerated openers like "Let's begin with a very real scenario" or "To feel the power of".
2. **Explanation (main body, 70-80% of content):** Explain each point from the slide — DO NOT read bullet points verbatim. Instead, EXPLAIN, provide EXAMPLES, and ANALYZE.
3. **Transition (1-2 sentences):** Summarize the key point and lead into the next slide.

**Important: Do NOT write the labels "Opening", "Explanation", "Transition" in the speakerNote. Write as a continuous, flowing narrative.**

### The explanation section MUST include:
- Clear explanation of every point in the slide (do not skip any)
- At least 1-2 concrete illustrative examples
- Brief analysis to clarify meaning
- Logical connections between points
- Emphasis on key takeaways

## 🗣️ TONE & STYLE:
- Write as a university lecture transcript — NORMAL, natural tone
- Tone = a lecturer talking normally to students in class
- NOT: event MC, motivational speaker, YouTuber, advertisement, literary essay
- Direct, clear, straight to the technical content
- DO NOT use excessive intensifiers ("very practical", "extremely important", "absolutely essential")
- DO NOT use metaphors, imagery, literary comparisons, or hyperbole
- **Format: PLAIN TEXT ONLY.** Do NOT use Markdown, lists, bullet points, asterisks (*), hashtags (#), or emojis. TTS engines do not read these well.
- Do not just read the text. Explain and expand on the points naturally.

### AVOID:
- ❌ Reading bullet points verbatim
- ❌ Writing too briefly without explanation
- ❌ Starting every sentence the same way
- ❌ Using too many rhetorical questions
- ❌ Exaggerated openings

---

## Output format (JSON):

{
  "speakerNotes": [
    {
      "slideIndex": 1,
      "speakerNote": "Welcome everyone. Today we will explore..."
    },
    {
      "slideIndex": 2,
      "speakerNote": "Today's lesson covers the following topics. First..."
    }
  ]
}

⚠️ REMINDER: Each speakerNote for content slides must be AT LEAST 200 words. Explain all points in the slide fully. Review before returning.

Return JSON only.`,
        variables: ['{title}', '{slides_content}', '{output_language_instruction}'],
      },
      {
        slug: 'slides.optimize-notes',
        name: 'Optimize & QA Speaker Notes',
        content: `**Optimize & QA Speaker Notes — Step 2**

Act as a professional university lecturer and TTS content optimizer.
Review, improve, and optimize the existing speaker notes for text-to-speech quality.

{output_language_instruction}

**Input:**
- Original slide content (for cross-checking):
{slides_content}

- Current speaker notes (from Step 1):
{speaker_notes}

---

## ⛔ MANDATORY PRINCIPLES — READ CAREFULLY BEFORE STARTING

1. **PRESERVE paragraph structure:** Keep the same number of paragraphs, sentence order, and narrative flow.
2. **ADD ONLY, DO NOT REMOVE:** If you find missing content → add new sentences.
3. **OUTPUT word count >= 95% of INPUT word count.** Violating this = FAILURE.
4. **Replace ALL metaphors, hyperbole, and excessive intensifiers** with direct, natural language appropriate for a university lecturer.
5. **TONE = NORMAL LECTURER.** Every sentence should sound like a lecturer explaining, NOT a motivational speaker/MC/advertisement.
6. **Format: PLAIN TEXT ONLY.** Remove any Markdown formatting, bullet points, asterisks (*), hashtags (#), or emojis from speaker notes. TTS engines do not read these well.

---

## ✅ TASK 1 (HIGHEST PRIORITY): NORMALIZE TONE

⚠️ THIS IS THE MOST IMPORTANT TASK. If output still has exaggerated tone = FAILURE.

**Standard:** A university lecturer speaking NORMALLY in class.

**Read EACH SENTENCE and ask:** "Does this sound like a normal lecturer or like a motivational speaker/MC/advertisement?"
- If it sounds like **a motivational speaker, event MC, advertisement, or literary essay** → rewrite in normal tone
- If it sounds like **a lecturer explaining** → keep as-is

**Signs to fix:**
- Long-winded, exaggerated slide openers → shorten to 1 direct sentence
- Metaphors, imagery, literary comparisons ("golden key", "open the door", "nightmare")
- Excessive intensifiers ("very", "extremely", "absolutely", "incredibly")
- Advertising language ("indispensable", "undeniable", "amazing")
- Hyperbole ("mind-blowing", "magical", "explosive", "legendary")

**Note:** Only fix the wording. PRESERVE the meaning and paragraph structure.

---

## ✅ TASK 2: QUALITY AUDIT

Cross-check speaker notes against original slide content to find and fix issues:

| Issue | Action |
|-------|--------|
| Slide has 4 points, speaker note only explains 2 | Add explanation for the 2 missing points |
| Speaker note < 200 words (content slide) | Add more examples and detailed explanation |
| Speaker note < 100 words (title/agenda/summary slide) | Add more content |
| Missing illustrative examples | Add at least 1 example |
| Incorrect or contradictory explanation | Fix to match slide content |

---

## ✅ TASK 3: TTS OPTIMIZATION

Speaker notes will be read aloud by TTS. Convert ALL technical content to natural spoken form.

### Code-to-speech conversion rules:
- Function/variable names with underscores → describe in words, DO NOT keep raw code names
- Operators → write as words ("equals", "less than", "greater than", "not equal to")
- Code statements → paraphrase as natural sentences

**Examples:**
❌ \`calculate_sum(a, b)\` → ✅ "the calculate sum function, which takes two parameters a and b"
❌ \`if n <= 1: return 1\` → ✅ "if n is less than or equal to 1, then return 1"
❌ \`factorial(n-1)\` → ✅ "call the factorial function with the parameter n minus 1"

### Abbreviation rules (priority order):
1. **Domain abbreviations with well-known expansions → expand in the output language:**
   EOL → "end of line character", EOF → "end of file", OS → "operating system", IDE → "integrated development environment", OOP → "object-oriented programming"

2. **Common tech abbreviations → keep as-is (TTS reads them automatically):**
   CPU, RAM, SSD, API, HTML, CSS, SQL, HTTP, JSON, XML

### ⚠️ DO NOT SPLIT short abbreviations into individual letters:
- ❌ DO NOT write: "p y" (splitting py into p y)
- ✅ KEEP AS-IS: "py", "js", "ts", "cpp", "exe", "dll"
- Abbreviations of 2-4 characters NOT in the expansion list → keep as-is, DO NOT split

---

## Output format (JSON):

{
  "speakerNotes": [
    {
      "slideIndex": 1,
      "speakerNote": "Reviewed, tone-corrected, and TTS-optimized speaker note..."
    }
  ]
}

⚠️ FINAL CHECK:
1. Output word count >= 95% of input? If not → add content.
2. Were any sentences deleted? If yes → add them back.
3. Were any narrative paragraphs turned into lists? If yes → rewrite as narrative.
Return JSON only.`,
        variables: ['{slides_content}', '{speaker_notes}', '{output_language_instruction}'],
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
        content: `## TASK
Format raw content into JSON bullets for a PowerPoint slide.

{output_language_instruction}

## ⚠️ STRICT CONSTRAINTS
- Use ONLY information from the PROVIDED CONTENT below
- Do NOT add new knowledge, new data, or new ideas
- Do NOT create content outside the scope of INPUT
- Keep the title exactly as provided

## FORMAT RULES
1. Create 3-5 bullets from the provided content
2. Each bullet consists of:
   - emoji: an appropriate icon (💡🔬🎯⚙️🧠📝)
   - point: A concise keyword/phrase extracted from the content
   - description: A brief, clear explanation BASED ON THE CONTENT
3. For definitions/concepts: emoji="" point="" description=full content text

## INPUT
---
**Title:** {title}
**Content to format:**
{content}
---

## OUTPUT (JSON only)
{
  "title": "Keep the title from input exactly",
  "bullets": [
    {"emoji": "💡", "point": "Keyword from input", "description": "Explanation from input"}
  ]
}`,
        variables: ['{title}', '{content}', '{output_language_instruction}'],
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
