# Cartelsia 2.0.0.0 — Автореєстрація нового покоління

## Головне

Стара система автореєстрації (PlaywrightRegistrar з ручною капчею / ClerkApiRegistrar /
BrowserlessRegistrar) **повністю замінена** новим браузерним рушієм **BrowserSignupRegistrar** —
портом перевіреного Python-движка з REGER.

### Чому заміна

1. **Чистий Clerk API soft-blocked** (з ~13:07 UTC 26.08.2026): email верифікується,
   але Clerk мовчки НЕ створює юзера (`status=missing_requirements`, `created_user_id=null`).
   Усі «успішні» регістрації старого clerk-api рушія після цієї дати — фейкові: акаунтів
   не існує (перевірено sign_in: «Couldn't find your account»).
2. **Старий ImapOtpPoller не працював**: довгоживуче IMAP з'єднання потрапляло на
   «мовчазний» backend Gmail і ніколи не знаходив коди (плюс не робив SELECT INBOX).

### Як працює новий рушій

```
headless Chromium (окремий на потік, через проксі з пулу)
  → play.cartesia.ai/sign-up (Vercel checkpoint проходить сам ~6-10 c)
  → справжня форма реєстрації Clerk
  → OTP: ПРЯМИЙ IMAP (свеже TLS+LOGIN на кожен запит + UID SEARCH HEADER To "<email>" ~2-3 c,
    знайдений лист одразу видаляється — жодних гонок між потоками)
  → редирект /start = акаунт РЕАЛЬНО створений
  → одразу /keys → Create API key → sk_car_... (в ТОМУ Ж сеансі:
    повторний логін ловить Clerk protect-check, тому ключ береться негайно)
  → session cookies → data/sessions/<email>.json (майбутні входи без пароля)
```

## Нове у 2.0

- **Багатопотік до 50** — персистентні воркери: завершив акаунт → пауза → наступний,
  на весь прогін рівно N одночасних реєстрацій.
- **Ключі в окремий файл** одразу після грабінгу: `data/api_keys.txt` та
  `output/api_keys.txt` (по одному `sk_car_...` на рядок) + автододавання в пул.
- **Proxy penalty**: проксі, що дала 2 фейли реєстрації підряд, автоматично
  видаляється з ротації; успіх скидає лічильник.
- **Окрема вкладка Проксі** під Автореєстрацією: імпорт `ip:port:user:pass`,
  `http://user:pass@ip:port`, `ip:port`, Grab по URL, чек усіх, видалення мертвих.
- **Налаштування перенесено**: у вкладці Автореєстрація (потоки, проксі, headless);
  IMAP/домен лишились у Налаштуваннях.
- **Тултіпи (?)** на кожному параметрі з докладним поясненням.
- **Редизайн 2.0**: Inter + JetBrains Mono, градієнтний акцент, анімовані картки,
  shimmer-прогрес, плавний скрол, нова іконка.

## Тестування (наживо, 27.08.2026)

| Тест | Результат |
|---|---|
| Один акаунт | OK 67 c, ключ валідний (API 200) |
| 6 акаунтів / 3 потоки / ротація 5 проксі | 6/6 registered, 6/6 keys, 150 c |
| OTP пошук по існуючому листу | знайдено за 2.8 c |
| Валідація ключів через api.cartesia.ai/voices | усі 200 OK |

## Файли

- `src/main/email/browserSignupRegistrar.ts` — новий рушій
- `src/main/email/imapDirectOtp.ts` — прямий IMAP OTP (REGER-порт)
- `src/main/email/autoregService.ts` — пул воркерів, keys file, proxy penalty
- `src/renderer/src/components/browser/AutoregView.tsx` — новий UI (2 підвкладки)
- `scripts/probe-direct-otp.mjs`, `scripts/test-multithread.mjs` — живі тести

Старі рушії (`playwrightRegistrar`, `clerkApiRegistrar`, `browserlessRegistrar`)
лишились у коді як legacy, але не використовуються (engine='browser-signup' за замовчуванням).
