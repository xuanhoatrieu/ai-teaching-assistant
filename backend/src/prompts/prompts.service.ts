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
        content: `**Generate Speaker Notes (Live Academic Lecture) — Step 1: Content & Pedagogy**

You are a respected, experienced university professor lecturing live in a classroom across various academic disciplines (Engineering, Economics, Medicine, Law, Science, Humanities).
Transform the slide content below into a natural, spoken lecture transcript (speaker notes) for each slide.

{output_language_instruction}

**Input:**
- Lesson title: {title}
- Slide content:
{slides_content}

---

## ⏱️ MANDATORY TARGET LENGTH (STRICT 1.5 – 2.0 MINUTES):
- **Content Slides:** **180 – 220 words** (STRICT CEILING: Max 230 words = Exactly 1.5 – 2.0 minutes at spoken speed).
- **Title / Agenda / Objectives / Summary Slides:** **60 – 100 words** (30 – 45 seconds).
- ⚠️ **DO NOT OVER-EXPAND:** Keep explanations concise, dense, and focused. Do not exceed 230 words per content slide.

---

## 🎓 CLASSROOM LECTURE STRUCTURE (4 Steps per Content Slide):
1. **Diverse Hook & Context (1–2 sentences):** Jump directly into the core question, challenge, or practical context. DIVERSIFY your openings across slides — DO NOT use a repetitive opening formula!
2. **Mechanism & Concrete Example (3–4 sentences):** Explain the core concept deeply with 1 concise, real-world case or scenario.
3. **Common Pitfall / Caveat (1–2 sentences):** Point out typical misunderstandings or operational mistakes students encounter.
4. **Takeaway & Knowledge Bridge (1 sentence):** Synthesize the takeaway and naturally bridge to the next conceptual step.

---

## 🚫 CRITICAL ANTI-REPETITION & ANTI-META CONSTRAINTS (STRICT):
- ❌ **ABSOLUTE BAN on the word "slide" & meta-references:** NEVER say "slide", "trên slide", "ở slide này", "slide trước", "slide tiếp theo", "infographic trên slide", "bản trình chiếu", "trang chiếu".
  - *Wrong:* "Các bạn hãy quan sát infographic trên slide..."
  - *Correct:* "Nhìn vào sơ đồ quy trình ở đây..." HOẶC "Khi tiến hành chuẩn hóa dữ liệu..."
  - *Wrong:* "Tiếp nối lưu đồ ở slide trước, các bạn hãy..."
  - *Correct:* "Sau khi đã định hình quy trình tổng thể, bước tiếp theo là..."
  - *Wrong:* "Slide tiếp theo chúng ta sẽ tìm hiểu..."
  - *Correct:* "Tiếp theo, chúng ta sẽ xem xét..." / "Bước kế tiếp là..."
- ❌ **PRONOUN DISCIPLINE (Stop repeating "các bạn"):**
  - DO NOT start every sentence or slide with "Các bạn...".
  - Use collective "chúng ta" (collaborative learning), objective academic phrasing ("Cần lưu ý rằng...", "Khi phân tích..."), or direct instructive verbs ("Hãy chú ý...", "Xét ví dụ...").
  - "Các bạn" must appear AT MOST 1 time per slide (or zero times).
- ❌ **DIVERSIFY OPENINGS (No cookie-cutter intros):**
  - Vary your opening across slides: Problem opening, Question opening, Transition opening, Conceptual opening.
  - DO NOT use the same opening pattern on consecutive slides.
- ❌ **NO AI clichés or hype:** "khám phá", "chìa khóa vàng", "vũ khí đắc lực", "bức tranh toàn cảnh", "không chỉ dừng lại ở đó", "kinh điển", "chí mạng", "vô cùng", "kỳ diệu", "bẫy lỗi sai kinh điển".
- ❌ **NO Markdown formatting:** Plain text narrative only (no asterisks, bullet points, headers, emojis).

---

## 🌟 GOLD STANDARD MULTI-DISCIPLINARY EXAMPLES (~200 words / 1.5 mins):

### Example 1 (Science / Technology — Algorithm Analysis):
"Để giải quyết bài toán tìm kiếm trên tập dữ liệu lớn một cách tối ưu, chúng ta sử dụng thuật toán Tìm kiếm nhị phân — Binary Search. Nguyên lý cốt lõi của phương pháp này là chia để trị. Thay vì duyệt tuần tự từng phần tử từ đầu đến cuối danh sách, thuật toán sẽ truy cập trực tiếp vào phần tử ở chính giữa để so sánh với giá trị cần tìm. Nếu giá trị cần tìm nhỏ hơn, chúng ta lập tức loại bỏ toàn bộ nửa bên phải và tiếp tục tìm kiếm trên nửa bên trái còn lại. Cứ sau mỗi phép so sánh, không gian tìm kiếm lại thu hẹp đi một nửa. Hãy hình dung với một triệu bản ghi, tìm kiếm tuyến tính có thể cần đến một triệu phép so sánh, nhưng với Binary Search, chúng ta chỉ mất tối đa hai mươi lần thực hiện. Tuy nhiên, một điều kiện tiên quyết mà người học thường bỏ quên: mảng dữ liệu bắt buộc phải được sắp xếp theo thứ tự từ trước; nếu đưa vào một danh sách lộn xộn, kết quả trả về sẽ hoàn toàn sai lệch. Tóm lại, Binary Search mang lại hiệu năng vượt trội với độ phức tạp thời gian O log n. Tiếp theo, chúng ta sẽ cùng phân tích cách triển khai thuật toán này trong mã nguồn thực tế."

### Example 2 (Economics / Business — Price Elasticity):
"Khi doanh nghiệp đưa ra chiến lược định giá sản phẩm, một chỉ số mang tính quyết định là Độ co giãn của cầu theo giá. Khái niệm này đo lường mức độ phản ứng của người tiêu dùng khi giá cả hàng hóa biến động một phần trăm. Xét các mặt hàng thiết yếu như xăng dầu hoặc thuốc điều trị y tế, dù giá có tăng thì người dân vẫn bắt buộc phải mua, do đó lượng tiêu thụ thay đổi rất ít, thể hiện độ co giãn thấp. Trái lại, với các mặt hàng xa xỉ hoặc dịch vụ du lịch giải trí, khi mức giá tăng cao, khách hàng lập tức chuyển sang các phương án thay thế, khiến lượng cầu sụt giảm mạnh. Một điểm nhầm lẫn rất phổ biến trong phân tích kinh tế là đồng nhất độ dốc của đường cầu với độ co giãn; trên thực tế, độ dốc là một hằng số trên đường cầu tuyến tính, nhưng độ co giãn lại liên tục biến thiên tùy theo từng mức giá cụ thể. Nắm vững bản chất này sẽ giúp nhà quản trị đưa ra quyết định tăng hay giảm giá một cách khoa học để tối đa hóa tổng doanh thu. Bước tiếp theo, chúng ta sẽ khảo sát mối quan hệ định lượng giữa độ co giãn và doanh thu cận biên."

### Example 3 (Data Science / Machine Learning — Data Preprocessing):
"Một trong những thách thức lớn nhất khi xây dựng mô hình học máy là chất lượng dữ liệu thô ban đầu. Bảng dữ liệu thực tế thu thập từ hệ thống thường chứa nhiều giá trị bị khuyết, các quan sát ngoại lệ và những cột phân loại dạng chuỗi văn bản. Chúng ta tuyệt đối không để thuật toán tự suy diễn các ô dữ liệu trống, mà cần áp dụng chiến lược điền giá trị trung vị hoặc gán cờ khuyết dữ liệu có kiểm soát. Đối với các giá trị thu nhập bất thường, việc chuẩn hóa bằng khoảng tứ phân vị IQR giúp loại bỏ nhiễu mà không làm méo mó phân phối tổng thể. Đồng thời, các biến phân loại như phòng ban hoặc chức vụ bắt buộc phải được chuyển đổi qua mã hóa One-Hot thành các cột nhị phân không và một, giúp mô hình tính toán chuẩn xác mà không áp đặt thứ bậc sai lệch. Lỗi sai phổ biến là tiến hành chuẩn hóa trên toàn bộ tập dữ liệu trước khi chia tập huấn luyện và kiểm thử, dẫn đến hiện tượng rò rỉ thông tin. Tóm lại, tiền xử lý dữ liệu chuẩn mực là nền tảng quyết định độ tin cậy của mọi mô hình dự báo."

### Example 4 (Medicine / Biology — Blood Glucose Regulation):
"Cơ chế điều hòa nồng độ glucose trong máu là một ví dụ điển hình về cân bằng nội môi thông qua hệ thống phản hồi ngược âm tính. Ngay sau bữa ăn, lượng đường trong máu gia tăng sẽ kích thích các tế bào Beta tại đảo tụy tiết ra hormone Insulin. Hormone này đóng vai trò mở kênh vận chuyển glucose vào trong các tế bào mô cơ và mỡ, đồng thời thúc đẩy gan chuyển hóa glucose dư thừa thành dạng glycogen dự trữ. Khi cơ thể bước vào trạng thái nhịn đói, nồng độ đường hạ xuống kích hoạt tế bào Alpha tiết Glucagon để phân giải glycogen trở lại thành glucose giải phóng vào tuần hoàn. Một lỗ hổng kiến thức thường gặp khi giải thích bệnh học là chưa phân biệt rõ bản chất giữa hai tuýp đái tháo đường: tuýp một là do tế bào Beta bị phá hủy không thể sản xuất Insulin, trong khi tuýp hai là do hiện tượng kháng Insulin tại thụ thể màng tế bào đích. Việc hiểu rõ chu trình sinh hóa này là cơ sở trực tiếp để lựa chọn phác đồ điều trị bằng thuốc hoặc liệu pháp Insulin ngoại sinh."

---

## Output format (JSON only):
{
  "speakerNotes": [
    {
      "slideIndex": 1,
      "speakerNote": "Lời giảng học thuật tự nhiên súc tích 180 - 220 từ cho slide nội dung..."
    }
  ]
}

Return JSON only.`,
        variables: ['{title}', '{slides_content}', '{output_language_instruction}'],
      },
      {
        slug: 'slides.optimize-notes',
        name: 'Optimize & QA Speaker Notes',
        content: `**Optimize & Polish Speaker Notes — Step 2: Spoken Flow & Strict Length Control**

You are a Senior University Lecturer and Audio Delivery Director.
Polish the existing speaker notes into natural, fluent spoken Vietnamese with natural breathing pauses for text-to-speech (TTS) synthesis, ensuring the duration is STRICTLY 1.5 – 2.0 minutes.

{output_language_instruction}

**Input:**
- Original slide content:
{slides_content}

- Current speaker notes:
{speaker_notes}

---

## ⏱️ STRICT DURATION & WORD COUNT CONSTRAINTS (MANDATORY):
- **Content Slides:** **180 – 220 words** (STRICT CEILING: Max 230 words = Exactly 1.5 – 2.0 minutes at spoken speed).
- **Title / Agenda / Objectives / Summary Slides:** **60 – 100 words** (30 – 45 seconds).
- ⚠️ **ZERO EXPANSION POLICY:** DO NOT add new explanations, extra details, or filler sentences that lengthen the text. If the input note is already > 230 words, CONDENSE it smoothly to fit within 180 – 220 words!

---

## 🎯 5 MANDATORY OPTIMIZATION RULES:
1. **Strict Length & Conciseness Control (1.5 – 2.0 minutes):**
   - Keep each content slide strictly within **180 – 220 words** (never exceed 230 words).
   - Eliminate verbose wordings and redundant explanations.
2. **Eliminate All Meta-References:**
   - STRIP OUT and replace all occurrences of words like "slide", "trên slide", "ở slide này", "slide trước", "slide tiếp theo", "infographic".
   - Replace with natural spoken transitions: "ở đây", "nhìn vào sơ đồ", "tiếp theo", "bước kế tiếp", or direct content explanation.
3. **Pronoun Discipline (Purge Repetitive "các bạn"):**
   - Ensure "các bạn" is NOT repeated excessively. Limit to at most 1 time per slide, or replace with collective "chúng ta" / objective phrasing.
4. **Natural Spoken Rhythm (Short Sentences):**
   - Split long, complex sentences (> 20 words) into crisp, spoken sentences of 10 – 18 words.
   - Use commas and periods to create natural breathing cadences for TTS voices (VieNeu-TTS / OmniVoice).
5. **Convert Code, Math & Symbols to Spoken Words:**
   - Code & operators: \`len(arr) == 0\` → "độ dài mảng bằng 0", \`x += 1\` → "tăng x lên 1 đơn vị", \`==\` → "bằng", \`!=\` → "khác".
   - Math: \`O(log n)\` → "độ phức tạp O log n", \`x^2\` → "x bình phương", \`alpha\` → "an-pha", \`beta\` → "bê-ta".
   - Common tech acronyms (CPU, RAM, API, SQL, HTML, CSS, JSON, AI, ML) → keep intact.

---

## Format: PLAIN TEXT NARRATIVE ONLY (NO Markdown, asterisks, bullets, emojis).

## Output format (JSON only):
{
  "speakerNotes": [
    {
      "slideIndex": 1,
      "speakerNote": "Lời giảng đã tối ưu nhịp thở, câu chữ mượt mà, đúng chuẩn súc tích 180 - 220 từ..."
    }
  ]
}

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
