import asyncio
import os
from playwright.async_api import async_playwright

ARTIFACT_DIR = "/home/trieuhoa/.gemini/antigravity-ide/brain/9a9b29ff-8132-43c3-85ea-61e1d6f56cde"

async def test_ui():
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

        target_url = "http://localhost:5173/pptx-audio-tool/1d87f5d9-ac2c-4407-abc0-0ead1edf4a17"
        print(f"2. Navigating to {target_url}...")
        await page.goto(target_url, wait_until="networkidle")
        await page.wait_for_timeout(2500)

        # Check if language toggle exists
        lang_toggle = page.locator('.language-toggle').first
        print(f"Language toggle visible: {await lang_toggle.is_visible()}")

        # Capture header screenshot
        header_shot = os.path.join(ARTIFACT_DIR, "pptx_tool_header_language_toggle.png")
        audio_header = page.locator('.audio-header').first
        if await audio_header.count() > 0:
            await audio_header.screenshot(path=header_shot)
            print(f"Captured: {header_shot}")

        # Click on 🇬🇧 EN button
        en_toggle_btn = page.locator('.language-toggle button:has-text("EN")').first
        if await en_toggle_btn.count() > 0:
            print("Clicking EN toggle button...")
            await en_toggle_btn.click()
            await page.wait_for_timeout(1000)

            # Capture slide card under EN
            slide_shot = os.path.join(ARTIFACT_DIR, "pptx_tool_slide_card_under_en.png")
            slide_card = page.locator('.slide-card').first
            if await slide_card.count() > 0:
                await slide_card.screenshot(path=slide_shot)
                print(f"Captured: {slide_shot}")

        # Now test triggering AI speaker notes generation with English selected
        btn_notes = page.locator('button.btn-generate-notes, button:has-text("Lời Giảng")').first
        if await btn_notes.count() > 0:
            print("Opening generate notes modal...")
            await btn_notes.click()
            await page.wait_for_timeout(1000)

            # Select English
            en_card = page.locator('.modal-content div:has-text("English")').last
            if await en_card.count() > 0:
                print("Selecting English card in modal...")
                await en_card.click()
                await page.wait_for_timeout(500)

            # Capture modal ready to generate EN
            modal_shot = os.path.join(ARTIFACT_DIR, "pptx_tool_modal_ready_en.png")
            modal_elem = page.locator('.modal-content').first
            await modal_elem.screenshot(path=modal_shot)
            print(f"Captured: {modal_shot}")

        await browser.close()
        print("Done!")

if __name__ == "__main__":
    asyncio.run(test_ui())
