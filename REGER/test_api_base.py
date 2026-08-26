import asyncio
import aiohttp
import json

# Тестуємо різні API base URL для Cartesia
CLERK = "https://clerk.cartesia.ai/v1"
HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://play.cartesia.ai",
    "Referer": "https://play.cartesia.ai/",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

async def test_with_jwt(session, jwt, base_url, endpoint):
    h = {
        "Cartesia-Version": "2026-08-14",
        "Authorization": f"Bearer {jwt}",
        "Origin": "https://play.cartesia.ai",
        "Referer": "https://play.cartesia.ai/",
    }
    try:
        async with session.get(f"{base_url}{endpoint}", headers=h, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            text = await resp.text()
            print(f"  {base_url}{endpoint} -> {resp.status}: {text[:200]}")
    except Exception as e:
        print(f"  {base_url}{endpoint} -> ERROR: {e}")

async def main():
    # JWT від попереднього успішного логіну (може бути протухлим, але перевіримо)
    jwt = "eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18yZGt6RG9EWlJsMVNobVdvbUhSMTEwUnI1RVkiLCJvaWF0IjoxNzg3NzQxMjg3LCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwczovL3BsYXkuY2FydGVzaWEuYWkiLCJleHAiOjE3ODc3NDEzNDcsImZ2YSI6WzAsMF0sImlhdCI6MTc4Nzc0MTI4NywiaXNzIjoiaHR0cHM6Ly9jbGVyay5jYXJ0ZXNpYS5haSIsImp0aSI6ImJkOWJhYWFjMjI4ZmQ3NGNmYTdhIiwibmJmIjoxNzg3NzQxMjc3LCJvcmdfaXNfaW50ZXJuYWwiOm51bGwsInNpZCI6InNlc3NfM0lSeGZWbkNXZkszWkRCYWp0SUpVM2NkcUd1Iiwic3RzIjoicGVuZGluZyIsInN1YiI6"
    
    connector = aiohttp.TCPConnector(limit=10, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        print("Testing api.cartesia.ai:")
        for ep in ["/api-keys", "/voices", "/user", "/account", "/profile"]:
            await test_with_jwt(session, jwt, "https://api.cartesia.ai", ep)
        
        print("\nTesting play.cartesia.ai:")
        for ep in ["/api/api-keys", "/api/keys", "/api/user", "/api/account", "/api/voices"]:
            await test_with_jwt(session, jwt, "https://play.cartesia.ai", ep)

asyncio.run(main())
