import asyncio
import aiohttp
import json

CLERK = "https://clerk.cartesia.ai/v1"
HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://play.cartesia.ai",
    "Referer": "https://play.cartesia.ai/",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

async def main():
    connector = aiohttp.TCPConnector(limit=10, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        # 1. Get client
        async with session.post(f"{CLERK}/client", headers=HEADERS) as resp:
            data = json.loads(await resp.text())
            client_id = data.get("response", {}).get("id")
            print(f"client_id = {client_id}")
        
        # 2. Create sign_in (login with existing account)
        h = dict(HEADERS)
        h["X-Clerk-Client-Id"] = client_id
        payload = "identifier=nygnslaxxpwc5m@furia.ink&password=eOwSNU3Le!3Vlrz7q#&strategy=password"
        
        async with session.post(f"{CLERK}/client/sign_ins", data=payload, headers=h) as resp:
            text = await resp.text()
            print(f"sign_in create: {resp.status}")
            print(f"Body: {text[:500]}")
            if resp.status == 200:
                signin_data = json.loads(text).get("response", {})
                signin_id = signin_data.get("id")
                print(f"signin_id = {signin_id}")
                
                # Try to get session token
                sessions = signin_data.get("client", {}).get("sessions", [])
                if sessions:
                    token = sessions[0].get("id")
                    print(f"session_token = {token}")
                    
                    # Test Cartesia API with session token
                    api_headers = {
                        "Cartesia-Version": "2026-08-14",
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    }
                    async with session.get("https://api.cartesia.ai/api-keys", headers=api_headers) as api_resp:
                        api_text = await api_resp.text()
                        print(f"API keys: {api_resp.status} -> {api_text[:500]}")

asyncio.run(main())
