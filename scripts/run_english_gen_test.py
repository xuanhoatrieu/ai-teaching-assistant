import asyncio
import os
import psycopg2
import json
import requests
from playwright.async_api import async_playwright

ARTIFACT_DIR = "/home/trieuhoa/.gemini/antigravity-ide/brain/9a9b29ff-8132-43c3-85ea-61e1d6f56cde"
SESSION_ID = "1d87f5d9-ac2c-4407-abc0-0ead1edf4a17"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 950})
        page = await context.new_page()

        print("1. Logging in...")
        await page.goto("http://localhost:5173/login", wait_until="networkidle")
        await page.fill('input[type="email"]', "xuanhoaspt@gmail.com")
        await page.fill('input[type="password"]', "123456")
        await page.click('button[type="submit"]')
        await page.wait_for_timeout(2000)

        print("2. Navigating to session...")
        target_url = f"http://localhost:5173/pptx-audio-tool/{SESSION_ID}"
        await page.goto(target_url, wait_until="networkidle")
        await page.wait_for_timeout(2500)

        # Click generate notes button
        btn_notes = page.locator('button.btn-generate-notes, button:has-text("Lời Giảng")').first
        if await btn_notes.count() > 0:
            print("3. Opening generate notes modal...")
            await btn_notes.click()
            await page.wait_for_timeout(1000)

            print("4. Selecting English card...")
            en_card = page.locator('.modal-content div:has-text("English")').last
            await en_card.click()
            await page.wait_for_timeout(500)

            print("5. Clicking Option 1 (Tạo lại cho tất cả các slide English)...")
            opt1 = page.locator('.modal-content div:has-text("Tạo lại cho TẤT CẢ các slide")').first
            await opt1.click()
            await page.wait_for_timeout(3000)

        # Now monitor job in database until notes_ready or timeout
        print("6. Polling database for notes generation completion...")
        for attempt in range(40):
            conn = psycopg2.connect('postgresql://ata_user:ata_password@localhost:5433/ata_db')
            cur = conn.cursor()
            cur.execute('SELECT status, language, slides_json FROM pptx_audio_sessions WHERE id = %s', (SESSION_ID,))
            row = cur.fetchone()
            conn.close()
            status, lang, slides_json = row[0], row[1], row[2]
            if isinstance(slides_json, str):
                slides = json.loads(slides_json)
            else:
                slides = slides_json or []

            print(f"[{attempt*5}s] status={status}, lang={lang}")
            if status == 'notes_ready' and attempt > 1:
                print("Job finished! Checking notes content...")
                if len(slides) > 0:
                    for i in range(min(3, len(slides))):
                        print(f"--- Slide {i} ---")
                        print("  noteVN:", (slides[i].get('noteVN') or '')[:80])
                        print("  noteEN:", (slides[i].get('noteEN') or '')[:80])
                        print("  hasDual:", slides[i].get('hasDual'))
                break
            await asyncio.sleep(5)

        # Refresh page to check UI rendering under English mode
        print("7. Reloading page to verify English display...")
        await page.goto(target_url, wait_until="networkidle")
        await page.wait_for_timeout(3000)

        # Screenshot header and active note
        shot1 = os.path.join(ARTIFACT_DIR, "pptx_tool_english_rendered.png")
        await page.screenshot(path=shot1)
        print(f"Saved screenshot: {shot1}")

        # Also click VN toggle to verify switching
        vn_btn = page.locator('.language-toggle button:has-text("VN")').first
        if await vn_btn.count() > 0:
            await vn_btn.click()
            await page.wait_for_timeout(1000)
            shot_vn = os.path.join(ARTIFACT_DIR, "pptx_tool_switched_to_vn.png")
            await page.screenshot(path=shot_vn)
            print(f"Saved VN screenshot: {shot_vn}")

        # Click back to EN
        en_btn = page.locator('.language-toggle button:has-text("EN")').first
        if await en_btn.count() > 0:
            await en_btn.click()
            await page.wait_for_timeout(1000)
            shot_en = os.path.join(ARTIFACT_DIR, "pptx_tool_switched_back_to_en.png")
            await page.screenshot(path=shot_en)
            print(f"Saved EN screenshot: {shot_en}")

        await browser.close()
        print("Test completed successfully!")

if __name__ == "__main__":
    asyncio.run(main())
