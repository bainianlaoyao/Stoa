import { describe, expect, test } from 'vitest'
import { mergeSessionDimensions, SessionDimensionsRegistry } from './session-dimensions'

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

  test('merges partial explicit dimensions without clearing remembered values', () => {
    expect(mergeSessionDimensions({ cols: 120, rows: 30 }, { cols: 132 }))
      .toEqual({ cols: 132, rows: 30 })
    expect(mergeSessionDimensions({ cols: 120, rows: 30 }, { rows: 44 }))
      .toEqual({ cols: 120, rows: 44 })
    expect(mergeSessionDimensions(null, { cols: 132 }))
      .toEqual({ cols: 132 })
  })
})
