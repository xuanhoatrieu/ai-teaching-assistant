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

        # Candidate session IDs
        session_ids = [
            "1d87f5d9-ac2c-4407-abc0-0ead1edf4a17",
            "49f1eb90-09a7-4f74-9aea-f836469a7b02",
            "2510c589-e833-4917-a17f-53062f413677",
            "2a1e1ea5-2a4b-4651-9594-7ba4141ae662"
        ]

        found_session = False
        for sid in session_ids:
            target_url = f"http://localhost:5173/pptx-audio-tool/{sid}"
            print(f"Trying session {sid}...")
            await page.goto(target_url, wait_until="networkidle")
            await page.wait_for_timeout(2000)

            # Check if Notes & Audio step is present or can be clicked
            step_btn = page.locator('.step-btn:has-text("Audio"), .step-btn:has-text("Notes")').first
            if await step_btn.count() > 0:
                await step_btn.click()
                await page.wait_for_timeout(1000)

            # Check for button to generate notes
            btn_notes = page.locator('button.btn-generate-notes, button:has-text("Lời Giảng")').first
            if await btn_notes.count() > 0:
                print(f"Found active session with notes button: {sid}")
                found_session = True

                # Click generate notes button to open modal
                await btn_notes.click()
                await page.wait_for_timeout(1000)

                # Capture Vietnamese state (Default)
                modal_elem = page.locator('.modal-content').first
                shot_vi = os.path.join(ARTIFACT_DIR, "pptx_tool_notes_modal_vietnamese.png")
                if await modal_elem.count() > 0:
                    await modal_elem.screenshot(path=shot_vi)
                else:
                    await page.screenshot(path=shot_vi)
                print(f"Captured VI: {shot_vi}")

                # Click English option card
                en_card = page.locator('.modal-content div:has-text("English")').last
                if await en_card.count() > 0:
                    print("Switching to English option...")
                    await en_card.click()
                    await page.wait_for_timeout(600)

                    shot_en = os.path.join(ARTIFACT_DIR, "pptx_tool_notes_modal_english.png")
                    if await modal_elem.count() > 0:
                        await modal_elem.screenshot(path=shot_en)
                    else:
                        await page.screenshot(path=shot_en)
                    print(f"Captured EN: {shot_en}")

                break

        if not found_session:
            print("No candidate session matched, navigating to /pptx-audio-tool...")
            await page.goto("http://localhost:5173/pptx-audio-tool", wait_until="networkidle")
            await page.screenshot(path=os.path.join(ARTIFACT_DIR, "pptx_tool_main.png"))

        await browser.close()
        print("Done!")

if __name__ == "__main__":
    asyncio.run(test_ui())
