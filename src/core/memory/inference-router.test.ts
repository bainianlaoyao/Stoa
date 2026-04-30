import { describe, expect, test, vi } from 'vitest'
import type { InferenceCapability } from '@shared/memory-runtime'
import { InferenceRouter } from './inference-router'

describe('InferenceRouter', () => {
  test('resolves the configured inference provider capability', async () => {
    const claudeCapability = makeInferenceCapability()

    const router = new InferenceRouter(
      {
        getInferenceProvider: () => 'claude-code'
      },
      {
        'claude-code': vi.fn(async () => claudeCapability)
      }
    )

    await expect(router.resolve()).resolves.toBe(claudeCapability)
  })
})

function makeInferenceCapability(): InferenceCapability {
  return {
    provider: 'claude-code',
    invoke: vi.fn(async () => ({
      content: 'claude-code response',
      provider: 'claude-code'
    }))
  }
}
