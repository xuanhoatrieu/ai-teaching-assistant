-- Prompt Seeding Script v2
-- Run: psql -U ata_user -d ai_teaching -f prisma/seed-prompts-v2.sql

-- Clear existing prompts (optional - comment out if you want to keep existing)
-- DELETE FROM prompts;

-- 1. System Role Template
INSERT INTO prompts (id, slug, name, content, variables, version, is_active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'system.role',
  'System Role Template',
  '**ROLE:** Bạn là một Giảng viên {institution_type} giàu kinh nghiệm, chuyên gia trong lĩnh vực {expertise_area}.

Nhiệm vụ của bạn là soạn thảo giáo án và bài giảng chi tiết, hấp dẫn và dễ hiểu cho môn học {course_name}.

Đối tượng là {target_audience} ngành {major_name}.

{additional_context}',
  ARRAY['{institution_type}', '{expertise_area}', '{course_name}', '{target_audience}', '{major_name}', '{additional_context}'],
  1,
  true,
  NOW(),
  NOW()
) ON CONFLICT (slug) DO UPDATE SET
  content = EXCLUDED.content,
  variables = EXCLUDED.variables,
  version = prompts.version + 1,
  updated_at = NOW();

-- 2. Outline Detailed Prompt (JSON output)
INSERT INTO prompts (id, slug, name, content, variables, version, is_active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'outline.detailed',
  'Build Detailed Outline',
  '**TASK:** Xây dựng một dàn bài (outline) chi tiết và logic cho bài giảng.

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

```json
{
  "title": "{title}",
  "agenda": ["Nội dung 1", "Nội dung 2", "..."],
  "objectives": [
    "Trình bày được...",
    "Phân tích được...",
    "Áp dụng được..."
  ],
  "learningGuide": "Thiết bị, học liệu và phương pháp học tập",
  "situation": "Một câu chuyện ngắn hoặc câu hỏi lớn gây tò mò",
  "sections": [
    {
      "id": "1",
      "title": "Mục lớn 1",
      "subsections": [
        {"id": "1.1", "title": "Mục nhỏ 1.1", "keyPoints": ["Điểm chính 1", "Điểm chính 2"]},
        {"id": "1.2", "title": "Mục nhỏ 1.2", "keyPoints": ["..."]}
      ]
    }
  ],
  "situationSolution": "Giải quyết tình huống đầu bài",
  "summary": ["Ý chính 1", "Ý chính 2", "Ý chính 3"],
  "reviewQuestions": [
    "Câu hỏi mở 1?",
    "Câu hỏi mở 2?",
    "Câu hỏi mở 3?"
  ],
  "closingMessage": "Thông điệp kết thúc bài học"
}
```

Chỉ trả về JSON, không thêm text khác.',
  ARRAY['{title}', '{raw_outline}'],
  1,
  true,
  NOW(),
  NOW()
) ON CONFLICT (slug) DO UPDATE SET
  content = EXCLUDED.content,
  variables = EXCLUDED.variables,
  version = prompts.version + 1,
  updated_at = NOW();

-- 3. Slides Script Prompt (JSON output)
INSERT INTO prompts (id, slug, name, content, variables, version, is_active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'slides.script',
  'Design Slides Script',
  '**TASK:** Chuyển hóa outline chi tiết thành kịch bản cho từng slide PowerPoint.

**INPUT:**
- Tiêu đề bài học: {title}
- Outline chi tiết:
{detailed_outline}

---

## ⚠️ RÀNG BUỘC BẮT BUỘC

> **QUAN TRỌNG:** Bạn KHÔNG được phép thêm hoặc bớt nội dung.

1. **MỖI MỤC** trong outline → **ÍT NHẤT 1 SLIDE**
2. **KHÔNG TẠO SLIDE** về nội dung không có trong outline
3. **SPEAKER NOTES** chỉ giải thích nội dung đã có, không thêm kiến thức mới
4. **VÍ DỤ** chỉ minh họa cho kiến thức trong outline

---

## YÊU CẦU:

1. **Ít chữ, giàu ý:** Slide chỉ chứa tiêu đề và tối đa 2-3 ý chính ngắn gọn.
2. **Visual First:** Mỗi slide nội dung PHẢI có visualIdea cụ thể.
3. **Speaker Notes chi tiết:** Văn phong tự nhiên như giảng trực tiếp.
4. **Thời lượng:** Mỗi slide khoảng 1-3 phút.

---

## OUTPUT FORMAT (JSON):

```json
{
  "title": "{title}",
  "totalSlides": 15,
  "slides": [
    {
      "slideIndex": 0,
      "slideType": "title",
      "title": "Tên bài học",
      "subtitle": "Tên môn học",
      "content": [],
      "visualIdea": null,
      "speakerNote": "Chào mừng các em đã đến với bài học..."
    },
    {
      "slideIndex": 1,
      "slideType": "agenda",
      "title": "Nội dung bài học",
      "content": ["Nội dung 1", "Nội dung 2", "Nội dung 3"],
      "visualIdea": null,
      "speakerNote": "Hôm nay chúng ta sẽ tìm hiểu..."
    },
    {
      "slideIndex": 2,
      "slideType": "objectives",
      "title": "Mục tiêu bài học",
      "content": ["Mục tiêu 1", "Mục tiêu 2"],
      "visualIdea": "Icons: target, lightbulb, steps",
      "speakerNote": "Sau bài học này, các em sẽ..."
    },
    {
      "slideIndex": 3,
      "slideType": "content",
      "title": "Tiêu đề mục trong outline",
      "content": ["Ý chính 1", "Ý chính 2"],
      "visualIdea": "Sơ đồ tư duy / Biểu đồ / Infographic",
      "speakerNote": "Lời giảng chi tiết, tự nhiên..."
    }
  ],
  "coverageCheck": {
    "inputSections": ["Mục 1", "Mục 2"],
    "mappedSlides": {"Mục 1": [3, 4], "Mục 2": [5, 6, 7]}
  }
}
```

Chỉ trả về JSON, không thêm text khác.',
  ARRAY['{title}', '{detailed_outline}'],
  1,
  true,
  NOW(),
  NOW()
) ON CONFLICT (slug) DO UPDATE SET
  content = EXCLUDED.content,
  variables = EXCLUDED.variables,
  version = prompts.version + 1,
  updated_at = NOW();

-- 4. Interactive Questions Prompt (JSON output)
INSERT INTO prompts (id, slug, name, content, variables, version, is_active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'questions.interactive',
  'Interactive Questions (Focus Check)',
  '**TASK:** Tạo 5 câu hỏi tương tác để kiểm tra sự tập trung của sinh viên trong quá trình học.

**INPUT:**
- Tiêu đề bài học: {title}
- Kịch bản slide:
{slide_script}

---

## ⚠️ QUY TẮC TẠO CÂU HỎI TƯƠNG TÁC

1. **CHỈ HỎI VỀ NỘI DUNG ĐÃ TRÌNH BÀY:**
   - Câu hỏi PHẢI lấy từ nội dung slide đã có
   - Mỗi câu hỏi PHẢI ghi rõ slideIndex liên quan

2. **KHÔNG HỎI:**
   - Kiến thức ngoài bài
   - Kiến thức suy luận phức tạp

3. **MỤC ĐÍCH:** Kiểm tra sinh viên có THEO DÕI không, không phải kiểm tra kiến thức nền

---

## OUTPUT FORMAT (JSON):

```json
{
  "questions": [
    {
      "questionOrder": 1,
      "questionType": "MC",
      "questionText": "Nội dung câu hỏi?",
      "relatedSlideIndex": 5,
      "answers": [
        {"text": "Đáp án A", "isCorrect": true},
        {"text": "Đáp án B", "isCorrect": false},
        {"text": "Đáp án C", "isCorrect": false},
        {"text": "Đáp án D", "isCorrect": false}
      ],
      "correctFeedback": "Chính xác! ...",
      "incorrectFeedback": "Chưa đúng. Đáp án đúng là...",
      "points": 1
    },
    {
      "questionOrder": 2,
      "questionType": "MR",
      "questionText": "Chọn TẤT CẢ các đáp án đúng...",
      "relatedSlideIndex": 8,
      "answers": [
        {"text": "Đáp án A", "isCorrect": true},
        {"text": "Đáp án B", "isCorrect": true},
        {"text": "Đáp án C", "isCorrect": false},
        {"text": "Đáp án D", "isCorrect": false}
      ],
      "correctFeedback": "Tuyệt vời!",
      "incorrectFeedback": "Xem lại slide...",
      "points": 1
    }
  ]
}
```

- MC = Multiple Choice (1 đáp án đúng)
- MR = Multiple Response (nhiều đáp án đúng)

Chỉ trả về JSON, không thêm text khác.',
  ARRAY['{title}', '{slide_script}'],
  1,
  true,
  NOW(),
  NOW()
) ON CONFLICT (slug) DO UPDATE SET
  content = EXCLUDED.content,
  variables = EXCLUDED.variables,
  version = prompts.version + 1,
  updated_at = NOW();

-- 5. Review Questions Prompt (JSON output)
INSERT INTO prompts (id, slug, name, content, variables, version, is_active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'questions.review',
  'Review Questions (Bloom Taxonomy)',
  '**TASK:** Tạo bộ câu hỏi trắc nghiệm ôn tập theo Bloom Taxonomy.

**INPUT:**
- Tiêu đề bài học: {title}
- Kịch bản slide:
{slide_script}

**SỐ LƯỢNG CÂU HỎI:**
- Mức độ **Biết** (Level 1): {level1_count} câu
- Mức độ **Hiểu** (Level 2): {level2_count} câu
- Mức độ **Vận dụng** (Level 3): {level3_count} câu

---

## YÊU CẦU THEO MỨC ĐỘ:

1. **Mức độ BIẾT (Level 1):**
   - Kiểm tra trí nhớ về khái niệm, định nghĩa, thuật ngữ
   - Từ khóa: ai, cái gì, ở đâu, khi nào, định nghĩa, liệt kê

2. **Mức độ HIỂU (Level 2):**
   - Kiểm tra khả năng giải thích, so sánh, phân biệt
   - Từ khóa: so sánh, giải thích, vì sao, tóm tắt

3. **Mức độ VẬN DỤNG (Level 3):**
   - Kiểm tra khả năng áp dụng vào tình huống mới
   - Từ khóa: áp dụng, sử dụng, giải quyết, dự đoán

---

## QUY TẮC:

- Mỗi câu hỏi chỉ có MỘT đáp án đúng
- Các phương án sai phải có tính hợp lý, thuyết phục
- Tránh từ phủ định (KHÔNG, NGOẠI TRỪ)
- **correctAnswer là đáp án đúng**, các options khác là sai

---

## OUTPUT FORMAT (JSON):

```json
{
  "questions": [
    {
      "questionId": "B1-1-01",
      "questionOrder": 1,
      "level": 1,
      "question": "Nội dung câu hỏi?",
      "correctAnswer": "Đáp án đúng (A)",
      "optionB": "Đáp án B",
      "optionC": "Đáp án C",
      "optionD": "Đáp án D",
      "explanation": "Giải thích tại sao A đúng..."
    },
    {
      "questionId": "B1-2-01",
      "questionOrder": 2,
      "level": 2,
      "question": "So sánh X và Y?",
      "correctAnswer": "Điểm khác biệt chính là...",
      "optionB": "...",
      "optionC": "...",
      "optionD": "...",
      "explanation": "..."
    }
  ]
}
```

**QUY TẮC Question ID:** B{lesson}-{level}-{order}
- B1-1-01 = Bài 1, Level 1, Câu 1
- B1-2-01 = Bài 1, Level 2, Câu 1

Chỉ trả về JSON, không thêm text khác.',
  ARRAY['{title}', '{slide_script}', '{level1_count}', '{level2_count}', '{level3_count}'],
  1,
  true,
  NOW(),
  NOW()
) ON CONFLICT (slug) DO UPDATE SET
  content = EXCLUDED.content,
  variables = EXCLUDED.variables,
  version = prompts.version + 1,
  updated_at = NOW();

-- 6. Slides Image Prompt (for Imagen)
INSERT INTO prompts (id, slug, name, content, variables, version, is_active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'slides.image',
  'Slide Image Prompt Generator',
  'You are an expert at creating image prompts for AI image generation.

## TASK:
Based on the slide content below, create a detailed image prompt for Imagen.

## SLIDE CONTENT:
Title: {slide_title}
Content: {slide_content}
Visual Idea: {visual_idea}

## OUTPUT FORMAT (JSON):

```json
{
  "prompt": "Detailed English prompt for image generation, photorealistic/illustration style, professional presentation quality",
  "style": "photorealistic",
  "aspectRatio": "16:9",
  "negativePrompt": "text, words, letters, watermark, logo"
}
```

## RULES:
1. Prompt MUST be in English
2. Be specific about colors, composition, and style
3. Avoid text in images (AI struggles with text)
4. Focus on visual metaphors and concepts
5. Keep aspect ratio 16:9 for presentation slides
6. Style can be: photorealistic, illustration, diagram, infographic, icon

Return only JSON, no other text.',
  ARRAY['{slide_title}', '{slide_content}', '{visual_idea}'],
  1,
  true,
  NOW(),
  NOW()
) ON CONFLICT (slug) DO UPDATE SET
  content = EXCLUDED.content,
  variables = EXCLUDED.variables,
  version = prompts.version + 1,
  updated_at = NOW();

-- 7. Handout/Ebook Generation (Future)
INSERT INTO prompts (id, slug, name, content, variables, version, is_active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'handout.generate',
  'Generate Study Handout',
  '**TASK:** Tạo tài liệu handout/ebook từ outline chi tiết.

**INPUT:**
- Tiêu đề bài học: {title}
- Outline chi tiết:
{detailed_outline}

---

## OUTPUT FORMAT (JSON):

```json
{
  "title": "{title}",
  "subject": "Tên môn học",
  "sections": [
    {
      "heading": "Tiêu đề phần",
      "content": "Nội dung chi tiết dạng markdown với **bold**, *italic*, và bullet points",
      "keyPoints": ["Điểm quan trọng 1", "Điểm quan trọng 2"],
      "examples": ["Ví dụ minh họa 1", "Ví dụ minh họa 2"]
    }
  ],
  "summary": "Tóm tắt nội dung chính của bài học",
  "reviewQuestions": [
    "Câu hỏi ôn tập 1?",
    "Câu hỏi ôn tập 2?"
  ]
}
```

## QUY TẮC:
1. Nội dung chi tiết, giải thích rõ ràng các khái niệm
2. Có ví dụ minh họa thực tế
3. Mỗi section có keyPoints để highlight điểm quan trọng
4. Sử dụng markdown cho formatting trong content

Chỉ trả về JSON, không thêm text khác.',
  ARRAY['{title}', '{detailed_outline}'],
  1,
  true,
  NOW(),
  NOW()
) ON CONFLICT (slug) DO UPDATE SET
  content = EXCLUDED.content,
  variables = EXCLUDED.variables,
  version = prompts.version + 1,
  updated_at = NOW();

-- Verify inserted prompts
SELECT slug, name, version, is_active FROM prompts ORDER BY slug;

-- 8. Slides Optimize Content (for single slide regeneration)
INSERT INTO prompts (id, slug, name, content, variables, version, is_active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'slides.optimize_content',
  'Optimize Slide Content',
  '**TASK:** Tối ưu hóa nội dung của một slide thành dạng bullet points ngắn gọn, dễ hiểu.

**INPUT:**
- Tiêu đề slide: {title}
- Nội dung gốc: {content}
- Tiêu đề bài học: {lesson_title}

---

## YÊU CẦU:

1. **Tối đa 4 bullet points** - mỗi bullet có:
   - 1 emoji phù hợp nội dung
   - 1 point ngắn (tối đa 10 từ)
   - 1 description giải thích (tối đa 20 từ)

2. **Bullet points phải:**
   - Súc tích, dễ đọc trên slide
   - Giữ nguyên ý nghĩa của nội dung gốc
   - Không thêm kiến thức mới

3. **Chọn emoji phù hợp:**
   - 📌 Điểm quan trọng
   - 💡 Ý tưởng, tips
   - ⚠️ Lưu ý, cảnh báo
   - ✅ Điều kiện, yêu cầu
   - 🔑 Khái niệm chính
   - 📊 Số liệu, thống kê
   - 🎯 Mục tiêu, kết quả

---

## OUTPUT FORMAT (JSON Array):

```json
[
  {
    "emoji": "📌",
    "point": "Tiêu đề ngắn gọn",
    "description": "Mô tả chi tiết hơn một chút về điểm này"
  },
  {
    "emoji": "💡",
    "point": "Ý tưởng quan trọng",
    "description": "Giải thích thêm về ý tưởng"
  }
]
```

Chỉ trả về JSON array, không thêm text khác.',
  ARRAY['{title}', '{content}', '{lesson_title}'],
  1,
  true,
  NOW(),
  NOW()
) ON CONFLICT (slug) DO UPDATE SET
  content = EXCLUDED.content,
  variables = EXCLUDED.variables,
  version = prompts.version + 1,
  updated_at = NOW();

-- 9. Slides Image Prompt (for single slide image regeneration)
INSERT INTO prompts (id, slug, name, content, variables, version, is_active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'slides.image_prompt',
  'Generate Slide Image Prompt',
  'You are an expert at creating image prompts for educational AI image generation.

## TASK:
Create a detailed image prompt for Imagen/DALL-E to generate an educational illustration.

## SLIDE CONTENT:
Title: {title}
Content: {content}
Lesson: {lesson_title}

---

## OUTPUT FORMAT (JSON):

```json
{
  "prompt": "A professional educational illustration showing [concept]. Clean, modern design with [specific elements]. Suitable for university-level presentation. High quality, 16:9 aspect ratio. Style: [photorealistic/illustration/diagram].",
  "style": "illustration",
  "aspectRatio": "16:9",
  "negativePrompt": "text, words, letters, watermark, logo, low quality, blurry"
}
```

## RULES:
1. Prompt MUST be in English
2. Focus on visual metaphors that explain the concept
3. Be specific about:
   - Main subject
   - Colors (prefer professional blues, teals, greens)
   - Composition (centered, balanced)
   - Lighting (soft, professional)
4. NEVER include text in the image
5. Style options:
   - "photorealistic" for real-world examples
   - "illustration" for concepts and diagrams
   - "flat design" for simple ideas
   - "3d render" for technical subjects

Return only JSON, no other text.',
  ARRAY['{title}', '{content}', '{lesson_title}'],
  1,
  true,
  NOW(),
  NOW()
) ON CONFLICT (slug) DO UPDATE SET
  content = EXCLUDED.content,
  variables = EXCLUDED.variables,
  version = prompts.version + 1,
  updated_at = NOW();

