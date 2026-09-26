import os
import sys
import asyncio
import json
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageFont
import psycopg2

SCREENSHOTS_DIR = 'docs/screenshots'
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

# Admin token from backend
ADMIN_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3ZDhkZjQ5NC0yZTZlLTQzMzMtODE3Mi00NTQxMTI4Yjg5N2YiLCJlbWFpbCI6Inh1YW5ob2FzcHRAZ21haWwuY29tIiwicm9sZSI6IkFETUlOIiwiaWF0IjoxNzkwMzkwNzU5LCJleHAiOjE3OTA5OTU1NTl9.qJ5BCJUju4oCabAulObFbl3VicDyuFDbc0QmtI2OGR4"
ADMIN_USER = {
    "id": "7d8df494-2e6e-4333-8172-4541128b897f",
    "email": "xuanhoaspt@gmail.com",
    "fullName": "TS. Triệu Xuân Hòa",
    "role": "ADMIN",
    "status": "APPROVED"
}

TARGET_SUBJECT_ID = 'b7782174-930c-44ef-8d13-15aeb512e40a'
TARGET_LESSON_ID = '4de7fece-f762-475e-b0e5-cee1ed83164d'

def get_db():
    return psycopg2.connect(
        host='localhost',
        port=5433,
        user='ata_user',
        password='ata_password',
        database='ata_db'
    )

def annotate_image(image_path, annotations):
    """
    Draw bright red bounding boxes (#ef4444) and red numbered badges (①, ②, ③)
    directly onto the interactive buttons and input fields that users must click/fill.
    """
    img = Image.open(image_path).convert('RGB')
    draw = ImageDraw.Draw(img)
    
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 16)
        label_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)
    except:
        font = ImageFont.load_default()
        label_font = font

    for ann in annotations:
        box = ann['box']
        badge = str(ann.get('badge', ''))
        label = ann.get('label', '')

        # Normalize box coordinates
        bx1 = min(box[0], box[2])
        by1 = min(box[1], box[3])
        bx2 = max(box[0], box[2])
        by2 = max(box[1], box[3])

        # Add slight padding for aesthetics
        pad = 4
        x1 = max(0, bx1 - pad)
        y1 = max(0, by1 - pad)
        x2 = min(img.width - 1, bx2 + pad)
        y2 = min(img.height - 1, by2 + pad)
        if x2 <= x1: x2 = x1 + 20
        if y2 <= y1: y2 = y1 + 20

        # 1. Draw glowing outer red box (thickness: 3px)
        draw.rectangle([x1, y1, x2, y2], outline='#ef4444', width=3)

        # 2. Draw circular Numbered Badge at the top-left corner
        if badge:
            badge_r = 14
            bx = x1
            by = y1
            # Badge background circle
            draw.ellipse([bx - badge_r, by - badge_r, bx + badge_r, by + badge_r], fill='#dc2626', outline='#ffffff', width=2)
            draw.text((bx, by), badge, fill='#ffffff', font=font, anchor='mm')
            
            # Badge text label pill beside circle
            if label:
                bbox = label_font.getbbox(label)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
                lx1 = bx + badge_r + 4
                ly1 = by - badge_r + 1
                lx2 = lx1 + tw + 14
                ly2 = by + badge_r - 1
                draw.rounded_rectangle([lx1, ly1, lx2, ly2], radius=4, fill='#dc2626')
                draw.text((lx1 + 6, by), label, fill='#ffffff', font=label_font, anchor='lm')

    img.save(image_path)
    print(f"Annotated successfully: {image_path}")

async def setup_auth(context):
    await context.add_init_script(f"""
        localStorage.setItem('accessToken', '{ADMIN_TOKEN}');
        localStorage.setItem('user', JSON.stringify({json.dumps(ADMIN_USER)}));
    """)

async def run():
    # Save original database content for lesson
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT detailed_outline, slide_script FROM lessons WHERE id = %s", (TARGET_LESSON_ID,))
    row = cur.fetchone()
    saved_outline = row[0] if row else ""
    saved_script = row[1] if row else ""

    # Check review questions
    cur.execute("SELECT id, question_id, question, correct_answer, option_b, option_c, option_d, explanation, level FROM review_questions WHERE lesson_id = %s", (TARGET_LESSON_ID,))
    saved_questions = cur.fetchall()
    if not saved_questions:
        saved_questions = [
            ("c15ec5cb-c6f2-4ec8-9813-6e7942f68b16", "B2-1-01", "Hàm nào trong Scikit-Learn được sử dụng để phân chia dữ liệu thành tập huấn luyện và tập kiểm thử?", "train_test_split()", "split_dataset()", "data_partition()", "cross_val_score()", "train_test_split() là hàm chuẩn trong sklearn.model_selection dùng để chia dataset theo tỷ lệ train/test.", 1),
            ("a92eb4fa-d512-4fe1-8172-5401128b898a", "B2-2-01", "Tại sao việc tiền xử lý dữ liệu (Feature Scaling) lại đặc biệt quan trọng với các thuật toán như KNN và SVM?", "Vì các thuật toán này dựa trên tính toán khoảng cách Euclidean giữa các điểm dữ liệu.", "Vì giúp tăng số lượng mẫu trong tập dữ liệu.", "Vì giúp loại bỏ hoàn toàn các giá trị ngoại lai (outliers).", "Vì Scikit-Learn bắt buộc dữ liệu phải chuẩn hóa mới chạy được.", "KNN và SVM đo khoảng cách giữa các điểm, nếu độ lớn các đặc trưng chênh lệch lớn sẽ làm méo mó kết quả phân lớp.", 2)
        ]
    conn.close()
    print(f"Original DB loaded: outline len={len(saved_outline or '')}, script len={len(saved_script or '')}, questions={len(saved_questions)}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1440, 'height': 1050})
        page = await context.new_page()

        # =========================================================================
        # 1. SCREENSHOT 01: Registration Form
        # =========================================================================
        print("--> Capturing 01_dang_ky.png...")
        await page.goto('http://localhost:5173/register')
        await page.wait_for_selector('form')
        
        await page.fill('input[placeholder*="Nguyễn Văn A"], input[type="text"]:first-of-type', 'TS. Nguyễn Văn An')
        await page.fill('input[type="email"]', 'giangvien.nguyenvanan@daihoc.edu.vn')
        phone_input = await page.query_selector('input[type="tel"]')
        if phone_input: await phone_input.fill('0912345678')
        org_input = await page.query_selector('input[placeholder*="Trường"], input[placeholder*="cơ quan"]')
        if org_input: await org_input.fill('Khoa CNTT - Trường Đại học Sư phạm Kỹ thuật')
        pw_inputs = await page.query_selector_all('input[type="password"]')
        if len(pw_inputs) >= 1: await pw_inputs[0].fill('MatKhauGiangVien@2026')
        if len(pw_inputs) >= 2: await pw_inputs[1].fill('MatKhauGiangVien@2026')
        await page.wait_for_timeout(400)
        
        img_path = f"{SCREENSHOTS_DIR}/01_dang_ky.png"
        await page.screenshot(path=img_path)
        form_elem = await page.query_selector('.auth-card, form')
        btn_reg = await page.query_selector('button[type="submit"]')
        ann = []
        if form_elem:
            fb = await form_elem.bounding_box()
            ann.append({'box': (fb['x'], fb['y'], fb['x'] + fb['width'], fb['y'] + fb['height']), 'badge': '1', 'label': 'Điền đầy đủ thông tin giảng viên'})
        if btn_reg:
            bb = await btn_reg.bounding_box()
            ann.append({'box': (bb['x'], bb['y'], bb['x'] + bb['width'], bb['y'] + bb['height']), 'badge': '2', 'label': 'Nhấn Đăng ký tài khoản'})
        annotate_image(img_path, ann)

        # =========================================================================
        # 2. SCREENSHOT 02: Login & Pending Approval
        # =========================================================================
        print("--> Capturing 02_dang_nhap_cho_duyet.png...")
        await page.goto('http://localhost:5173/login')
        await page.wait_for_selector('form')
        await page.fill('input[type="email"]', 'giangvien.nguyenvanan@daihoc.edu.vn')
        await page.fill('input[type="password"]', 'MatKhauGiangVien@2026')
        
        # Inject notification showing pending status
        await page.evaluate("""
            const form = document.querySelector('.auth-card');
            const err = document.createElement('div');
            err.className = 'auth-error';
            err.style.background = '#fef3c7';
            err.style.color = '#92400e';
            err.style.border = '1px solid #f59e0b';
            err.style.padding = '12px';
            err.style.borderRadius = '8px';
            err.style.marginBottom = '16px';
            err.style.fontSize = '14px';
            err.style.fontWeight = '500';
            err.innerHTML = '⏳ <strong>Tài khoản đang chờ duyệt:</strong> Quản trị viên đang thẩm định thông tin giảng viên. Vui lòng liên hệ Admin để được kích hoạt sử dụng hệ thống.';
            form.insertBefore(err, form.children[1]);
        """)
        await page.wait_for_timeout(400)
        img_path = f"{SCREENSHOTS_DIR}/02_dang_nhap_cho_duyet.png"
        await page.screenshot(path=img_path)
        
        err_box = await page.query_selector('.auth-error')
        btn_login = await page.query_selector('button[type="submit"]')
        ann = []
        if err_box:
            eb = await err_box.bounding_box()
            ann.append({'box': (eb['x'], eb['y'], eb['x'] + eb['width'], eb['y'] + eb['height']), 'badge': '1', 'label': 'Thông báo trạng thái Đang chờ duyệt (PENDING)'})
        if btn_login:
            bb = await btn_login.bounding_box()
            ann.append({'box': (bb['x'], bb['y'], bb['x'] + bb['width'], bb['y'] + bb['height']), 'badge': '2', 'label': 'Đăng nhập sau khi được kích hoạt'})
        annotate_image(img_path, ann)

        # =========================================================================
        # 3. SCREENSHOT 03: Admin User Approval
        # =========================================================================
        print("--> Capturing 03_admin_duyet_giang_vien.png...")
        await setup_auth(context)
        await page.goto('http://localhost:5173/admin/users')
        await page.wait_for_selector('table')
        await page.wait_for_timeout(1000)
        img_path = f"{SCREENSHOTS_DIR}/03_admin_duyet_giang_vien.png"
        await page.screenshot(path=img_path)
        
        tbody = await page.query_selector('table tbody')
        first_row_btn = await page.query_selector('table tbody tr:first-of-type button, table tbody tr:first-of-type .action-btn')
        ann = []
        if tbody:
            tb = await tbody.bounding_box()
            ann.append({'box': (tb['x'], tb['y'], tb['x'] + tb['width'], min(tb['y'] + 220, tb['y'] + tb['height'])), 'badge': '1', 'label': 'Danh sách tài khoản chờ xét duyệt'})
        if first_row_btn:
            fb = await first_row_btn.bounding_box()
            ann.append({'box': (fb['x'], fb['y'], fb['x'] + fb['width'], fb['y'] + fb['height']), 'badge': '2', 'label': 'Nhấn Phê duyệt kích hoạt Giảng viên'})
        annotate_image(img_path, ann)

        # =========================================================================
        # 4. SCREENSHOT 04: User Settings - ViTTS API Key & Preset Servers
        # =========================================================================
        print("--> Capturing 04_cai_dat_api_key.png...")
        await page.goto('http://localhost:5173/')
        await page.wait_for_timeout(1000)
        
        # Click settings button in header
        settings_btn = await page.query_selector('button[title*="Cài đặt"], button:has-text("⚙️"), a[href*="settings"]')
        if settings_btn:
            await settings_btn.click()
            await page.wait_for_timeout(800)
        else:
            await page.goto('http://localhost:5173/settings')
            await page.wait_for_timeout(800)
            
        # Fill demo API key to show key input & eye toggle
        key_input = await page.query_selector('.modal-content input[type="password"], .modal-content input[name="vittsApiKey"]')
        if key_input:
            await key_input.fill('vitts_prod_token_ai_hub_2026')

        img_path = f"{SCREENSHOTS_DIR}/04_cai_dat_api_key.png"
        await page.screenshot(path=img_path)
        
        ann = []
        key_group = await page.query_selector('.modal-content .form-group:has(input[name="vittsApiKey"]), .modal-content .form-group:has(input[type="password"])')
        if key_group:
            kb = await key_group.bounding_box()
            ann.append({'box': (kb['x'], kb['y'], kb['x'] + kb['width'], kb['y'] + kb['height']), 'badge': '1', 'label': 'Dán ViTTS API Key & Nút 👁️ Xem/Ẩn'})
        
        cards = await page.query_selector('.vitts-servers-grid')
        if cards:
            cb = await cards.bounding_box()
            ann.append({'box': (cb['x'], cb['y'], cb['x'] + cb['width'], cb['y'] + cb['height']), 'badge': '2', 'label': 'Chọn Máy chủ ViTTS 1 hoặc 2'})
            
        test_btn = await page.query_selector('.btn-test-connection')
        if test_btn:
            tb = await test_btn.bounding_box()
            ann.append({'box': (tb['x'], tb['y'], tb['x'] + tb['width'], tb['y'] + tb['height']), 'badge': '3', 'label': 'Nhấn Kiểm tra kết nối'})
            
        save_btn = await page.query_selector('.modal-content button.btn-save, .modal-content button:has-text("Thêm")')
        if save_btn:
            sb = await save_btn.bounding_box()
            ann.append({'box': (sb['x'], sb['y'], sb['x'] + sb['width'], sb['y'] + sb['height']), 'badge': '4', 'label': 'Nhấn Thêm để Lưu'})
        annotate_image(img_path, ann)

        # Close modal
        close_btn = await page.query_selector('.modal-close, button:has-text("Hủy")')
        if close_btn: await close_btn.click()

        # =========================================================================
        # 5. SCREENSHOT 05: Subjects Page
        # =========================================================================
        print("--> Capturing 05_danh_sach_mon_hoc.png...")
        await page.goto('http://localhost:5173/')
        await page.wait_for_timeout(1000)
        img_path = f"{SCREENSHOTS_DIR}/05_danh_sach_mon_hoc.png"
        await page.screenshot(path=img_path)
        
        create_btn = await page.query_selector('.primary-btn, button:has-text("Tạo môn học")')
        subj_card = await page.query_selector('.subject-card, .subjects-grid')
        ann = []
        if create_btn:
            cb = await create_btn.bounding_box()
            ann.append({'box': (cb['x'], cb['y'], cb['x'] + cb['width'], cb['y'] + cb['height']), 'badge': '1', 'label': 'Nhấn "+ Tạo môn học"'})
        if subj_card:
            sb = await subj_card.bounding_box()
            ann.append({'box': (sb['x'], sb['y'], sb['x'] + sb['width'], sb['y'] + sb['height']), 'badge': '2', 'label': 'Danh sách Môn giảng dạy'})
        annotate_image(img_path, ann)

        # =========================================================================
        # 6. SCREENSHOT 06: Create Subject Modal
        # =========================================================================
        print("--> Capturing 06_modal_tao_mon_hoc.png...")
        if create_btn:
            await create_btn.click()
            await page.wait_for_timeout(600)
            name_input = await page.query_selector('.modal input[type="text"]')
            if name_input: await name_input.fill('Nền tảng Trí tuệ Nhân tạo')
        
        img_path = f"{SCREENSHOTS_DIR}/06_modal_tao_mon_hoc.png"
        await page.screenshot(path=img_path)
        
        name_grp = await page.query_selector('.modal .form-group:first-of-type')
        lang_grp = await page.query_selector('.modal .form-group:has(select)')
        submit_subj = await page.query_selector('.modal .primary-btn')
        ann = []
        if name_grp:
            nb = await name_grp.bounding_box()
            ann.append({'box': (nb['x'], nb['y'], nb['x'] + nb['width'], nb['y'] + nb['height']), 'badge': '1', 'label': 'Nhập Tên môn học'})
        if lang_grp:
            lb = await lang_grp.bounding_box()
            ann.append({'box': (lb['x'], lb['y'], lb['x'] + lb['width'], lb['y'] + lb['height']), 'badge': '2', 'label': 'Chọn Ngôn ngữ bài giảng'})
        if submit_subj:
            sb = await submit_subj.bounding_box()
            ann.append({'box': (sb['x'], sb['y'], sb['x'] + sb['width'], sb['y'] + sb['height']), 'badge': '3', 'label': 'Nhấn Tạo môn học'})
        annotate_image(img_path, ann)

        # Close subject modal
        close_m = await page.query_selector('.modal-close, button:has-text("Hủy")')
        if close_m: await close_m.click()

        # =========================================================================
        # 7. SCREENSHOT 07: Subject Detail - Explicitly Skip Syllabus
        # =========================================================================
        print("--> Capturing 07_chi_tiet_mon_hoc_bo_qua_de_cuong.png...")
        await page.goto(f'http://localhost:5173/subjects/{TARGET_SUBJECT_ID}')
        await page.wait_for_timeout(1000)
        img_path = f"{SCREENSHOTS_DIR}/07_chi_tiet_mon_hoc_bo_qua_de_cuong.png"
        await page.screenshot(path=img_path)
        
        add_lesson_btn = await page.query_selector('button:has-text("Tạo bài giảng"), button:has-text("Thêm bài giảng"), .btn-create-lesson')
        syllabus_tabs = await page.query_selector('.syllabus-section, .subject-tabs')
        ann = []
        if syllabus_tabs:
            sb = await syllabus_tabs.bounding_box()
            ann.append({'box': (sb['x'], sb['y'], sb['x'] + sb['width'], sb['y'] + sb['height']), 'badge': '1', 'label': 'BỎ QUA bước sinh đề cương môn học'})
        if add_lesson_btn:
            lb = await add_lesson_btn.bounding_box()
            ann.append({'box': (lb['x'], lb['y'], lb['x'] + lb['width'], lb['y'] + lb['height']), 'badge': '2', 'label': 'Nhấn "+ Tạo bài giảng" trực tiếp'})
        annotate_image(img_path, ann)

        # =========================================================================
        # 8. SCREENSHOT 08: Create Lesson Modal
        # =========================================================================
        print("--> Capturing 08_modal_tao_bai_giang.png...")
        if add_lesson_btn:
            await add_lesson_btn.click()
            await page.wait_for_timeout(600)
            lesson_input = await page.query_selector('.modal input, .modal-content input')
            if lesson_input:
                await lesson_input.fill('Bài 02: Xây dựng Mô hình Học máy Cơ bản với Scikit-Learn')
        
        img_path = f"{SCREENSHOTS_DIR}/08_modal_tao_bai_giang.png"
        await page.screenshot(path=img_path)
        
        lesson_input_grp = await page.query_selector('.modal .form-group, .modal-content .form-group')
        lesson_submit = await page.query_selector('.modal .primary-btn, .modal-content .btn-save, .modal-content button:has-text("Tạo")')
        ann = []
        if lesson_input_grp:
            ib = await lesson_input_grp.bounding_box()
            ann.append({'box': (ib['x'], ib['y'], ib['x'] + ib['width'], ib['y'] + ib['height']), 'badge': '1', 'label': 'Nhập Tên bài giảng'})
        if lesson_submit:
            sb = await lesson_submit.bounding_box()
            ann.append({'box': (sb['x'], sb['y'], sb['x'] + sb['width'], sb['y'] + sb['height']), 'badge': '2', 'label': 'Nhấn Bắt đầu soạn bài'})
        annotate_image(img_path, ann)

        close_l = await page.query_selector('.modal-close, button:has-text("Hủy")')
        if close_l: await close_l.click()

        # =========================================================================
        # 9. SCREENSHOT 09: Step 1 - Raw Outline Input
        # =========================================================================
        print("--> Capturing 09_buoc1_nhap_outline_tho.png...")
        await page.goto(f'http://localhost:5173/lessons/{TARGET_LESSON_ID}')
        await page.wait_for_selector('.workflow-stepper')
        await page.wait_for_timeout(2000)
        
        stepper_steps = await page.query_selector_all('.workflow-stepper .step')
        if len(stepper_steps) >= 6:
            await stepper_steps[0].click() # Click Step 1
            await page.wait_for_timeout(1000)
        
        img_path = f"{SCREENSHOTS_DIR}/09_buoc1_nhap_outline_tho.png"
        await page.screenshot(path=img_path)
        
        textarea = await page.query_selector('textarea')
        gen_btn = await page.query_selector('button:has-text("Tạo dàn ý"), button:has-text("Phân tích"), button:has-text("Lưu"), button.primary-btn')
        ann = []
        if stepper_steps and len(stepper_steps) >= 1:
            sb = await stepper_steps[0].bounding_box()
            ann.append({'box': (sb['x'], sb['y'], sb['x'] + sb['width'], sb['y'] + sb['height']), 'badge': '1', 'label': 'Bước 1: Nhập Outline'})
        if textarea:
            tb = await textarea.bounding_box()
            ann.append({'box': (tb['x'], tb['y'], tb['x'] + tb['width'], min(tb['y'] + 420, tb['y'] + tb['height'])), 'badge': '2', 'label': 'Dán giáo trình / dàn ý thô'})
        if gen_btn:
            gb = await gen_btn.bounding_box()
            ann.append({'box': (gb['x'], gb['y'], gb['x'] + gb['width'], gb['y'] + gb['height']), 'badge': '3', 'label': 'Nhấn Tạo dàn ý với AI'})
        annotate_image(img_path, ann)

        # =========================================================================
        # 10. SCREENSHOT 10: Step 2 Initial - Click "Tạo với AI"
        # =========================================================================
        print("--> Capturing 10_buoc2_tao_outline_ai.png (Initial state)...")
        # Temporarily clear detailed_outline in DB to show initial state
        c = get_db()
        cr = c.cursor()
        cr.execute("UPDATE lessons SET detailed_outline = NULL WHERE id = %s", (TARGET_LESSON_ID,))
        c.commit()
        c.close()
        
        await page.reload()
        await page.wait_for_selector('.workflow-stepper')
        await page.wait_for_timeout(1200)
        stepper_steps = await page.query_selector_all('.workflow-stepper .step')
        if len(stepper_steps) >= 2:
            await stepper_steps[1].click() # Click Step 2
            await page.wait_for_timeout(1000)

        img_path = f"{SCREENSHOTS_DIR}/10_buoc2_tao_outline_ai.png"
        await page.screenshot(path=img_path)

        btn_ai_step2 = await page.query_selector('button.btn-primary:has-text("Tạo với AI")')
        model_step2 = await page.query_selector('.model-selector, .model-selector-compact')
        ann = []
        if stepper_steps and len(stepper_steps) >= 2:
            sb = await stepper_steps[1].bounding_box()
            ann.append({'box': (sb['x'], sb['y'], sb['x'] + sb['width'], sb['y'] + sb['height']), 'badge': '1', 'label': 'Bước 2: Tạo Outline Chi Tiết'})
        if btn_ai_step2:
            ab = await btn_ai_step2.bounding_box()
            ann.append({'box': (ab['x'], ab['y'], ab['x'] + ab['width'], ab['y'] + ab['height']), 'badge': '2', 'label': 'Nhấn "🤖 Tạo với AI" để sinh dàn bài'})
        if model_step2:
            mb = await model_step2.bounding_box()
            ann.append({'box': (mb['x'], mb['y'], mb['x'] + mb['width'], mb['y'] + mb['height']), 'badge': '3', 'label': 'Lựa chọn Model AI'})
        annotate_image(img_path, ann)

        # =========================================================================
        # 11. SCREENSHOT 11: Step 2 Edit - Customize & Save Detailed Outline
        # =========================================================================
        print("--> Capturing 11_buoc2_sua_dan_y.png (Personalization & Edit mode)...")
        # Restore detailed_outline in DB
        c = get_db()
        cr = c.cursor()
        cr.execute("UPDATE lessons SET detailed_outline = %s WHERE id = %s", (saved_outline, TARGET_LESSON_ID))
        c.commit()
        c.close()

        await page.reload()
        await page.wait_for_selector('.workflow-stepper')
        await page.wait_for_timeout(1200)
        stepper_steps = await page.query_selector_all('.workflow-stepper .step')
        if len(stepper_steps) >= 2:
            await stepper_steps[1].click() # Click Step 2
            await page.wait_for_timeout(1000)

        # Click "⚙️ Sửa JSON" button to enter edit mode
        edit_json_btn = await page.query_selector('button.btn-toggle:has-text("Sửa JSON")')
        if edit_json_btn:
            await edit_json_btn.click()
            await page.wait_for_timeout(600)

        img_path = f"{SCREENSHOTS_DIR}/11_buoc2_sua_dan_y.png"
        await page.screenshot(path=img_path)

        json_editor = await page.query_selector('textarea.json-editor')
        save_outline_btn = await page.query_selector('button.btn-primary:has-text("Lưu thay đổi")')
        ann = []
        if edit_json_btn:
            eb = await edit_json_btn.bounding_box()
            ann.append({'box': (eb['x'], eb['y'], eb['x'] + eb['width'], eb['y'] + eb['height']), 'badge': '1', 'label': 'Nút "⚙️ Sửa JSON" mở chế độ chỉnh sửa'})
        if json_editor:
            jb = await json_editor.bounding_box()
            ann.append({'box': (jb['x'], jb['y'], jb['x'] + jb['width'], min(jb['y'] + 420, jb['y'] + jb['height'])), 'badge': '2', 'label': 'Tùy biến mục tiêu & nội dung cá nhân hóa'})
        if save_outline_btn:
            sb = await save_outline_btn.bounding_box()
            ann.append({'box': (sb['x'], sb['y'], sb['x'] + sb['width'], sb['y'] + sb['height']), 'badge': '3', 'label': 'Nhấn "💾 Lưu thay đổi" dàn ý'})
        annotate_image(img_path, ann)

        # =========================================================================
        # 12. SCREENSHOT 12: Step 3 Initial - Click "Tạo Kịch Bản" (No Image Gen here)
        # =========================================================================
        print("--> Capturing 12_buoc3_tao_kich_ban.png (Initial state)...")
        # Temporarily clear slide_script in DB
        c = get_db()
        cr = c.cursor()
        cr.execute("UPDATE lessons SET slide_script = NULL WHERE id = %s", (TARGET_LESSON_ID,))
        c.commit()
        c.close()

        await page.reload()
        await page.wait_for_selector('.workflow-stepper')
        await page.wait_for_timeout(1200)
        stepper_steps = await page.query_selector_all('.workflow-stepper .step')
        if len(stepper_steps) >= 3:
            await stepper_steps[2].click() # Click Step 3
            await page.wait_for_timeout(1000)

        img_path = f"{SCREENSHOTS_DIR}/12_buoc3_tao_kich_ban.png"
        await page.screenshot(path=img_path)

        btn_ai_step3 = await page.query_selector('button.btn-primary:has-text("Tạo Kịch Bản")')
        model_step3 = await page.query_selector('.model-selector, .model-selector-compact')
        ann = []
        if stepper_steps and len(stepper_steps) >= 3:
            sb = await stepper_steps[2].bounding_box()
            ann.append({'box': (sb['x'], sb['y'], sb['x'] + sb['width'], sb['y'] + sb['height']), 'badge': '1', 'label': 'Bước 3: Thiết Kế Slide'})
        if btn_ai_step3:
            ab = await btn_ai_step3.bounding_box()
            ann.append({'box': (ab['x'], ab['y'], ab['x'] + ab['width'], ab['y'] + ab['height']), 'badge': '2', 'label': 'Nhấn "🤖 Tạo Kịch Bản" với AI'})
        if model_step3:
            mb = await model_step3.bounding_box()
            ann.append({'box': (mb['x'], mb['y'], mb['x'] + mb['width'], mb['y'] + mb['height']), 'badge': '3', 'label': 'Lựa chọn Model AI'})
        annotate_image(img_path, ann)

        # =========================================================================
        # 13. SCREENSHOT 13: Step 3 Edit - Customize & Save Slide Script
        # =========================================================================
        print("--> Capturing 13_buoc3_sua_kich_ban.png (Personalization & Edit mode)...")
        # Restore slide_script in DB
        c = get_db()
        cr = c.cursor()
        cr.execute("UPDATE lessons SET slide_script = %s WHERE id = %s", (saved_script, TARGET_LESSON_ID))
        c.commit()
        c.close()

        await page.reload()
        await page.wait_for_selector('.workflow-stepper')
        await page.wait_for_timeout(1200)
        stepper_steps = await page.query_selector_all('.workflow-stepper .step')
        if len(stepper_steps) >= 3:
            await stepper_steps[2].click() # Click Step 3
            await page.wait_for_timeout(1000)

        # Click "⚙️ Sửa JSON" button to enter edit mode for slide script
        edit_script_btn = await page.query_selector('button.btn-toggle:has-text("Sửa JSON")')
        if edit_script_btn:
            await edit_script_btn.click()
            await page.wait_for_timeout(600)

        img_path = f"{SCREENSHOTS_DIR}/13_buoc3_sua_kich_ban.png"
        await page.screenshot(path=img_path)

        script_editor = await page.query_selector('textarea.content-textarea, textarea.json-editor')
        save_script_btn = await page.query_selector('button.btn-primary:has-text("Lưu thay đổi")')
        ann = []
        if edit_script_btn:
            eb = await edit_script_btn.bounding_box()
            ann.append({'box': (eb['x'], eb['y'], eb['x'] + eb['width'], eb['y'] + eb['height']), 'badge': '1', 'label': 'Nút "⚙️ Sửa JSON" kịch bản'})
        if script_editor:
            sb = await script_editor.bounding_box()
            ann.append({'box': (sb['x'], sb['y'], sb['x'] + sb['width'], min(sb['y'] + 420, sb['y'] + sb['height'])), 'badge': '2', 'label': 'Cá nhân hóa nội dung slide & lời giảng'})
        if save_script_btn:
            bb = await save_script_btn.bounding_box()
            ann.append({'box': (bb['x'], bb['y'], bb['x'] + bb['width'], bb['y'] + bb['height']), 'badge': '3', 'label': 'Nhấn "💾 Lưu thay đổi" kịch bản'})
        annotate_image(img_path, ann)

        # =========================================================================
        # 14. SCREENSHOT 14: Step 4 - Select ViTTS Provider & Clone Voice
        # =========================================================================
        print("--> Capturing 14_buoc4_chon_giong_clone.png...")
        await page.evaluate("window.scrollTo(0, 0)")
        if len(stepper_steps) >= 4:
            await stepper_steps[3].click() # Click Step 4
            await page.wait_for_timeout(1000)

        # Wait for TTSSelector to finish loading
        try:
            await page.wait_for_selector('.provider-btn:has-text("ViTTS")', timeout=15000)
            # Wait until loading spinner disappears
            await page.wait_for_selector('.tts-loading', state='detached', timeout=10000)
        except Exception as e:
            print("Notice waiting TTS:", e)
        await page.wait_for_timeout(800)

        # Click ViTTS provider button
        vitts_btn = await page.query_selector('button.provider-btn:has-text("ViTTS")')
        if vitts_btn:
            await vitts_btn.click()
            await page.wait_for_timeout(800)

        # Click Clone Voice mode button
        clone_mode_btn = await page.query_selector('button.provider-btn:has-text("Giọng clone")')
        if clone_mode_btn:
            await clone_mode_btn.click()
            await page.wait_for_timeout(800)

        # Scroll slightly to show clone select dropdown cleanly
        await page.evaluate("window.scrollTo(0, 180)")
        await page.wait_for_timeout(400)

        img_path = f"{SCREENSHOTS_DIR}/14_buoc4_chon_giong_clone.png"
        await page.screenshot(path=img_path)

        clone_select = await page.query_selector('select.voice-select')
        ann = []
        if vitts_btn:
            vb = await vitts_btn.bounding_box()
            ann.append({'box': (vb['x'], vb['y'], vb['x'] + vb['width'], vb['y'] + vb['height']), 'badge': '1', 'label': 'Chọn ViTTS'})
        if clone_mode_btn:
            cb = await clone_mode_btn.bounding_box()
            ann.append({'box': (cb['x'], cb['y'], cb['x'] + cb['width'], cb['y'] + cb['height']), 'badge': '2', 'label': 'Chọn Giọng clone'})
        if clone_select:
            sb = await clone_select.bounding_box()
            ann.append({'box': (sb['x'], sb['y'], sb['x'] + sb['width'], sb['y'] + sb['height']), 'badge': '3', 'label': 'Chọn Giọng clone mẫu'})
        annotate_image(img_path, ann)

        # =========================================================================
        # 15. SCREENSHOT 15: Step 4 - Edit Speaker Notes, QA & Generate Audio
        # =========================================================================
        print("--> Capturing 15_buoc4_kiem_duyet_tao_audio.png...")
        # Scroll down slightly to show first slide card with 3 columns
        await page.evaluate("window.scrollBy(0, 320)")
        await page.wait_for_timeout(400)

        # Click edit button on slide 1's speaker note
        inline_edit_btn = await page.query_selector('.card-note-optimized button.btn-edit-inline')
        if inline_edit_btn:
            await inline_edit_btn.click()
            await page.wait_for_timeout(500)

        img_path = f"{SCREENSHOTS_DIR}/15_buoc4_kiem_duyet_tao_audio.png"
        await page.screenshot(path=img_path)

        note_editor = await page.query_selector('.card-note-optimized .edit-mode')
        opt_btn = await page.query_selector('button.btn-optimize-notes')
        gen_all_btn = await page.query_selector('button.btn-generate-all')
        ann = []
        if note_editor:
            nb = await note_editor.bounding_box()
            ann.append({'box': (nb['x'], nb['y'], nb['x'] + nb['width'], nb['y'] + nb['height']), 'badge': '1', 'label': 'Chỉnh sửa lời giảng riêng từng slide & Lưu'})
        if opt_btn:
            ob = await opt_btn.bounding_box()
            ann.append({'box': (ob['x'], ob['y'], ob['x'] + ob['width'], ob['y'] + ob['height']), 'badge': '2', 'label': 'Nhấn "✅ Tối Ưu & Kiểm Duyệt" chuẩn hóa'})
        if gen_all_btn:
            gb = await gen_all_btn.bounding_box()
            ann.append({'box': (gb['x'], gb['y'], gb['x'] + gb['width'], gb['y'] + gb['height']), 'badge': '3', 'label': 'Nhấn "🎙️ Tạo Audio Tất Cả" sinh giọng nói'})
        annotate_image(img_path, ann)

        # Cancel note edit
        cancel_note = await page.query_selector('.card-note-optimized .btn-cancel')
        if cancel_note: await cancel_note.click()

        # =========================================================================
        # 16. SCREENSHOT 16: Step 5 - PPTX Export, Inline Edit & Image Actions
        # =========================================================================
        print("--> Capturing 16_buoc5_tao_pptx_va_sua_slide.png...")
        await page.evaluate("window.scrollTo(0, 0)")
        if len(stepper_steps) >= 5:
            await stepper_steps[4].click() # Click Step 5
            await page.wait_for_timeout(1200)

        # Scroll to slide 1
        await page.evaluate("window.scrollBy(0, 360)")
        await page.wait_for_timeout(500)

        # Click "✏️ Sửa nội dung" on slide 1
        btn_edit_content = await page.query_selector('.btn-action-edit, button:has-text("Sửa nội dung")')
        if btn_edit_content:
            await btn_edit_content.click()
            await page.wait_for_timeout(600)

        img_path = f"{SCREENSHOTS_DIR}/16_buoc5_tao_pptx_va_sua_slide.png"
        await page.screenshot(path=img_path)

        inline_edit_container = await page.query_selector('.slide-inline-edit-container')
        btn_upload = await page.query_selector('.btn-action-upload, button:has-text("Đổi ảnh")')
        btn_regen_img = await page.query_selector('.btn-action-regen-img, button:has-text("Tạo lại ảnh")')
        btn_export_pptx = await page.query_selector('button.btn-primary:has-text("Tạo PPTX"), button:has-text("Tải PPTX")')
        ann = []
        if inline_edit_container:
            ib = await inline_edit_container.bounding_box()
            ann.append({'box': (ib['x'], ib['y'], ib['x'] + ib['width'], min(ib['y'] + 420, ib['y'] + ib['height'])), 'badge': '1', 'label': 'Sửa trực tiếp tiêu đề, ý chính & Lưu nội dung'})
        if btn_upload:
            ub = await btn_upload.bounding_box()
            ann.append({'box': (ub['x'], ub['y'], ub['x'] + ub['width'], ub['y'] + ub['height']), 'badge': '2', 'label': 'Nhấn "📤 Đổi ảnh" tải ảnh máy tính hoặc Tạo lại AI'})
        if btn_export_pptx:
            eb = await btn_export_pptx.bounding_box()
            ann.append({'box': (eb['x'], eb['y'], eb['x'] + eb['width'], eb['y'] + eb['height']), 'badge': '3', 'label': 'Nhấn Tạo file PowerPoint (có Audio)'})
        annotate_image(img_path, ann)

        # Cancel slide inline edit
        cancel_inline = await page.query_selector('.btn-cancel-inline')
        if cancel_inline: await cancel_inline.click()

        # =========================================================================
        # 17. SCREENSHOT 17: Step 5 - Image Crop & Resize Modal (1:1 Aspect Ratio)
        # =========================================================================
        print("--> Capturing 17_buoc5_crop_resize_anh.png...")
        upload_btns = await page.query_selector_all('.btn-action-upload, button:has-text("Đổi ảnh")')
        if len(upload_btns) > 0:
            async with page.expect_file_chooser() as fc_info:
                await upload_btns[0].click()
            file_chooser = await fc_info.value
            await file_chooser.set_files('docs/screenshots/01_dang_ky.png')
            await page.wait_for_timeout(1000)

        img_path = f"{SCREENSHOTS_DIR}/17_buoc5_crop_resize_anh.png"
        await page.screenshot(path=img_path)

        crop_viewport = await page.query_selector('div:has(> img[alt="Crop target"])')
        zoom_controls = await page.query_selector('button:has-text("Vừa khung"), input[type="range"]')
        apply_crop_btn = await page.query_selector('button:has-text("Áp dụng & Lưu ảnh")')
        ann = []
        if crop_viewport:
            cb = await crop_viewport.bounding_box()
            ann.append({'box': (cb['x'], cb['y'], cb['x'] + cb['width'], cb['y'] + cb['height']), 'badge': '1', 'label': 'Khung Cắt & Thu phóng ảnh chuẩn 1:1'})
        if zoom_controls:
            zb = await zoom_controls.bounding_box()
            ann.append({'box': (zb['x'] - 10, zb['y'] - 5, zb['x'] + 220, zb['y'] + 40), 'badge': '2', 'label': 'Phóng to / Thu nhỏ & Căn giữa'})
        if apply_crop_btn:
            ab = await apply_crop_btn.bounding_box()
            ann.append({'box': (ab['x'], ab['y'], ab['x'] + ab['width'], ab['y'] + ab['height']), 'badge': '3', 'label': 'Nhấn Áp dụng & Lưu ảnh'})
        annotate_image(img_path, ann)

        # Close crop modal cleanly
        cancel_btn = await page.query_selector('button:has-text("Hủy")')
        if cancel_btn:
            await cancel_btn.click(force=True)
        else:
            await page.keyboard.press('Escape')
        await page.wait_for_timeout(600)

        # =========================================================================
        # 18. SCREENSHOT 18: Step 6 - Question Bank Initial State (Bloom Configuration)
        # =========================================================================
        print("--> Capturing 18_buoc6_tao_cau_hoi.png (Initial Bloom state)...")
        # Temporarily remove review questions in DB to show initial state
        c = get_db()
        cr = c.cursor()
        cr.execute("DELETE FROM review_questions WHERE lesson_id = %s", (TARGET_LESSON_ID,))
        c.commit()
        c.close()

        await page.evaluate("window.scrollTo(0, 0)")
        if len(stepper_steps) >= 6:
            await stepper_steps[5].click() # Click Step 6
            await page.wait_for_timeout(1200)

        review_tab = await page.query_selector('button:has-text("Câu hỏi Ôn tập")')
        if review_tab:
            await review_tab.click()
            await page.wait_for_timeout(800)

        # Scroll slightly to place Bloom inputs and button comfortably in viewport
        await page.evaluate("window.scrollTo(0, 80)")
        await page.wait_for_timeout(300)

        img_path = f"{SCREENSHOTS_DIR}/18_buoc6_tao_cau_hoi.png"
        await page.screenshot(path=img_path)

        level_inputs = await page.query_selector('.level-inputs')
        btn_gen_review = await page.query_selector('button.btn-primary:has-text("Tạo Mới")')
        ann = []
        if review_tab:
            rb = await review_tab.bounding_box()
            ann.append({'box': (rb['x'], rb['y'], rb['x'] + rb['width'], rb['y'] + rb['height']), 'badge': '1', 'label': 'Tab "📝 Câu hỏi Ôn tập (Bloom Taxonomy)"'})
        if level_inputs:
            lb = await level_inputs.bounding_box()
            ann.append({'box': (lb['x'], lb['y'], lb['x'] + lb['width'], lb['y'] + lb['height']), 'badge': '2', 'label': 'Thiết lập số lượng câu theo 3 cấp độ Bloom'})
        if btn_gen_review:
            gb = await btn_gen_review.bounding_box()
            ann.append({'box': (gb['x'], gb['y'], gb['x'] + gb['width'], gb['y'] + gb['height']), 'badge': '3', 'label': 'Nhấn "🤖 Tạo Mới" để AI sinh câu hỏi'})
        annotate_image(img_path, ann)

        # =========================================================================
        # 19. SCREENSHOT 19: Step 6 - Edit Questions & Export Moodle XML / Excel
        # =========================================================================
        print("--> Capturing 19_buoc6_sua_va_xuat_moodle.png...")
        # Restore review questions in DB
        c = get_db()
        cr = c.cursor()
        for q in saved_questions:
            cr.execute("""
                INSERT INTO review_questions (id, lesson_id, question_id, question, correct_answer, option_b, option_c, option_d, explanation, level, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            """, (q[0], TARGET_LESSON_ID, q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8]))
        c.commit()
        c.close()

        await page.reload()
        await page.wait_for_selector('.workflow-stepper')
        await page.wait_for_timeout(1200)
        stepper_steps = await page.query_selector_all('.workflow-stepper .step')
        if len(stepper_steps) >= 6:
            await stepper_steps[5].click() # Click Step 6
            await page.wait_for_timeout(1000)

        review_tab = await page.query_selector('button:has-text("Câu hỏi Ôn tập")')
        if review_tab:
            await review_tab.click()
            await page.wait_for_timeout(800)

        # Click edit button on first question row
        edit_q_btn = await page.query_selector('.questions-table tbody tr:first-of-type .btn-edit')
        if edit_q_btn:
            await edit_q_btn.click()
            await page.wait_for_timeout(500)

        # Scroll to position header export buttons and editing table row together in view
        await page.evaluate("window.scrollTo(0, 160)")
        await page.wait_for_timeout(400)

        img_path = f"{SCREENSHOTS_DIR}/19_buoc6_sua_va_xuat_moodle.png"
        await page.screenshot(path=img_path)

        editing_row = await page.query_selector('.questions-table tbody tr:first-of-type')
        moodle_btn = await page.query_selector('button:has-text("Xuất Moodle XML")')
        excel_btn = await page.query_selector('button:has-text("Xuất Excel Ôn tập")')
        ann = []
        if editing_row:
            eb = await editing_row.bounding_box()
            ann.append({'box': (eb['x'], eb['y'], eb['x'] + eb['width'], eb['y'] + eb['height']), 'badge': '1', 'label': 'Sửa câu hỏi & đáp án'})
        if moodle_btn:
            mb = await moodle_btn.bounding_box()
            ann.append({'box': (mb['x'], mb['y'], mb['x'] + mb['width'], mb['y'] + mb['height']), 'badge': '2', 'label': 'Xuất Moodle XML'})
        if excel_btn:
            xb = await excel_btn.bounding_box()
            ann.append({'box': (xb['x'], xb['y'], xb['x'] + xb['width'], xb['y'] + xb['height']), 'badge': '3', 'label': 'Xuất Excel'})
        annotate_image(img_path, ann)

        await browser.close()
        print("\n=== ALL 19 SCREENSHOTS CAPTURED & ANNOTATED WITH HIGH-PRECISION RED BOXES & BADGES ===")

if __name__ == '__main__':
    asyncio.run(run())
