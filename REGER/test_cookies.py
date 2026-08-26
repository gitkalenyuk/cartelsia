import asyncio
import aiohttp
import json
import re
import imaplib
import email
import base64

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
    from datetime import datetime
    start = datetime.now()
    while (datetime.now() - start).seconds < timeout:
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
                target_clean = target_email.lower().strip()
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
        import time
        time.sleep(2)
    return None

def decode_cookie(val):
    try:
        # Try base64 decode
        padded = val + '=' * (4 - len(val) % 4)
        decoded = base64.b64decode(padded)
        try:
            return json.loads(decoded)
        except:
            return decoded.decode('utf-8', errors='ignore')[:200]
    except Exception as e:
        return f"Decode error: {e}"

async def main():
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

        print("=== Cookies ===")
        for url, cookies in jar._cookies.items():
            for name, cookie in cookies.items():
                val = cookie.value
                print(f"\n{name} @ {url}")
                print(f"  Value: {val[:100]}...")
                print(f"  Decoded: {decode_cookie(val)[:300]}")

        # Try to manually set __client cookie on api.cartesia.ai
        client_cookie = None
        for url, cookies in jar._cookies.items():
            for name, cookie in cookies.items():
                if name == "__client":
                    client_cookie = cookie.value

        if client_cookie:
            print(f"\n=== Trying api.cartesia.ai with __client cookie ===")
            api_h = {
                "Cartesia-Version": "2026-08-14",
                "Accept": "application/json",
                "Cookie": f"__client={client_cookie}",
            }
            async with session.get("https://api.cartesia.ai/api-keys", headers=api_h) as resp:
                print(f"  /api-keys: {resp.status}: {(await resp.text())[:200]}")

asyncio.run(main())
