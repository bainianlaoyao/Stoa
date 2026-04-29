import { describe, expect, test } from 'vitest'
import { getConsumerContextPath } from './delivery-paths'

describe('delivery-paths', () => {
  test('returns the Claude generated context path under .stoa/generated/evolver-context', () => {
    expect(getConsumerContextPath('D:/repo', 'claude-code')).toBe(
      'D:\\repo\\.stoa\\generated\\evolver-context\\claude-code.jsonl'
    )
  })

  test('returns the Codex generated context path under .stoa/generated/evolver-context', () => {
    expect(getConsumerContextPath('D:/repo', 'codex')).toBe(
      'D:\\repo\\.stoa\\generated\\evolver-context\\codex.jsonl'
    )
  })
})
