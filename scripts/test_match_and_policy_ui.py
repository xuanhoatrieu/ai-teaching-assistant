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

        target_lesson_url = "http://localhost:5173/lessons/4de7fece-f762-475e-b0e5-cee1ed83164d"
        await page.goto(target_lesson_url, wait_until="networkidle")
        await page.wait_for_timeout(2000)

        step5_btn = page.locator('text="Tạo PPTX"').first
        if await step5_btn.count() > 0:
            await step5_btn.click()
            await page.wait_for_timeout(2500)

        add_interactive_btn = page.locator('button:has-text("Thêm Slide Tương Tác"), button:has-text("Slide Tương Tác")').first
        if await add_interactive_btn.count() > 0:
            await add_interactive_btn.click()
            await page.wait_for_timeout(1000)

            # Scroll down
            modal_body = page.locator('.add-slide-modal-body').first
            await modal_body.evaluate("el => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })")
            await page.wait_for_timeout(600)

            modal_elem = page.locator('.add-slide-modal-content, .add-slide-modal').first
            shot1 = os.path.join(ARTIFACT_DIR, "step5_modal_policy_locked.png")
            await modal_elem.screenshot(path=shot1)

        await browser.close()

if __name__ == "__main__":
    asyncio.run(test_ui())
