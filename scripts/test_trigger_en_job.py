import asyncio
import os
from playwright.async_api import async_playwright

ARTIFACT_DIR = "/home/trieuhoa/.gemini/antigravity-ide/brain/9a9b29ff-8132-43c3-85ea-61e1d6f56cde"

async def test_ui():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 950})
        page = await context.new_page()

        await page.goto("http://localhost:5173/login", wait_until="networkidle")
        await page.fill('input[type="email"]', "xuanhoaspt@gmail.com")
        await page.fill('input[type="password"]', "123456")
        await page.click('button[type="submit"]')
        await page.wait_for_timeout(2000)

        target_url = "http://localhost:5173/pptx-audio-tool/1d87f5d9-ac2c-4407-abc0-0ead1edf4a17"
        await page.goto(target_url, wait_until="networkidle")
        await page.wait_for_timeout(2500)

        btn_notes = page.locator('button.btn-generate-notes, button:has-text("Lời Giảng")').first
        if await btn_notes.count() > 0:
            print("1. Opening generate notes modal...")
            await btn_notes.click()
            await page.wait_for_timeout(1000)

            print("2. Selecting English card...")
            en_card = page.locator('.modal-content div:has-text("English")').last
            await en_card.click()
            await page.wait_for_timeout(500)

            print("3. Clicking Option 1 (Tạo lại cho tất cả các slide English)...")
            opt1 = page.locator('.modal-content div:has-text("Tạo lại cho TẤT CẢ các slide")').first
            await opt1.click()
            await page.wait_for_timeout(2000)

            print("4. Monitoring job banner...")
            # Wait 15 seconds to let first batch process
            for i in range(5):
                await page.wait_for_timeout(3000)
                banner = page.locator('.job-banner, .btn-generate-notes').first
                banner_text = await banner.inner_text() if await banner.count() > 0 else 'no banner'
                print(f"Status at {(i+1)*3}s: {banner_text.strip()[:60]}")

            # Capture progress shot
            shot_prog = os.path.join(ARTIFACT_DIR, "pptx_tool_generating_en.png")
            await page.screenshot(path=shot_prog)
            print(f"Captured: {shot_prog}")

        await browser.close()
        print("Done test!")

if __name__ == "__main__":
    asyncio.run(test_ui())
