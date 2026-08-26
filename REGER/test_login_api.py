import asyncio
import aiohttp
import json
import re
import imaplib
import email

CLERK = "https://clerk.cartesia.ai/v1"
HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://play.cartesia.ai",
    "Referer": "https://play.cartesia.ai/",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

GMAIL_USER = "nameofsewar@gmail.com"
GMAIL_PASS = "negfglnqrzkiibgs"

def get_code_from_inbox(target_email, timeout=60):
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
                        print(f"Found login code: {code}")
                        mail.store(msg_num, '+FLAGS', '\\Seen')
                        mail.close()
                        mail.logout()
                        return code
            mail.close()
            mail.logout()
        except Exception as e:
            print(f"IMAP error: {e}")
        import time
        time.sleep(2)
    return None

async def main():
    connector = aiohttp.TCPConnector(limit=10, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        # 1. Get client
        async with session.post(f"{CLERK}/client", headers=HEADERS) as resp:
            data = json.loads(await resp.text())
            client_id = data.get("response", {}).get("id")
            print(f"client_id = {client_id}")
        
        # 2. Create sign_in
        h = dict(HEADERS)
        h["X-Clerk-Client-Id"] = client_id
        payload = "identifier=nygnslaxxpwc5m@furia.ink&password=eOwSNU3Le!3Vlrz7q#&strategy=password"
        
        async with session.post(f"{CLERK}/client/sign_ins", data=payload, headers=h) as resp:
            signin_data = json.loads(await resp.text()).get("response", {})
            signin_id = signin_data.get("id")
            print(f"signin_id = {signin_id}")
        
        # 3. Prepare second factor
        async with session.post(
            f"{CLERK}/client/sign_ins/{signin_id}/prepare_second_factor",
            data="strategy=email_code", headers=h
        ) as resp:
            print(f"prepare_second_factor: {resp.status}")
        
        # 4. Get code from email
        code = get_code_from_inbox("nygnslaxxpwc5m@furia.ink")
        print(f"Code: {code}")
        
        # 5. Attempt second factor
        async with session.post(
            f"{CLERK}/client/sign_ins/{signin_id}/attempt_second_factor",
            data=f"strategy=email_code&code={code}", headers=h
        ) as resp:
            text = await resp.text()
            print(f"attempt_second_factor: {resp.status}")
            if resp.status == 200:
                full_data = json.loads(text)
                client_data = full_data.get("client", {})
                sessions = client_data.get("sessions", [])
                sess_id = sessions[0].get("id") if sessions else None
                print(f"session_id = {sess_id}")
                
                # 6. Get JWT token
                async with session.post(
                    f"{CLERK}/client/sessions/{sess_id}/tokens",
                    headers=h
                ) as token_resp:
                    token_data = json.loads(await token_resp.text())
                    jwt = token_data.get("jwt")
                    print(f"JWT retrieved: {jwt[:50]}...")
                    
                    # 7. Get API keys
                    api_headers = {
                        "Cartesia-Version": "2026-08-14",
                        "Authorization": f"Bearer {jwt}",
                        "Content-Type": "application/json",
                    }
                    async with session.get("https://api.cartesia.ai/api-keys", headers=api_headers) as api_resp:
                        api_text = await api_resp.text()
                        print(f"API keys: {api_resp.status} -> {api_text[:800]}")
                    
                    # 8. Try creating API key
                    async with session.post("https://api.cartesia.ai/api-keys", headers=api_headers, json={"name": "auto-generated"}) as create_resp:
                        create_text = await create_resp.text()
                        print(f"Create API key: {create_resp.status} -> {create_text[:500]}")

asyncio.run(main())
