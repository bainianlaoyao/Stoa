import { afterEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/project-session'

const mocks = vi.hoisted(() => ({
  createEvolverEngineAdapter: vi.fn(),
  createClaudeCodeInferenceCapability: vi.fn()
}))

vi.mock('./evolver-engine-adapter', () => ({
  createEvolverEngineAdapter: mocks.createEvolverEngineAdapter
}))

vi.mock('./runtime-capabilities', () => ({
  createClaudeCodeInferenceCapability: mocks.createClaudeCodeInferenceCapability
}))

import { createMemoryRuntimeHost } from './runtime-host'

describe('createMemoryRuntimeHost', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  test('returns disabled availability when bundled Evolver cannot be resolved', async () => {
    mocks.createEvolverEngineAdapter.mockRejectedValueOnce(new Error('no bundled repo'))

    const host = await createMemoryRuntimeHost({
      settings: DEFAULT_SETTINGS
    })

    expect(host).toEqual({
      availability: 'disabled',
      diagnostics: [
        'Bundled Evolver bridge is unavailable: no bundled repo'
      ]
    })
  })

  test('returns full availability when adapter and inference capability are available', async () => {
    const adapter = {
      repoRoot: 'D:/repo/evolver',
      stageTurn: async (input: { turnId: string }) => ({ jobId: `job_${input.turnId}` }),
      solidify: async () => {},
      prepareDistill: async () => ({ kind: 'none' as const }),
      completeDistill: async () => {}
    }
    mocks.createEvolverEngineAdapter.mockResolvedValueOnce(adapter)
    mocks.createClaudeCodeInferenceCapability.mockReturnValueOnce({
      provider: 'claude-code',
      modelHint: 'claude-sonnet',
      invoke: vi.fn(async () => ({ content: 'distilled lesson' }))
    })

    const host = await createMemoryRuntimeHost({
      settings: DEFAULT_SETTINGS
    })

    expect(host.availability).toBe('full')
    expect(host.diagnostics).toEqual([])
    expect(host.engineAdapter).toBe(adapter)
    expect(host.turnMaintenanceRunner).toBeDefined()
    expect(mocks.createClaudeCodeInferenceCapability).toHaveBeenCalledWith('claude')
  })

  test('falls back to recall-only when strict provider resolution cannot find claude-code', async () => {
    const adapter = {
      repoRoot: 'D:/repo/evolver',
      stageTurn: async (input: { turnId: string }) => ({ jobId: `job_${input.turnId}` }),
      solidify: async () => {},
      prepareDistill: async () => ({ kind: 'none' as const }),
      completeDistill: async () => {}
    }
    mocks.createEvolverEngineAdapter.mockResolvedValueOnce(adapter)

    const host = await createMemoryRuntimeHost({
      settings: DEFAULT_SETTINGS,
      detectShell: async () => null,
      detectProvider: async () => null
    })

    expect(host.availability).toBe('recall-only')
    expect(host.engineAdapter).toBe(adapter)
    expect(host.turnMaintenanceRunner).toBeDefined()
    expect(host.diagnostics).toEqual([
      'Inference provider "claude-code" is unavailable for distillation completion; Stoa will stay in recall-only mode. Provider executable for "claude-code" could not be resolved.'
    ])
    expect(mocks.createClaudeCodeInferenceCapability).not.toHaveBeenCalled()
  })
})
