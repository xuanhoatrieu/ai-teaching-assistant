import asyncio
import os
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageFont

SCREENSHOTS_DIR = 'docs/screenshots'
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

def annotate_image(image_path, annotations):
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

        bx1 = min(box[0], box[2])
        by1 = min(box[1], box[3])
        bx2 = max(box[0], box[2])
        by2 = max(box[1], box[3])

        pad = 4
        x1 = max(0, bx1 - pad)
        y1 = max(0, by1 - pad)
        x2 = min(img.width - 1, bx2 + pad)
        y2 = min(img.height - 1, by2 + pad)

        draw.rectangle([x1, y1, x2, y2], outline='#ef4444', width=3)

        if badge:
            badge_r = 14
            bx = x1
            by = y1 if y1 >= 25 else (y2 + 16)
            draw.ellipse([bx - badge_r, by - badge_r, bx + badge_r, by + badge_r], fill='#dc2626', outline='#ffffff', width=2)
            draw.text((bx, by), badge, fill='#ffffff', font=font, anchor='mm')
            
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

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1440, 'height': 900})
        page = await context.new_page()

        # Login
        await page.goto("https://tts.hoclieu.id.vn", wait_until="networkidle")
        await page.fill('input[type="text"]', "admin")
        await page.fill('input[type="password"]', "123456")
        await page.click('button[type="submit"]')
        await page.wait_for_timeout(2000)

        # -------------------------------------------------------------
        # 1. API Keys Page
        # -------------------------------------------------------------
        await page.click('a:has-text("API Keys"), button:has-text("API Keys")')
        await page.wait_for_timeout(1500)
        
        inp_key_name = page.locator('input[placeholder*="Tên gợi nhớ"]').first
        await inp_key_name.fill("AI_Teaching_Assistant")
        await page.wait_for_timeout(500)
        
        path_api_keys = os.path.join(SCREENSHOTS_DIR, "tts_01_api_keys.png")
        await page.screenshot(path=path_api_keys)

        annotate_image(path_api_keys, [
            {
                "box": [285, 169, 685, 212],
                "badge": "1",
                "label": "Nhập tên gợi nhớ (VD: AI_Teaching_Assistant)"
            },
            {
                "box": [697, 169, 797, 205],
                "badge": "2",
                "label": "Bấm 'Tạo Key'"
            },
            {
                "box": [1187, 423, 1261, 451],
                "badge": "3",
                "label": "Bấm 'Copy' để sao chép API Key"
            }
        ])

        # -------------------------------------------------------------
        # 2. Voice Library Page
        # -------------------------------------------------------------
        await page.click('a:has-text("Voice Library"), button:has-text("Voice Library")')
        await page.wait_for_timeout(1500)
        
        path_voice_lib = os.path.join(SCREENSHOTS_DIR, "tts_02_voice_library.png")
        await page.screenshot(path=path_voice_lib)

        annotate_image(path_voice_lib, [
            {
                "box": [1244, 9, 1329, 45],
                "badge": "1",
                "label": "Ghi âm"
            },
            {
                "box": [1337, 9, 1416, 45],
                "badge": "2",
                "label": "Tải file"
            },
            {
                "box": [819, 162, 959, 198],
                "badge": "3",
                "label": "Bấm 'Cache' nạp bộ đệm âm sắc"
            }
        ])

        # -------------------------------------------------------------
        # 3. Voice Record Modal
        # -------------------------------------------------------------
        btn_record = page.locator('button:has-text("Record")').first
        await btn_record.click()
        await page.wait_for_timeout(1000)

        path_record_modal = os.path.join(SCREENSHOTS_DIR, "tts_03_record_voice.png")
        await page.screenshot(path=path_record_modal)

        annotate_image(path_record_modal, [
            {
                "box": [450, 307, 990, 398],
                "badge": "1",
                "label": "Chọn câu văn mẫu tiếng Việt để đọc"
            },
            {
                "box": [685, 570, 755, 642],
                "badge": "2",
                "label": "Bấm Micro để Bắt đầu/Dừng ghi âm"
            }
        ])

        await page.click('button:has-text("Hủy")')
        await page.wait_for_timeout(500)

        # -------------------------------------------------------------
        # 4. Voice Upload Modal
        # -------------------------------------------------------------
        btn_upload = page.locator('button:has-text("Upload")').first
        await btn_upload.click()
        await page.wait_for_timeout(1000)

        # Pre-fill sample values
        name_input = page.locator('input[placeholder*="Tên giọng nói"]').first
        transcript_input = page.locator('textarea[placeholder*="Nội dung nói trong audio"]').first
        await name_input.fill("GiangVien_XuanHoa")
        await transcript_input.fill("Chào mừng các bạn sinh viên đến với bài giảng hôm nay.")

        path_upload_modal = os.path.join(SCREENSHOTS_DIR, "tts_04_upload_voice.png")
        await page.screenshot(path=path_upload_modal)

        annotate_image(path_upload_modal, [
            {
                "box": [505, 230, 935, 395],
                "badge": "1",
                "label": "Kéo thả file âm thanh mẫu (.wav, .mp3, .ogg)"
            },
            {
                "box": [505, 412, 935, 452],
                "badge": "2",
                "label": "Đặt tên giọng đọc cá nhân"
            },
            {
                "box": [505, 497, 935, 625],
                "badge": "3",
                "label": "Nhập nội dung câu nói (Transcript)"
            },
            {
                "box": [846, 788, 935, 828],
                "badge": "4",
                "label": "Bấm 'Upload' hoàn tất nạp giọng"
            }
        ])

        await browser.close()
        print("All TTS screenshots captured and annotated!")

if __name__ == "__main__":
    asyncio.run(main())
