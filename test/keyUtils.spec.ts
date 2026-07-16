import { describe, expect, it } from 'vitest'
import { extractCartesiaKeys } from '../src/shared/keyUtils'

describe('extractCartesiaKeys', () => {
  it('знаходить повний ключ у тексті сторінки', () => {
    const text = 'Your API key: sk_car_GsyBydrygHNw3cKmLbkCWJ — copy it now'
    expect(extractCartesiaKeys(text)).toEqual(['sk_car_GsyBydrygHNw3cKmLbkCWJ'])
  })

  it('знаходить кілька ключів і прибирає дублі', () => {
    const text = `
      sk_car_AAAAAAAAAAAAAAAAAAAA01
      sk_car_BBBBBBBBBBBBBBBBBBBB02
      sk_car_AAAAAAAAAAAAAAAAAAAA01
    `
    expect(extractCartesiaKeys(text)).toEqual([
      'sk_car_AAAAAAAAAAAAAAAAAAAA01',
      'sk_car_BBBBBBBBBBBBBBBBBBBB02'
    ])
  })

  it('ігнорує замасковані ключі', () => {
    expect(extractCartesiaKeys('sk_car_••••••••••••••••abcd')).toEqual([])
    expect(extractCartesiaKeys('sk_car_xxxxxxxxxxxxxxxxxxxx')).toEqual([])
  })

  it('ігнорує занадто короткі', () => {
    expect(extractCartesiaKeys('sk_car_short')).toEqual([])
  })

  it('порожній ввід', () => {
    expect(extractCartesiaKeys('')).toEqual([])
  })
})
