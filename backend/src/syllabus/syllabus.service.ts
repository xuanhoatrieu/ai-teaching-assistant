import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { ImagenService } from '../ai/imagen.service';
import { MarkItDownService } from './markitdown.service';
import { MermaidService } from './mermaid.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { ReferenceRagService } from './reference-rag.service';

/** Default 10 blocks matching TUAF 2026 syllabus template */
const DEFAULT_BLOCKS = [
    {
        blockType: 'header',
        title: 'Thông tin chung đề cương',
        sortOrder: 0,
        defaultContent: `|  |  |
| --- | --- |
| TRƯỜNG ĐẠI HỌC NÔNG LÂM  **KHOA……** | CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM  **Độc lập – Tự do – Hạnh phúc**  *Thái nguyên, ngày…tháng…năm 2026* |

**ĐỀ CƯƠNG HỌC PHẦN**

**Tên học phần:**

**Mã học phần:**`
    },
    {
        blockType: 'general_info',
        title: 'Thông tin tổng quan học phần',
        sortOrder: 1,
        defaultContent: `**1. Thông tin chung về học phần**

- Số tín chỉ: ……… Loại học phần: (bắt buộc, tự chọn)
- Các học phần tiên quyết:
- Học phần học trước:
- Các học phần song hành:
- Các yêu cầu đối với học phần (nếu có):
- Bộ môn (Khoa) phụ trách học phần:
- Số tiết quy đổi với các hoạt động:

|  |  |  |  |
| --- | --- | --- | --- |
| Nghe giảng lý thuyết: | …..tiết | Thảo luận: | …..tiết |
| Làm bài tập: | …..tiết | Thực hành, thí nghiệm: | …..tiết |
| Hoạt động theo nhóm: | …..tiết | Tự học: | …..tiết |
| Bài tập lớn (tiểu luận): | …..tiết | Tự học có hướng dẫn: | …..tiết |`
    },
    {
        blockType: 'lecturers',
        title: 'Giảng viên phụ trách',
        sortOrder: 2,
        defaultContent: `**2. Thông tin chung về các giảng viên**

|  |  |  |  |  |
| --- | --- | --- | --- | --- |
| **STT** | **Học hàm, học vị, họ tên** | **Số điện thoại** | **Email** | **Ghi chú** |
| 1 | PGS.TS. Nguyễn Văn A | 0912 | mail@tuaf.edu.vn | |
| 2 | | | | |
| …. | | | | |`
    },
    {
        blockType: 'description',
        title: 'Mô tả học phần',
        sortOrder: 3,
        defaultContent: `**3. Mô tả tóm tắt nội dung học phần, mục tiêu của học phần**

Trình bày ngắn gọn vai trò, vị trí học phần, kiến thức sẽ trang bị cho sinh viên, quan hệ với các học phần khác trong chương trình đào tạo.

*(Mô tả học phần cần đảm bảo rõ ràng, ngắn gọn, dễ đọc và truyền đạt lợi ích mang lại cho người học. Tránh sử dụng các đại từ như “chúng tôi” và “bạn” khi viết mô tả học phần.)*

Cụ thể mục tiêu của học phần thành các mục kiến thức, kỹ năng (bao gồm cả kỹ năng số), năng lực tự chủ. Mỗi mục tiêu tách thành một ý riêng.`
    },
    {
        blockType: 'clo',
        title: 'Chuẩn đầu ra học phần (CLO)',
        sortOrder: 4,
        defaultContent: `**4. Chuẩn đầu ra học phần**

Ma trận đóng góp của mục tiêu, chuẩn đầu ra của học phần và chuẩn đầu ra của chương trình đào tạo.

|  |  |  |  |  |
| --- | --- | --- | --- | --- |
| **Mục tiêu của HP** | **Thứ tự chuẩn đầu ra** | **Nội dung đầu ra HP** | **Chuẩn đầu ra chương trình đào tạo** | **Mức độ đóng góp** |
| CO1 | CLO1 | | PLO1 | |
| CO2 | CLO2 | | PLO.. | |
| CO3 | CLO3 | | PLOn | |
| | …. | …….. | ….. | …. |

*Lưu ý:*
*- Chuẩn đầu ra học phần cần quy định cụ thể kiến thức, kỹ năng, năng lực tự chủ sinh viên đạt được.*
*- Mức năng lực được đánh giá theo thang Bloom (1= Nhớ; 2= Hiểu; 3= Ứng dụng; 4= Phân tích; 5= Đánh giá; 6= Sáng tạo).*`
    },
    {
        blockType: 'materials',
        title: 'Học liệu',
        sortOrder: 5,
        defaultContent: `**5. Học liệu**

- Tài liệu học tập chính: ghi rõ tên sách, giáo trình, năm xuất bản, nhà xuất bản (từ 01 đến 03 tài liệu). *Các giáo trình cần có mã số thư viện, trung tâm số ĐHTN hoặc đường link truy cập nếu là tài liệu mở.*
- Tài liệu tham khảo: ghi rõ những sách, tạp chí và tư liệu thông tin liên quan đến học phần (ít nhất 04 tài liệu)
- Học liệu điện tử (nếu có).

*Chú ý:*
- Tài liệu học tập phải đáp ứng yêu cầu của Thông tư số 35/2021/TT-BGDĐT ngày 06 tháng 12 năm 2021 của Bộ Giáo dục và Đào tạo.
- Tài liệu học tập chính phải có sự phê duyệt của Thủ trưởng cơ sở đào tạo.
- *Tài liệu tham khảo cần có mã số thư viện, trung tâm số ĐHTN hoặc đường link truy cập.*`
    },
    {
        blockType: 'student_tasks',
        title: 'Nhiệm vụ của sinh viên',
        sortOrder: 6,
        defaultContent: `**6. Nhiệm vụ của sinh viên**

Mô tả các yêu cầu đối với sinh viên theo quy định chung và đặc thù của học phần, bao gồm cả đạo đức học thuật.

**6.1. Phần lý thuyết, bài tập, thảo luận**
- Dự lớp ≥80% tổng số thời lượng của học phần, bao gồm cả thời gian học trực tuyến (nếu có).
- Chuẩn bị thảo luận.
- Hoàn thành các bài tập được giao trong sách bài tập, hệ thống LMS.

**6.2. Phần thí nghiệm, thực hành (nếu có)**
- Các bài thí nghiệm, thực hành của học phần.
- Yêu cầu cần đạt đối với phần thí nghiệm, thực hành.

**6.3. Phần bài tập lớn, tiểu luận (nếu có)**
- Tên bài tập lớn hoặc tiểu luận.
- Yêu cầu cần đạt, trong đó quy định rõ yêu cầu về liêm chính học thuật.

**6.4. Phần khác (nếu có)**
Ví dụ như tham quan thực tế.`
    },
    {
        blockType: 'assessment',
        title: 'Kế hoạch kiểm tra, đánh giá',
        sortOrder: 7,
        defaultContent: `**7. Phương pháp kiểm tra, đánh giá người học và thang điểm**

**7.1. Kế hoạch kiểm tra**

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| **STT** | **Nội dung** | **Thời điểm (tiết thứ)** | **Chuẩn đầu ra được đánh giá** | **Phương pháp đánh giá** | **Công cụ đánh giá** | **Tỷ lệ %** |
| **I. Chuyên cần** | | | | | | **20%** |
| 1 | Đi học đầy đủ, tích cực tham gia các hoạt động trong giờ | | CLO.. | Quan sát | Rubric 1 | 30% |
| 2 | Trung bình các bài ôn tập LMS | | CLO.. | Trắc nghiệm | | 70% |
| .. | … | | | | | |
| **II. Kiểm tra quá trình** | | | | | | **30%** |
| 1 | | 12 | CLO.. | | | |
| 2 | | 30 | CLO.. | | | |
| … | …. | | | | | |
| **III. Thi cuối kỳ** | | | | | | **50%** |
| 1 | | | CLO.. | | | |
| 2 | | | CLO.. | | | |
| … | …. | | | | | |

*Lưu ý:* *Trọng số đánh giá hiện đang áp dụng*
* *Đối với bậc đại học: 20% chuyên cần; 30% quá trình và 50% cuối kỳ;*
* *Đối với bậc thạc sĩ: 20% chuyên cần; 20% quá trình và 60% cuối kỳ;*

**7.2. Các Rubric đánh giá chuẩn đầu ra của học phần**

**Rubric đánh giá học phần**

*Hướng dẫn: Rubric là một hình thức đánh giá chỉ rõ các tiêu chí đạt được trên tất cả các nhiệm vụ của người học. Với mỗi thành phần điểm (chuyên cần, quá trình, cuối kỳ), giảng viên chủ động chọn các Rubric phù hợp. Với mỗi Rubric, Thầy/Cô xác định trọng số của các tiêu chí đánh giá và tổng trọng số của các tiêu chí bằng 100%.. Ví dụ các Rubric: sự tham gia và tính chủ động trong các buổi học; tự luận; trắc nghiệm; vấn đáp; thuyết trình; tiểu luận; bài tập lớn... Trường hợp có nhiều Rubric, giảng viên xác định trọng số sao cho tổng trọng số của các Rubric bằng 100%.*

***Ví dụ: Các hình thức đánh giá khác nhau***

**Rubric 1: Sự tham gia và tính chủ động trong các buổi học**

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| **Tiêu chí đánh giá** | **Trọng số (%)** | **Giỏi (8,5-10)** | **Khá (7,0-8,4)** | **Trung bình (5,5-6,9)** | **Trung bình yếu (4,0-5,4)** | **Kém <4,0** |
| Tham dự các buổi học lý thuyết và thảo luận | 80% | Tham dự đầy đủ các buổi học lý thuyết và thực hành | Tham dự chỉ đạt khoảng 95% -99% các buổi học lý thuyết và thực hành | Tham dự chỉ đạt khoảng 90% -94% các buổi học lý thuyết và thực hành | Tham dự đạt khoảng 80% - 89% các buổi học lý thuyết và thực hành | Tham dự < 80% các buổi học lý thuyết và thực hành |
| Thái độ học giờ lý thuyết, thảo luận | 20% | Tích cực phát biểu xây dựng bài. Xung phong làm bài tập | Tương đối tích cực phát biểu xây dựng và có tinh thần xung phong làm bài tập tuy nhiên chất lượng câu trả lời chưa cao. | Chưa tích cực phát biểu xây dựng và xung phong làm bài tập. Giáo viên chỉ định mới trả lời. | Chỉ tham dự lớp học nhưng không tham gia phát biểu, xung phong làm bài. | Không hiểu bài và không trả lời được câu hỏi liên quan đến bài cũ. Làm việc riêng trong giờ học. |

**Rubric 2: Thuyết trình**

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| **Tiêu chí đánh giá** | **Trọng số (%)** | **Giỏi (8,5-10)** | **Khá (7,0-8,4)** | **Trung bình (5,5-6,9)** | **Trung bình yếu (4,0-5,4)** | **Kém <4,0** |
| | | | | | | |

**Rubric 3: Vấn đáp**

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| **Tiêu chí đánh giá** | **Trọng số (%)** | **Giỏi (8,5-10)** | **Khá (7,0-8,4)** | **Trung bình (5,5-6,9)** | **Trung bình yếu (4,0-5,4)** | **Kém <4,0** |
| | | | | | | |

**Rubric 4: Tiểu luận**

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| **Tiêu chí đánh giá** | **Trọng số (%)** | **Giỏi (8,5-10)** | **Khá (7,0-8,4)** | **Trung bình (5,5-6,9)** | **Trung bình yếu (4,0-5,4)** | **Kém <4,0** |
| | | | | | | |

**Rubric n: ..............**

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| **Tiêu chí đánh giá** | **Trọng số (%)** | **Giỏi (8,5-10)** | **Khá (7,0-8,4)** | **Trung bình (5,5-6,9)** | **Trung bình yếu (4,0-5,4)** | **Kém <4,0** |
| | | | | | | |`
    },
    {
        blockType: 'content_detail',
        title: 'Nội dung chi tiết học phần',
        sortOrder: 8,
        defaultContent: `**8. Nội dung chi tiết học phần**

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| **Tiết** | **Nội dung** | **Chuẩn đầu ra HP** | **Phương pháp dạy học** | **Phương pháp đánh giá** | **Tài liệu tham khảo** |
| | **Chương 1:…** | | | | |
| 1,2,3 | A. Nội dung trên lớp<br>1. Lý thuyết: ...<br>2. Thảo luận: ... | CLO1 | Thuyết trình, Thảo luận | Kiểm tra quá trình | [1] |
| | B. Nội dung tự học:<br>1. Chuẩn bị tài liệu...<br>2. Làm bài tập... | CLO1 | Tự học có hướng dẫn | Đánh giá chuyên cần | [2] |`
    },
    {
        blockType: 'update_log',
        title: 'Quá trình cập nhật, bổ sung đề cương',
        sortOrder: 9,
        defaultContent: `**9. Thời điểm ban hành đề cương chi tiết học phần**

**10. Tiến trình cập nhật đề cương chi tiết (hàng năm)**

|  |  |
| --- | --- |
| **Lần 1:** Tóm tắt nội dung cập nhật ĐCCT lần 1: *ngày .. tháng .. năm..*<br>- Lý do cập nhật, bổ sung | <Người cập nhật ký và ghi rõ họ tên)<br>Trưởng Bộ môn: |
| **Lần 2:** Tóm tắt nội dung cập nhật ĐCCT lần 2: *ngày .. tháng .. năm..*<br>- Lý do cập nhật, bổ sung | <Người cập nhật ký và ghi rõ họ tên)<br>Trưởng Bộ môn: |
| **Lần …:** | <Người cập nhật ký và ghi rõ họ tên)<br>Trưởng Bộ môn: |

|  |  |  |
| --- | --- | --- |
| **TRƯỜNG KHOA** | **TRƯỞNG BỘ MÔN** | **GIẢNG VIÊN BIÊN SOẠN** |`
    }
];

/** Valid block types for mapping */
const VALID_BLOCK_TYPES = DEFAULT_BLOCKS.map((b) => b.blockType);

/** Reference character limit per reference (raised from 3000 to 50K) */
const REF_CHAR_LIMIT = 50_000;

/** System prompt for parsing syllabus DOCX markdown into 10 blocks */
const SYLLABUS_PARSE_SYSTEM_PROMPT = `You are an expert at parsing Vietnamese university syllabus documents.
You will receive a markdown conversion of a DOCX syllabus file. Your job is to identify the content
that belongs to each of these 10 standard blocks, extract the values, and reconstruct each block content using the EXACT structure, markdown tables, headings, and formatting of the 2026 standard templates.

CRITICAL RULES:
1. Legacy documents use DIFFERENT numbering systems (Roman numerals I/II/III, Arabic 1/2/3, or no numbers at all), DIFFERENT section ordering, and DIFFERENT terminology. You MUST match by CONTENT SEMANTICS, NOT by section numbers or headings.
2. For each block, your output MUST STRICTLY follow the provided "Standard Template" format (including all markdown tables, subheadings, and specific list structures). Do not copy the legacy document's formatting.
3. Extract relevant details from the imported document and fill them into the template's placeholder values (e.g. replacing '……', '.....', 'CLO..', 'PLO..', empty table cells, or blank areas).
4. If a piece of information or field in the template is not present in the imported document, keep the template's default placeholder value (e.g. keep '……' or '.....' or leave empty).
5. For tables with dynamic rows (e.g. lecturers, CLO mapping, weekly plan schedule, assessment plan items), you may add or remove rows as needed to represent all actual imported items, but you MUST preserve the exact columns, headers, and separator styles.
6. Silently ignore and discard any content in the imported document that does not map to any template field or block.

Here are the 10 blocks with their standard template structures and semantic matching descriptions:

1. "header" — Cover page / university header.
Matches: The document header/cover page area ONLY. Contains university name, department, title "ĐỀ CƯƠNG HỌC PHẦN", course name, course code, date.
Standard Template Structure (You MUST use this exact table and heading structure):
\`\`\`markdown
|  |  |
| --- | --- |
| TRƯỜNG ĐẠI HỌC NÔNG LÂM  **KHOA [Extracted Faculty, e.g. CÔNG NGHỆ THÔNG TIN or ……]** | CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM  **Độc lập – Tự do – Hạnh phúc**  *Thái nguyên, ngày…tháng…năm 2026* |

**ĐỀ CƯƠNG HỌC PHẦN**

**Tên học phần:** [Extracted Course Name, e.g. Tin học đại cương]

**Mã học phần:** [Extracted Course Code, e.g. CNTT101]
\`\`\`

2. "general_info" — Course metadata/administrative info.
Matches: Credits, prerequisites, course type, department, credit hour breakdown.
Standard Template Structure (You MUST use this exact list and table structure):
\`\`\`markdown
**1. Thông tin chung về học phần**

- Số tín chỉ: [Extracted credits or ……] Loại học phần: [Extracted type: bắt buộc, tự chọn or ……]
- Các học phần tiên quyết: [Extracted prerequisites or ……]
- Học phần học trước: [Extracted previous courses or ……]
- Các học phần song hành: [Extracted parallel courses or ……]
- Các yêu cầu đối với học phần (nếu có): [Extracted requirements or ……]
- Bộ môn (Khoa) phụ trách học phần: [Extracted department or ……]
- Số tiết quy đổi với các hoạt động:

|  |  |  |  |
| --- | --- | --- | --- |
| Nghe giảng lý thuyết: | [Extracted number or …..]tiết | Thảo luận: | [Extracted number or …..]tiết |
| Làm bài tập: | [Extracted number or …..]tiết | Thực hành, thí nghiệm: | [Extracted number or …..]tiết |
| Hoạt động theo nhóm: | [Extracted number or …..]tiết | Tự học: | [Extracted number or …..]tiết |
| Bài tập lớn (tiểu luận): | [Extracted number or …..]tiết | Tự học có hướng dẫn: | [Extracted number or …..]tiết |
\`\`\`

3. "lecturers" — Information about teaching staff.
Matches: Lecturer names, contact info (phone, email), academic credentials, office hours.
Standard Template Structure (Use this exact table format):
\`\`\`markdown
**2. Thông tin chung về các giảng viên**

|  |  |  |  |  |
| --- | --- | --- | --- | --- |
| **STT** | **Học hàm, học vị, họ tên** | **Số điện thoại** | **Email** | **Ghi chú** |
[Generate a table row for each lecturer found in the format: | [STT] | [Academic title + Full name] | [Phone] | [Email] | [Notes] |. If none found, output:
| 1 | PGS.TS. Nguyễn Văn A | 0912 | mail@tuaf.edu.vn |  |
| 2 |  |  |  |  |
| …. |  |  |  |  |
]
\`\`\`

4. "description" — Course description and objectives.
Matches: Course overview narrative, role in curriculum, general learning goals (kiến thức, kỹ năng, năng lực tự chủ) as narrative/bullet text (not mapping tables).
Standard Template Structure (You MUST use this format):
\`\`\`markdown
**3. Mô tả tóm tắt nội dung học phần, mục tiêu của học phần**

[Extracted course description narrative]

[Extracted course objectives / learning goals, formatted as a clear list or paragraphs]
\`\`\`

5. "clo" — Course Learning Outcomes (CLOs) and PLO mapping.
Matches: CLO table mapping (CLO1->PLO, CLO2->PLO), competency matrix tables, Bloom's level.
Standard Template Structure (Use this exact table and list format):
\`\`\`markdown
**4. Chuẩn đầu ra học phần**

Ma trận đóng góp của mục tiêu, chuẩn đầu ra của học phần và chuẩn đầu ra của chương trình đào tạo.

|  |  |  |  |  |
| --- | --- | --- | --- | --- |
| **Mục tiêu của HP** | **Thứ tự chuẩn đầu ra** | **Nội dung đầu ra HP** | **Chuẩn đầu ra chương trình đào tạo** | **Mức độ đóng góp** |
[Generate a table row for each CLO/CĐR found. If none found, output:
| CO1 | CLO1 |  | PLO1 |  |
| CO2 | CLO2 |  | PLO.. |  |
| CO3 | CLO3 |  | PLOn |  |
|  | …. | …….. | ….. | …. |
]

*Lưu ý:*
*- Chuẩn đầu ra học phần cần quy định cụ thể kiến thức, kỹ năng, năng lực tự chủ sinh viên đạt được.*
*- Mức năng lực được đánh giá theo thang Bloom (1= Nhớ; 2= Hiểu; 3= Ứng dụng; 4= Phân tích; 5= Đánh giá; 6= Sáng tạo).*
\`\`\`

6. "materials" — Textbooks, reference materials.
Matches: Textbooks, reference books, journals, library codes, online resources.
Standard Template Structure:
\`\`\`markdown
**5. Học liệu**

- Tài liệu học tập chính: [Extracted main books, list items]
- Tài liệu tham khảo: [Extracted reference books, list items]
- Học liệu điện từ (nếu có): [Extracted electronic links/materials or ……]

*Chú ý:*
- Tài liệu học tập phải đáp ứng yêu cầu của Thông tư số 35/2021/TT-BGDĐT ngày 06 tháng 12 năm 2021 của Bộ Giáo dục và Đào tạo.
- Tài liệu học tập chính phải có sự phê duyệt của Thủ trưởng cơ sở đào tạo.
- *Tài liệu tham khảo cần có mã số thư viện, trung tâm số ĐHTN hoặc đường link truy cập.*
\`\`\`

7. "student_tasks" — Student responsibilities.
Matches: Attendance rules (>=80%), lab/practice rules, essay/project rules, academic integrity.
Standard Template Structure:
\`\`\`markdown
**6. Nhiệm vụ của sinh viên**

Mô tả các yêu cầu đối với sinh viên theo quy định chung và đặc thù của học phần, bao gồm cả đạo đức học thuật.

**6.1. Phần lý thuyết, bài tập, thảo luận**
- Dự lớp ≥80% tổng số thời lượng của học phần, bao gồm cả thời gian học trực tuyến (nếu có).
- Chuẩn bị thảo luận.
- Hoàn thành các bài tập được giao trong sách bài tập, hệ thống LMS.

**6.2. Phần thí nghiệm, thực hành (nếu có)**
[Extracted or default:
- Các bài thí nghiệm, thực hành của học phần.
- Yêu cầu cần đạt đối với phần thí nghiệm, thực hành.
]

**6.3. Phần bài tập lớn, tiểu luận (nếu có)**
[Extracted or default:
- Tên bài tập lớn hoặc tiểu luận.
- Yêu cầu cần đạt, trong đó quy định rõ yêu cầu về liêm chính học thuật.
]

**6.4. Phần khác (nếu có)**
[Extracted or default:
Ví dụ như tham quan thực tế.
]
\`\`\`

8. "assessment" — Grading and evaluation plans.
Matches: Grade weights breakdown (attendance %, midterm %, final exam %), planning table, rubrics.
Standard Template Structure:
\`\`\`markdown
**7. Phương pháp kiểm tra, đánh giá người học và thang điểm**

**7.1. Kế hoạch kiểm tra**

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| **STT** | **Nội dung** | **Thời điểm (tiết thứ)** | **Chuẩn đầu ra được đánh giá** | **Phương pháp đánh giá** | **Công cụ đánh giá** | **Tỷ lệ %** |
[Generate rows for assessment items found. If none found, output:
| **I. Chuyên cần** | | | | | | **20%** |
| 1 | Đi học đầy đủ, tích cực tham gia các hoạt động trong giờ | | CLO.. | Quan sát | Rubric 1 | 30% |
| 2 | Trung bình các bài ôn tập LMS | | CLO.. | Trắc nghiệm | | 70% |
| .. | … | | | | | |
| **II. Kiểm tra quá trình** | | | | | | **30%** |
| 1 | | 12 | CLO.. | | | |
| 2 | | 30 | CLO.. | | | |
| … | …. | | | | | |
| **III. Thi cuối kỳ** | | | | | | **50%** |
| 1 | | | CLO.. | | | |
| 2 | | | CLO.. | | | |
| … | …. | | | | | |
]

*Lưu ý:* *Trọng số đánh giá hiện đang áp dụng*
* *Đối với bậc đại học: 20% chuyên cần; 30% quá trình và 50% cuối kỳ;*
* *Đối với bậc thạc sĩ: 20% chuyên cần; 20% quá trình và 60% cuối kỳ;*

**7.2. Các Rubric đánh giá chuẩn đầu ra của học phần**

**Rubric đánh giá học phần**

*Hướng dẫn: Rubric là một hình thức đánh giá chỉ rõ các tiêu chí đạt được trên tất cả các nhiệm vụ của người học. Với mỗi thành phần điểm (chuyên cần, quá trình, cuối kỳ), giảng viên chủ động chọn các Rubric phù hợp. Với mỗi Rubric, Thầy/Cô xác định trọng số của các tiêu chí đánh giá và tổng trọng số của các tiêu chí bằng 100%.. Ví dụ các Rubric: sự tham gia và tính chủ động trong các buổi học; tự luận; trắc nghiệm; vấn đáp; thuyết trình; tiểu luận; bài tập lớn... Trường hợp có nhiều Rubric, giảng viên xác định trọng số sao cho tổng trọng số của các Rubric bằng 100%.*

***Ví dụ: Các hình thức đánh giá khác nhau***

**Rubric 1: Sự tham gia và tính chủ động trong các buổi học**

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| **Tiêu chí đánh giá** | **Trọng số (%)** | **Giỏi (8,5-10)** | **Khá (7,0-8,4)** | **Trung bình (5,5-6,9)** | **Trung bình yếu (4,0-5,4)** | **Kém <4,0** |
| Tham dự các buổi học lý thuyết và thảo luận | 80% | Tham dự đầy đủ các buổi học lý thuyết và thực hành | Tham dự chỉ đạt khoảng 95% -99% các buổi học lý thuyết và thực hành | Tham dự chỉ đạt khoảng 90% -94% các buổi học lý thuyết và thực hành | Tham dự đạt khoảng 80% - 89% các buổi học lý thuyết và thực hành | Tham dự < 80% các buổi học lý thuyết và thực hành |
| Thái độ học giờ lý thuyết, thảo luận | 20% | Tích cực phát biểu xây dựng bài. Xung phong làm bài tập | Tương đối tích cực phát biểu xây dựng và có tinh thần xung phong làm bài tập tuy nhiên chất lượng câu trả lời chưa cao. | Chưa tích cực phát biểu xây dựng và xung phong làm bài tập. Giáo viên chỉ định mới trả lời. | Chỉ tham dự lớp học nhưng không tham gia phát biểu, xung phong làm bài. | Không hiểu bài và không trả lời được câu hỏi liên quan đến bài cũ. Làm việc riêng trong giờ học. |

**Rubric 2: Thuyết trình**

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| **Tiêu chí đánh giá** | **Trọng số (%)** | **Giỏi (8,5-10)** | **Khá (7,0-8,4)** | **Trung bình (5,5-6,9)** | **Trung bình yếu (4,0-5,4)** | **Kém <4,0** |
| | | | | | | |

**Rubric 3: Vấn đáp**

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| **Tiêu chí đánh giá** | **Trọng số (%)** | **Giỏi (8,5-10)** | **Khá (7,0-8,4)** | **Trung bình (5,5-6,9)** | **Trung bình yếu (4,0-5,4)** | **Kém <4,0** |
| | | | | | | |

**Rubric 4: Tiểu luận**

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| **Tiêu chí đánh giá** | **Trọng số (%)** | **Giỏi (8,5-10)** | **Khá (7,0-8,4)** | **Trung bình (5,5-6,9)** | **Trung bình yếu (4,0-5,4)** | **Kém <4,0** |
| | | | | | | |

**Rubric n: ..............**

|  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| **Tiêu chí đánh giá** | **Trọng số (%)** | **Giỏi (8,5-10)** | **Khá (7,0-8,4)** | **Trung bình (5,5-6,9)** | **Trung bình yếu (4,0-5,4)** | **Kém <4,0** |
| | | | | | | |
\`\`\`

9. "content_detail" — Weekly teaching schedule / Chapter breakdown.
Matches: Chapter/Lesson detailed schedule (hours, topics, CLOs, teaching/assessment methods, references).
Standard Template Structure (Use this exact 6-column markdown table. Do NOT alter columns):
\`\`\`markdown
**8. Nội dung chi tiết học phần**

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| **Tiết** | **Nội dung** | **Chuẩn đầu ra HP** | **Phương pháp dạy học** | **Phương pháp đánh giá** | **Tài liệu tham khảo** |
[Generate rows for chapters and sessions. Format MUST follow:
- Chapter row: |  | **Chương X: [Chapter Name]** |  |  |  |  |
- In-class teaching row: | [Periods, e.g. 1,2,3] | A. Nội dung trên lớp<br>1. [Topic 1]<br>2. [Topic 2] | [CLO, e.g. CLO1] | [Teaching methods, e.g. Thuyết trình] | [Assessment, e.g. Kiểm tra viết giữa kỳ] | [References, e.g. 1, trang 1-15] |
- Self-study row: |  | B. Nội dung tự học<br>1. [Task 1]<br>2. [Task 2] | [CLO, e.g. CLO1] | Tự học có hướng dẫn | Đánh giá chuyên cần | [References, e.g. 3, trang 3-10] |
]
\`\`\`

10. "update_log" — Revision log and signature block.
Matches: Revision dates, approver blocks, TRƯỜNG KHOA / TRƯỞNG BỘ MÔN / GIẢNG VIÊN signatures.
Standard Template Structure:
\`\`\`markdown
**9. Thời điểm ban hành đề cương chi tiết học phần**

**10. Tiến trình cập nhật đề cương chi tiết (hàng năm)**

|  |  |
| --- | --- |
| **Lần 1:** Tóm tắt nội dung cập nhật ĐCCT lần 1: *ngày .. tháng .. năm..*<br>- Lý do cập nhật, bổ sung | <Người cập nhật ký và ghi rõ họ tên)<br>Trưởng Bộ môn: |
| **Lần 2:** Tóm tắt nội dung cập nhật ĐCCT lần 2: *ngày .. tháng .. năm..*<br>- Lý do cập nhật, bổ sung | <Người cập nhật ký và ghi rõ họ tên)<br>Trưởng Bộ môn: |
| **Lần …:** | <Người cập nhật ký và ghi rõ họ tên)<br>Trưởng Bộ môn: |

|  |  |  |
| --- | --- | --- |
| **TRƯỜNG KHOA** | **TRƯỞNG BỘ MÔN** | **GIẢNG VIÊN BIÊN SOẠN** |
\`\`\`

Output ONLY a JSON mapping from blockType to its reconstructed markdown content. Do not enclose in code fences.`;

/** Valid block types for mapping */


@Injectable()
export class SyllabusService {
    private readonly logger = new Logger(SyllabusService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly aiProvider: AiProviderService,
        private readonly markItDown: MarkItDownService,
        private readonly mermaid: MermaidService,
        private readonly imagen: ImagenService,
        private readonly fileStorage: FileStorageService,
        private readonly apiKeysService: ApiKeysService,
        private readonly referenceRag: ReferenceRagService,
    ) {}

    /**
     * Get subject name by ID (for export filename).
     */
    async getSubjectName(subjectId: string): Promise<string> {
        const subject = await this.prisma.subject.findUnique({
            where: { id: subjectId },
            select: { name: true },
        });
        return subject?.name || 'Unnamed';
    }

    /**
     * Get a SyllabusLesson by ID.
     */
    async getSyllabusLessonById(lessonId: string) {
        return this.prisma.syllabusLesson.findUnique({
            where: { id: lessonId },
        });
    }

    /**
     * Get a Syllabus by ID.
     */
    async getSyllabusById(syllabusId: string) {
        return this.prisma.syllabus.findUnique({
            where: { id: syllabusId },
        });
    }

    /**
     * Create a new syllabus for a subject with 10 default blocks.
     */
    async createSyllabus(subjectId: string) {
        return this.prisma.syllabus.create({
            data: {
                subjectId,
                blocks: {
                    create: DEFAULT_BLOCKS.map((b) => ({
                        blockType: b.blockType,
                        title: b.title,
                        content: (b as any).defaultContent || '',
                        sortOrder: b.sortOrder,
                    })),
                },
            },
            include: {
                blocks: { orderBy: { sortOrder: 'asc' } },
                references: true,
                lessons: {
                    orderBy: { sortOrder: 'asc' },
                    include: { lesson: { select: { id: true, title: true, status: true } } },
                },
            },
        });
    }

    /**
     * Delete an entire syllabus (cascade deletes blocks, lessons, references).
     */
    async deleteSyllabus(subjectId: string, userId: string) {
        const subject = await this.prisma.subject.findUnique({
            where: { id: subjectId },
            select: { userId: true },
        });
        if (!subject) {
            throw new BadRequestException('Môn học không tồn tại.');
        }
        if (subject.userId !== userId) {
            throw new ForbiddenException('Bạn không có quyền xóa đề cương này.');
        }
        const syllabus = await this.prisma.syllabus.findUnique({ where: { subjectId } });
        if (!syllabus) {
            throw new BadRequestException('Chưa có đề cương để xóa.');
        }
        await this.prisma.syllabus.delete({ where: { id: syllabus.id } });
        this.logger.log(`Deleted syllabus for subject ${subjectId}`);
        return { success: true, message: 'Đã xóa đề cương thành công.' };
    }

    /**
     * Get syllabus for a subject (null if none exists).
     */
    async getSyllabus(subjectId: string) {
        return this.prisma.syllabus.findUnique({
            where: { subjectId },
            include: {
                blocks: { orderBy: { sortOrder: 'asc' } },
                references: { orderBy: { createdAt: 'desc' } },
                lessons: {
                    orderBy: { sortOrder: 'asc' },
                    include: { lesson: { select: { id: true, title: true, status: true } } },
                },
            },
        });
    }

    /**
     * Update a single block.
     */
    async updateBlock(blockId: string, data: { title?: string; content?: string; metadata?: any }) {
        return this.prisma.syllabusBlock.update({
            where: { id: blockId },
            data,
        });
    }

    /**
     * Bulk update all blocks for a syllabus.
     */
    async updateBlocks(syllabusId: string, blocks: { id: string; title?: string; content?: string; metadata?: any }[]) {
        const updates = blocks.map((b) =>
            this.prisma.syllabusBlock.update({
                where: { id: b.id },
                data: {
                    ...(b.title !== undefined && { title: b.title }),
                    ...(b.content !== undefined && { content: b.content }),
                    ...(b.metadata !== undefined && { metadata: b.metadata }),
                },
            }),
        );
        return this.prisma.$transaction(updates);
    }

    // ==================== References ====================

    /**
     * Upload a reference file, convert via MarkItDown, save to DB.
     */
    async uploadReference(syllabusId: string, userId: string, file: Express.Multer.File) {
        this.logger.log(`Uploading reference for syllabus ${syllabusId}: ${file.originalname}`);

        // Step 0: Validate syllabus existence and ownership
        const syllabus = await this.prisma.syllabus.findUnique({
            where: { id: syllabusId },
            include: { subject: { select: { userId: true } } },
        });
        if (!syllabus) {
            throw new BadRequestException('Đề cương không tồn tại hoặc đã bị xóa. Vui lòng tải lại trang.');
        }
        if (syllabus.subject.userId !== userId) {
            throw new ForbiddenException('Bạn không có quyền truy cập đề cương này.');
        }

        // Save file to disk
        const { writeFile, mkdir } = await import('fs/promises');
        const { join } = await import('path');
        const dir = join(process.cwd(), 'uploads', 'syllabus-refs', syllabusId);
        await mkdir(dir, { recursive: true });

        const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = join(dir, safeName);
        await writeFile(filePath, file.buffer);
        const fileUrl = `/uploads/syllabus-refs/${syllabusId}/${safeName}`;

        // Create DB record as pending
        const ref = await this.prisma.syllabusReference.create({
            data: {
                syllabusId,
                fileName: file.originalname,
                fileUrl,
                fileSize: file.size,
                status: 'processing',
            },
        });

        // Convert via MarkItDown asynchronously in the background to prevent HTTP timeouts
        this.markItDown.convertToMarkdown(file.buffer, file.originalname)
            .then(async (markdown) => {
                await this.prisma.syllabusReference.update({
                    where: { id: ref.id },
                    data: { markdownContent: markdown, status: 'done' },
                });
                this.logger.log(`Reference ${ref.id}: MarkItDown done (${markdown.length} chars)`);
            })
            .catch(async (err) => {
                this.logger.error(`Reference ${ref.id}: MarkItDown failed: ${err.message}`);
                await this.prisma.syllabusReference.update({
                    where: { id: ref.id },
                    data: { status: 'error' },
                });
            });

        return ref;
    }

    /**
     * List all references for a syllabus.
     */
    async listReferences(syllabusId: string) {
        return this.prisma.syllabusReference.findMany({
            where: { syllabusId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                fileName: true,
                fileUrl: true,
                fileSize: true,
                status: true,
                createdAt: true,
                // Don't return markdownContent in list — it can be huge
            },
        });
    }

    /**
     * Get a single reference with full markdown content.
     */
    async getReference(refId: string) {
        return this.prisma.syllabusReference.findUnique({
            where: { id: refId },
        });
    }

    /**
     * Delete a reference (DB + file).
     */
    async deleteReference(refId: string) {
        const ref = await this.prisma.syllabusReference.findUnique({ where: { id: refId } });
        if (!ref) return;

        // Delete file from disk
        try {
            const { unlink } = await import('fs/promises');
            const { join } = await import('path');
            const filePath = join(process.cwd(), ref.fileUrl);
            await unlink(filePath);
        } catch {
            // File may not exist — that's OK
        }

        return this.prisma.syllabusReference.delete({ where: { id: refId } });
    }

    /**
     * Import DOCX syllabus: MarkItDown → AI parse → fill blocks.
     *
     * Flow:
     * 1. If syllabus doesn't exist, create it with defaults.
     * 2. Convert DOCX to markdown via MarkItDown CLI.
     * 3. Send markdown to AI to parse into 10 block mappings.
     * 4. Bulk update blocks with parsed content.
     * 5. Return updated syllabus.
     */
    async importFromDocx(subjectId: string, userId: string, file: Express.Multer.File, modelName: string, callUserId?: string) {
        this.logger.log(`Importing DOCX syllabus for subject ${subjectId}: ${file.originalname}`);

        // Step 0: Validate subject existence and ownership
        const subject = await this.prisma.subject.findUnique({
            where: { id: subjectId },
            select: { userId: true },
        });
        if (!subject) {
            throw new BadRequestException('Môn học không tồn tại hoặc đã bị xóa. Vui lòng tải lại trang.');
        }
        if (subject.userId !== userId) {
            throw new ForbiddenException('Bạn không có quyền truy cập môn học này.');
        }

        // Step 1: Ensure syllabus exists
        let syllabus = await this.getSyllabus(subjectId);
        if (!syllabus) {
            syllabus = await this.createSyllabus(subjectId) as NonNullable<typeof syllabus>;
        }
        if (!syllabus) {
            throw new BadRequestException('Không thể tạo đề cương');
        }

        // Update status to 'importing' synchronously
        await this.prisma.syllabus.update({
            where: { id: syllabus.id },
            data: { status: 'importing' },
        });

        // Run the heavy lifting in background
        this.runImportBackground(syllabus.id, subjectId, file, modelName, callUserId)
            .catch((err) => {
                this.logger.error(`Failed during async import setup: ${err.message}`);
            });

        // Return current syllabus with status 'importing' immediately
        return this.getSyllabus(subjectId);
    }

    private async runImportBackground(
        syllabusId: string,
        subjectId: string,
        file: Express.Multer.File,
        modelName: string,
        callUserId?: string
    ) {
        const updateStatus = async (status: string) => {
            await this.prisma.syllabus.update({
                where: { id: syllabusId },
                data: { status },
            });
        };

        try {
            // Step 1: Convert DOCX to markdown
            await updateStatus('importing:converting');
            const markdown = await this.markItDown.convertToMarkdown(file.buffer, file.originalname);
            this.logger.log(`MarkItDown output: ${markdown.length} chars`);

            // Step 2: AI parse into blocks
            await updateStatus('importing:parsing');
            const userPrompt = `Parse the following syllabus document into the 10 standard blocks:\n\n${markdown}`;

            const aiResult = await this.aiProvider.generateTextWithSystem(
                SYLLABUS_PARSE_SYSTEM_PROMPT,
                userPrompt,
                modelName,
                callUserId,
            );

            // Step 3: Parse AI response as JSON
            await updateStatus('importing:filling');
            let blockMapping: Record<string, string>;
            // Strip markdown code fences if present
            let jsonStr = aiResult.content.trim();
            if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            }
            blockMapping = JSON.parse(jsonStr);

            // Fetch current syllabus blocks to map
            const syllabus = await this.prisma.syllabus.findUnique({
                where: { id: syllabusId },
                include: { blocks: true },
            });

            if (syllabus) {
                // Step 4: Map parsed content to existing blocks one by one with progress
                const blockTypes = syllabus.blocks.map(b => b.blockType);
                let filledCount = 0;
                for (const block of syllabus.blocks) {
                    const content = blockMapping[block.blockType];
                    if (content !== undefined && content.trim().length > 0) {
                        await this.prisma.syllabusBlock.update({
                            where: { id: block.id },
                            data: { content },
                        });
                        filledCount++;
                        await updateStatus(`importing:block_${filledCount}_${blockTypes.length}`);
                    }
                }
                this.logger.log(`Async Imported ${filledCount}/${syllabus.blocks.length} blocks from DOCX`);
            }
        } catch (error: any) {
            this.logger.error(`Async DOCX import failed: ${error.message}`);
            await updateStatus('importing:error');
            // Wait 3s so frontend can see the error status before resetting
            await new Promise(r => setTimeout(r, 3000));
        } finally {
            // Always restore status to 'draft' so client knows it's finished
            await this.prisma.syllabus.update({
                where: { id: syllabusId },
                data: { status: 'draft' },
            });
        }
    }

    // ==================== AI Lesson Splitting ====================

    /**
     * AI-split content_detail into N lessons with title + outline.
     * Clears existing lessons before generating new ones.
     */
    async generateLessons(
        syllabusId: string,
        numberOfLessons: number | undefined,
        modelName: string,
        userId?: string,
        theoryLessons?: number,
        practiceLessons?: number,
    ) {
        this.logger.log(`Generating lessons for syllabus ${syllabusId}`);

        const syllabus = await this.prisma.syllabus.findUnique({
            where: { id: syllabusId },
            include: {
                blocks: true,
                references: { where: { status: 'done' }, select: { markdownContent: true, fileName: true } },
            },
        });

        if (!syllabus) {
            throw new BadRequestException('Syllabus not found');
        }

        // Find relevant blocks
        const contentBlock = syllabus.blocks.find((b) => b.blockType === 'content_detail');
        const objectivesBlock = syllabus.blocks.find((b) => b.blockType === 'course_objectives');
        const infoBlock = syllabus.blocks.find((b) => b.blockType === 'general_info');

        if (!contentBlock?.content?.trim()) {
            throw new BadRequestException(
                'Chưa có nội dung chi tiết học phần (block 8). Hãy điền hoặc import đề cương trước.',
            );
        }

        // Build context
        let context = `## NỘI DUNG CHI TIẾT HỌC PHẦN\n${contentBlock.content}\n\n`;
        if (objectivesBlock?.content?.trim()) {
            context += `## MỤC TIÊU HỌC PHẦN\n${objectivesBlock.content}\n\n`;
        }
        if (infoBlock?.content?.trim()) {
            context += `## THÔNG TIN CHUNG\n${infoBlock.content}\n\n`;
        }

        // Add reference summaries (first 2000 chars each, max 3)
        const refs = syllabus.references.slice(0, 3);
        for (const ref of refs) {
            if (ref.markdownContent) {
                context += `## TÀI LIỆU: ${ref.fileName}\n${ref.markdownContent.slice(0, 2000)}\n\n`;
            }
        }

        let countInstruction = '';
        if (numberOfLessons && numberOfLessons > 0) {
            countInstruction = `\n\nYÊU CẦU QUAN TRỌNG: Bạn PHẢI tạo chính xác ${numberOfLessons} bài giảng.`;
        } else if (theoryLessons !== undefined || practiceLessons !== undefined) {
            const total = (theoryLessons || 0) + (practiceLessons || 0);
            countInstruction = `\n\nYÊU CẦU QUAN TRỌNG: Bạn PHẢI tạo chính xác ${total} bài giảng.`;
        } else {
            countInstruction = `\n\nYÊU CẦU QUAN TRỌNG: Số lượng bài giảng mặc định là số tín chỉ * 4 (ví dụ 3 tín chỉ = 12 bài). Hãy tìm thông tin số tín chỉ trong phần THÔNG TIN CHUNG và tạo số lượng bài tương ứng.`;
        }

        if (theoryLessons !== undefined && theoryLessons > 0) {
            countInstruction += ` Trong đó phải có chính xác ${theoryLessons} bài Lý thuyết (ghi rõ 'Lý thuyết' trong tiêu đề bài nếu thích hợp, hoặc phân bổ hợp lý theo đề cương).`;
        }
        if (practiceLessons !== undefined && practiceLessons > 0) {
            countInstruction += ` Trong đó phải có chính xác ${practiceLessons} bài Thực hành/Thảo luận (ghi rõ 'Thực hành' hoặc 'Thảo luận' trong tiêu đề bài).`;
        }

        // AI call
        let aiResult;
        try {
            aiResult = await this.aiProvider.generateTextWithSystem(
                LESSON_SPLIT_SYSTEM_PROMPT,
                `Phân chia nội dung học phần sau thành các bài giảng:${countInstruction}\n\n${context}`,
                modelName,
                userId,
            );
        } catch (error: any) {
            this.logger.error(`AI generate failed: ${error.message}`);
            throw new BadRequestException(`Lỗi AI: ${error.message || 'Không có mô hình AI khả dụng. Vui lòng kiểm tra lại cấu hình Model hoặc API Key.'}`);
        }

        // Parse JSON response
        let lessons: { title: string; outline: string }[];
        try {
            let jsonStr = aiResult.content.trim();
            if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            }
            lessons = JSON.parse(jsonStr);
            if (!Array.isArray(lessons)) {
                throw new Error('Expected array');
            }
        } catch (err) {
            this.logger.error(`Failed to parse AI lesson split: ${err}`);
            throw new BadRequestException('AI không thể phân chia bài giảng. Vui lòng thử lại.');
        }

        // Clear existing lessons
        await this.prisma.syllabusLesson.deleteMany({ where: { syllabusId } });

        // Create new lessons
        const created = await this.prisma.$transaction(
            lessons.map((l, idx) =>
                this.prisma.syllabusLesson.create({
                    data: {
                        syllabusId,
                        sortOrder: idx,
                        title: l.title,
                        outline: l.outline,
                    },
                }),
            ),
        );

        this.logger.log(`Generated ${created.length} lessons for syllabus ${syllabusId}`);
        return created;
    }

    /**
     * Clear all generated lessons for a syllabus.
     */
    async clearLessons(syllabusId: string) {
        return this.prisma.syllabusLesson.deleteMany({ where: { syllabusId } });
    }

    /**
     * Update a single lesson (title, outline).
     */
    async updateLesson(lessonId: string, data: { title?: string; outline?: string }) {
        return this.prisma.syllabusLesson.update({
            where: { id: lessonId },
            data,
        });
    }

    /**
     * Reorder lessons within a syllabus.
     */
    async reorderLessons(syllabusId: string, userId: string, lessonIds: string[]) {
        this.logger.log(`Reordering lessons for syllabus ${syllabusId}`);

        // Validate ownership
        const syllabus = await this.prisma.syllabus.findUnique({
            where: { id: syllabusId },
            include: { subject: { select: { userId: true } } },
        });
        if (!syllabus) {
            throw new BadRequestException('Đề cương không tồn tại.');
        }
        if (syllabus.subject.userId !== userId) {
            throw new ForbiddenException('Bạn không có quyền chỉnh sửa đề cương này.');
        }

        const updates = lessonIds.map((id, idx) =>
            this.prisma.syllabusLesson.update({
                where: { id },
                data: { sortOrder: idx },
            }),
        );
        await this.prisma.$transaction(updates);
        return this.getSyllabusLessons(syllabusId);
    }

    /**
     * Helper to get lessons of a syllabus.
     */
    async getSyllabusLessons(syllabusId: string) {
        return this.prisma.syllabusLesson.findMany({
            where: { syllabusId },
            orderBy: { sortOrder: 'asc' },
            include: { lesson: { select: { id: true, title: true, status: true } } },
        });
    }

    // ==================== Lesson Bridge ====================

    /**
     * Create a Lesson in the existing workflow from a SyllabusLesson.
     * Pre-fills title + outline. Links via SyllabusLesson.lessonId.
     */
    async createLessonBridge(syllabusLessonId: string) {
        const sl = await this.prisma.syllabusLesson.findUnique({
            where: { id: syllabusLessonId },
            include: { syllabus: true },
        });

        if (!sl) {
            throw new BadRequestException('SyllabusLesson not found');
        }

        if (sl.lessonId) {
            throw new BadRequestException('Bài giảng này đã được tạo. Không thể tạo trùng.');
        }

        // Create the Lesson
        const lesson = await this.prisma.lesson.create({
            data: {
                subjectId: sl.syllabus.subjectId,
                title: sl.title,
                outlineRaw: sl.outline,
                status: 'DRAFT',
            },
        });

        // Link SyllabusLesson → Lesson
        await this.prisma.syllabusLesson.update({
            where: { id: syllabusLessonId },
            data: { lessonId: lesson.id },
        });

        this.logger.log(`Bridge: Created Lesson ${lesson.id} from SyllabusLesson ${syllabusLessonId}`);

        return {
            lesson,
            syllabusLessonId,
        };
    }

    // ==================== Textbook Generation ====================

    /**
     * AI-generate textbook chapter content for a SyllabusLesson.
     */
    async generateTextbook(syllabusLessonId: string, modelName: string, userId?: string) {
        this.logger.log(`Generating textbook for SyllabusLesson ${syllabusLessonId}`);

        const sl = await this.prisma.syllabusLesson.findUnique({
            where: { id: syllabusLessonId },
            include: {
                syllabus: {
                    include: {
                        blocks: true,
                        references: {
                            where: { status: 'done' },
                            select: { markdownContent: true, fileName: true },
                        },
                    },
                },
            },
        });

        if (!sl) {
            throw new BadRequestException('SyllabusLesson not found');
        }

        // Set status to generating
        await this.prisma.syllabusLesson.update({
            where: { id: syllabusLessonId },
            data: { textbookStatus: 'generating' },
        });

        try {
            // Build context
            const objectivesBlock = sl.syllabus.blocks.find((b) => b.blockType === 'course_objectives');
            const descBlock = sl.syllabus.blocks.find((b) => b.blockType === 'description');

            let context = `## BÀI GIẢNG: ${sl.title}\n\n`;
            context += `## ĐỀ CƯƠNG BÀI\n${sl.outline}\n\n`;

            if (objectivesBlock?.content?.trim()) {
                context += `## MỤC TIÊU HỌC PHẦN\n${objectivesBlock.content}\n\n`;
            }
            if (descBlock?.content?.trim()) {
                context += `## MÔ TẢ HỌC PHẦN\n${descBlock.content}\n\n`;
            }

            // Add reference summaries (max 3, first 3000 chars each)
            const refs = sl.syllabus.references.slice(0, 3);
            for (const ref of refs) {
                if (ref.markdownContent) {
                    context += `## TÀI LIỆU: ${ref.fileName}\n${ref.markdownContent.slice(0, REF_CHAR_LIMIT)}\n\n`;
                }
            }

            // AI call
            let aiResult;
            try {
                aiResult = await this.aiProvider.generateTextWithSystem(
                    TEXTBOOK_SYSTEM_PROMPT,
                    `Viết nội dung textbook cho bài giảng sau:\n\n${context}`,
                    modelName,
                    userId,
                );
            } catch (error: any) {
                this.logger.error(`AI generate failed: ${error.message}`);
                throw new BadRequestException(`Lỗi AI: ${error.message || 'Không có mô hình AI khả dụng. Vui lòng kiểm tra lại cấu hình Model hoặc API Key.'}`);
            }

            const content = aiResult.content.trim();

            await this.prisma.syllabusLesson.update({
                where: { id: syllabusLessonId },
                data: {
                    textbookContent: content,
                    textbookStatus: 'done',
                },
            });

            this.logger.log(`Textbook done for ${syllabusLessonId}: ${content.length} chars`);
            return this.prisma.syllabusLesson.findUnique({ where: { id: syllabusLessonId } });
        } catch (err: any) {
            this.logger.error(`Textbook generation failed: ${err.message}`);
            await this.prisma.syllabusLesson.update({
                where: { id: syllabusLessonId },
                data: { textbookStatus: 'error' },
            });
            throw new BadRequestException(`AI textbook generation failed: ${err.message}`);
        }
    }

    /**
     * Save edited textbook content for a SyllabusLesson.
     */
    async saveTextbookContent(lessonId: string, textbookContent: string) {
        return this.prisma.syllabusLesson.update({
            where: { id: lessonId },
            data: { textbookContent, textbookStatus: 'done' },
        });
    }

    /**
     * Get current textbook generation status for polling.
     */
    async getTextbookStatus(lessonId: string) {
        const sl = await this.prisma.syllabusLesson.findUnique({
            where: { id: lessonId },
            select: { textbookPhase: true, textbookStatus: true },
        });
        if (!sl) return null;

        const phaseProgress: Record<string, number> = {
            extracting: 10, planning: 30, writing: 50, illustrating: 70, reviewing: 90, done: 100, error: 0,
        };
        const phaseMessages: Record<string, string> = {
            extracting: 'Trích xuất tài liệu tham khảo...',
            planning: 'Lập kế hoạch bài viết (Backward Design)...',
            writing: 'Viết nội dung chương...',
            illustrating: 'Tạo sơ đồ & hình minh họa...',
            reviewing: 'Kiểm tra & hiệu chỉnh chất lượng...',
            done: 'Hoàn thành!',
            error: 'Lỗi trong quá trình tạo',
        };

        const phase = sl.textbookPhase || 'none';
        return {
            phase,
            status: sl.textbookStatus,
            progress: phaseProgress[phase] ?? 0,
            message: phaseMessages[phase] ?? '',
        };
    }

    // ==================== Multi-Phase Textbook Pipeline ====================

    /**
     * Kick off the Textbook Pro pipeline in the background and return immediately.
     * The pipeline can take several minutes; running it synchronously causes the
     * HTTP connection to be closed by proxies (net::ERR_EMPTY_RESPONSE). The client
     * tracks progress via getTextbookStatus polling (phase 'done' / 'error').
     */
    async startTextbookPro(lessonId: string, modelName: string, imageModelName: string | undefined, userId?: string, embeddingModelName?: string) {
        const sl = await this.prisma.syllabusLesson.findUnique({
            where: { id: lessonId },
            select: { id: true },
        });
        if (!sl) throw new BadRequestException('SyllabusLesson not found');

        // Set initial phase synchronously so the first poll reflects progress
        await this.updatePhase(lessonId, 'generating', 'extracting');

        // Fire-and-forget; errors are recorded into textbookPhase='error' by the pipeline
        this.generateTextbookPro(lessonId, modelName, imageModelName, userId, embeddingModelName).catch((err: any) => {
            this.logger.error(`[TextbookPro] background pipeline failed: ${err.message}`);
        });

        return { started: true, phase: 'extracting', status: 'generating' };
    }

    /**
     * AI-generate textbook using 5-step pipeline:
     * EXTRACT → PLAN → WRITE → ILLUSTRATE → REVIEW+FIX
     */
    async generateTextbookPro(syllabusLessonId: string, modelName: string, imageModelName?: string, userId?: string, embeddingModelName?: string) {
        this.logger.log(`[TextbookPro] Starting 5-step pipeline for ${syllabusLessonId}`);

        const sl = await this.prisma.syllabusLesson.findUnique({
            where: { id: syllabusLessonId },
            include: {
                syllabus: {
                    include: {
                        blocks: true,
                        references: { where: { status: 'done' }, select: { id: true, markdownContent: true, fileName: true } },
                    },
                },
            },
        });

        if (!sl) throw new BadRequestException('SyllabusLesson not found');

        const syllabusId = sl.syllabusId;

        // Set initial status
        await this.updatePhase(syllabusLessonId, 'generating', 'extracting');

        try {
            // Build base context
            const objectivesBlock = sl.syllabus.blocks.find((b) => b.blockType === 'clo');
            const descBlock = sl.syllabus.blocks.find((b) => b.blockType === 'description');

            let baseContext = `## BÀI GIẢNG: ${sl.title}\n\n## ĐỀ CƯƠNG BÀI\n${sl.outline}\n\n`;
            if (objectivesBlock?.content?.trim()) {
                baseContext += `## CHUẨN ĐẦU RA HỌC PHẦN\n${objectivesBlock.content}\n\n`;
            }
            if (descBlock?.content?.trim()) {
                baseContext += `## MÔ TẢ HỌC PHẦN\n${descBlock.content}\n\n`;
            }

            // ── Step 0: EXTRACT (RAG retrieval, fallback to AI-extract) ──
            this.logger.log(`[TextbookPro] Step 0: EXTRACT references (embeddingModel=${embeddingModelName || 'none'})`);
            let relevantRefs = '';
            const refs = sl.syllabus.references.slice(0, 3);

            // Path 1: RAG — chunk + embed + retrieve top-k relevant passages.
            let ragSucceeded = false;
            if (embeddingModelName && refs.length > 0) {
                try {
                    for (const ref of refs) {
                        if (!ref.markdownContent) continue;
                        await this.referenceRag.indexReference(ref.id, embeddingModelName, userId);
                    }
                    const query = `${sl.title}\n${sl.outline}`;
                    const hits = await this.referenceRag.retrieve(syllabusId, query, embeddingModelName, userId, 12);
                    if (hits.length > 0) {
                        // Group retrieved chunks by source file.
                        const byFile = new Map<string, string[]>();
                        for (const h of hits) {
                            if (!byFile.has(h.fileName)) byFile.set(h.fileName, []);
                            byFile.get(h.fileName)!.push(h.content);
                        }
                        for (const [fileName, contents] of byFile) {
                            relevantRefs += `\n## TÀI LIỆU THAM KHẢO: ${fileName}\n${contents.join('\n\n---\n\n')}\n`;
                        }
                        ragSucceeded = true;
                        this.logger.log(`[TextbookPro] RAG retrieved ${hits.length} chunks → ${relevantRefs.length} chars`);
                    }
                } catch (err: any) {
                    this.logger.warn(`[TextbookPro] RAG failed, falling back to AI-extract: ${err.message}`);
                }
            }

            // Path 2: Fallback — AI extracts relevant passages from truncated text.
            if (!ragSucceeded && refs.length > 0) {
                for (const ref of refs) {
                    if (!ref.markdownContent) continue;
                    try {
                        const extractResult = await this.aiProvider.generateTextWithSystem(
                            EXTRACT_PROMPT,
                            `BÀI GIẢNG: "${sl.title}"\nĐỀ CƯƠNG: ${sl.outline}\n\nTÀI LIỆU (${ref.fileName}):\n${ref.markdownContent.slice(0, REF_CHAR_LIMIT)}`,
                            modelName, userId,
                        );
                        if (!extractResult.content.includes('KHÔNG CÓ NỘI DUNG LIÊN QUAN')) {
                            relevantRefs += `\n## TÀI LIỆU THAM KHẢO: ${ref.fileName}\n${extractResult.content}\n`;
                        }
                    } catch (err: any) {
                        this.logger.warn(`[TextbookPro] EXTRACT failed for ${ref.fileName}: ${err.message}`);
                    }
                }
            }
            this.logger.log(`[TextbookPro] Extracted ${relevantRefs.length} chars of relevant references`);

            // ── Step 1: PLAN ──
            await this.updatePhase(syllabusLessonId, 'generating', 'planning');
            this.logger.log(`[TextbookPro] Step 1: PLAN (Backward Design)`);

            const planResult = await this.aiProvider.generateTextWithSystem(
                PLAN_PROMPT,
                `${baseContext}\n${relevantRefs ? `## TÀI LIỆU THAM KHẢO ĐÃ TRÍCH\n${relevantRefs}\n` : ''}`,
                modelName, userId,
            );

            // Save plan
            let planJson = planResult.content.trim();
            if (planJson.startsWith('```')) {
                planJson = planJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            }
            await this.prisma.syllabusLesson.update({
                where: { id: syllabusLessonId },
                data: { textbookPlan: planJson },
            });

            // ── Step 2: WRITE ──
            await this.updatePhase(syllabusLessonId, 'generating', 'writing');
            this.logger.log(`[TextbookPro] Step 2: WRITE draft`);

            const writeResult = await this.aiProvider.generateTextWithSystem(
                WRITE_PROMPT,
                `## KẾ HOẠCH BÀI VIẾT (PLAN)\n${planJson}\n\n${baseContext}\n${relevantRefs ? `## TÀI LIỆU THAM KHẢO\n${relevantRefs}\n` : ''}`,
                modelName, userId,
            );
            let draft = writeResult.content.trim();

            // ── Step 3: ILLUSTRATE ──
            await this.updatePhase(syllabusLessonId, 'generating', 'illustrating');
            this.logger.log(`[TextbookPro] Step 3: ILLUSTRATE`);

            try {
                draft = await this.illustrateTextbook(draft, syllabusId, syllabusLessonId, modelName, imageModelName, userId);
            } catch (err: any) {
                this.logger.warn(`[TextbookPro] ILLUSTRATE failed (non-fatal): ${err.message}`);
            }

            // ── Step 4: REVIEW + FIX ──
            await this.updatePhase(syllabusLessonId, 'generating', 'reviewing');
            this.logger.log(`[TextbookPro] Step 4: REVIEW + FIX`);

            const reviewResult = await this.aiProvider.generateTextWithSystem(
                REVIEW_FIX_PROMPT,
                `${relevantRefs ? `## TÀI LIỆU THAM KHẢO (đối chiếu tính chính xác)\n${relevantRefs}\n\n` : ''}BÀI VIẾT CẦN KIỂM TRA:\n\n${draft}`,
                modelName, userId,
            );
            const finalContent = reviewResult.content.trim();

            // ── Done ──
            await this.prisma.syllabusLesson.update({
                where: { id: syllabusLessonId },
                data: {
                    textbookContent: finalContent,
                    textbookStatus: 'done',
                    textbookPhase: 'done',
                },
            });

            this.logger.log(`[TextbookPro] ✅ Complete: ${finalContent.length} chars`);
            return this.prisma.syllabusLesson.findUnique({ where: { id: syllabusLessonId } });

        } catch (err: any) {
            this.logger.error(`[TextbookPro] Pipeline failed: ${err.message}`);
            await this.updatePhase(syllabusLessonId, 'error', 'error');
            throw new BadRequestException(`Textbook Pro failed: ${err.message}`);
        }
    }

    private async updatePhase(lessonId: string, status: string, phase: string) {
        await this.prisma.syllabusLesson.update({
            where: { id: lessonId },
            data: { textbookStatus: status, textbookPhase: phase },
        });
    }

    /**
     * ILLUSTRATE step: parse markers, generate images, replace in markdown.
     */
    private async illustrateTextbook(
        draft: string, syllabusId: string, lessonId: string,
        modelName: string, imageModelName?: string, userId?: string,
    ): Promise<string> {
        // Ask AI to create illustration specs
        const illustrateResult = await this.aiProvider.generateTextWithSystem(
            ILLUSTRATE_PROMPT, `BÀI VIẾT:\n\n${draft}`, modelName, userId,
        );

        let illustrations: Array<{ position: string; type: string; caption: string; content: string }>;
        try {
            let jsonStr = illustrateResult.content.trim();
            if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            }
            illustrations = JSON.parse(jsonStr);
            if (!Array.isArray(illustrations)) illustrations = [];
        } catch {
            this.logger.warn('[TextbookPro] Could not parse ILLUSTRATE response');
            return draft;
        }

        if (illustrations.length === 0) return draft;

        // Limit to 5
        illustrations = illustrations.slice(0, 5);

        const imageRecords: Array<{ url: string; caption: string; type: string }> = [];
        const markdownInserts: string[] = [];

        for (let i = 0; i < illustrations.length; i++) {
            const ill = illustrations[i];
            const idx = String(i + 1).padStart(3, '0');
            try {
                if (ill.type === 'mermaid') {
                    const png = await this.mermaid.renderToPng(ill.content);
                    const filename = `diagram_${idx}.png`;
                    const { publicUrl } = await this.fileStorage.saveTextbookAsset(syllabusId, lessonId, png, filename);
                    markdownInserts.push(`\n![${ill.caption}](${publicUrl})\n`);
                    imageRecords.push({ url: publicUrl, caption: ill.caption, type: 'mermaid' });
                } else if (ill.type === 'ai_image') {
                    const geminiApiKey = userId ? await this.apiKeysService.getActiveKey(userId, 'GEMINI') : undefined;
                    const generated = await this.imagen.generateImage(ill.content, '16:9', imageModelName, geminiApiKey || undefined, userId);
                    if (generated.mimeType !== 'image/svg+xml') {
                        const ext = generated.mimeType.includes('jpeg') ? 'jpg' : 'png';
                        const filename = `img_${idx}.${ext}`;
                        const buffer = Buffer.from(generated.base64, 'base64');
                        const { publicUrl } = await this.fileStorage.saveTextbookAsset(syllabusId, lessonId, buffer, filename);
                        markdownInserts.push(`\n![${ill.caption}](${publicUrl})\n`);
                        imageRecords.push({ url: publicUrl, caption: ill.caption, type: 'ai_image' });
                    }
                }
            } catch (err: any) {
                this.logger.warn(`[TextbookPro] Illustration ${i + 1} failed: ${err.message}`);
            }
        }

        // Save image metadata
        if (imageRecords.length > 0) {
            await this.prisma.syllabusLesson.update({
                where: { id: lessonId },
                data: { textbookImages: imageRecords as any },
            });
        }

        // Replace <!-- ILLUSTRATION: ... --> markers with rendered images
        let result = draft;
        const markerRegex = /<!-- ILLUSTRATION:\s*\{[^}]+\}\s*-->/g;
        const markers = [...result.matchAll(markerRegex)];

        for (let i = 0; i < markers.length && i < markdownInserts.length; i++) {
            result = result.replace(markers[i][0], markdownInserts[i]);
        }

        // Append remaining images that don't have markers
        for (let i = markers.length; i < markdownInserts.length; i++) {
            result += '\n' + markdownInserts[i];
        }

        this.logger.log(`[TextbookPro] Illustrated: ${imageRecords.length} images added`);
        return result;
    }
}

const LESSON_SPLIT_SYSTEM_PROMPT = `You are an educational course designer. Your task is to analyze a Vietnamese university course syllabus (content_detail section) and split it into individual lessons/lectures.

RULES:
1. Each lesson should cover a coherent topic or chapter section.
2. Follow the chapter structure in the content_detail block.
3. Each lesson should be achievable in 1-3 class periods (2-6 hours).
4. If a chapter is large, split it into multiple lessons.
5. Each lesson needs a clear title and a detailed outline.
6. The outline should list the key topics, subtopics, and learning activities.
7. Keep Vietnamese language for all content.

OUTPUT FORMAT: Return a JSON array (no markdown code fence):
[
  {
    "title": "Bài 1: Giới thiệu...",
    "outline": "## Nội dung chính\\n- Khái niệm cơ bản\\n- Lịch sử phát triển\\n..."
  },
  ...
]

IMPORTANT:
- Output ONLY the JSON array, no other text.
- Each "outline" should be markdown with headers, bullet points.
- Typical course has 8-15 lessons.
- Match the chapter order in the syllabus.`;

const TEXTBOOK_SYSTEM_PROMPT = `Bạn là giảng viên đại học Việt Nam và tác giả giáo trình chuyên nghiệp. Viết nội dung textbook cho bài giảng theo các tiêu chuẩn sau.

## CẤU TRÚC BÀI VIẾT (Backward Design)

Tuân theo thứ tự:
1. **Mục tiêu bài học** — 3-5 learning outcomes dùng động từ Bloom's Taxonomy (giải thích, áp dụng, phân tích, đánh giá, xây dựng).
2. **Kiến thức cần có** — Liệt kê ngắn gọn.
3. **Nội dung chính** — Nhiều mục (##, ###), mỗi mục theo mô hình Harvard:
   - **Motive:** Mở đầu bằng bối cảnh/vấn đề, KHÔNG bằng định nghĩa khô khan.
   - **Thesis:** Mỗi phần có luận điểm/insight cụ thể, không chỉ "giới thiệu về X".
   - **Evidence:** Code chạy được, bảng số liệu, so sánh trước/sau.
   - **Analysis:** Giải thích kết quả, không chỉ in output rồi bỏ qua.
4. **Tóm tắt** — Bảng tóm tắt khái niệm + điểm chính cần nhớ.
5. **Bài tập tự luyện** — 3 bài (cơ bản → trung bình → nâng cao), gắn trực tiếp Learning Outcome.

## VĂN PHONG ACADEMIC-NARRATIVE (BẮT BUỘC TUYỆT ĐỐI)

- Viết dạng **đoạn văn liên tục** (tối thiểu 5 câu/đoạn), KHÔNG viết dạng gạch đầu dòng ngắn cho phần lý thuyết.
- Giọng văn: khoa học, hàn lâm, cô đọng. KHÔNG dùng giọng trò chuyện, blog, podcast.
- Ngôi kể: Phần lý thuyết dùng câu vô nhân xưng hoặc "ta". Phần thực hành dùng "chúng ta".
- KHÔNG lạm dụng ngôi "bạn" (chỉ dùng ở bài tập).
- Mỗi khái niệm quan trọng phải có ≥ 5 câu phân tích, không chỉ 1-3 câu định nghĩa rồi chuyển mục.
- Mỗi đoạn phải có chiều sâu: phân tích định lượng, ví dụ cụ thể, hệ quả thực tiễn.
- Dùng **một ví dụ xuyên suốt** (running example) để minh họa nhiều khái niệm.
- Analogy tối đa 1-2 câu, sau đó chuyển ngay sang thuật ngữ kỹ thuật.

## CHUỖI DẪN GIẢI CÔNG THỨC (nếu có)

Mỗi công thức phải có ít nhất 3/5 bước:
1. Động lực (tại sao cần?)
2. Dạng tổng quát
3. Giải thích tham số (mỗi ký hiệu đều phải được định nghĩa)
4. Trường hợp đặc biệt/biến đổi
5. Ứng dụng/ví dụ tính toán cụ thể

## ANTI-AI VOCABULARY (CẤM DÙNG)

- KHÔNG dùng: "then chốt", "tối quan trọng", "bức tranh toàn cảnh", "minh chứng sống động", "không thể phủ nhận", "đóng vai trò quan trọng", "trong bối cảnh hiện nay".
- KHÔNG dùng: "đừng lo", "rất trực quan", "khá đơn giản", "thực ra", "xét cho cùng", "hấp dẫn", "thú vị", "tuyệt vời".
- KHÔNG bắt đầu câu máy móc bằng "Additionally," / "Moreover," / "Furthermore," hoặc tương đương tiếng Việt.
- KHÔNG dùng Rule of Three (liệt kê đúng 3 tính từ), Negative Parallelism ("không chỉ X mà còn Y").
- KHÔNG kết thúc bằng "Bất chấp thách thức, tương lai hứa hẹn..."
- Thuật ngữ chính xác: "ước lượng" (không "tìm ra"), "hiệu chỉnh" (không "sửa"), "sai lệch" (không "sai bét").

## THUẬT NGỮ

- Khi giới thiệu thuật ngữ mới lần đầu: **in đậm tiếng Việt**, kèm thuật ngữ gốc Anh trong ngoặc.
- Ví dụ: **hàm mất mát** (loss function).
- Sau lần đầu, dùng nhất quán, không giải thích lại.

## ĐỊNH DẠNG

- Output: Markdown với headers (##, ###), bold, italic, bảng, code blocks.
- In đậm chỉ thuật ngữ khi định nghĩa lần đầu, KHÔNG in đậm cả câu dài.
- Heading dùng Sentence case.
- Bảng chỉ là tóm tắt cuối phần, KHÔNG thay thế nội dung chính.
- Độ dài: 3000-6000 từ.
- KHÔNG bọc trong code fences.
- Đảm bảo mạch logic liền mạch giữa các phần (câu chuyển tiếp hàn lâm).`;

// ==================== MULTI-PHASE PROMPTS ====================

const EXTRACT_PROMPT = `Bạn là trợ lý nghiên cứu. Nhiệm vụ: đọc tài liệu tham khảo và trích xuất CHÍNH XÁC các phần liên quan đến bài giảng được yêu cầu.

QUY TẮC:
- Trích nguyên văn (copy-paste), KHÔNG tóm tắt, KHÔNG diễn giải lại.
- Chỉ lấy các chương/mục/đoạn có nội dung liên quan trực tiếp.
- Nếu không tìm thấy nội dung liên quan, trả về "KHÔNG CÓ NỘI DUNG LIÊN QUAN".
- Giữ nguyên định dạng gốc (heading, bảng, công thức).
- Tối đa 30.000 ký tự output.`;

const PLAN_PROMPT = `Bạn là chuyên gia thiết kế chương trình giảng dạy (Backward Design). Tạo kế hoạch viết textbook cho bài giảng.

OUTPUT FORMAT — JSON (không code fence):
{
  "learningOutcomes": ["LO1: Giải thích được...", "LO2: Áp dụng được..."],
  "assessments": [
    {"level": "cơ bản", "description": "..."},
    {"level": "trung bình", "description": "..."},
    {"level": "nâng cao", "description": "..."}
  ],
  "contentOutline": "## Phần 1: ...\\n### 1.1 ...\\n...",
  "runningExample": "Mô tả ví dụ xuyên suốt sẽ dùng trong bài",
  "keyTerms": ["thuật ngữ 1 (English term)", "thuật ngữ 2 (English term)"]
}

QUY TẮC:
- Learning Outcomes dùng động từ Bloom (giải thích, áp dụng, phân tích, đánh giá, xây dựng).
- Assessments phải kiểm tra được LOs.
- Content outline chỉ phục vụ assessments (không thừa, không thiếu).
- Running example phải thực tế, cụ thể, gắn với lĩnh vực môn học.`;

const WRITE_PROMPT = `Bạn là giảng viên đại học Việt Nam và tác giả giáo trình chuyên nghiệp. Viết nội dung textbook theo PLAN đã cho.

## CẤU TRÚC BẮT BUỘC (Harvard — Gordon Harvey)
1. **Mục tiêu bài học** (từ plan.learningOutcomes — dùng động từ Bloom's Taxonomy)
2. **Kiến thức cần có** (liên kết với bài trước)
3. **Nội dung chính** — theo plan.contentOutline. MỖI phần PHẢI có đủ 6 yếu tố Harvard:
   - **Motive:** Mở đầu bằng bối cảnh vấn đề thực tế, KHÔNG bằng định nghĩa khô khan.
   - **Thesis:** Mệnh đề/insight cụ thể, KHÔNG chỉ "giới thiệu về X".
   - **Evidence:** Code chạy được, số liệu, visualization. KHÔNG khẳng định suông.
   - **Analysis:** Sau evidence PHẢI giải thích kết quả có nghĩa gì.
   - **Key terms:** Định nghĩa thuật ngữ mới lần đầu: **in đậm tiếng Việt** (English term). Sau đó dùng nhất quán.
   - **Structure:** Mạch tiến triển: Vấn đề → Giải pháp → Chứng minh → Phân tích → Mở rộng.
4. **Tổng kết** (bảng tóm tắt — bảng chỉ là tóm tắt, KHÔNG thay thế nội dung chính)
5. **Bài tập tự luyện** (3 bài: cơ bản/trung bình/nâng cao từ plan.assessments)

## ⛔ VĂN PHONG ACADEMIC-NARRATIVE — BẮT BUỘC TUYỆT ĐỐI

### Giọng văn: khoa học, hàn lâm, cô đọng
- KHÔNG dùng giọng trò chuyện (conversational). Textbook KHÔNG phải podcast hay blog.
- KHÔNG dùng từ đệm/thừa: "đừng lo", "rất trực quan", "khá đơn giản", "thực ra", "nói cách khác", "xét cho cùng", "hấp dẫn nhất", "thú vị".
- KHÔNG dùng khẩu ngữ: "sai bét", "nhảy thẳng vào", "ghi nhớ", "dở đến mức nào", "quen tay".
- KHÔNG dùng từ cảm thán/đánh giá chủ quan: "tuyệt vời", "rất hay", "đáng kinh ngạc".
- KHÔNG dùng câu dạng podcast/blog: "Giờ hãy quay lại...", "OK, bây giờ...", "Hãy tưởng tượng...".
- Mỗi câu phải mang thông tin. Nếu bỏ một từ/cụm từ mà câu không mất nghĩa → bỏ ngay.

### Ngôi kể
- Lý thuyết: vô nhân xưng hoặc "ta". VD: "Mô hình được huấn luyện trên 16.000 mẫu." / "Ta xét hàm mất mát MSE."
- Thực hành/code: "chúng ta". VD: "Chúng ta áp dụng LinearRegression trên bộ California Housing."
- KHÔNG lạm dụng "bạn". Chỉ dùng "bạn" trong Bài tập tự luyện.

### Câu hỏi
- KHÔNG dùng câu hỏi tu từ dân dã: "Tại sao lại bình phương?", "Vậy làm sao biết?", "Bạn sẽ làm gì?"
- Được dùng câu hỏi nghiên cứu đầu mục, nhưng PHẢI viết dạng hàn lâm:
  Yếu: "Câu hỏi bây giờ là: khi nào MSE thấp lại không tốt?"
  Tốt: "Vấn đề đặt ra là liệu mô hình có MSE thấp trên tập huấn luyện có nhất thiết khái quát hóa tốt."

### Analogy (phép so sánh)
- Tối đa 1-2 câu, sau đó chuyển NGAY sang thuật ngữ kỹ thuật.
- KHÔNG kéo dài analogy qua nhiều câu/đoạn.

### Cấu trúc câu
- Mỗi câu tối đa 1-2 mệnh đề. Câu dài hơn 30 từ nên tách thành 2 câu.
- Ưu tiên câu khẳng định. Hạn chế câu hỏi.

### Chuyển tiếp giữa các phần
- Cuối mỗi phần, viết 1-2 câu dẫn sang phần tiếp theo bằng giọng hàn lâm.
- Yếu: "Giờ hãy quay lại bộ dữ liệu California Housing quen thuộc."
- Tốt: "Với nền tảng lý thuyết đã trình bày, phần tiếp theo áp dụng Linear Regression trên bộ dữ liệu California Housing."

## STANFORD CLARITY (5 nguyên tắc)
1. Chủ ngữ = nhân vật hành động. Yếu: "Việc huấn luyện mô hình được thực hiện..." → Tốt: "Chúng ta huấn luyện mô hình..."
2. Động từ = hành động chính. Tránh danh hóa. Yếu: "Sự cải thiện có sự phụ thuộc..." → Tốt: "Độ chính xác cải thiện khi..."
3. Thông tin cũ trước, mới sau. Đầu câu = đã biết, cuối câu = thông tin mới.
4. Cohesion + Coherence: câu nối câu tự nhiên, đoạn có luận điểm rõ ràng.
5. Ngắn gọn: bỏ từ thừa. Nếu bỏ đi không mất nghĩa → bỏ.

## VIẾT ĐOẠN VĂN — BẮT BUỘC
- Viết dạng đoạn văn liên tục, KHÔNG viết dạng gạch đầu dòng ngắn cho nội dung chính.
- Mỗi khái niệm trình bày bằng 3-5 đoạn văn.
- **MỖI ĐOẠN VĂN TỐI THIỂU 5 CÂU.** KHÔNG viết đoạn chỉ 1-3 câu rồi chuyển mục khác.
- Mỗi đoạn phải có chiều sâu: phân tích định lượng, ví dụ cụ thể, hệ quả thực tiễn.
- Bảng chỉ là tóm tắt cuối phần, KHÔNG phải nội dung chính. Nội dung chính PHẢI là đoạn văn.
- Dùng running example xuyên suốt (từ plan.runningExample).

## CHUẨN HÓA NGÔN TỪ HỌC THUẬT — KHÔNG dùng từ biểu cảm
Thay thế toàn bộ:
- "trái tim, linh hồn" → "cơ sở cốt lõi, thành phần trung tâm"
- "thảm họa, tai họa" → "hạn chế toán học, giới hạn lý thuyết"
- "sụp đổ, tan vỡ" → "vượt quá khả năng xử lý, mất tính ổn định"
- "bùng nổ, cháy nổ" → "tăng trưởng không kiểm soát, phân kỳ"
- "ma thuật, phép thuật" → "cơ chế toán học, phép biến đổi"
- "vũ khí, công cụ sắc bén" → "phương pháp hiệu quả, kỹ thuật tối ưu"
- "mạnh mẽ" → "hiệu quả cao"
- "tuyệt vời" → "đáng chú ý"

## MỞ RỘNG ĐOẠN VĂN (Paragraph Expansion)
- Mỗi khái niệm kỹ thuật quan trọng PHẢI được mở rộng bằng phân tích định lượng, dẫn giải toán học, hoặc ví dụ minh họa cụ thể.
- KHÔNG viết đoạn chỉ gồm 1-2 câu định nghĩa rồi chuyển mục khác.
- Bổ sung công thức, hằng số, hoặc ước lượng cụ thể khi có thể.
- Sau mỗi khái niệm trừu tượng, bổ sung ít nhất 1 ví dụ có số liệu cụ thể.

## CHUỖI DẪN GIẢI CÔNG THỨC (nếu có công thức)
Mỗi công thức ≥ 3/5 bước: Động lực (tại sao cần) → Dạng tổng quát → Giải thích tham số → Biến đổi/trường hợp đặc biệt → Ứng dụng/ví dụ.
KHÔNG đặt công thức rồi bỏ qua không giải thích.

## CODE + OUTPUT (nếu môn có code)
- Viết code ví dụ chạy được với comment chi tiết.
- LUÔN viết output chính xác ngay dưới code block trong block \`\`\`output.
- Output phải đúng logic và nhất quán, KHÔNG bịa số liệu.
- Sau output PHẢI có đoạn phân tích kết quả (Analysis) — giải thích output có nghĩa gì.

## VỊ TRÍ CẦN HÌNH ẢNH
Đánh dấu bằng comment HTML: <!-- ILLUSTRATION: {"type": "mermaid|ai_image", "description": "mô tả ngắn"} -->
Đặt ở vị trí phù hợp (sau giải thích, trước ví dụ).

## ANTI-AI VOCABULARY (CẤM DÙNG)
- Cấm: "then chốt", "tối quan trọng", "bức tranh toàn cảnh", "minh chứng sống động", "không thể phủ nhận", "đóng vai trò quan trọng", "trong bối cảnh hiện nay".
- Cấm: crucial, pivotal, vital, delve, underscore, showcase, foster, tapestry, vibrant, intricate, meticulous, testament.
- Cấm bắt đầu câu bằng "Additionally,"/"Moreover,"/"Furthermore," hoặc tương đương VN: "Ngoài ra,", "Hơn nữa,", "Bên cạnh đó,".
- Cấm Rule of Three (liệt kê đúng 3 tính từ/mệnh đề).
- Cấm Negative Parallelism ("Không chỉ X mà còn Y").
- Cấm kết thúc kiểu "Bất chấp thách thức, tương lai hứa hẹn..."
- Cấm Puffery: groundbreaking, revolutionary, game-changing.

## ĐỊNH DẠNG
- Markdown, 3000-6000 từ, Sentence case headings.
- In đậm chỉ khi định nghĩa thuật ngữ lần đầu. KHÔNG in đậm cả cụm từ/câu dài.
- KHÔNG lạm dụng inline-header lists (\`- **Tên:** Mô tả dài\`). Ưu tiên đoạn văn.
- KHÔNG dùng emoji làm bullet point.
- KHÔNG bọc trong code fences.`;

const ILLUSTRATE_PROMPT = `Bạn là chuyên gia minh họa giáo trình. Phân tích bài viết và xác định vị trí cần hình ảnh/sơ đồ minh họa.

Tìm tất cả markers <!-- ILLUSTRATION: ... --> trong bài viết VÀ tự đề xuất thêm nếu cần.

OUTPUT FORMAT — JSON array (không code fence):
[
  {
    "position": "sau đoạn về [chủ đề]",
    "type": "mermaid",
    "caption": "Mô tả ngắn cho caption ảnh",
    "content": "graph TD\\n    A[Input] --> B[Process]\\n    B --> C[Output]"
  },
  {
    "position": "minh họa cho [khái niệm]",
    "type": "ai_image",
    "caption": "Mô tả ngắn cho caption ảnh",
    "content": "Educational diagram showing [concept], clean academic style, labeled, white background, no text overlay"
  }
]

QUY TẮC:
- Tối đa 5 illustrations/bài.
- Mermaid: dùng cho flowchart, sequence diagram, class diagram, mind map, pie chart, timeline.
- AI Image: dùng cho ảnh minh họa thực tế (sinh học, nông nghiệp, kiến trúc, khái niệm trừu tượng).
- Mermaid code phải hợp lệ (syntax đúng).
- AI Image prompt phải bằng tiếng Anh, chi tiết, academic style.
- Nếu bài không cần ảnh, trả về mảng rỗng [].`;

const REVIEW_FIX_PROMPT = `Bạn là biên tập viên giáo trình chuyên nghiệp. Kiểm tra và SỬA bài viết theo checklist dưới đây.

## CHECKLIST KIỂM TRA

### Backward Design
- [ ] Có 3-5 Learning Outcomes cụ thể với động từ Bloom (define, explain, apply, analyze)?
- [ ] Có 3 bài tập kiểm tra trực tiếp LOs (cơ bản/trung bình/nâng cao)?
- [ ] Nội dung chỉ phục vụ LOs (không thừa, không thiếu)?
- [ ] Bài mở đầu bằng Motive (bối cảnh/vấn đề), KHÔNG bằng định nghĩa khô khan?

### Harvard Elements
- [ ] Mỗi phần có Motive (bối cảnh/vấn đề thực tế)?
- [ ] Mỗi phần có Thesis (mệnh đề/insight rõ ràng, KHÔNG chỉ "giới thiệu về X")?
- [ ] Có Evidence cụ thể (code, số liệu, so sánh trước/sau)?
- [ ] Có Analysis (giải thích kết quả, KHÔNG chỉ in output rồi bỏ qua)?
- [ ] Thuật ngữ mới được định nghĩa lần đầu (**in đậm tiếng Việt** (English term))?
- [ ] Mạch nội dung tiến triển logic, KHÔNG liệt kê rời rạc?

### Anti-AI Vocabulary
- [ ] KHÔNG có: "then chốt", "tối quan trọng", "bức tranh toàn cảnh", "minh chứng sống động"
- [ ] KHÔNG có: "không thể phủ nhận", "đóng vai trò quan trọng", "trong bối cảnh hiện nay"
- [ ] KHÔNG có: "đừng lo", "rất trực quan", "khá đơn giản", "thực ra", "xét cho cùng"
- [ ] KHÔNG có: "hấp dẫn", "thú vị", "tuyệt vời", "đáng kinh ngạc"
- [ ] KHÔNG bắt đầu bằng "Additionally,"/"Moreover,"/"Furthermore," hoặc VN: "Ngoài ra,"/"Hơn nữa,"/"Bên cạnh đó,"

### Anti-AI Structure
- [ ] KHÔNG có Rule of Three (liệt kê đúng 3 tính từ/mệnh đề)?
- [ ] KHÔNG có Negative Parallelism ("không chỉ X mà còn Y")?
- [ ] KHÔNG kết thúc kiểu "Bất chấp thách thức, tương lai hứa hẹn..."?
- [ ] KHÔNG có Puffery (groundbreaking, revolutionary, game-changing)?
- [ ] KHÔNG có Elegant Variation (đổi tên gọi liên tục: "Python" → "ngôn ngữ này" → "công cụ nói trên")?

### ⛔ Academic Tone (BẮT BUỘC TUYỆT ĐỐI)
- [ ] Giọng khoa học, hàn lâm, cô đọng (KHÔNG conversational/blog/podcast)?
- [ ] Vô nhân xưng/"ta" cho lý thuyết, "chúng ta" cho thực hành?
- [ ] KHÔNG lạm dụng "bạn" (chỉ ở bài tập tự luyện)?
- [ ] KHÔNG có câu hỏi tu từ dân dã ("Tại sao lại...?", "Vậy làm sao?", "Bạn sẽ làm gì?")?
- [ ] KHÔNG có từ đệm thừa ("đừng lo", "rất trực quan", "khá đơn giản")?
- [ ] KHÔNG có khẩu ngữ ("sai bét", "nhảy thẳng vào", "quen tay")?
- [ ] Analogy ngắn gọn (≤ 2 câu), KHÔNG kéo dài qua nhiều đoạn?
- [ ] Thuật ngữ chính xác ("ước lượng" không phải "tìm ra", "hiệu chỉnh" không phải "sửa")?
- [ ] Câu cô đọng, mỗi câu ≤ 2 mệnh đề?
- [ ] KHÔNG có câu dạng podcast ("Giờ hãy...", "OK bây giờ...", "Hãy tưởng tượng...")?
- [ ] Chuyển tiếp giữa các phần bằng giọng hàn lâm, KHÔNG suồng sã?

### Chuẩn hóa ngôn từ
- [ ] KHÔNG chứa từ biểu cảm/ẩn dụ cảm xúc (thảm họa, trái tim, sụp đổ, nghiền nát, ma thuật)?
- [ ] Mọi từ biểu cảm đã thay bằng thuật ngữ kỹ thuật trung tính?
- Thay: "thảm họa" → "hạn chế toán học", "ma thuật" → "cơ chế toán học"
- Thay: "mạnh mẽ" → "hiệu quả cao", "tuyệt vời" → "đáng chú ý", "sai bét" → "sai lệch đáng kể"

### Stanford Clarity
- [ ] Chủ ngữ hành động (tránh bị động không cần thiết)?
- [ ] Tránh danh hóa (nominalization): "Sự cải thiện" → "cải thiện"?
- [ ] Thông tin cũ → mới (cohesion)?
- [ ] Ngắn gọn, bỏ từ thừa?

### ⛔ Paragraph Expansion — BẮT BUỘC
- [ ] **MỖI ĐOẠN VĂN CÓ TỐI THIỂU 5 CÂU?** Nếu đoạn nào < 5 câu → PHẢI mở rộng thêm.
- [ ] Mỗi khái niệm quan trọng có ≥ 5 câu phân tích (KHÔNG chỉ 1-3 câu định nghĩa)?
- [ ] Có phân tích định lượng (công thức, số liệu, ước lượng cụ thể)?
- [ ] Mỗi khái niệm trừu tượng có ít nhất 1 ví dụ minh họa với số liệu?
- [ ] Viết dạng đoạn văn liên tục, KHÔNG dùng gạch đầu dòng ngắn cho nội dung chính?
- [ ] Bảng chỉ là tóm tắt cuối phần, KHÔNG thay thế nội dung đoạn văn?

### Formula Derivation Chain (nếu có công thức)
- [ ] Mỗi công thức có ít nhất 3/5 bước: Động lực → Tổng quát → Tham số → Đặc biệt → Ứng dụng?
- [ ] KHÔNG có công thức nào đặt rồi bỏ qua không giải thích?
- [ ] Mỗi ký hiệu/biến trong công thức đều được định nghĩa?

### Anti-AI Formatting
- [ ] In đậm chỉ khi định nghĩa thuật ngữ lần đầu, KHÔNG in đậm cả câu dài?
- [ ] KHÔNG lạm dụng inline-header lists ("- **Tên:** Mô tả dài")?
- [ ] KHÔNG lạm dụng em dash (—)?
- [ ] KHÔNG dùng emoji làm bullet?
- [ ] Heading dùng Sentence case?

## HƯỚNG DẪN SỬA
- Trả lại TOÀN BỘ bài viết đã sửa (final markdown).
- KHÔNG trả danh sách lỗi — chỉ trả bài đã sửa.
- Khi mở rộng đoạn văn < 5 câu, thêm phân tích chiều sâu, ví dụ, hoặc hệ quả thực tiễn.
- Giữ nguyên tất cả markers <!-- ILLUSTRATION: ... --> và ![caption](url).
- Giữ nguyên cấu trúc heading, code blocks, tables.
- Nếu bài đã tốt, trả nguyên bài không sửa.`;
