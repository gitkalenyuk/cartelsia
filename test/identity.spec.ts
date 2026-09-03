import { describe, expect, it } from 'vitest'
import {
  genEmailLocal,
  genName,
  isBanned,
  sanitizeBanned,
  validateIdentity,
  randStr
} from '../src/main/email/identity'

describe('identity — стилі email (2.1.2)', () => {
  it('random: 10-12 символів [a-z0-9], без підкреслень і бренд-слів', () => {
    for (let i = 0; i < 50; i++) {
      const local = genEmailLocal('random')
      expect(local).toMatch(/^[a-z0-9]{10,12}$/)
      expect(local).not.toContain('_')
      expect(isBanned(local)).toBe(false)
    }
  })

  it('word: слово+цифри+слово, без бренд-слів', () => {
    for (let i = 0; i < 30; i++) {
      const local = genEmailLocal('word')
      expect(local).toMatch(/^[a-z]+[0-9]{2}[a-z]+$/)
      expect(isBanned(local)).toBe(false)
    }
  })

  it('support: support + 13 цифр', () => {
    const local = genEmailLocal('support')
    expect(local).toMatch(/^support\d{13}$/)
  })

  it('custom: префікс + рандом, забанені слова в префіксі санітизуються', () => {
    const clean = genEmailLocal('custom', 'john')
    expect(clean).toMatch(/^john[a-z0-9]{6}$/)
    // префікс містить cartelia → санітизація
    const sanitized = genEmailLocal('custom', 'cartelia-shop')
    expect(isBanned(sanitized)).toBe(false)
    expect(sanitized.startsWith('cartelia')).toBe(false)
  })

  it('жоден стиль не містить «cartelia» (головний регрес-тест)', () => {
    for (const style of ['random', 'word', 'support', 'custom'] as const) {
      for (let i = 0; i < 30; i++) {
        const local = genEmailLocal(style, 'prefix')
        expect(local.toLowerCase()).not.toContain('cartelia')
        expect(local.toLowerCase()).not.toContain('cartel')
      }
    }
  })
})

describe('identity — імена', () => {
  it('людські імена без бренд-слів', () => {
    for (let i = 0; i < 30; i++) {
      const { first, last } = genName()
      expect(first.length).toBeGreaterThan(1)
      expect(last.length).toBeGreaterThan(1)
      expect(isBanned(first)).toBe(false)
      expect(isBanned(last)).toBe(false)
      expect(first).not.toBe('cartelia')
    }
  })
})

describe('identity — санітизація і валідація', () => {
  it('sanitizeBanned замінює cartelia у будь-якому регістрі', () => {
    expect(isBanned(sanitizeBanned('Cartelia_shop'))).toBe(false)
    expect(isBanned(sanitizeBanned('CARTELIA'))).toBe(false)
    expect(isBanned(sanitizeBanned('my-cartelia-x'))).toBe(false)
    expect(sanitizeBanned('clean')).toBe('clean')
  })

  it('isBanned ловить усі варіанти', () => {
    expect(isBanned('cartelia_x')).toBe(true)
    expect(isBanned('Cartelia')).toBe(true)
    expect(isBanned('CARTELIA')).toBe(true)
    expect(isBanned('sonic-fan')).toBe(true)
    expect(isBanned('stoneriver')).toBe(false)
  })

  it('validateIdentity відхиляє бренд-слова і поганий email', () => {
    expect(validateIdentity('cartelia_x@saputti365.life', 'John', 'Stone')).toContain('banned')
    expect(validateIdentity('ok@saputti365.life', 'cartelia', 'Stone')).toContain('banned')
    expect(validateIdentity('not-an-email', 'John', 'Stone')).toContain('invalid')
    expect(validateIdentity('mt8kb1dc8llr@saputti365.life', 'John', 'Stone')).toBeNull()
  })

  it('randStr детермінований по довжині й алфавіту', () => {
    const s = randStr(8, 'abc')
    expect(s).toHaveLength(8)
    expect(s).toMatch(/^[abc]+$/)
  })
})
