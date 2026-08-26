import asyncio
import aiohttp
import json
import re
import random
import string
import imaplib
import email
import time
from datetime import datetime
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass
class Account:
    email: str
    password: str
    first_name: str
    last_name: str
    user_id: Optional[str] = None
    api_key: Optional[str] = None
    created_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class CartesiaAPIAutoreg:
    """API-only реєстратор для Cartesia через Clerk API."""

    def __init__(
        self,
        domain: str,
        gmail_user: str,
        gmail_app_pass: str,
        imap_server: str = "imap.gmail.com",
        imap_port: int = 993,
        proxies: Optional[List[str]] = None,
        concurrency: int = 3,
    ):
        self.domain = domain
        self.gmail_user = gmail_user
        self.gmail_pass = gmail_app_pass.replace(" ", "")
        self.imap_server = imap_server
        self.imap_port = imap_port
        self.concurrency = concurrency
        self.semaphore = asyncio.Semaphore(concurrency)
        self.imap_lock = asyncio.Lock()
        self.proxy_rotator = self._init_proxy_rotator(proxies)
        self.clerk_api = "https://clerk.cartesia.ai/v1"

    def _init_proxy_rotator(self, proxies: Optional[List[str]]):
        class ProxyRotator:
            def __init__(self, proxies):
                self.proxies = proxies or []
                self.current = 0
            def get(self):
                if not self.proxies:
                    return None
                p = self.proxies[self.current]
                self.current = (self.current + 1) % len(self.proxies)
                return p
        return ProxyRotator(proxies)

    def _gen_email(self) -> str:
        prefix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=14))
        return f"{prefix}@{self.domain}"

    def _gen_password(self) -> str:
        chars = string.ascii_letters + string.digits + "!@#$%^&*"
        return ''.join(random.choices(chars, k=18))

    def _gen_name(self) -> tuple:
        first = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Avery", "Quinn", "Skyler", "Dakota"]
        last = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Moore"]
        return random.choice(first), random.choice(last)

    def _get_proxy(self) -> Optional[str]:
        return self.proxy_rotator.get()

    def _get_base_headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://play.cartesia.ai",
            "Referer": "https://play.cartesia.ai/",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

    async def _get_client_id(self, session: aiohttp.ClientSession) -> str:
        url = f"{self.clerk_api}/client"
        async with session.post(url, headers=self._get_base_headers(), proxy=self._get_proxy()) as resp:
            text = await resp.text()
            if resp.status != 200:
                raise Exception(f"client_id failed: {resp.status} - {text[:300]}")
            data = json.loads(text)
            client_id = data.get("response", {}).get("id")
            if not client_id:
                raise Exception(f"No client_id: {data}")
            return client_id

    async def _create_signup(self, session: aiohttp.ClientSession, client_id: str, email: str, password: str, first: str, last: str) -> str:
        url = f"{self.clerk_api}/client/sign_ups"
        h = self._get_base_headers()
        h["X-Clerk-Client-Id"] = client_id
        payload = {"email_address": email, "password": password, "first_name": first, "last_name": last, "strategy": "email_code"}
        async with session.post(url, data=payload, headers=h, proxy=self._get_proxy()) as resp:
            text = await resp.text()
            if resp.status != 200:
                raise Exception(f"signup failed: {resp.status} - {text[:300]}")
            data = json.loads(text)
            signup_id = data.get("response", {}).get("id")
            if not signup_id:
                raise Exception(f"No signup_id: {data}")
            return signup_id

    async def _prepare_verification(self, session: aiohttp.ClientSession, client_id: str, signup_id: str):
        url = f"{self.clerk_api}/client/sign_ups/{signup_id}/prepare_verification"
        h = self._get_base_headers()
        h["X-Clerk-Client-Id"] = client_id
        async with session.post(url, data="strategy=email_code", headers=h, proxy=self._get_proxy()) as resp:
            if resp.status != 200:
                raise Exception(f"prepare_verification failed: {resp.status} - {(await resp.text())[:300]}")

    async def _attempt_verification(self, session: aiohttp.ClientSession, client_id: str, signup_id: str, code: str):
        url = f"{self.clerk_api}/client/sign_ups/{signup_id}/attempt_verification"
        h = self._get_base_headers()
        h["X-Clerk-Client-Id"] = client_id
        payload = {"strategy": "email_code", "code": code}
        async with session.post(url, data=payload, headers=h, proxy=self._get_proxy()) as resp:
            text = await resp.text()
            if resp.status != 200:
                raise Exception(f"verification failed: {resp.status} - {text[:300]}")

    async def _check_inbox_once(self, target_email: str) -> Optional[str]:
        """Одноразова перевірка скриньки (блокується imap_lock на час з'єднання)."""
        target_clean = target_email.lower().strip()
        async with self.imap_lock:
            try:
                mail = imaplib.IMAP4_SSL(self.imap_server, self.imap_port)
                mail.login(self.gmail_user, self.gmail_pass)
                mail.select("inbox")
                _, messages = mail.search(None, 'ALL')
                msg_ids = messages[0].split()
                for msg_num in reversed(msg_ids[-30:]):
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
        return None

    async def _get_email_code(self, target_email: str, timeout: int = 120) -> Optional[str]:
        """Асинхронне очікування коду з IMAP (блокує лише на момент перевірки)."""
        start = datetime.now()
        while (datetime.now() - start).seconds < timeout:
            code = await self._check_inbox_once(target_email)
            if code:
                return code
            await asyncio.sleep(2)
        return None

    async def register_single(self) -> Optional[Account]:
        email = self._gen_email()
        password = self._gen_password()
        first_name, last_name = self._gen_name()
        connector = aiohttp.TCPConnector(limit=5, ssl=False)
        timeout = aiohttp.ClientTimeout(total=120)

        async with self.semaphore:
            async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
                try:
                    client_id = await self._get_client_id(session)
                    signup_id = await self._create_signup(session, client_id, email, password, first_name, last_name)
                    await self._prepare_verification(session, client_id, signup_id)

                    code = await self._get_email_code(email)
                    if not code:
                        print(f"  {email} -> timeout waiting for code")
                        return None

                    await self._attempt_verification(session, client_id, signup_id, code)
                    account = Account(
                        email=email, password=password,
                        first_name=first_name, last_name=last_name,
                        created_at=datetime.now().isoformat()
                    )
                    self._save_account(account)
                    print(f"  SUCCESS: {email}")
                    return account
                except Exception as e:
                    print(f"  FAILED: {email} -> {e}")
                    return None

    def _save_account(self, account: Account):
        txt_path = Path("cartesia_accounts.txt")
        json_path = Path("cartesia_accounts.json")
        with open(txt_path, "a") as f:
            f.write(f"{account.email}:{account.password}\n")
        accounts = []
        if json_path.exists():
            try:
                with open(json_path, "r") as f:
                    accounts = json.load(f)
            except:
                accounts = []
        accounts.append(account.to_dict())
        with open(json_path, "w") as f:
            json.dump(accounts, f, indent=2)

    async def register_bulk(self, count: int = 10, stagger: float = 2.0):
        print(f"\n{'='*60}")
        print(f"Cartesia Bulk Registration: {count} accounts")
        print(f"Concurrency: {self.concurrency} | Stagger: {stagger}s | Domain: {self.domain}")
        print(f"{'='*60}\n")

        tasks = []
        for i in range(count):
            tasks.append(self.register_single())
            if i < count - 1:
                await asyncio.sleep(stagger)

        results = await asyncio.gather(*tasks)
        success = sum(1 for r in results if r)
        failed = count - success
        print(f"\n{'='*60}")
        print(f"DONE: {success} success, {failed} failed")
        print(f"Accounts saved to: cartesia_accounts.txt | cartesia_accounts.json")
        print(f"{'='*60}")
        return results


async def main():
    CONFIG = {
        "domain": "furia.ink",
        "gmail_user": "nameofsewar@gmail.com",
        "gmail_app_pass": "negf glnq rzki ibgs",
        "concurrency": 2,           # Без проксі: 2-3 макс
        "stagger": 10.0,            # Секунд між стартами
        "count": 10,                # Скільки акаунтів реєструвати
        "proxies": None,            # ["http://user:pass@ip:port", ...]
    }
    autoreg = CartesiaAPIAutoreg(
        domain=CONFIG["domain"],
        gmail_user=CONFIG["gmail_user"],
        gmail_app_pass=CONFIG["gmail_app_pass"],
        concurrency=CONFIG["concurrency"],
        proxies=CONFIG["proxies"],
    )
    await autoreg.register_bulk(count=CONFIG["count"], stagger=CONFIG["stagger"])


if __name__ == "__main__":
    asyncio.run(main())
