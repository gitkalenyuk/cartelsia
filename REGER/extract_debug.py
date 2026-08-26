import asyncio
from playwright.async_api import async_playwright
import imaplib
import email
import re
import time

GMAIL_USER = "nameofsewar@gmail.com"
GMAIL_PASS = "negfglnqrzkiibgs"

def get_code(target_email, timeout=60):
    target_clean = target_email.lower().strip()
    start = time.time()
    while time.time() - start < timeout:
        try:
            mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
            mail.login(GMAIL_USER, GMAIL_PASS)
            mail.select("inbox")
            _, messages = mail.search(None, 'UNSEEN')
            msg_ids = messages[0].split()
            for msg_num in reversed(msg_ids[-20:]):
                _, msg_data = mail.fetch(msg_num, '(RFC822)')
                raw = msg_data[0][1]
                msg = email.message_from_bytes(raw)
                to_header = str(msg.get('To', '')).lower().strip()
                subject = str(msg.get('Subject', ''))
                if to_header == target_clean or f"<{target_clean}>" in to_header:
                    code_match = re.search(r'\b(\d{6})\b', subject)
                    if code_match:
                        code = code_match.group(1)
                        mail.store(msg_num, '+FLAGS', '\\Seen')
                        mail.close(); mail.logout()
                        return code
            mail.close(); mail.logout()
        except Exception:
            pass
        time.sleep(2)
    return None

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        email = "nygnslaxxpwc5m@furia.ink"
        password = "eOwSNU3Le!3Vlrz7q#"
        
        # Step 1: Open page
        print("Opening sign-in...")
        await page.goto("https://play.cartesia.ai/sign-in", wait_until="domcontentloaded")
        await asyncio.sleep(3)
        await page.screenshot(path="step1_email_page.png")
        
        # Step 2: Fill email
        print("Filling email...")
        await page.fill('input[type="email"], input[placeholder*="email" i]', email)
        await page.click('button:has-text("Continue")')
        await asyncio.sleep(3)
        await page.screenshot(path="step2_after_email.png")
        print(f"URL after email: {page.url}")
        
        # Step 3: Check what's on the page now
        html = await page.content()
        with open("step2_page.html", "w") as f:
            f.write(html)
        print("Saved step2_page.html for analysis")
        
        # Try to find password field
        pass_input = await page.query_selector('input[type="password"]')
        if pass_input:
            print("Found password field, filling...")
            await pass_input.fill(password)
            await page.click('button:has-text("Continue")')
            await asyncio.sleep(3)
            await page.screenshot(path="step3_after_password.png")
        else:
            print("No password field found. Checking for code field...")
            code_input = await page.query_selector('input[name="code"], input[autocomplete="one-time-code"]')
            if code_input:
                print("Code field found, need verification")
        
        await browser.close()

asyncio.run(main())
