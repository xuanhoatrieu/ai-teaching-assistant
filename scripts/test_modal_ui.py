import asyncio
import os
from playwright.async_api import async_playwright

ARTIFACT_DIR = "/home/trieuhoa/.gemini/antigravity-ide/brain/9a9b29ff-8132-43c3-85ea-61e1d6f56cde"

async def test_ui():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await context.new_page()

        print("1. Navigating to login page...")
        await page.goto("http://localhost:5173/login", wait_until="networkidle")

        print("2. Logging in...")
        await page.fill('input[type="email"]', "xuanhoaspt@gmail.com")
        await page.fill('input[type="password"]', "123456")
        await page.click('button[type="submit"]')

        await page.wait_for_timeout(2000)
        print("Logged in, URL:", page.url)

        # Go directly to target lesson
        target_lesson_url = "http://localhost:5173/lessons/4de7fece-f762-475e-b0e5-cee1ed83164d"
        print(f"Navigating to lesson {target_lesson_url}...")
        await page.goto(target_lesson_url, wait_until="networkidle")
        await page.wait_for_timeout(2000)

        print("Current page after opening lesson:", page.url)

        # Click Step 5 (Tạo PPTX)
        step5_btn = page.locator('text="Tạo PPTX"').first
        if await step5_btn.count() > 0:
            print("Navigating to step 5 (Tạo PPTX)...")
            await step5_btn.click()
            await page.wait_for_timeout(2500)

        # Look for "+ Thêm Slide Tương Tác" button
        add_interactive_btn = page.locator('button:has-text("Thêm Slide Tương Tác"), button:has-text("Slide Tương Tác")').first
        if await add_interactive_btn.count() > 0:
            print("Opening interactive modal...")
            await add_interactive_btn.click()
            await page.wait_for_timeout(1000)

            # Switch to "Nhập văn bản / Đề" tab in Mode 1 (AI tự sáng tạo câu hỏi mới)
            text_tab = page.locator('.source-tab-btn:has-text("Nhập văn bản")').first
            if await text_tab.count() > 0:
                await text_tab.click()
                await page.wait_for_timeout(500)

            # Capture Mode 1 screenshot
            mode1_path = os.path.join(ARTIFACT_DIR, "step5_interactive_modal_mode1.png")
            modal_elem = page.locator('.add-slide-modal-content, .add-slide-modal').first
            if await modal_elem.count() > 0:
                await modal_elem.screenshot(path=mode1_path)
            else:
                await page.screenshot(path=mode1_path)
            print(f"Captured Mode 1: {mode1_path}")

            # Switch to Mode 2: "Trích xuất từ đề / câu hỏi có sẵn"
            mode2_card = page.locator('.generation-mode-card:has-text("Trích xuất từ đề")').first
            if await mode2_card.count() > 0:
                print("Switching to Mode 2 (Extract existing questions)...")
                await mode2_card.click()
                await page.wait_for_timeout(500)

                # Click "Dán đề mẫu"
                sample_btn = page.locator('.btn-sample-paste').first
                if await sample_btn.count() > 0:
                    print("Clicking Dán đề mẫu...")
                    await sample_btn.click()
                    await page.wait_for_timeout(500)

                # Scroll modal to bottom
                modal_body = page.locator('.add-slide-modal-body').first
                if await modal_body.count() > 0:
                    await modal_body.evaluate("el => el.scrollTop = el.scrollHeight")
                    await page.wait_for_timeout(500)

                # Capture Mode 2 bottom screenshot
                mode2_bottom_path = os.path.join(ARTIFACT_DIR, "step5_interactive_modal_mode2_bottom.png")
                if await modal_elem.count() > 0:
                    await modal_elem.screenshot(path=mode2_bottom_path)
                else:
                    await page.screenshot(path=mode2_bottom_path)
                print(f"Captured Mode 2 bottom: {mode2_bottom_path}")

        else:
            print("Could not find '+ Thêm Slide Tương Tác' button")
            await page.screenshot(path=os.path.join(ARTIFACT_DIR, "debug_step5_page.png"))

        await browser.close()

if __name__ == "__main__":
    asyncio.run(test_ui())
