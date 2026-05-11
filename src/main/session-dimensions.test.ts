import { describe, expect, test } from 'vitest'
import { SessionDimensionsRegistry } from './session-dimensions'

describe('SessionDimensionsRegistry', () => {
  test('stores and returns cloned session dimensions', () => {
    const registry = new SessionDimensionsRegistry()
    const dims = { cols: 120, rows: 30 }

    registry.set('session-1', dims)
    dims.cols = 80

    expect(registry.get('session-1')).toEqual({ cols: 120, rows: 30 })

    const stored = registry.get('session-1')
    if (!stored) {
      throw new Error('Expected stored dimensions')
    }

    stored.rows = 10
    expect(registry.get('session-1')).toEqual({ cols: 120, rows: 30 })
  })
})
