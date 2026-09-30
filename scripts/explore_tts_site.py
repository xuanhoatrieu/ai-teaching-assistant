import asyncio
import os
from playwright.async_api import async_playwright

SCREENSHOTS_DIR = 'docs/screenshots/tts_clone'
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1440, 'height': 900})
        page = await context.new_page()

        print("Navigating to https://tts.hoclieu.id.vn...")
        await page.goto("https://tts.hoclieu.id.vn", wait_until="networkidle")
        await page.wait_for_timeout(2000)

        await page.screenshot(path=f"{SCREENSHOTS_DIR}/01_login_page.png")
        print("Captured 01_login_page.png")

        # Let's inspect inputs
        inputs = await page.locator("input").all()
        print(f"Found {len(inputs)} inputs")
        for i, inp in enumerate(inputs):
            name = await inp.get_attribute("name")
            placeholder = await inp.get_attribute("placeholder")
            inp_type = await inp.get_attribute("type")
            print(f"Input {i}: name={name}, type={inp_type}, placeholder={placeholder}")

        # Try to login: username/admin, password/123456
        # Find username field
        user_input = page.locator("input[type='text'], input[name='username'], input[placeholder*='tên' i], input[placeholder*='user' i], input[type='email']").first
        pass_input = page.locator("input[type='password']").first

        if await user_input.count() > 0 and await pass_input.count() > 0:
            await user_input.fill("admin")
            await pass_input.fill("123456")
            
            # Click submit button
            submit_btn = page.locator("button[type='submit'], button:has-text('Đăng nhập'), button:has-text('Login')").first
            await submit_btn.click()
            await page.wait_for_timeout(3000)
            print("Current URL after login:", page.url)
            await page.screenshot(path=f"{SCREENSHOTS_DIR}/02_after_login.png")
            print("Captured 02_after_login.png")

            # Check navigation links / menu items
            nav_items = await page.locator("nav a, aside a, header a, button").all_inner_texts()
            print("Navigation elements:", [t.strip() for t in nav_items if t.strip()][:30])

            # Dump page title & main text
            body_text = await page.inner_text("body")
            print("Body snippet:", body_text[:500])

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
