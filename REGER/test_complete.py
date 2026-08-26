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
            data = json.loads(await resp.text())
            client_id = data.get("response", {}).get("id")
            print(f"client_id = {client_id}")
        
        # 2. Create sign_up
        pw = gen_pw()
        email = f"test{random.randint(10000,99999)}@furia.ink"
        payload = f"email_address={email}&password={pw}&first_name=Test&last_name=User&strategy=email_code"
        
        h = dict(HEADERS)
        h["X-Clerk-Client-Id"] = client_id
        async with session.post(f"{CLERK}/client/sign_ups", data=payload, headers=h) as resp:
            data = json.loads(await resp.text())
            signup_id = data.get("response", {}).get("id")
            print(f"signup_id = {signup_id}")
            print(f"Status after create: {data.get('response',{}).get('status')}")
        
        # 3. Prepare verification
        async with session.post(
            f"{CLERK}/client/sign_ups/{signup_id}/prepare_verification",
            data="strategy=email_code", headers=h
        ) as resp:
            print(f"prepare_verification: {resp.status}")
        
        # 4. Print what we need to do next
        print(f"\nEmail: {email}")
        print("Check email and enter the 6-digit code manually, then we'll test attempt_verification")
        print("(For now, let's also test what /complete returns with a fake code path)")
        
        # Test complete endpoint variations
        for path in [
            f"/client/sign_ups/{signup_id}/complete",
            f"/sign_ups/{signup_id}/complete",
        ]:
            async with session.post(f"{CLERK}{path}", headers=h) as resp:
                print(f"POST {path} -> {resp.status}")

asyncio.run(main())
