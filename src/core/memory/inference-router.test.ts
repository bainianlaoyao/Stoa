import { describe, expect, test, vi } from 'vitest'
import type { InferenceCapability } from '@shared/memory-runtime'
import { InferenceRouter } from './inference-router'

describe('InferenceRouter', () => {
  test('resolves the configured inference provider capability', async () => {
    const claudeCapability = makeInferenceCapability('claude-code')
    const codexCapability = makeInferenceCapability('codex')
    const apiCapability = makeInferenceCapability('api')

    const router = new InferenceRouter(
      {
        getInferenceProvider: () => 'codex'
      },
      {
        'claude-code': vi.fn(async () => claudeCapability),
        codex: vi.fn(async () => codexCapability),
        api: vi.fn(async () => apiCapability)
      }
    )

    await expect(router.resolve()).resolves.toBe(codexCapability)
  })
})

function makeInferenceCapability(provider: 'claude-code' | 'codex' | 'api'): InferenceCapability {
  return {
    provider,
    invoke: vi.fn(async () => ({
      content: `${provider} response`,
      provider
    }))
  }
}
