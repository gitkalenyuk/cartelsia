import asyncio
import aiohttp
import json
import random
import string

CLERK = "https://clerk.cartesia.ai/v1"
HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://play.cartesia.ai",
    "Referer": "https://play.cartesia.ai/",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def gen_pw():
    chars = string.ascii_letters + string.digits + "!@#$%^&*"
    return ''.join(random.choices(chars, k=18))

async def main():
    connector = aiohttp.TCPConnector(limit=10, ssl=False)
    timeout = aiohttp.ClientTimeout(total=30)
    
    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        # 1. Get client_id
        async with session.post(f"{CLERK}/client", headers=HEADERS) as resp:
            body = await resp.text()
            data = json.loads(body)
            client_id = data.get("response", {}).get("id")
            print(f"[1] client_id = {client_id}")
        
        # 2. Create sign_up
        pw = gen_pw()
        email = f"test{random.randint(1000,9999)}@furia.ink"
        payload = f"email_address={email}&password={pw}&first_name=Test&last_name=User&strategy=email_code"
        
        h = dict(HEADERS)
        h["X-Clerk-Client-Id"] = client_id
        async with session.post(f"{CLERK}/client/sign_ups", data=payload, headers=h) as resp:
            body = await resp.text()
            print(f"[2] POST /client/sign_ups -> {resp.status}")
            signup_data = json.loads(body)
            signup_id = signup_data.get("response", {}).get("id")
            print(f"    signup_id = {signup_id}")
        
        # 3. Try prepare_verification path
        paths_to_test = [
            f"/client/sign_ups/{signup_id}/prepare_verification",
            f"/client/sign_up/{signup_id}/prepare_verification",
        ]
        for p in paths_to_test:
            async with session.post(f"{CLERK}{p}", data="strategy=email_code", headers=h) as resp:
                body = await resp.text()
                print(f"[3] POST {p} -> {resp.status} | {body[:300]}")

asyncio.run(main())
