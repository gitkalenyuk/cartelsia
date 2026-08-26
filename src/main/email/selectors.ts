/**
 * Єдине джерело правди для DOM/CSS-селекторів Playwright.
 *
 * Кожен селектор — це масив fallback-ів (перший, що знайшов — використовується).
 * Якщо Cartesia/WorkOS змінює розмітку — правимо ТІЛЬКИ цей файл, не Playwright-код.
 *
 * УВАГА: цей файл імпортується в renderer/main — він не повинен мати
 * Node-only dependencies (fs, path, os, process).
 */

/** Поля форми створення акаунта на /sign-in/create */
export const SIGN_IN = {
  firstName: [
    'input[name="firstName"]',
    'input[name="first_name"]',
    'input[autocomplete="given-name"]',
    'input[id*="first" i]',
  ],
  lastName: [
    'input[name="lastName"]',
    'input[name="last_name"]',
    'input[autocomplete="family-name"]',
    'input[id*="last" i]',
  ],
  email: [
    'input[name="emailAddress"]',
    'input[type="email"]',
    'input[name="email"]',
    'input[autocomplete="email"]',
  ],
  password: [
    'input[name="password"]',
    'input[type="password"]',
    'input[autocomplete="new-password"]',
  ],
} as const

/** Кнопка Continue (форма логіну/реєстрації) */
export const CONTINUE_BTN_TEXT = 'continue'

/** OTP-поле на сторінці /verify-email-address */
export const OTP_INPUT = [
  'input[data-input-otp="true"]',
  'input[autocomplete="one-time-code"]',
  'input[name="code"]',
  'input[name="otp"]',
  'input[inputmode="numeric"][maxlength="6"]',
] as const

/** Поле "Description" у модалці Create API Key */
export const API_KEY_DESCRIPTION = [
  'input[name="description"]',
  'input[id="description"]',
  'input[placeholder*="description" i]',
] as const

/** Кнопки Submit у модалках (текст) */
export const MODAL_SUBMIT_TEXTS = [
  'create api key',
  'create',
  'submit',
  'save',
  'confirm',
] as const

/** Captcha detection — селектори Cloudflare Turnstile / hCaptcha */
export const CAPTCHA_INDICATORS = [
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="turnstile"]',
  'iframe[src*="hcaptcha"]',
  'div[data-sitekey]',
  '[data-callback*="turnstile"]',
] as const

/** Текстові ознаки капчі (нижній регістр) */
export const CAPTCHA_TEXT_HINTS = [
  'verify you are human',
  'checking your browser',
  'cf-turnstile',
] as const

/** Шукаємо ключ API на сторінці */
export const API_KEY_REGEX = /sk_car_[A-Za-z0-9_-]{10,}/

/** Витягує перший робочий селектор (для page.locator(...).first()) */
export function firstMatching<T extends readonly string[]>(
  selectors: T,
  predicate: (sel: string) => boolean
): string | null {
  for (const s of selectors) {
    if (predicate(s)) return s
  }
  return null
}

/** Повертає один CSS-селектор через кому — Playwright приймає такий формат. */
export function joinSelectors(selectors: readonly string[]): string {
  return selectors.join(', ')
}
