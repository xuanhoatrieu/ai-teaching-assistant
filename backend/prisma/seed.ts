import { PrismaClient, UserRole, TTSProviderType, APIService } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // 1. Create default admin user
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      passwordHash: adminPassword,
      role: UserRole.ADMIN,
    },
  });
  console.log('✅ Admin user created:', admin.email);

  // 2. Create system prompts (v2 - JSON output format)
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
      content: `**TASK:** Xây dựng một dàn bài (outline) chi tiết và logic cho bài giảng.

**INPUT:**
- Tiêu đề bài học: {title}
- Dàn ý thô:
{raw_outline}

---

## ⚠️ RÀNG BUỘC QUAN TRỌNG

1. **KHÔNG THÊM NỘI DUNG MỚI:** Chỉ mở rộng các mục có trong dàn ý thô.
2. **KHÔNG BỎ SÓT:** Mỗi mục trong dàn ý thô PHẢI xuất hiện trong output.
3. **KHÔNG TỰ Ý THÊM:** Không thêm chủ đề, khái niệm ngoài phạm vi input.

---

## OUTPUT FORMAT (JSON):

\`\`\`json
{
  "title": "{title}",
  "agenda": ["Nội dung 1", "Nội dung 2"],
  "objectives": ["Trình bày được...", "Phân tích được..."],
  "learningGuide": "Thiết bị, học liệu và phương pháp học tập",
  "situation": "Câu chuyện hoặc câu hỏi gây tò mò",
  "sections": [
    {
      "id": "1",
      "title": "Mục lớn 1",
      "subsections": [
        {"id": "1.1", "title": "Mục nhỏ 1.1", "keyPoints": ["Điểm chính 1"]}
      ]
    }
  ],
  "situationSolution": "Giải quyết tình huống",
  "summary": ["Ý chính 1", "Ý chính 2"],
  "reviewQuestions": ["Câu hỏi mở 1?", "Câu hỏi mở 2?"],
  "closingMessage": "Thông điệp kết thúc"
}
\`\`\`

Chỉ trả về JSON, không thêm text khác.`,
      variables: ['{title}', '{raw_outline}'],
    },
    {
      slug: 'slides.script',
      name: 'Design Slides Script',
      content: `**TASK:** Chuyển hóa outline chi tiết thành kịch bản cho từng slide PowerPoint.

**INPUT:**
- Tiêu đề bài học: {title}
- Outline chi tiết:
{detailed_outline}

---

## ⚠️ RÀNG BUỘC BẮT BUỘC

1. **MỖI MỤC** trong outline → **ÍT NHẤT 1 SLIDE**
2. **KHÔNG TẠO SLIDE** về nội dung không có trong outline
3. **SPEAKER NOTES** chỉ giải thích nội dung đã có

---

## OUTPUT FORMAT (JSON):

\`\`\`json
{
  "title": "{title}",
  "totalSlides": 15,
  "slides": [
    {
      "slideIndex": 0,
      "slideType": "title",
      "title": "Tên bài học",
      "content": [],
      "visualIdea": null,
      "speakerNote": "Chào mừng các em..."
    }
  ],
  "coverageCheck": {
    "inputSections": ["Mục 1", "Mục 2"],
    "mappedSlides": {"Mục 1": [3, 4], "Mục 2": [5, 6]}
  }
}
\`\`\`

Chỉ trả về JSON, không thêm text khác.`,
      variables: ['{title}', '{detailed_outline}'],
    },
    {
      slug: 'questions.interactive',
      name: 'Interactive Questions (Focus Check)',
      content: `**TASK:** Tạo 5 câu hỏi tương tác để kiểm tra sự tập trung của sinh viên.

**INPUT:**
- Tiêu đề bài học: {title}
- Kịch bản slide:
{slide_script}

---

## QUY TẮC:
1. Câu hỏi PHẢI lấy từ nội dung slide đã có
2. Mỗi câu ghi rõ slideIndex liên quan
3. MC = 1 đáp án đúng, MR = nhiều đáp án đúng

---

## OUTPUT FORMAT (JSON):

\`\`\`json
{
  "questions": [
    {
      "questionOrder": 1,
      "questionType": "MC",
      "questionText": "Câu hỏi?",
      "relatedSlideIndex": 5,
      "answers": [
        {"text": "Đáp án A", "isCorrect": true},
        {"text": "Đáp án B", "isCorrect": false}
      ],
      "correctFeedback": "Chính xác!",
      "incorrectFeedback": "Chưa đúng.",
      "points": 1
    }
  ]
}
\`\`\`

Chỉ trả về JSON, không thêm text khác.`,
      variables: ['{title}', '{slide_script}'],
    },
    {
      slug: 'questions.review',
      name: 'Review Questions (Bloom Taxonomy)',
      content: `**TASK:** Tạo bộ câu hỏi trắc nghiệm ôn tập theo Bloom Taxonomy.

**INPUT:**
- Tiêu đề bài học: {title}
- Kịch bản slide:
{slide_script}

**SỐ LƯỢNG:**
- Mức độ Biết (Level 1): {level1_count} câu
- Mức độ Hiểu (Level 2): {level2_count} câu
- Mức độ Vận dụng (Level 3): {level3_count} câu

---

## OUTPUT FORMAT (JSON):

\`\`\`json
{
  "questions": [
    {
      "questionId": "B1-1-01",
      "questionOrder": 1,
      "level": 1,
      "question": "Câu hỏi?",
      "correctAnswer": "Đáp án đúng (A)",
      "optionB": "Đáp án B",
      "optionC": "Đáp án C",
      "optionD": "Đáp án D",
      "explanation": "Giải thích..."
    }
  ]
}
\`\`\`

Chỉ trả về JSON, không thêm text khác.`,
      variables: ['{title}', '{slide_script}', '{level1_count}', '{level2_count}', '{level3_count}'],
    },
    {
      slug: 'slides.image',
      name: 'Slide Image Prompt Generator',
      content: `You are an expert at creating image prompts for AI image generation.

## TASK:
Create a detailed image prompt for Imagen based on slide content.

## INPUT:
Title: {slide_title}
Content: {slide_content}
Visual Idea: {visual_idea}

## OUTPUT FORMAT (JSON):

\`\`\`json
{
  "prompt": "Detailed English prompt, professional presentation quality",
  "style": "photorealistic",
  "aspectRatio": "16:9",
  "negativePrompt": "text, words, letters, watermark"
}
\`\`\`

Return only JSON.`,
      variables: ['{slide_title}', '{slide_content}', '{visual_idea}'],
    },
    {
      slug: 'handout.generate',
      name: 'Generate Study Handout',
      content: `**TASK:** Tạo tài liệu handout/ebook từ outline chi tiết.

**INPUT:**
- Tiêu đề: {title}
- Outline:
{detailed_outline}

---

## OUTPUT FORMAT (JSON):

\`\`\`json
{
  "title": "{title}",
  "sections": [
    {
      "heading": "Tiêu đề phần",
      "content": "Nội dung markdown",
      "keyPoints": ["Điểm quan trọng"],
      "examples": ["Ví dụ"]
    }
  ],
  "summary": "Tóm tắt",
  "reviewQuestions": ["Câu hỏi ôn tập?"]
}
\`\`\`

Chỉ trả về JSON, không thêm text khác.`,
      variables: ['{title}', '{detailed_outline}'],
    },
  ];

  for (const prompt of prompts) {
    await prisma.prompt.upsert({
      where: { slug: prompt.slug },
      update: prompt,
      create: prompt,
    });
  }
  console.log('✅ System prompts created:', prompts.length);

  // 3. Create system TTS providers
  const ttsProviders = [
    {
      name: 'Gemini TTS',
      type: TTSProviderType.GEMINI,
      requiredFields: ['api_key'],
      isSystem: true,
    },
    {
      name: 'Google Cloud TTS',
      type: TTSProviderType.GOOGLE_CLOUD,
      requiredFields: ['project_id', 'credentials_json'],
      isSystem: true,
    },
    {
      name: 'Vbee TTS',
      type: TTSProviderType.VBEE,
      endpoint: 'https://vbee.vn/api/v1/tts',
      requiredFields: ['token', 'app_id'],
      isSystem: false,
    },
    {
      name: 'ViTTS',
      type: TTSProviderType.VITTS,
      endpoint: 'https://vitts.hoclieu.id.vn',
      requiredFields: ['api_key', 'base_url'],
      isSystem: false,
    },
  ];

  for (const provider of ttsProviders) {
    await prisma.tTSProvider.upsert({
      where: { name: provider.name },
      update: provider,
      create: provider,
    });
  }
  console.log('✅ TTS providers created:', ttsProviders.length);

  // 4. Create ViTTS admin config (system-level default for all users)
  const vittsConfigs = [
    { key: 'vitts.enabled', value: 'true' },
    { key: 'vitts.baseUrl', value: 'http://117.0.36.6:8888' },
    { key: 'vitts.apiKey', value: 'vneu_SqSvHWYLuHEc9cp4kRNYAxOUv73J39vXG8ywp6igQRo' },
    { key: 'vitts.defaultVoice', value: 'vitts:design' },
    { key: 'vitts.designInstruct', value: 'male, middle-aged' },
  ];

  for (const config of vittsConfigs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: {}, // Don't overwrite if already exists
      create: config,
    });
  }
  console.log('✅ ViTTS admin config created');

  // 5. Set CLIProxy default image model to gpt-image-2
  await prisma.systemConfig.upsert({
    where: { key: 'cliproxy.defaultImageModel' },
    update: { value: 'gpt-image-2' },
    create: { key: 'cliproxy.defaultImageModel', value: 'gpt-image-2' },
  });
  console.log('✅ CLIProxy defaultImageModel set to gpt-image-2');

  console.log('🎉 Seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
