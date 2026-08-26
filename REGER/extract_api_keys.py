import asyncio
import aiohttp
import json
import re
import imaplib
import email
import time
from playwright.async_api import async_playwright
from pathlib import Path
from typing import Optional, List

CLERK = "https://clerk.cartesia.ai/v1"
HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://play.cartesia.ai",
    "Referer": "https://play.cartesia.ai/",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}

GMAIL_USER = "nameofsewar@gmail.com"
GMAIL_PASS = "negfglnqrzkiibgs"


def get_code(target_email: str, timeout: int = 120) -> Optional[str]:
    """Отримує 6-значний код з Gmail IMAP для конкретного To-адресата."""
    target_clean = target_email.lower().strip()
    start = time.time()
    while time.time() - start < timeout:
        try:
            mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
            mail.login(GMAIL_USER, GMAIL_PASS)
            mail.select("inbox")
            # Шукаємо тільки непрочитані (нові) листи
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
                        mail.close()
                        mail.logout()
                        return code
            mail.close()
            mail.logout()
        except Exception as e:
            print(f"  IMAP error: {e}")
        time.sleep(3)
    return None


async def _js_click_element(page, selector: str) -> bool:
    """Клік через evaluate — обходить оверлеї."""
    clicked = await page.evaluate(f'''
        () => {{
            const el = document.querySelector('{selector}');
            if (el) {{ el.click(); return true; }}
            return false;
        }}
    ''')
    return bool(clicked)


async def _js_click_by_text(page, tag: str, text: str, exact: bool = False) -> bool:
    """Клік через evaluate по тексту тега."""
    import json
    text_json = json.dumps(text)
    script = f'''
        () => {{
            const els = document.querySelectorAll({json.dumps(tag)});
            for (const el of els) {{
                const t = el.textContent.trim();
                if ({'t ===' if exact else 't.includes'}({text_json})) {{
                    el.click();
                    return true;
                }}
            }}
            return false;
        }}
    '''
    return await page.evaluate(script)


async def _find_api_key_in_page(page) -> Optional[str]:
    """Шукає API ключ у всьому DOM."""
    content = await page.content()
    key_match = re.search(r'sk_car_[a-zA-Z0-9_]+', content)
    if key_match:
        return key_match.group(0)

    # Спробувати натиснути Reveal
    try:
        reveal_btns = await page.query_selector_all('button:has-text("Reveal")')
        for btn in reveal_btns[:3]:
            await btn.click()
            await asyncio.sleep(1)
        content = await page.content()
        key_match = re.search(r'sk_car_[a-zA-Z0-9_]+', content)
        if key_match:
            return key_match.group(0)
    except Exception:
        pass

    # Перевірити input поля
    try:
        inputs = await page.query_selector_all('input')
        for inp in inputs:
            val = await inp.input_value()
            if val and val.startswith('sk_car_'):
                return val
    except Exception:
        pass

    # Перевірити текст сторінки
    try:
        text = await page.inner_text('body')
        key_match = re.search(r'sk_car_[a-zA-Z0-9_]+', text)
        if key_match:
            return key_match.group(0)
    except Exception:
        pass

    return None


async def extract_api_key(email: str, password: str, semaphore: asyncio.Semaphore) -> Optional[str]:
    async with semaphore:
        print(f"\n[{email}] ========== START ==========")

        # ---- Step 1: API login ----
        print(f"[{email}] Step 1: API login...")
        connector = aiohttp.TCPConnector(limit=10, ssl=False)
        jar = aiohttp.CookieJar()
        cookies_to_set = []

        async with aiohttp.ClientSession(connector=connector, cookie_jar=jar) as session:
            async with session.post(f"{CLERK}/client", headers=HEADERS) as resp:
                data = json.loads(await resp.text())
                client_id = data.get("response", {}).get("id")
                if not client_id:
                    print(f"[{email}] ❌ No client_id")
                    return None

            h = dict(HEADERS)
            h["X-Clerk-Client-Id"] = client_id
            payload = f"identifier={email}&password={password}&strategy=password"
            async with session.post(f"{CLERK}/client/sign_ins", data=payload, headers=h) as resp:
                signin_data = json.loads(await resp.text()).get("response", {})
                signin_id = signin_data.get("id")
                if not signin_id:
                    print(f"[{email}] ❌ No signin_id")
                    return None

            async with session.post(
                f"{CLERK}/client/sign_ins/{signin_id}/prepare_second_factor",
                data="strategy=email_code", headers=h
            ) as resp:
                if resp.status != 200:
                    print(f"[{email}] ⚠️ prepare_second_factor: {resp.status}")

            code = get_code(email)
            if not code:
                print(f"[{email}] ❌ No 2FA code received")
                return None
            print(f"[{email}] 2FA code: {code}")

            async with session.post(
                f"{CLERK}/client/sign_ins/{signin_id}/attempt_second_factor",
                data=f"strategy=email_code&code={code}", headers=h
            ) as resp:
                if resp.status != 200:
                    print(f"[{email}] ⚠️ attempt_second_factor: {resp.status}")
                    return None

            # Збираємо cookies
            for url_obj, cookies in jar._cookies.items():
                for name, cookie in cookies.items():
                    cookies_to_set.append({
                        "name": name,
                        "value": cookie.value,
                        "domain": ".cartesia.ai",
                        "path": "/",
                    })
            print(f"[{email}] Cookies extracted: {len(cookies_to_set)}")

        # ---- Step 2: Browser ----
        print(f"[{email}] Step 2: Opening browser...")
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context()
            for c in cookies_to_set:
                try:
                    await context.add_cookies([c])
                except Exception:
                    pass

            page = await context.new_page()

            # Переходимо на /keys
            print(f"[{email}] Navigating to /keys...")
            await page.goto("https://play.cartesia.ai/keys", wait_until="domcontentloaded")
            await asyncio.sleep(6)

            # Вибір організації
            if "/choose-organization" in page.url:
                print(f"[{email}] Selecting organization...")
                # Скріншот для дебагу
                safe_email = re.sub(r'[^a-z0-9]', '_', email.split('@')[0])
                await page.screenshot(path=f"org_select_{safe_email}.png", full_page=True)
                # Клік на перший елемент з текстом "'s organization" (не "Create new")
                clicked = await page.evaluate('''() => {
                    const all = document.querySelectorAll('div, span, p, a, button');
                    for (const el of all) {
                        const text = el.textContent.trim();
                        if (text.includes("'s organization") && !text.includes("Create new")) {
                            // Знайти найближчий clickable предок
                            let node = el;
                            while (node && node !== document.body) {
                                const style = window.getComputedStyle(node);
                                if (node.tagName === 'BUTTON' || node.tagName === 'A' || 
                                    node.onclick || style.cursor === 'pointer' ||
                                    node.getAttribute('role') === 'button') {
                                    node.click();
                                    return true;
                                }
                                node = node.parentElement;
                            }
                            el.click();
                            return true;
                        }
                    }
                    return false;
                }''')
                print(f"[{email}] Organization clicked: {clicked}")
                await asyncio.sleep(5)
                # Якщо все ще на сторінці вибору — спробувати ще раз з іншим селектором
                if "/choose-organization" in page.url:
                    await page.evaluate('''() => {
                        const items = document.querySelectorAll('[class*="organization"], [data-testid*="organization"]');
                        if (items.length > 0) items[0].click();
                    }''')
                    await asyncio.sleep(5)
            if "/choose-organization" in page.url:
                print(f"[{email}] Selecting organization...")
                await _js_click_by_text(page, 'div', "Skyler")
                await asyncio.sleep(5)

            print(f"[{email}] URL: {page.url}")

            # Закрити cookie banner
            try:
                await _js_click_by_text(page, 'button', 'Accept')
                await asyncio.sleep(1)
            except Exception:
                pass

            # --- Шукаємо існуючий ключ ---
            existing_key = await _find_api_key_in_page(page)
            if existing_key:
                print(f"[{email}] ✅ API KEY (existing): {existing_key}")
                await browser.close()
                return existing_key

            # --- Створюємо новий ключ ---
            print(f"[{email}] No existing key. Creating new...")

            # Клік на "Create API key" (верхня зелена кнопка)
            clicked = await _js_click_by_text(page, 'button', 'Create API key')
            if not clicked:
                clicked = await _js_click_element(page, 'button[type="button"]')
            print(f"[{email}] Create API key clicked: {clicked}")
            await asyncio.sleep(4)

            # Перевіряємо, чи відкрився діалог
            dialog_input = await page.query_selector('input[placeholder*="description" i], input[name="description"]')
            if not dialog_input:
                # Можливо, діалог ще не відкрився — спробуємо ще раз
                await _js_click_by_text(page, 'button', 'Create API key')
                await asyncio.sleep(3)
                dialog_input = await page.query_selector('input[placeholder*="description" i], input[name="description"]')

            if dialog_input:
                print(f"[{email}] Dialog opened, filling...")
                await dialog_input.fill("auto-generated")
                await asyncio.sleep(1)

                # Клік на Create через evaluate (обхід оверлею)
                create_clicked = await _js_click_by_text(page, 'button', 'Create', exact=True)
                if not create_clicked:
                    create_clicked = await page.evaluate('''() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const btn = buttons.find(b => b.textContent.trim() === 'Create');
                        if (btn) { btn.click(); return true; }
                        return false;
                    }''')
                print(f"[{email}] Create clicked: {create_clicked}")
                await asyncio.sleep(5)
            else:
                print(f"[{email}] No dialog detected, checking page directly...")

            # Скріншот для дебагу
            safe_email = re.sub(r'[^a-z0-9]', '_', email.split('@')[0])
            await page.screenshot(path=f"keys_final_{safe_email}.png", full_page=True)

            # Шукаємо ключ
            api_key = await _find_api_key_in_page(page)
            if api_key:
                print(f"[{email}] ✅ API KEY: {api_key}")
                await browser.close()
                return api_key

            print(f"[{email}] ❌ API key not found")
            await browser.close()
            return None


async def main():
    accounts_file = Path("cartesia_accounts.txt")
    if not accounts_file.exists():
        print("No accounts file found!")
        return

    with open(accounts_file) as f:
        lines = [l.strip() for l in f.read().strip().split('\n') if ':' in l]

    print(f"Loaded {len(lines)} accounts")

    # Семафор — не більше 3 одночасних браузерів
    semaphore = asyncio.Semaphore(3)

    results = []
    for line in lines:
        email, password = line.split(':', 1)
        try:
            api_key = await extract_api_key(email, password, semaphore)
            if api_key:
                with open("cartesia_api_keys.txt", "a") as f:
                    f.write(f"{email}:{api_key}\n")
                print(f"[{email}] SAVED to cartesia_api_keys.txt")
            results.append((email, api_key))
        except Exception as e:
            print(f"[{email}] 💥 ERROR: {e}")
            results.append((email, None))

    print("\n" + "=" * 60)
    print("SUMMARY:")
    success = sum(1 for _, k in results if k)
    print(f"  Success: {success}/{len(results)}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
