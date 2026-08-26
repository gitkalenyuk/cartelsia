import asyncio
import aiohttp
import json
import re
import imaplib
import email
from playwright.async_api import async_playwright

CLERK = "https://clerk.cartesia.ai/v1"
HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://play.cartesia.ai",
    "Referer": "https://play.cartesia.ai/",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

GMAIL_USER = "nameofsewar@gmail.com"
GMAIL_PASS = "negfglnqrzkiibgs"

def get_code(target_email, timeout=60):
    target_clean = target_email.lower().strip()
    import time
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
    # Step 1: Login via API to get Clerk cookies
    print("Step 1: API login...")
    connector = aiohttp.TCPConnector(limit=10, ssl=False)
    jar = aiohttp.CookieJar()
    async with aiohttp.ClientSession(connector=connector, cookie_jar=jar) as session:
        async with session.post(f"{CLERK}/client", headers=HEADERS) as resp:
            data = json.loads(await resp.text())
            client_id = data.get("response", {}).get("id")

        h = dict(HEADERS)
        h["X-Clerk-Client-Id"] = client_id
        payload = "identifier=nygnslaxxpwc5m@furia.ink&password=eOwSNU3Le!3Vlrz7q#&strategy=password"
        async with session.post(f"{CLERK}/client/sign_ins", data=payload, headers=h) as resp:
            signin_data = json.loads(await resp.text()).get("response", {})
            signin_id = signin_data.get("id")

        async with session.post(f"{CLERK}/client/sign_ins/{signin_id}/prepare_second_factor", data="strategy=email_code", headers=h) as resp:
            pass

        code = get_code("nygnslaxxpwc5m@furia.ink")
        async with session.post(f"{CLERK}/client/sign_ins/{signin_id}/attempt_second_factor", data=f"strategy=email_code&code={code}", headers=h) as resp:
            pass

        # Extract cookies
        cookies_to_set = []
        for url, cookies in jar._cookies.items():
            for name, cookie in cookies.items():
                cookies_to_set.append({
                    "name": name,
                    "value": cookie.value,
                    "domain": cookie.get("domain", ".cartesia.ai"),
                    "path": cookie.get("path", "/"),
                })
        print(f"Extracted {len(cookies_to_set)} cookies")

    # Step 2: Use Playwright with the cookies
    print("\nStep 2: Opening browser with session cookies...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()

        # Set cookies
        for c in cookies_to_set:
            try:
                await context.add_cookies([c])
            except Exception as e:
                print(f"  Failed to set cookie {c['name']}: {e}")

        page = await context.new_page()

        # Navigate directly to API keys page
        print("Navigating to /keys...")
        await page.goto("https://play.cartesia.ai/keys", wait_until="domcontentloaded")
        await asyncio.sleep(5)

        print(f"URL: {page.url}")
        await page.screenshot(path="keys_with_session.png", full_page=True)
        print("Screenshot saved: keys_with_session.png")

        # Check for API key in page
        content = await page.content()
        key_match = re.search(r'sk_car_[a-zA-Z0-9_]+', content)
        if key_match:
            print(f"\n🎉 API KEY FOUND: {key_match.group(0)}")
        else:
            print("\nNo API key found in page content")

        await browser.close()

asyncio.run(main())
