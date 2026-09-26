import os
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls

SCREENSHOTS_DIR = 'docs/screenshots'
OUTPUT_DOCX = 'Huong_Dan_Su_Dung_AI_Teaching_Assistant.docx'

# Color Palette Constants
COLOR_PRIMARY = RGBColor(30, 58, 138)     # Deep Navy #1E3A8A
COLOR_SECONDARY = RGBColor(51, 65, 85)    # Slate #334155
COLOR_ACCENT = RGBColor(220, 38, 38)      # Crimson Red #DC2626 (matches red badges)
COLOR_TEXT = RGBColor(30, 41, 59)         # Dark Charcoal #1E293B
COLOR_MUTED = RGBColor(100, 116, 139)     # Gray #64748B
COLOR_WHITE = RGBColor(255, 255, 255)

def set_cell_background(cell, fill_hex):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{fill_hex}"/>')
    tcPr.append(shd)

def set_cell_margins(cell, top=120, bottom=120, left=160, right=160):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(f'''
        <w:tcMar {nsdecls("w")}>
            <w:top w:w="{top}" w:type="dxa"/>
            <w:bottom w:w="{bottom}" w:type="dxa"/>
            <w:left w:w="{left}" w:type="dxa"/>
            <w:right w:w="{right}" w:type="dxa"/>
        </w:tcMar>
    ''')
    tcPr.append(tcMar)

def set_table_borders(table, color="CBD5E1", sz="4", val="single"):
    tblPr = table._tbl.tblPr
    borders = parse_xml(f'''
        <w:tblBorders {nsdecls("w")}>
            <w:top w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>
            <w:bottom w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>
            <w:insideH w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>
            <w:insideV w:val="none"/>
            <w:left w:val="none"/>
            <w:right w:val="none"/>
        </w:tblBorders>
    ''')
    tblPr.append(borders)

def add_callout(doc, title, text, callout_type="tip"):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0, 0)
    cell.width = Inches(6.5)
    
    if callout_type == "tip":
        bg_hex = "F0FDF4"
        border_hex = "16A34A"
        icon = "💡 MẸO HAY CHO GIẢNG VIÊN"
        title_color = RGBColor(22, 163, 74)
    elif callout_type == "warning":
        bg_hex = "FEFCE8"
        border_hex = "CA8A04"
        icon = "⚠️ LƯU Ý NGHIỆP VỤ QUAN TRỌNG"
        title_color = RGBColor(180, 83, 9)
    else: # action / info
        bg_hex = "EEF2FF"
        border_hex = "4F46E5"
        icon = "📌 HƯỚNG DẪN THAO TÁC CÁ NHÂN HÓA"
        title_color = RGBColor(79, 70, 229)
        
    set_cell_background(cell, bg_hex)
    set_cell_margins(cell, top=140, bottom=140, left=200, right=160)
    
    tcPr = cell._tc.get_or_add_tcPr()
    borders = parse_xml(f'''
        <w:tcBorders {nsdecls("w")}>
            <w:top w:val="none"/>
            <w:left w:val="single" w:sz="24" w:space="0" w:color="{border_hex}"/>
            <w:bottom w:val="none"/>
            <w:right w:val="none"/>
        </w:tcBorders>
    ''')
    tcPr.append(borders)
    
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.15
    run_title = p.add_run(f"{icon}: {title}\n")
    run_title.font.name = 'Arial'
    run_title.font.size = Pt(10.5)
    run_title.font.bold = True
    run_title.font.color.rgb = title_color
    
    run_text = p.add_run(text)
    run_text.font.name = 'Arial'
    run_text.font.size = Pt(10)
    run_text.font.color.rgb = COLOR_TEXT
    
    # Empty space after callout
    p_after = doc.add_paragraph()
    p_after.paragraph_format.space_before = Pt(0)
    p_after.paragraph_format.space_after = Pt(6)

def add_heading_1(doc, text):
    h = doc.add_heading(text, level=1)
    h.paragraph_format.space_before = Pt(16)
    h.paragraph_format.space_after = Pt(6)
    h.paragraph_format.keep_with_next = True
    for r in h.runs:
        r.font.name = 'Arial'
        r.font.size = Pt(15)
        r.font.bold = True
        r.font.color.rgb = COLOR_PRIMARY
    return h

def add_heading_2(doc, text):
    h = doc.add_heading(text, level=2)
    h.paragraph_format.space_before = Pt(12)
    h.paragraph_format.space_after = Pt(4)
    h.paragraph_format.keep_with_next = True
    for r in h.runs:
        r.font.name = 'Arial'
        r.font.size = Pt(12.5)
        r.font.bold = True
        r.font.color.rgb = COLOR_SECONDARY
    return h

def add_body_p(doc, text, bold_prefix="", space_after=6):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.2
    if bold_prefix:
        r_pre = p.add_run(bold_prefix)
        r_pre.font.name = 'Arial'
        r_pre.font.size = Pt(10.5)
        r_pre.font.bold = True
        r_pre.font.color.rgb = COLOR_TEXT
    r_body = p.add_run(text)
    r_body.font.name = 'Arial'
    r_body.font.size = Pt(10.5)
    r_body.font.color.rgb = COLOR_TEXT
    return p

def add_badge_step(doc, badge_num, action_title, action_desc):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.2
    p.paragraph_format.left_indent = Inches(0.2)
    
    # Red badge symbol
    r_badge = p.add_run(f"[{badge_num}] ")
    r_badge.font.name = 'Arial'
    r_badge.font.size = Pt(11)
    r_badge.font.bold = True
    r_badge.font.color.rgb = COLOR_ACCENT
    
    # Action title
    r_title = p.add_run(f"{action_title}: ")
    r_title.font.name = 'Arial'
    r_title.font.size = Pt(10.5)
    r_title.font.bold = True
    r_title.font.color.rgb = COLOR_PRIMARY
    
    # Action description
    r_desc = p.add_run(action_desc)
    r_desc.font.name = 'Arial'
    r_desc.font.size = Pt(10)
    r_desc.font.color.rgb = COLOR_TEXT
    return p

def add_screenshot_figure(doc, img_name, caption_text):
    img_path = os.path.join(SCREENSHOTS_DIR, img_name)
    if not os.path.exists(img_path):
        print(f"Warning: Image {img_path} not found!")
        return
        
    p_img = doc.add_paragraph()
    p_img.paragraph_format.space_before = Pt(8)
    p_img.paragraph_format.space_after = Pt(2)
    p_img.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_img.paragraph_format.keep_with_next = True
    run_img = p_img.add_run()
    run_img.add_picture(img_path, width=Inches(6.2))
    
    p_cap = doc.add_paragraph()
    p_cap.paragraph_format.space_before = Pt(2)
    p_cap.paragraph_format.space_after = Pt(10)
    p_cap.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run_cap = p_cap.add_run(caption_text)
    run_cap.font.name = 'Arial'
    run_cap.font.size = Pt(9.5)
    run_cap.font.italic = True
    run_cap.font.color.rgb = COLOR_MUTED

def build_user_guide():
    doc = docx.Document()
    
    # Setup page geometry: Margins 1 inch (72 pt)
    sections = doc.sections
    for sec in sections:
        sec.top_margin = Inches(0.85)
        sec.bottom_margin = Inches(0.85)
        sec.left_margin = Inches(1.0)
        sec.right_margin = Inches(1.0)
        
        # Header setup
        header = sec.header
        hp = header.paragraphs[0]
        hp.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hr = hp.add_run("AI Teaching Assistant • Tài liệu Hướng dẫn Giảng viên")
        hr.font.name = 'Arial'
        hr.font.size = Pt(8.5)
        hr.font.italic = True
        hr.font.color.rgb = COLOR_MUTED
        
        # Footer setup
        footer = sec.footer
        fp = footer.paragraphs[0]
        fp.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
        fr = fp.add_run("Trang bị công nghệ AI cho Giáo dục đại học & Cá nhân hóa bài giảng số")
        fr.font.name = 'Arial'
        fr.font.size = Pt(8.5)
        fr.font.color.rgb = COLOR_MUTED

    # =========================================================================
    # TRANG BÌA (COVER PAGE)
    # =========================================================================
    cover_box = doc.add_table(rows=1, cols=1)
    cover_box.alignment = WD_TABLE_ALIGNMENT.CENTER
    c_cell = cover_box.cell(0, 0)
    c_cell.width = Inches(6.5)
    set_cell_background(c_cell, "1E3A8A")
    set_cell_margins(c_cell, top=360, bottom=360, left=300, right=300)
    
    cp = c_cell.paragraphs[0]
    cp.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cp.paragraph_format.space_after = Pt(8)
    r1 = cp.add_run("HỆ THỐNG TRỢ LÝ GIẢNG DẠY THÔNG MINH\nAI TEACHING ASSISTANT\n\n")
    r1.font.name = 'Arial'
    r1.font.size = Pt(13)
    r1.font.bold = True
    r1.font.color.rgb = RGBColor(191, 219, 254) # Light Blue
    
    r2 = cp.add_run("HƯỚNG DẪN SỬ DỤNG DÀNH CHO GIẢNG VIÊN\n")
    r2.font.name = 'Arial'
    r2.font.size = Pt(21)
    r2.font.bold = True
    r2.font.color.rgb = COLOR_WHITE
    
    r3 = cp.add_run("Quy trình khởi tạo bài giảng trực tiếp, thiết kế Slide & Audio tự động,\ntinh chỉnh cá nhân hóa mọi bước và xuất ngân hàng câu hỏi Moodle XML chuẩn quốc tế\n")
    r3.font.name = 'Arial'
    r3.font.size = Pt(11)
    r3.font.italic = True
    r3.font.color.rgb = RGBColor(226, 232, 240)
    
    p_meta = doc.add_paragraph()
    p_meta.paragraph_format.space_before = Pt(24)
    p_meta.paragraph_format.space_after = Pt(24)
    p_meta.paragraph_format.line_spacing = 1.3
    
    add_body_p(doc, "Môn học & Bài giảng minh họa:", "• ", space_after=2)
    add_body_p(doc, "Nền tảng Trí tuệ Nhân tạo", "  - Môn học: ", space_after=2)
    add_body_p(doc, "Bài 02: Xây dựng Mô hình Học máy Cơ bản với Scikit-Learn", "  - Bài giảng thực hành: ", space_after=2)
    add_body_p(doc, "Giảng viên các trường Đại học, Học viện, Cao đẳng và Cơ sở Giáo dục chuyên nghiệp", "  - Đối tượng sử dụng: ", space_after=2)
    add_body_p(doc, "2.6 (Cá nhân hóa Dàn ý, Kịch bản, Giọng clone ViTTS, Sửa slide PPTX, Crop 1:1 & Moodle XML)", "  - Phiên bản ứng dụng: ", space_after=2)
    add_body_p(doc, "Tháng 09/2026", "  - Thời gian ban hành: ", space_after=20)
    
    add_callout(doc, "Phương pháp tiếp cận trực quan với vòng tròn đỏ",
                "Trong toàn bộ tài liệu này, mọi ảnh chụp màn hình ứng dụng thực tế đều được KHOANH HỘP VIỀN ĐỎ và gắn HUY HIỆU SỐ THỨ TỰ ĐỎ [①], [②], [③]... tại chính xác vị trí các nút bấm và ô nhập liệu. "
                "Giảng viên chỉ cần nhìn số trên hình và đối chiếu mục hướng dẫn tương ứng bên dưới để thao tác chuẩn xác 100%.", "action")

    doc.add_page_break()

    # =========================================================================
    # TỔNG QUAN LUỒNG LÀM VIỆC & CÁ NHÂN HÓA
    # =========================================================================
    add_heading_1(doc, "TỔNG QUAN QUY TRÌNH BIÊN SOẠN & CÁ NHÂN HÓA BÀI GIẢNG")
    
    add_body_p(doc, "Hệ thống AI Teaching Assistant được thiết kế chuyên biệt nhằm giải phóng giảng viên khỏi những công việc thủ công tốn hàng chục giờ đồng hồ, "
                    "đồng thời vẫn đảm bảo GIẢNG VIÊN HOÀN TOÀN LÀM CHỦ VÀ CÁ NHÂN HÓA NỘI DUNG Ở MỌI BƯỚC: "
                    "từ dàn ý bài học, phong cách câu từ trong kịch bản slide, ngữ điệu giọng đọc của chính giảng viên (Clone Voice), cách bố trí hình ảnh 1:1, đến ngân hàng câu hỏi kiểm tra đánh giá theo thang đo tư duy Bloom.")

    # Summary Table
    wf_table = doc.add_table(rows=5, cols=3)
    wf_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(wf_table)
    
    headers = ["Giai đoạn", "Các bước cốt lõi", "Điểm nhấn Cá nhân hóa (Personalization)"]
    for i, h_text in enumerate(headers):
        cell = wf_table.cell(0, i)
        set_cell_background(cell, "1E3A8A")
        set_cell_margins(cell, top=140, bottom=140, left=160, right=160)
        p = cell.paragraphs[0]
        p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(h_text)
        r.font.name = 'Arial'
        r.font.size = Pt(10)
        r.font.bold = True
        r.font.color.rgb = COLOR_WHITE
        
    rows_data = [
        ("Giai đoạn 1: Đăng ký & Cấu hình", "Đăng ký tài khoản giảng viên, chờ Admin phê duyệt, cấu hình API Key và máy chủ ViTTS Local.", "Cấu hình máy chủ GPU nội bộ, kiểm tra kết nối thời gian thực."),
        ("Giai đoạn 2: Khởi tạo môn & bài", "Tạo môn học 'Nền tảng Trí tuệ Nhân tạo', BỎ QUA bước sinh đề cương, tạo bài giảng trực tiếp.", "Giảng viên đi thẳng vào bài học mà không bị AI thay đổi khung chương trình."),
        ("Giai đoạn 3: Studio 6 bước soạn bài", "Bước 1 (Outline thô) ➔ Bước 2 (Dàn ý AI & Sửa JSON) ➔ Bước 3 (Kịch bản & Sửa JSON) ➔ Bước 4 (Giọng Clone & Sửa Lời giảng) ➔ Bước 5 (Sửa slide PPTX, Đổi ảnh & Crop 1:1).", "Cá nhân hóa mọi thành phần: sửa trực tiếp dàn bài, sửa văn phong kịch bản, dùng giọng clone của chính mình, tải ảnh riêng."),
        ("Giai đoạn 4: Đánh giá & Xuất LMS", "Bước 6: Sinh câu hỏi Bloom 3 cấp độ, sửa trực tiếp từng câu/đáp án, xuất Moodle XML & Excel.", "Tùy biến câu hỏi theo thực tế lớp học, nạp vào LMS trường trong 3 giây."),
    ]
    
    for row_idx, r_data in enumerate(rows_data, start=1):
        bg = "F8FAFC" if row_idx % 2 == 1 else "FFFFFF"
        for col_idx, text in enumerate(r_data):
            cell = wf_table.cell(row_idx, col_idx)
            set_cell_background(cell, bg)
            set_cell_margins(cell, top=100, bottom=100, left=140, right=140)
            p = cell.paragraphs[0]
            p.paragraph_format.line_spacing = 1.15
            r = p.add_run(text)
            r.font.name = 'Arial'
            r.font.size = Pt(9.5)
            if col_idx == 0:
                r.font.bold = True
                r.font.color.rgb = COLOR_PRIMARY

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    # =========================================================================
    # PHẦN I: ĐĂNG KÝ, DUYỆT TÀI KHOẢN & CẤU HÌNH API KEY
    # =========================================================================
    add_heading_1(doc, "PHẦN I: KHỞI TẠO TÀI KHOẢN VÀ CẤU HÌNH HỆ THỐNG")
    
    add_heading_2(doc, "1. Đăng ký tài khoản Giảng viên mới (/register)")
    add_body_p(doc, "Để bảo mật nguồn học liệu và tài nguyên máy chủ trường, hệ thống áp dụng cơ chế xác thực hai vòng: Giảng viên tự đăng ký thông tin cá nhân và Quản trị viên (Admin) xét duyệt phân quyền trước khi kích hoạt.")
    
    add_screenshot_figure(doc, "01_dang_ky.png", "Hình 1: Giao diện Đăng ký tài khoản Giảng viên với các trường thông tin bắt buộc")
    
    add_body_p(doc, "Các thao tác cụ thể trên Hình 1:", bold_prefix="👉 Hướng dẫn thao tác theo thứ tự:")
    add_badge_step(doc, "1", "Điền thông tin giảng viên", 
                   "Giảng viên nhập chính xác Họ và tên (kèm học hàm/học vị nếu có, ví dụ: 'TS. Nguyễn Văn An'), địa chỉ Email công vụ (@daihoc.edu.vn hoặc email trường), Số điện thoại liên hệ, Đơn vị công tác (Khoa/Bộ môn) và Mật khẩu đăng nhập an toàn.")
    add_badge_step(doc, "2", "Bấm nút 'Đăng ký'", 
                   "Nhấp chuột vào nút 'Đăng ký' màu xanh lam ở cuối biểu mẫu để gửi hồ sơ khởi tạo tài khoản lên hệ thống.")
                   
    add_heading_2(doc, "2. Trạng thái chờ phê duyệt (Pending State)")
    add_body_p(doc, "Sau khi hoàn tất đăng ký, tài khoản của Thầy/Cô sẽ được chuyển vào hàng đợi phê duyệt (PENDING) để đảm bảo không có tài khoản rác xâm nhập vào kho bài giảng.")
    
    add_screenshot_figure(doc, "02_dang_nhap_cho_duyet.png", "Hình 2: Thông báo trạng thái Chờ duyệt (PENDING) khi đăng nhập lần đầu")
    
    add_badge_step(doc, "1", "Thông báo chờ phê duyệt", 
                   "Khung cảnh báo màu vàng hiển thị rõ: 'Tài khoản đang ở trạng thái CHỜ DUYỆT (PENDING)'. Thầy/Cô vui lòng nhắn tin hoặc liên hệ Quản trị viên phụ trách CNTT của đơn vị để được kích hoạt nhanh chóng.")
    add_badge_step(doc, "2", "Đăng nhập sau khi được kích hoạt", 
                   "Sau khi Admin duyệt, Thầy/Cô chỉ cần nhấn 'Đăng nhập' để bước vào giao diện chính.")
                   
    add_heading_2(doc, "3. Góc nhìn Quản trị viên: Phê duyệt tài khoản (/admin/users)")
    add_body_p(doc, "Quản trị viên đăng nhập vào trang quản trị người dùng để kiểm tra tính hợp lệ của giảng viên đăng ký và kích hoạt tài khoản trong vòng 1 cú nhấp chuột.")
    
    add_screenshot_figure(doc, "03_admin_duyet_giang_vien.png", "Hình 3: Quản trị viên xét duyệt hồ sơ giảng viên tại trang Quản trị Người dùng")
    
    add_badge_step(doc, "1", "Danh sách tài khoản Giảng viên", 
                   "Quản trị viên theo dõi bảng thông tin gồm Họ tên, Email, Đơn vị công tác và Trạng thái người dùng.")
    add_badge_step(doc, "2", "Bấm nút 'Phê duyệt'", 
                   "Quản trị viên nhấp vào nút 'Phê duyệt' ứng với tài khoản của giảng viên. Ngay lập tức tài khoản chuyển sang trạng thái APPROVED (Đã duyệt), giảng viên có thể sử dụng đầy đủ mọi tính năng.")

    add_heading_2(doc, "4. Cài đặt API Key & Chọn máy chủ ViTTS Local (/settings)")
    add_body_p(doc, "Hệ thống hỗ trợ giảng viên sử dụng API Key cá nhân để được ưu tiên tài nguyên. Đặc biệt, hệ thống tích hợp công nghệ giọng đọc tiếng Việt ViTTS Local đặt trực tiếp trong mạng nội bộ trường, mang lại tốc độ tổng hợp âm thanh cực nhanh và bảo mật tuyệt đối.")
    
    add_screenshot_figure(doc, "04_cai_dat_api_key.png", "Hình 4: Thiết lập API Key và lựa chọn Máy chủ ViTTS Local qua thẻ trực quan")
    
    add_badge_step(doc, "1", "Dán ViTTS API Key & Nút 👁️ Xem/Ẩn", 
                   "Dán mã khóa xác thực ViTTS vào ô nhập liệu. Giảng viên có thể nhấp vào biểu tượng con mắt 👁️ ('Xem' / 'Ẩn') bên góc phải để kiểm tra chính xác từng ký tự khóa.")
    add_badge_step(doc, "2", "Chọn Máy chủ ViTTS Local qua Thẻ Radio", 
                   "Hệ thống đã cấu hình sẵn 2 máy chủ tốc độ cao trong mạng nội bộ để giảng viên lựa chọn bằng 1 chạm:\n"
                   "  • Máy chủ 1 (Mặc định): 10.64.11.16:8888 — Cụm máy chủ GPU tốc độ cao ưu tiên.\n"
                   "  • Máy chủ 2 (Dự phòng): 10.64.220.241:8889 — Máy chủ dự phòng khi tải cao.\n"
                   "  • Thêm mới: Dành cho giảng viên muốn kết nối đến máy chủ ViTTS riêng.")
    add_badge_step(doc, "3", "Nhấn nút '⚡ Kiểm tra kết nối'", 
                   "Kiểm tra tức thời xem máy chủ ViTTS được chọn có phản hồi hay không.")
    add_badge_step(doc, "4", "Nhấn nút 'Thêm' (hoặc 'Lưu')", 
                   "Xác nhận lưu lại cấu hình API Key vào hồ sơ giảng viên.")

    doc.add_page_break()

    # =========================================================================
    # PHẦN II: KHỞI TẠO MÔN HỌC & BÀI GIẢNG (BỎ QUA ĐỀ CƯƠNG)
    # =========================================================================
    add_heading_1(doc, "PHẦN II: KHỞI TẠO MÔN HỌC & BÀI GIẢNG TRỰC TIẾP")
    
    add_heading_2(doc, "1. Tạo môn học mới (/subjects)")
    add_body_p(doc, "Mỗi môn học đại diện cho một học phần giảng dạy trong học kỳ (ví dụ: Nền tảng Trí tuệ Nhân tạo, Học máy, Lập trình Python...).")
    
    add_screenshot_figure(doc, "05_danh_sach_mon_hoc.png", "Hình 5: Trang tổng quan danh sách môn giảng dạy của Giảng viên")
    
    add_badge_step(doc, "1", "Bấm '+ Tạo môn học'", 
                   "Nhấp vào nút xanh nổi bật '+ Tạo môn học' ở góc trên bên phải màn hình danh sách.")
    add_badge_step(doc, "2", "Thẻ môn học đã có", 
                   "Khu vực hiển thị danh mục các môn học đã được tạo trước đó cùng số lượng bài giảng hiện có.")

    add_body_p(doc, "Khi cửa sổ tạo môn học hiện lên, Thầy/Cô tiến hành thiết lập các thông số cơ bản cho môn học:")
    add_screenshot_figure(doc, "06_modal_tao_mon_hoc.png", "Hình 6: Hộp thoại nhập thông tin chi tiết môn học mới")
    
    add_badge_step(doc, "1", "Nhập Tên môn học", 
                   "Nhập tên đầy đủ của học phần: 'Nền tảng Trí tuệ Nhân tạo'.")
    add_badge_step(doc, "2", "Chọn Ngôn ngữ bài giảng", 
                   "Chọn ngôn ngữ sư phạm chủ đạo cho các slide và lời giảng (mặc định là 'Tiếng Việt', hỗ trợ cả Tiếng Anh, Tiếng Trung, Tiếng Hàn, Tiếng Nhật...).")
    add_badge_step(doc, "3", "Nhấn 'Tạo môn học'", 
                   "Bấm nút xác nhận để lưu và chuyển ngay vào trang quản lý chi tiết môn học.")

    add_heading_2(doc, "2. Khởi tạo bài giảng trực tiếp — BỎ QUA BƯỚC SINH ĐỀ CƯƠNG MÔN HỌC")
    
    add_callout(doc, "QUY TẮC VÀNG DÀNH CHO GIẢNG VIÊN ĐÃ CÓ GIÁO TRÌNH",
                "Nhiều Thầy/Cô thắc mắc: 'Tôi đã có sẵn giáo trình và đề cương bài giảng của bộ môn, tôi có bắt buộc phải dùng tính năng sinh đề cương môn học (Syllabus) của AI không?'\n\n"
                "👉 CÂU TRẢ LỜI LÀ: HOÀN TOÀN KHÔNG CẦN THIẾT! Thầy/Cô hãy BỎ QUA bước sinh đề cương môn học và bấm trực tiếp vào nút '+ Tạo bài giảng'. "
                "Cách làm này giúp Thầy/Cô đi thẳng vào việc tạo slide cho bài học cụ thể mà không bị AI can thiệp vào khung chương trình môn học đã được Nhà trường phê duyệt!", "warning")

    add_screenshot_figure(doc, "07_chi_tiet_mon_hoc_bo_qua_de_cuong.png", "Hình 7: Giảng viên bỏ qua bước tạo đề cương môn học và bấm tạo bài giảng ngay")
    
    add_badge_step(doc, "1", "BỎ QUA bước sinh đề cương môn học", 
                   "Không cần nhấn vào bất kỳ nút sinh đề cương nào tại đây. Hãy chuyển qua tab 'Bài giảng'.")
    add_badge_step(doc, "2", "Nhấn nút '+ Tạo bài giảng' trực tiếp", 
                   "Bấm thẳng vào nút xanh '+ Tạo bài giảng' ở góc phải để mở cửa sổ khởi tạo bài học mới.")

    add_body_p(doc, "Cửa sổ đặt tên bài giảng sẽ hiển thị ngay sau đó:")
    add_screenshot_figure(doc, "08_modal_tao_bai_giang.png", "Hình 8: Hộp thoại đặt tên bài học cụ thể trong môn học")
    
    add_badge_step(doc, "1", "Nhập Tên bài giảng", 
                   "Nhập tiêu đề chuyên đề bài giảng cụ thể: 'Bài 02: Xây dựng Mô hình Học máy Cơ bản với Scikit-Learn'.")
    add_badge_step(doc, "2", "Nhấn 'Bắt đầu soạn bài'", 
                   "Nhấp nút xác nhận để hệ thống đưa Thầy/Cô bước vào phòng làm việc Studio biên soạn với thanh tiến trình Stepper 6 bước.")

    doc.add_page_break()

    # =========================================================================
    # PHẦN III: QUY TRÌNH 6 BƯỚC BIÊN SOẠN & CÁ NHÂN HÓA BÀI GIẢNG
    # =========================================================================
    add_heading_1(doc, "PHẦN III: QUY TRÌNH 6 BƯỚC BIÊN SOẠN & CÁ NHÂN HÓA BÀI GIẢNG")
    
    add_body_p(doc, "Quy trình biên soạn của AI Teaching Assistant được mô hình hóa theo thanh tiến trình Stepper 6 bước trực quan ở đỉnh màn hình. "
                    "Đặc biệt, hệ thống thiết kế cơ chế 'AI khởi tạo ban đầu ➔ Giảng viên cá nhân hóa nội dung' xuyên suốt tất cả các bước.")

    # -------------------------------------------------------------------------
    # BƯỚC 1: NHẬP OUTLINE THÔ
    # -------------------------------------------------------------------------
    add_heading_2(doc, "Chương 5: Bước 1 — Nhập Outline thô / Nội dung giáo trình")
    add_body_p(doc, "Tại bước này, giảng viên không cần phải định dạng cầu kỳ. Hãy sao chép (Copy) nội dung từ file Word, PDF giáo trình, giáo án hiện có hoặc các gạch đầu dòng ghi chú của Thầy/Cô và dán (Paste) vào khung nhập liệu.")
    
    add_screenshot_figure(doc, "09_buoc1_nhap_outline_tho.png", "Hình 9: Bước 1 — Dán nội dung outline thô hoặc ghi chú bài giảng Scikit-Learn")
    
    add_badge_step(doc, "1", "Chỉ báo Stepper Bước 1: Nhập Outline", 
                   "Thanh Stepper hiển thị trạng thái hiện tại đang ở Bước 1.")
    add_badge_step(doc, "2", "Khung Textarea dán dàn ý thô / tài liệu", 
                   "Giảng viên dán các ý chính cần dạy trong buổi học. Ví dụ mẫu cho bài Học máy với Scikit-Learn:\n"
                   "  1. Giới thiệu tổng quan về thư viện Scikit-Learn trong Python\n"
                   "  2. Khái niệm cốt lõi: Fit & Predict trong học máy có giám sát\n"
                   "  3. Chuẩn bị dữ liệu: Phân tách train_test_split và tiền xử lý Feature Scaling\n"
                   "  4. Huấn luyện các mô hình phân lớp cơ bản (KNN, Decision Tree, Logistic Regression)\n"
                   "  5. Đánh giá độ chính xác mô hình: Accuracy, Confusion Matrix và Classification Report")
    add_badge_step(doc, "3", "Nhấn nút 'Tạo dàn ý với AI'", 
                   "Bấm nút để lưu trữ và kích hoạt AI tiến hành phân tích ngữ nghĩa, cấu trúc bài học thành các chương mục chuẩn sư phạm.")

    # -------------------------------------------------------------------------
    # BƯỚC 2: TẠO OUTLINE & CÁ NHÂN HÓA DÀN Ý
    # -------------------------------------------------------------------------
    add_heading_2(doc, "Chương 6: Bước 2 — Khởi tạo Dàn ý với AI & Cá nhân hóa Dàn ý bài giảng")
    add_body_p(doc, "Ở bước này, quy trình cá nhân hóa diễn ra theo 2 giai đoạn rõ ràng: "
                    "Đầu tiên nhấn nút AI để sinh dàn bài chi tiết chuẩn; sau đó nhấp vào nút sửa để điều chỉnh theo đúng giáo án riêng của giảng viên.")
    
    add_screenshot_figure(doc, "10_buoc2_tao_outline_ai.png", "Hình 10: Bước 2 — Màn hình khởi tạo với nút '🤖 Tạo với AI' và chọn Model AI")
    
    add_badge_step(doc, "1", "Chỉ báo Stepper Bước 2: Tạo Outline Chi Tiết", 
                   "Đang ở giai đoạn cấu trúc đề cương chi tiết của bài giảng.")
    add_badge_step(doc, "2", "Nhấn nút '🤖 Tạo với AI'", 
                   "Bấm nút để AI tự động phân tích dàn ý thô và sinh ra toàn bộ: Mục tiêu bài học (Objectives), Nội dung từng phần (Agenda), Hướng dẫn học tập và Câu hỏi tương tác.")
    add_badge_step(doc, "3", "Lựa chọn Model AI", 
                   "Giảng viên có thể linh hoạt chọn giữa các model AI tốc độ cao (Gemini Flash) hoặc model lý luận chuyên sâu (GPT-5.6 / Gemini Pro).")

    add_body_p(doc, "Sau khi AI sinh xong dàn bài, giảng viên tiến hành cá nhân hóa nội dung để phù hợp nhất với lớp học:")
    add_screenshot_figure(doc, "11_buoc2_sua_dan_y.png", "Hình 11: Bước 2 — Chế độ '⚙️ Sửa JSON' cho phép giảng viên tùy biến toàn bộ dàn bài")
    
    add_badge_step(doc, "1", "Nút '⚙️ Sửa JSON' mở chế độ chỉnh sửa", 
                   "Nhấp vào nút '⚙️ Sửa JSON' trên thanh tiêu đề để chuyển giao diện sang khung soạn thảo nội dung trực tiếp.")
    add_badge_step(doc, "2", "Tùy biến mục tiêu & nội dung cá nhân hóa", 
                   "Giảng viên có thể tự do chỉnh sửa câu chữ, bổ sung ví dụ thực tế của bộ môn, thêm bớt các mục con hoặc định nghĩa lại chuẩn đầu ra theo ý mình.")
    add_badge_step(doc, "3", "Nhấn '💾 Lưu thay đổi'", 
                   "Bấm nút lưu để hệ thống cập nhật dàn ý cá nhân hóa mới nhất vào cơ sở dữ liệu bài học.")

    # -------------------------------------------------------------------------
    # BƯỚC 3: THIẾT KẾ KỊCH BẢN SLIDE & CÁ NHÂN HÓA LỜI GIẢNG
    # -------------------------------------------------------------------------
    add_heading_2(doc, "Chương 7: Bước 3 — Thiết kế Kịch bản Slide & Cá nhân hóa Văn phong Lời giảng")
    add_body_p(doc, "Tại bước này, hệ thống tập trung phân bổ nội dung thành từng trang slide và soạn thảo Lời giảng chi tiết của giảng viên (Speaker Notes). "
                    "Lưu ý: Bước tạo và thay thế hình ảnh được thực hiện tập trung tại Bước 5 (Tạo PPTX). Tại Bước 3, giảng viên hoàn toàn làm chủ kịch bản chữ và lời thoại.")
    
    add_screenshot_figure(doc, "12_buoc3_tao_kich_ban.png", "Hình 12: Bước 3 — Khởi tạo kịch bản slide và lời giảng với nút '🤖 Tạo Kịch Bản'")
    
    add_badge_step(doc, "1", "Chỉ báo Stepper Bước 3: Thiết Kế Slide", 
                   "Đang ở giai đoạn thiết kế kịch bản trình chiếu.")
    add_badge_step(doc, "2", "Nhấn nút '🤖 Tạo Kịch Bản'", 
                   "AI sẽ tự động chia nhỏ bài học thành các slide cụ thể: Slide giới thiệu, Slide mục tiêu, các Slide lý thuyết trọng tâm và Slide tổng kết.")
    add_badge_step(doc, "3", "Lựa chọn Model AI thiết kế", 
                   "Tùy chọn mô hình AI chuyên trách soạn thảo giáo án sư phạm.")

    add_body_p(doc, "Sau khi AI tạo xong các slide, giảng viên mở chế độ chỉnh sửa để cá nhân hóa lời giảng theo giọng điệu sư phạm của riêng mình:")
    add_screenshot_figure(doc, "13_buoc3_sua_kich_ban.png", "Hình 13: Bước 3 — Nút '⚙️ Sửa JSON' để tinh chỉnh tiêu đề, nội dung và lời giảng từng slide")
    
    add_badge_step(doc, "1", "Nút '⚙️ Sửa JSON' kịch bản", 
                   "Nhấp vào nút để mở khung chỉnh sửa toàn diện kịch bản bài học.")
    add_badge_step(doc, "2", "Cá nhân hóa nội dung slide & lời giảng", 
                   "Giảng viên có thể điều chỉnh lại từng câu thoại trong 'speakerNote', viết lại các bullet points cô đọng hơn, hoặc đưa thêm các câu hỏi gợi mở cho sinh viên.")
    add_badge_step(doc, "3", "Nhấn '💾 Lưu thay đổi' kịch bản", 
                   "Xác nhận lưu kịch bản đã được cá nhân hóa thành công.")

    # -------------------------------------------------------------------------
    # BƯỚC 4: TẠO AUDIO & CHỌN GIỌNG CLONE CÁ NHÂN HÓA
    # -------------------------------------------------------------------------
    add_heading_2(doc, "Chương 8: Bước 4 — Lựa chọn Giọng Clone Giảng viên & Tinh chỉnh Lời giảng Audio")
    add_body_p(doc, "Đây là điểm đột phá lớn nhất của hệ thống: Thay vì dùng các giọng đọc máy móc phổ thông, "
                    "hệ thống cho phép giảng viên chọn GIỌNG CLONE (Clone Voice) được huấn luyện từ chính giọng nói của Thầy/Cô. "
                    "Bài giảng xuất ra sẽ vang lên chính xác bằng chất giọng truyền cảm quen thuộc của giảng viên!")
    
    add_screenshot_figure(doc, "14_buoc4_chon_giong_clone.png", "Hình 14: Bước 4 — Chọn Nhà cung cấp ViTTS và chế độ 'Giọng clone' cá nhân hóa giọng nói")
    
    add_badge_step(doc, "1", "Chọn Nhà cung cấp '🎙️ ViTTS'", 
                   "Bấm vào nút chọn ViTTS để sử dụng động cơ chuyển văn bản thành giọng nói tiếng Việt chất lượng cao.")
    add_badge_step(doc, "2", "Chọn Chế độ '🎤 Giọng clone'", 
                   "Nhấp vào nút '🎤 Giọng clone' để kích hoạt thư viện giọng đọc mẫu cá nhân của giảng viên.")
    add_badge_step(doc, "3", "Chọn Giọng clone mẫu từ danh sách", 
                   "Mở danh sách thả xuống và chọn đúng tên mẫu giọng của Thầy/Cô (ví dụ: giọng mẫu 'thuong' thời lượng 11.8s). Toàn bộ bài giảng sau đó sẽ được tổng hợp âm thanh bằng đúng chất giọng này!")

    add_body_p(doc, "Bên cạnh việc chọn giọng clone, giảng viên có thể xem xét đối chiếu 3 cột và sửa riêng lẻ lời giảng của từng trang slide:")
    add_screenshot_figure(doc, "15_buoc4_kiem_duyet_tao_audio.png", "Hình 15: Bước 4 — Chỉnh sửa lời giảng từng slide bằng nút ✏️, Tối ưu hóa và Tạo Audio hàng loạt")
    
    add_badge_step(doc, "1", "Chỉnh sửa lời giảng riêng từng slide & Lưu", 
                   "Tại cột 'Lời Giảng (Tối Ưu)', nhấp vào biểu tượng chiếc bút chì ✏️ để sửa nhanh câu chữ của slide đó, sau đó bấm '💾 Lưu'.")
    add_badge_step(doc, "2", "Nhấn '✅ Tối Ưu & Kiểm Duyệt'", 
                   "AI sẽ tự động rà soát: sửa lỗi chính tả, ngắt câu nhịp nhàng, phiên âm từ viết tắt kỹ thuật (như 'Scikit-Learn', 'Train', 'Test') để máy chủ ViTTS đọc mượt mà nhất.")
    add_badge_step(doc, "3", "Nhấn '🎙️ Tạo Audio Tất Cả'", 
                   "Khởi chạy tiến trình sinh file âm thanh .mp3 cho tất cả các slide trong bài giảng.")

    # -------------------------------------------------------------------------
    # BƯỚC 5: TẠO PPTX, SỬA NỘI DUNG SLIDE & CẮT ẢNH 1:1
    # -------------------------------------------------------------------------
    add_heading_2(doc, "Chương 9: Bước 5 — Xuất PowerPoint, Sửa nội dung slide, Đổi ảnh & Cắt ảnh 1:1")
    add_body_p(doc, "Tại Bước 5, hệ thống hiển thị trực quan toàn bộ các slide hoàn chỉnh kèm hình ảnh. "
                    "Giảng viên có toàn quyền: sửa trực tiếp tiêu đề/nội dung từng slide bằng nút '✏️ Sửa nội dung', yêu cầu AI vẽ lại ảnh, hoặc tự tải ảnh từ máy tính cá nhân lên.")
    
    add_screenshot_figure(doc, "16_buoc5_tao_pptx_va_sua_slide.png", "Hình 16: Bước 5 — Tùy biến nội dung slide trực tiếp, đổi ảnh minh họa và xuất file PPTX")
    
    add_badge_step(doc, "1", "Sửa trực tiếp tiêu đề, ý chính & Lưu nội dung", 
                   "Bấm nút '✏️ Sửa nội dung' trên slide: khung biên tập trực quan mở ra cho phép sửa Tiêu đề, từng gạch đầu dòng ý chính, icon emoji, thêm ý mới và nhấn '💾 Lưu nội dung'.")
    add_badge_step(doc, "2", "Nhấn '📤 Đổi ảnh' tải ảnh máy tính hoặc Tạo lại AI", 
                   "Nếu muốn dùng sơ đồ thuật toán, ảnh chụp màn hình code hoặc ảnh thực tế của giảng viên, nhấp vào nút '📤 Đổi ảnh' (hoặc '🖼️ Tạo lại ảnh AI' để AI vẽ lại phong cách khác).")
    add_badge_step(doc, "3", "Nhấn Tạo file PowerPoint (có Audio)", 
                   "Chọn Mẫu giao diện yêu thích và nhấn '📦 Tạo PPTX (có Audio)' để tải bài giảng hoàn chỉnh về máy tính.")

    add_body_p(doc, "Khi giảng viên tải ảnh từ máy tính lên, công cụ Cắt & Căn chỉnh ảnh tỷ lệ 1:1 độc quyền sẽ tự động xuất hiện:")
    add_screenshot_figure(doc, "17_buoc5_crop_resize_anh.png", "Hình 17: Công cụ Căn chỉnh & Tự động Resize ảnh tỷ lệ chuẩn 1:1 chuyên nghiệp")
    
    add_badge_step(doc, "1", "Khung Cắt & Thu phóng ảnh chuẩn 1:1", 
                   "Khung hình vuông với lưới tỷ lệ vàng. Giảng viên kéo rê bức ảnh để chọn góc hiển thị đẹp nhất.")
    add_badge_step(doc, "2", "Phóng to / Thu nhỏ & Căn giữa", 
                   "Sử dụng thanh trượt Zoom hoặc các nút tiện ích: '📐 Vừa khung (100%)', '🔍 Lấp đầy khung' và tùy chọn màu viền thừa (Trắng, Tối, Xám nhạt).")
    add_badge_step(doc, "3", "Nhấn Áp dụng & Lưu ảnh", 
                   "Hệ thống tự động nén và resize ảnh chuẩn 1024×1024 pixel rồi gắn ngay vào slide PowerPoint.")

    doc.add_page_break()

    # =========================================================================
    # PHẦN IV: NGÂN HÀNG CÂU HỎI TRẮC NGHIỆM & XUẤT MOODLE XML
    # =========================================================================
    add_heading_1(doc, "PHẦN IV: NGÂN HÀNG CÂU HỎI TRẮC NGHIỆM & ĐÓNG GÓI LMS")
    
    add_heading_2(doc, "Chương 10: Bước 6 — Thiết lập Câu hỏi Bloom, Chỉnh sửa trực tiếp & Xuất Moodle XML")
    add_body_p(doc, "Đánh giá kết quả học tập là khâu then chốt trong sư phạm. "
                    "Hệ thống hỗ trợ tạo câu hỏi trắc nghiệm theo 3 cấp độ nhận thức của Thang đo Bloom (Biết, Hiểu, Vận dụng), "
                    "cho phép giảng viên chỉnh sửa trực tiếp từng câu hỏi/đáp án/giải thích và xuất file Moodle XML nạp thẳng vào LMS trường.")
    
    add_screenshot_figure(doc, "18_buoc6_tao_cau_hoi.png", "Hình 18: Bước 6 — Thiết lập số lượng câu hỏi ôn tập theo 3 cấp độ Thang đo Bloom")
    
    add_badge_step(doc, "1", "Tab '📝 Câu hỏi Ôn tập (Bloom Taxonomy)'", 
                   "Chuyển sang tab ngân hàng câu hỏi ôn tập tổng hợp.")
    add_badge_step(doc, "2", "Thiết lập số lượng câu theo 3 cấp độ Bloom", 
                   "Giảng viên nhập số lượng câu hỏi mong muốn cho từng mức độ:\n"
                   "  • Mức 1 (Biết): Nhận biết khái niệm, cú pháp lệnh Scikit-Learn cơ bản.\n"
                   "  • Mức 2 (Hiểu): Hiểu bản chất các tham số và thuật toán học máy.\n"
                   "  • Mức 3 (Vận dụng): Tình huống xử lý dữ liệu và đánh giá mô hình thực tế.")
    add_badge_step(doc, "3", "Nhấn '🤖 Tạo Mới'", 
                   "Bấm nút để AI tự động đối chiếu nội dung bài giảng và sinh bộ câu hỏi trắc nghiệm tương ứng.")

    add_body_p(doc, "Sau khi có danh sách câu hỏi, giảng viên có thể sửa trực tiếp từng câu và tải về định dạng Moodle XML chuẩn:")
    add_screenshot_figure(doc, "19_buoc6_sua_va_xuat_moodle.png", "Hình 19: Bước 6 — Chỉnh sửa câu hỏi trực tiếp bằng nút ✏️ và xuất Moodle XML / Excel")
    
    add_badge_step(doc, "1", "Sửa câu hỏi & đáp án", 
                   "Nhấp vào nút ✏️ tại hàng câu hỏi để sửa trực tiếp Nội dung câu hỏi, Đáp án đúng (A), các phương án gây nhiễu (B, C, D) và Lời giải thích chi tiết, sau đó nhấn 💾 Lưu.")
    add_badge_step(doc, "2", "Xuất Moodle XML", 
                   "Nhấn nút '📋 Xuất Moodle XML' để tải về tệp tin XML chuẩn quốc tế. Giảng viên vào hệ thống LMS Moodle của trường, chọn 'Import' là toàn bộ câu hỏi được nạp vào ngân hàng đề thi trong 3 giây!")
    add_badge_step(doc, "3", "Xuất Excel", 
                   "Nhấn '📊 Xuất Excel Ôn tập' để tải bảng tính Excel hoàn chỉnh phục vụ in ấn đề thi giấy hoặc lưu trữ hồ sơ chuyên môn.")

    add_callout(doc, "Tương thích 100% với hệ thống LMS trường học",
                "Tệp Moodle XML xuất ra từ hệ thống đã được kiểm định tương thích tuyệt đối với: Moodle 3.x, Moodle 4.x, Canvas LMS, Blackboard, "
                "và các cổng thi trắc nghiệm trực tuyến của các trường Đại học tại Việt Nam.", "tip")

    # =========================================================================
    # PHẦN V: TỔNG KẾT & KINH NGHIỆM THỰC HÀNH TỐI ƯU
    # =========================================================================
    add_heading_1(doc, "PHẦN V: BẢNG TỔNG HỢP CÁC BƯỚC CÁ NHÂN HÓA DÀNH CHO GIẢNG VIÊN")
    
    pers_table = doc.add_table(rows=6, cols=3)
    pers_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(pers_table)
    
    p_headers = ["Thành phần bài giảng", "Vị trí thao tác", "Quyền kiểm soát của Giảng viên"]
    for i, h_text in enumerate(p_headers):
        cell = pers_table.cell(0, i)
        set_cell_background(cell, "1E3A8A")
        set_cell_margins(cell, top=140, bottom=140, left=160, right=160)
        p = cell.paragraphs[0]
        p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(h_text)
        r.font.name = 'Arial'
        r.font.size = Pt(10)
        r.font.bold = True
        r.font.color.rgb = COLOR_WHITE
        
    p_rows = [
        ("Dàn ý bài giảng (Outline)", "Bước 2 ➔ Nút '⚙️ Sửa JSON'", "Tự do chỉnh sửa mục tiêu, thêm bớt bài tập, thay đổi thời lượng từng phần."),
        ("Kịch bản Slide (Script)", "Bước 3 ➔ Nút '⚙️ Sửa JSON'", "Tùy biến tiêu đề slide, câu chữ bullet points và lời thoại sư phạm của giảng viên."),
        ("Giọng đọc thuyết minh (Voice)", "Bước 4 ➔ Chế độ 'Giọng clone'", "Sử dụng giọng nói thật của chính giảng viên để thuyết minh bài giảng."),
        ("Lời giảng âm thanh (Notes)", "Bước 4 ➔ Nút '✏️' trên từng slide", "Sửa riêng lẻ câu thoại cho từng slide mà không làm ảnh hưởng các slide khác."),
        ("Nội dung & Ảnh slide PPTX", "Bước 5 ➔ Nút '✏️ Sửa nội dung' & '📤 Đổi ảnh'", "Sửa chữ trực tiếp trên slide, tải ảnh từ máy tính, cắt ảnh tỷ lệ 1:1 chuẩn xác."),
    ]
    for row_idx, r_data in enumerate(p_rows, start=1):
        bg = "F8FAFC" if row_idx % 2 == 1 else "FFFFFF"
        for col_idx, text in enumerate(r_data):
            cell = pers_table.cell(row_idx, col_idx)
            set_cell_background(cell, bg)
            set_cell_margins(cell, top=100, bottom=100, left=140, right=140)
            p = cell.paragraphs[0]
            p.paragraph_format.line_spacing = 1.15
            r = p.add_run(text)
            r.font.name = 'Arial'
            r.font.size = Pt(9.5)
            if col_idx == 0:
                r.font.bold = True
                r.font.color.rgb = COLOR_ACCENT

    doc.add_paragraph().paragraph_format.space_after = Pt(20)

    # Concluding signature box
    sig_p = doc.add_paragraph()
    sig_p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    sig_p.paragraph_format.line_spacing = 1.2
    r_sig1 = sig_p.add_run("BAN BIÊN TẬP NỀN TẢNG AI TEACHING ASSISTANT\n")
    r_sig1.font.name = 'Arial'
    r_sig1.font.size = Pt(10.5)
    r_sig1.font.bold = True
    r_sig1.font.color.rgb = COLOR_PRIMARY
    
    r_sig2 = sig_p.add_run("Kính chúc Quý Thầy/Cô có những tiết giảng số hiện đại, trực quan và hiệu quả!")
    r_sig2.font.name = 'Arial'
    r_sig2.font.size = Pt(10)
    r_sig2.font.italic = True
    r_sig2.font.color.rgb = COLOR_MUTED

    doc.save(OUTPUT_DOCX)
    print(f"=== Document successfully generated: {OUTPUT_DOCX} ===")

if __name__ == '__main__':
    build_user_guide()
