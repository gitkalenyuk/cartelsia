import asyncio
import aiohttp
import json

# Свіжий JWT з попереднього логіну (може бути протухлим, але спробуємо)
jwt = "eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18yZGt6RG9EWlJsMVNobVdvbUhSMTEwUnI1RVkiLCJvaWF0IjoxNzg3NzQxMjg3LCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwczovL3BsYXkuY2FydGVzaWEuYWkiLCJleHAiOjE3ODc3NDEzNDcsImZ2YSI6WzAsMF0sImlhdCI6MTc4Nzc0MTI4NywiaXNzIjoiaHR0cHM6Ly9jbGVyay5jYXJ0ZXNpYS5haSIsImp0aSI6ImJkOWJhYWFjMjI4ZmQ3NGNmYTdhIiwibmJmIjoxNzg3NzQxMjc3LCJvcmdfaXNfaW50ZXJuYWwiOm51bGwsInNpZCI6InNlc3NfM0lSeGZWbkNXZkszWkRCYWp0SUpVM2NkcUd1Iiwic3RzIjoicGVuZGluZyIsInN1YiI6"

async def test():
    connector = aiohttp.TCPConnector(limit=10, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        # Test POST /access-token with JWT
        h = {
            "Cartesia-Version": "2026-08-14",
            "Authorization": f"Bearer {jwt}",
            "Content-Type": "application/json",
        }
        
        body = {
            "grant": "tts",
            "expires_in": 3600
        }
        
        async with session.post("https://api.cartesia.ai/access-token", headers=h, json=body) as resp:
            print(f"POST /access-token (JWT): {resp.status}")
            print(await resp.text())
        
        # Test GET /api-keys with JWT
        async with session.get("https://api.cartesia.ai/api-keys", headers=h) as resp:
            print(f"\nGET /api-keys (JWT): {resp.status}")
            print(await resp.text())
        
        # Test with session cookie
        cookie_h = {
            "Cartesia-Version": "2026-08-14",
            "Cookie": f"__session={jwt}",
            "Content-Type": "application/json",
        }
        async with session.post("https://api.cartesia.ai/access-token", headers=cookie_h, json=body) as resp:
            print(f"\nPOST /access-token (cookie): {resp.status}")
            print(await resp.text())

asyncio.run(test())
