import asyncio
from playwright.async_api import async_playwright

async def test_browser():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        print("Opening play.cartesia.ai...")
        await page.goto("https://play.cartesia.ai", wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(5)
        
        print(f"URL: {page.url}")
        print(f"Title: {await page.title()}")
        
        # Save screenshot
        await page.screenshot(path="cartesia_home.png", full_page=True)
        print("Screenshot saved: cartesia_home.png")
        
        await browser.close()

asyncio.run(test_browser())
