import { describe, expect, test, vi } from 'vitest'
import { createMemoryRuntimeHost } from './runtime-host'

const MOCK_EVOLVER_REPO_ROOT = 'D:/repo/research/upstreams/evolver'

describe('createMemoryRuntimeHost', () => {
  test('returns disabled availability when bundled evolver is unavailable', async () => {
    const host = await createMemoryRuntimeHost({
      settings: {
        evolverInferenceProvider: 'claude-code',
        evolverExecutionMode: 'workspace-shell',
        providers: {},
        shellPath: ''
      },
      resolveBundledEvolverRepoRoot: vi.fn(async () => {
        throw new Error('missing evolver')
      })
    })

    expect(host.availability).toBe('disabled')
    expect(host.engineAdapter).toBeUndefined()
    expect(host.turnMaintenanceRunner).toBeUndefined()
    expect(host.diagnostics).toContain('Bundled Evolver bridge is unavailable: missing evolver')
  })

  test('returns recall-only availability when strict provider detection cannot resolve claude', async () => {
    const host = await createMemoryRuntimeHost({
      settings: {
        evolverInferenceProvider: 'claude-code',
        evolverExecutionMode: 'workspace-shell',
        providers: {
          'claude-code': 'C:/tools/claude.exe'
        },
        shellPath: ''
      },
      resolveBundledEvolverRepoRoot: vi.fn(async () => MOCK_EVOLVER_REPO_ROOT)
    })

    expect(host.availability).toBe('full')
    expect(host.engineAdapter).toBeDefined()
    expect(host.turnMaintenanceRunner).toBeDefined()
    expect(host.diagnostics).toEqual([])
  })

  test('returns full availability when strict provider detection resolves claude', async () => {
    const detectProvider = vi.fn(async () => 'C:/tools/claude.cmd')
    const host = await createMemoryRuntimeHost({
      settings: {
        evolverInferenceProvider: 'claude-code',
        evolverExecutionMode: 'workspace-shell',
        providers: {},
        shellPath: ''
      },
      resolveBundledEvolverRepoRoot: vi.fn(async () => MOCK_EVOLVER_REPO_ROOT),
      detectShell: vi.fn(async () => 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'),
      detectProvider
    })

    expect(host.availability).toBe('full')
    expect(host.turnMaintenanceRunner).toBeDefined()
    expect(host.diagnostics).toEqual([])
    expect(detectProvider).toHaveBeenCalled()
  })

  test('returns recall-only availability when strict provider detection cannot resolve claude', async () => {
    const host = await createMemoryRuntimeHost({
      settings: {
        evolverInferenceProvider: 'claude-code',
        evolverExecutionMode: 'workspace-shell',
        providers: {},
        shellPath: ''
      },
      resolveBundledEvolverRepoRoot: vi.fn(async () => MOCK_EVOLVER_REPO_ROOT),
      detectShell: vi.fn(async () => 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'),
      detectProvider: vi.fn(async () => null)
    })

    expect(host.availability).toBe('recall-only')
    expect(host.engineAdapter).toBeDefined()
    expect(host.turnMaintenanceRunner).toBeDefined()
    expect(host.diagnostics[0]).toContain('Provider executable for "claude-code" could not be resolved.')
  })

  test('engine adapter warmStart returns null', async () => {
    const host = await createMemoryRuntimeHost({
      settings: {
        evolverInferenceProvider: 'claude-code',
        evolverExecutionMode: 'workspace-shell',
        providers: { 'claude-code': 'C:/tools/claude.exe' },
        shellPath: ''
      },
      resolveBundledEvolverRepoRoot: vi.fn(async () => MOCK_EVOLVER_REPO_ROOT)
    })

    const result = await host.engineAdapter!.warmStart({
      projectRoot: '/test',
      consumer: 'claude-code',
      stoaSessionId: 'session_1'
    })
    expect(result).toBeNull()
  })

  test('engine adapter recall returns null', async () => {
    const host = await createMemoryRuntimeHost({
      settings: {
        evolverInferenceProvider: 'claude-code',
        evolverExecutionMode: 'workspace-shell',
        providers: { 'claude-code': 'C:/tools/claude.exe' },
        shellPath: ''
      },
      resolveBundledEvolverRepoRoot: vi.fn(async () => MOCK_EVOLVER_REPO_ROOT)
    })

    const result = await host.engineAdapter!.recall({
      projectRoot: '/test',
      consumer: 'claude-code',
      stoaSessionId: 'session_1',
      taskText: 'Fix the bug'
    })
    expect(result).toBeNull()
  })
})
