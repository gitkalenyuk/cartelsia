# ☠️ Cartelsia — by YouTube Cartel (v2.2.0)

<div align="center">

<img src="build/icon.png" width="140" alt="Cartelsia Skull" />

### Надшвидка озвучка Cartesia AI · Пул безкоштовних ключів · Go Standalone & Electron

[![Версія](https://img.shields.io/badge/version-2.2.0-f59e0b.svg?style=for-the-badge)](https://github.com/gitkalenyuk/cartelsia/releases/latest)
[![Go Standalone](https://img.shields.io/badge/Go%20Native-8%20MB%20Portable-10b981.svg?style=for-the-badge)](https://github.com/gitkalenyuk/cartelsia/releases/latest)
[![Сайт & Гайди](https://img.shields.io/badge/%D0%A1%D0%B0%D0%B9%D1%82-%D0%94%D0%BE%D0%BA%D1%83%D0%BC%D0%B5%D0%BD%D1%82%D0%B0%D1%86%D1%96%D1%8F-38bdf8.svg?style=for-the-badge)](https://gitkalenyuk.github.io/cartelsia/)
[![Telegram](https://img.shields.io/badge/Telegram-YouTube%20Cartel-0088cc.svg?style=for-the-badge&logo=telegram)](https://t.me/+e_g6IwDlVhg4OGJi)

**📥 [Завантажити Cartelsia v2.2.0 (Windows / Mac)](https://github.com/gitkalenyuk/cartelsia/releases/latest)** ·
**🌐 [Офіційний сайт з покроковими гайдами](https://gitkalenyuk.github.io/cartelsia/)** ·
**💬 [YouTube Cartel Telegram](https://t.me/+e_g6IwDlVhg4OGJi)**

*Розроблено спеціально для YouTube-креаторів. Озвучуйте сотні тисяч та мільйони символів абсолютно безкоштовно завдяки пулу ключів Cartesia.*

</div>

---

## 🚀 Що нового у версії v2.2.0

- **⚡ Go Standalone Edition:** Ядро програми повністю переписано на Go! Запуск за 0.05 секунди, розмір ~8 МБ (замість 200+ МБ в Electron), мінімальне споживання пам'яті.
- **🖼️ Вбудована нативна іконка Windows:** `Cartelsia.exe` тепер має повнорозмірну вшиту іконку (PE resource table via `rsrc`) у провіднику та на панелі задач.
- **🪟 Чистий запуск без чорної консолі:** Компіляція з прапором `-H=windowsgui` — при подвійному кліку відкривається одразу вікно програми без висячого вікна `cmd.exe`.
- **🎨 Престижний Cyber Cartel Noir дизайн:** Глибокі обсидіанові фони, титанові поверхні з підсвічуванням палючого бурштинового золота, анімований череп Cartel, скляний неоморфізм і плавні мікроінтеракції.
- **📚 Пряме посилання на гайди:** У сайдбарі додатку додано брендовану кнопку швидкого переходу на сайт з інструкціями.
- **🛡️ Повна стабільність:** Ротація активних ключів при вичерпанні лімітів (20k на ключ), кешування 950+ зразків голосів, спільні голоси за Voice ID.

---

## ⚡ Головні можливості

| Модуль | Опис |
|---|---|
| **🎙️ Флагманська модель sonic-3.6** | Новітнє покоління моделі Cartesia з кришталевою якістю, підтримкою української та десятків інших мов, емоціями та темпом. |
| **🔑 Нескінченний пул ключів** | Об'єднуйте 10, 50 чи 100 безкоштовних ключів (20 000 символів на кожен). Cartelsia автоматично паралелить чанки між ключами. |
| **🌐 Спільні голоси (Shared Voices)** | Додавайте будь-який чужий або публічний голос за його **Voice ID** — озвучуйте вашим пулом без списання кредитів у власника. |
| **📝 Субтитри (SRT / VTT)** | Миттєва генерація файлів субтитрів з точними таймкодами слів для YouTube, TikTok та Instagram Reels. |
| **💾 Локальне кешування** | Якщо ви змінили фрагмент тексту — Cartelsia переозвучить лише змінене речення. |
| **📦 100% Портативність** | Усі налаштування, ключі та аудіо зберігаються поруч у папці `data/` та `output/`. |

---

## 📖 Стратегія Catch-All: Нескінченні ключі через піддомени 3-го рівня

Повна детальна інструкція опублікована на нашому сайті: **[https://gitkalenyuk.github.io/cartelsia/#catchall](https://gitkalenyuk.github.io/cartelsia/#catchall)**

### 1. Чому піддомени 3-го рівня (`c1.domain.watch`, `c2.domain.watch`)?
Якщо реєструвати сотні акаунтів на корінь основного домену, антифрод Clerk може заблокувати домен.
Використовуючи піддомени:
- Основний домен залишається чистим і захищеним назавжди.
- Якщо піддомен заблокували — ви просто додаєте `c2.domain.watch` у Namecheap за 30 секунд. Вартість: **0$**.

### 2. Найдешевші зони на Namecheap.com:
- `.watch` (~$1.98 / рік)
- `.xyz` (~$1.99 / рік)
- `.top` (~$1.80 / рік)
- `.site`, `.shop`, `.online`, `.club` (~$1.88 - $1.99)

### 3. Налаштування Namecheap DNS + ImprovMX:
1. Зареєструйтесь безкоштовно на [ImprovMX.com](https://improvmx.com/) та додайте піддомен (наприклад `c1.yourdomain.watch`).
2. Вкажіть вашу особисту пошту Gmail для перенаправлення (Forwarding).
3. В Namecheap у розділі **Advanced DNS ➔ Mail Settings ➔ Custom MX** додайте:
   - `MX` | Host: `c1` | Value: `mx1.improvmx.com.` | Priority: `10`
   - `MX` | Host: `c1` | Value: `mx2.improvmx.com.` | Priority: `20`
   - `TXT` | Host: `c1` | Value: `v=spf1 include:spf.improvmx.com ~all`
4. Тепер будь-який лист на `будь-що@c1.yourdomain.watch` миттєво надходить у ваш Gmail!
5. Реєструєте акаунт на [play.cartesia.ai](https://play.cartesia.ai), копіюєте OTP з Gmail, генеруєте API-ключ і додаєте у Cartelsia.

---

## 🪟 Встановлення та запуск

### Windows (Go Standalone):
1. Завантажте `Cartelsia-Go-v2.2.0-windows-x64.zip`.
2. Розпакуйте у будь-яку теку (наприклад, `C:\Cartelsia`).
3. Запустіть `Cartelsia.exe` (відкриється нативне вікно WebView2).
4. Перейдіть у вкладку **«Ключі»**, вставте ваші API-ключі та генеруйте аудіо!

### macOS (Apple Silicon & Intel):
1. Для M1/M2/M3/M4 завантажте `Cartelsia-Go-v2.2.0-mac-arm64.zip`, для Intel — `Cartelsia-Go-v2.2.0-mac-amd64.zip`.
2. Відкрийте Terminal у розпакованій теці та зніміть блокування:
   ```bash
   xattr -cr . && chmod +x Cartelsia run.sh
   ```
3. Запустіть застосунок:
   ```bash
   ./run.sh
   ```
4. Відкриється веб-інтерфейс у вашому браузері.

---

## 📁 Структура даних

Вся конфігурація та файли зберігаються автономно:
- `data/keys.json` — збережені API-ключі та баланси.
- `data/settings.json` — налаштування моделей та формату аудіо.
- `data/shared_voices.json` — реєстр доданих спільних голосів.
- `data/chats/` — історія текстів та згенеровані чанки.
- `output/` — готові аудіотреки та субтитри.

---

## 👥 Спільнота

Приєднуйтесь до нашого Telegram-каналу: **[YouTube Cartel](https://t.me/+e_g6IwDlVhg4OGJi)**
