import { describe, expect, it } from 'vitest'
import {
  API_KEY_DESCRIPTION,
  API_KEY_REGEX,
  CAPTCHA_INDICATORS,
  CAPTCHA_TEXT_HINTS,
  CONTINUE_BTN_TEXT,
  MODAL_SUBMIT_TEXTS,
  OTP_INPUT,
  SIGN_IN,
  firstMatching,
  joinSelectors,
} from '../../src/main/email/selectors'

describe('selectors catalogue', () => {
  it('SIGN_IN.email має принаймні 3 fallback-а', () => {
    expect(SIGN_IN.email.length).toBeGreaterThanOrEqual(3)
  })

  it('SIGN_IN.password має кілька варіантів', () => {
    expect(SIGN_IN.password.length).toBeGreaterThanOrEqual(2)
  })

  it('OTP_INPUT починається з найнадійніших патернів', () => {
    expect(OTP_INPUT[0]).toBe('input[data-input-otp="true"]')
    expect(OTP_INPUT[1]).toBe('input[autocomplete="one-time-code"]')
  })

  it('API_KEY_DESCRIPTION включає description-based selectors', () => {
    expect(API_KEY_DESCRIPTION.some((s) => s.includes('description'))).toBe(true)
  })

  it('MODAL_SUBMIT_TEXTS містить "create" (Cartesiaʼвська модалка)', () => {
    expect(MODAL_SUBMIT_TEXTS).toContain('create api key')
    expect(MODAL_SUBMIT_TEXTS).toContain('create')
  })

  it('CAPTCHA_INDICATORS включає turnstile + hcaptcha', () => {
    expect(CAPTCHA_INDICATORS.some((s) => s.includes('turnstile'))).toBe(true)
    expect(CAPTCHA_INDICATORS.some((s) => s.includes('hcaptcha'))).toBe(true)
  })

  it('CAPTCHA_TEXT_HINTS — у нижньому регістрі', () => {
    for (const h of CAPTCHA_TEXT_HINTS) {
      expect(h).toBe(h.toLowerCase())
    }
  })

  it('CONTINUE_BTN_TEXT — "continue"', () => {
    expect(CONTINUE_BTN_TEXT).toBe('continue')
  })
})

describe('API_KEY_REGEX', () => {
  it('матчить валідний ключ', () => {
    expect(API_KEY_REGEX.test('sk_car_ABCDEFGHIJKLMN123456')).toBe(true)
  })

  it('не матчить короткі рядки', () => {
    expect(API_KEY_REGEX.test('sk_car_short')).toBe(false)
  })

  it('не матчить без префіксу', () => {
    expect(API_KEY_REGEX.test('ABCDEFGHIJKLMN1234567890')).toBe(false)
  })
})

describe('firstMatching', () => {
  it('повертає перший селектор що проходить predicate', () => {
    const out = firstMatching(['a', 'b', 'c'], (s) => s === 'b')
    expect(out).toBe('b')
  })

  it('повертає null якщо жоден не проходить', () => {
    expect(firstMatching(['a', 'b'], () => false)).toBeNull()
  })

  it('повертає перший коли всі проходять', () => {
    expect(firstMatching(['x', 'y'], () => true)).toBe('x')
  })
})

describe('joinSelectors', () => {
  it('обʼєднує через кому', () => {
    expect(joinSelectors(['a', 'b'])).toBe('a, b')
  })

  it('повертає один селектор якщо масив з 1', () => {
    expect(joinSelectors(['only'])).toBe('only')
  })

  it('повертає порожній рядок для порожнього масиву', () => {
    expect(joinSelectors([])).toBe('')
  })
})
