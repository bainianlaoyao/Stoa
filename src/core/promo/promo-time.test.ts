import { describe, expect, test } from 'vitest'
import { addDaysToPromoDate, resolvePromoDateParts } from './promo-time'

describe('promo-time', () => {
  test('resolves local promo date using the provided timezone', () => {
    expect(resolvePromoDateParts({
      nowIso: '2026-05-19T17:46:53.888Z',
      timeZone: 'Asia/Shanghai'
    })).toEqual({
      date: '2026-05-20',
      timeZone: 'Asia/Shanghai'
    })
  })

  test('adds days from a normalized promo date string', () => {
    expect(addDaysToPromoDate('2026-05-20', 0)).toBe('2026-05-20')
    expect(addDaysToPromoDate('2026-05-20', 3)).toBe('2026-05-23')
  })
})
