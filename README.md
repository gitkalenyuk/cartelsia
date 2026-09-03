<div align="center">

<img src="build/icon.png" width="140" alt="Cartelsia" />

# ☠️ Cartelsia

### Генерація озвучки через Cartesia AI · Автореєстрація акаунтів · Master-клонування голосів

**Потрібно багато озвучки?** Один portable .exe: пул безкоштовних ключів (20 000 символів кожен),
автореєстрація нових акаунтів у headless-браузері, клонування голосів — і весь текст
озвучується **одним голосом** через **всі твої ключі одночасно**.

[![Release](https://img.shields.io/github/v/release/gitkalenyuk/cartelsia?color=d97757&label=%D0%B2%D0%B5%D1%80%D1%81%D1%96%D1%8F&style=for-the-badge)](https://github.com/gitkalenyuk/cartelsia/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/gitkalenyuk/cartelsia/total?color=7fa66f&label=%D0%B7%D0%B0%D0%B2%D0%B0%D0%BD%D1%82%D0%B0%D0%B6%D0%B5%D0%BD%D1%8C&style=for-the-badge)](https://github.com/gitkalenyuk/cartelsia/releases)
[![Tests](https://img.shields.io/badge/%D1%82%D0%B5%D1%81%D1%82%D0%B8-153%20%E2%9C%93-7fa66f?style=for-the-badge)](#розробка)
[![Platform](https://img.shields.io/badge/Windows-portable%20.exe-2b2a27?style=for-the-badge&logo=windows)](https://github.com/gitkalenyuk/cartelsia/releases/latest)

**📥 [Завантажити останню версію](https://github.com/gitkalenyuk/cartelsia/releases/latest)** ·
**🌐 [Сайт з документацією](https://gitkalenyuk.github.io/cartelsia/)** ·
**💬 [Телеграм-канал](https://t.me/+e_g6IwDlVhg4OGJi)**

*Скачав → запустив → вставив ключі → озвучуєш. Без інсталяції, без Python, усе в одному файлі.*

</div>

---

## ⚡ Можливості

<table>
<tr>
<td width="50%" valign="top">

### 🎙️ Озвучення
- **sonic-3.6** (нова модель) + 3.5/3 на вибір; locale-коди (`en-GB`, `uk-UA`…)
- **Пул ключів**: скільки завгодно безкоштовних, best-fit розподіл тексту
- **Паралельна генерація** — фрагменти йдуть на різні ключі одночасно
- **Кеш TTS** — переозвучка того самого тексту = 0 кредитів
- Субтитри з таймкодами слів → SRT/VTT
- Склейка в один файл, паузи між фрагментами

### 🌐 Спільні голоси (2.1)
- Додай будь-який публічний голос **за Voice ID** → озвучуй ним **усім пулом**
- Кредити списуються з **твого** ключа, не власника *(живо перевірено)*
- Захист від ревокації: перевірка перед кожним прогоном

</td>
<td width="50%" valign="top">

### 🤖 Автореєстрація 2.0
- Реєстрація через **справжню форму** в headless Chromium (Clerk-блокування обійдено)
- До **25 потоків**, до 2000 акаунтів за прогін
- Ключ грабиться **в тому ж сеансі** → одразу в пул + `api_keys.txt`
- Rescue-прохід для акаунтів без ключа
- **4 стилі email** (Cartesia забанила «cartelia» — обійдено)
- Стоп = миттєве вбивство всіх браузерів

### 👑 Master-клонування (Pro)
- Pro-акаунт ($5) як **фабрика клонів**: ffmpeg-препроцесинг → clone → авто-public
- Дедуплікація SHA-256 — кредити не горять марно
- Клони озвучуються free-ключами

</td>
</tr>
</table>

### 🌐 Проксі 2.0
Імпорт із файлу/тексту/URL · **realtime-чекінг** (статус кожного проксі в міру перевірки) ·
потоки 1–50 · перевірка **на домені Cartesia** (марна проксі, через яку Cartesia недосяжна) ·
зупинка чекінгу · експорт · socks5 · persist між запусками

---

## 🚀 Швидкий старт

```bash
# 1. Скачай Cartelsia-2.1.3-portable.exe з Releases у окрему папку
# 2. SmartScreen → «Докладніше» → «Виконати все одно»
# 3. Встав наявні ключі АБО запусти автореєстрацію
# 4. Обери голос → встав текст → «Озвучити»
```

> ⚠️ Ключі зберігаються відкритим текстом у `data/` поруч з exe — не передавай папку стороннім.

---

## 🆕 Історія версій

| Версія | Головне |
|---|---|
| **2.1.3** | Проксі-чек на домені Cartesia (clerk + play), іконки оновлено |
| **2.1.2** | 🎭 Виправлено бан «cartelia»: 4 стилі email, людські імена. Стоп=killAll браузерів, повний вихід, Проксі 2.0 (realtime/потоки/експорт/socks5), авто-розширення композера, нове лого |
| **2.1.1** | 🚀 sonic-3.6 за замовчуванням + locale (взаємовиключний з language) |
| **2.1.0** | 🌐 Спільні голоси за Voice ID + кеш TTS (повтори безкоштовні) |
| **2.0.1** | 👑 Master-клонування: Pro-ключ → клон → авто-public → озвучка free-ключами |
| **2.0.0** | 🤖 Автореєстрація 2.0: browser-signup рушій, 25 потоків, rescue, редизайн |

Детальні звіти: [RELEASE_NOTES_2.1.2.md](RELEASE_NOTES_2.1.2.md) · [RELEASE_NOTES_2.1.0.md](RELEASE_NOTES_2.1.0.md) · [RELEASE_NOTES_2.0.0.md](RELEASE_NOTES_2.0.0.md)

---

## 🤖 Автореєстрація — як працює

```
headless Chromium (окремий на потік, через проксі)
  → play.cartesia.ai/sign-up   (Vercel checkpoint проходить САМ за 6–10 с)
  → людські імена + email у вибраному стилі (без бан-слів)
  → форма → екран OTP
  → прямий IMAP: свіже TLS-з'єднання + UID SEARCH HEADER To (~3 с)
  → введення коду → /start = АКАУНТ СТВОРЕНИЙ
  → одразу /keys → Create API key → sk_car_... (в ТОМУ Ж сеансі!)
  → session cookies збережено (rescue-прохід для «без ключа»)
```

| Параметр | Значення | Чому |
|---|---|---|
| Потоків максимум | **25** | Понад 25 Clerk масово віддає 429. Комфортно: 5–15 |
| Акаунтів за прогін | до 2000 | Пул воркерів: завершив → пауза → наступний |
| Час одного акаунта | 50–90 с | Checkpoint + форма + OTP + /keys |
| Успішність | 60–85% | Решту добиває retry + rescue |
| Proxy penalty | 2 фейли підряд = вилучення | Успіх скидає лічильник |

### 📮 Catch-All на субдомені

Всі акаунти реєструються на `*@ваш-домен`. Якщо Cartesia забанить домен — все пропало.
Рішення: **субдомен** (`reg.mydomain.com` через [ImprovMX](https://improvmx.com), безкоштовно).
Забанять субдомен → міняєш на `reg2.` за 2 хвилини, основний домен живий.
Повний гайд у вкладці Docs на [сайті](https://gitkalenyuk.github.io/cartelsia/).

---

## ❓ FAQ

<details>
<summary><b>Чому не можна більше 25 потоків?</b></summary>
Понад 25 одночасних Chromium Clerk/Vercel починають масово віддавати HTTP 429 — реєстрації ламаються лавиною. 5–15 = стабільно.
</details>

<details>
<summary><b>Акаунт «без ключа» — загублено?</b></summary>
Ні. Rescue-прохід після прогону сам відновлює сесію з <code>sessions/</code> і витягує ключ.
</details>

<details>
<summary><b>Чому не просто залогінитись знову за ключем?</b></summary>
Clerk Bot Protection: логін з нового браузера = protect-check → «suspicious, blocked». Ключ береться <b>одразу</b> в сеансі реєстрації.
</details>

<details>
<summary><b>OTP не знаходиться</b></summary>
Gmail App Password (не звичайний пароль) + фільтр «Never spam» на адресу субдомена + тестовий лист на <code>xyz@sub.domain.com</code>.
</details>

<details>
<summary><b>Скільки символів дає один ключ?</b></summary>
20 000/міс безкоштовно. 100 акаунтів = 2 млн символів/місяць.
</details>

<details>
<summary><b>Чи можна юзати чужі публічні голоси?</b></summary>
Так — вкладка «Клон голосу» → «Спільні голоси»: встав Voice ID з діалогу Share → голос у бібліотеці, озвучується будь-яким твоїм ключем. Кредити — з твого ключа.
</details>

<details>
<summary><b>Antivirus лається на exe?</b></summary>
Portable самопідписаний. SmartScreen попереджає всі непідписані — «Докладніше → Виконати все одно». Код відкритий.
</details>

---

## 🛠️ Розробка

```bash
git clone https://github.com/gitkalenyuk/cartelsia.git
cd cartelsia
npm install
npm run dev          # dev-режим із HMR
```

| Команда | Що робить |
|---|---|
| `npm run typecheck` | перевірка типів (main + renderer) |
| `npm test` | **153** unit-тести (vitest) |
| `npm run build:win` | portable .exe → `dist/` |

> 🤖 **AI-збірка з сирців**: на [сайті](https://gitkalenyuk.github.io/cartelsia/) готовий промпт для Claude Code / Codex / Antigravity — встановлює, збирає і запускає проєкт покроково (Windows + macOS).

### Архітектура

| Модуль | Роль |
|---|---|
| `src/main/email/browserSignupRegistrar.ts` | Рушій реєстрації: headless Chromium, форма, граб ключа, rescue, killAll |
| `src/main/email/identity.ts` | Генерація email (4 стилі) + людські імена + санітизація бан-слів |
| `src/main/email/imapDirectOtp.ts` | Прямий IMAP OTP: свіже TLS + UID SEARCH HEADER To |
| `src/main/email/autoregService.ts` | Пул воркерів до 25, rescue-етап, api_keys.txt |
| `src/main/proxy/proxyManager.ts` | Realtime чекінг на домені Cartesia, потоки, persist, socks5 |
| `src/main/voices/sharedVoiceRegistry.ts` | Спільні голоси: alias→voice_id, пребатч-гейт ревокації |
| `src/main/voices/masterVoiceService.ts` | Master-клонування: SHA-256 дедуп, ensurePublic, retry |
| `src/main/tts/ttsCache.ts` | Кеш генерацій: sha256(voice+model+text), atomic writes |

---

<div align="center">

**💀 YT CARTEL** · [Канал](https://t.me/+e_g6IwDlVhg4OGJi) · [Чат](https://t.me/+Jj06Fbj8-8oyZDQ6) · [Сайт](https://gitkalenyuk.github.io/cartelsia/)

</div>
