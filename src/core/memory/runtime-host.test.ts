import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { createMemoryRuntimeHost } from './runtime-host'

describe('createMemoryRuntimeHost', () => {
  test('returns disabled availability when bundled evolver is unavailable', async () => {
    const host = await createMemoryRuntimeHost({
      settings: {
        evolverInferenceProvider: 'claude-code',
        evolverExecutionMode: 'workspace-shell',
        providers: {},
        shellPath: ''
      },
      resolveBundledEvolverCli: vi.fn(async () => {
        throw new Error('missing evolver')
      })
    })

    expect(host.availability).toBe('disabled')
    expect(host.evolverBridge).toBeUndefined()
    expect(host.turnMaintenanceRunner).toBeUndefined()
    expect(host.diagnostics).toContain('Bundled Evolver bridge is unavailable: missing evolver')
  })

  test('returns recall-only availability when the selected inference provider is unsupported', async () => {
    const host = await createMemoryRuntimeHost({
      settings: {
        evolverInferenceProvider: 'api',
        evolverExecutionMode: 'workspace-shell',
        providers: {},
        shellPath: ''
      },
      resolveBundledEvolverCli: vi.fn(async () => ({
        command: 'node',
        repoRoot: 'D:/repo/research/upstreams/evolver',
        argsPrefix: ['index.js'],
        env: {}
      }))
    })

    expect(host.availability).toBe('recall-only')
    expect(host.evolverBridge).toBeDefined()
    expect(host.turnMaintenanceRunner).toBeDefined()
    expect(host.diagnostics[0]).toContain('Inference provider "api" is unavailable for turn maintenance; Stoa will stay in recall-only mode.')
  })

  test('routes recall through the bundled host-bridge subcommand', async () => {
    const runJsonCommand = vi.fn().mockResolvedValue({
      content: 'Recall memory',
      sourceRefs: [],
      selectionPolicy: 'task-recall-v1'
    })
    const host = await createMemoryRuntimeHost({
      settings: {
        evolverInferenceProvider: 'api',
        evolverExecutionMode: 'workspace-shell',
        providers: {},
        shellPath: ''
      },
      runJsonCommand,
      resolveBundledEvolverCli: vi.fn(async () => ({
        command: 'node',
        repoRoot: 'D:/repo/research/upstreams/evolver',
        argsPrefix: ['index.js'],
        env: {}
      }))
    })

    await expect(host.evolverBridge?.recall({
      projectRoot: 'C:/repo',
      consumer: 'codex',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      taskText: 'Fix the provider bridge'
    })).resolves.toMatchObject({
      content: 'Recall memory',
      selectionPolicy: 'task-recall-v1'
    })

    expect(runJsonCommand).toHaveBeenCalledOnce()
    expect(runJsonCommand.mock.calls[0]![0]).toMatchObject({
      command: 'node',
      args: ['index.js', 'host-bridge', 'recall', expect.stringMatching(/^--request-file=/), '--json']
    })
  })

  test('handles processTurn locally without dispatching the host-bridge CLI command', async () => {
    const runJsonCommand = vi.fn()
    const projectRoot = await mkdtemp(join(tmpdir(), 'stoa-runtime-host-'))
    const host = await createMemoryRuntimeHost({
      settings: {
        evolverInferenceProvider: 'api',
        evolverExecutionMode: 'workspace-shell',
        providers: {},
        shellPath: ''
      },
      runJsonCommand,
      resolveBundledEvolverCli: vi.fn(async () => ({
        command: 'node',
        repoRoot: 'D:/repo/research/upstreams/evolver',
        argsPrefix: ['index.js'],
        env: {}
      }))
    })

    try {
      await expect(host.evolverBridge?.processTurn({
        projectRoot,
        stoaSessionId: 'session_1',
        providerSessionId: 'provider-session-1',
        turnId: 'turn_1',
        evidenceRefs: []
      })).resolves.toMatchObject({
        jobId: expect.stringMatching(/^job_turn_1_/)
      })

      expect(runJsonCommand).not.toHaveBeenCalled()
    } finally {
      await rm(projectRoot, { recursive: true, force: true })
    }
  })

  test('returns full availability when bundled evolver and claude inference are available', async () => {
    const host = await createMemoryRuntimeHost({
      settings: {
        evolverInferenceProvider: 'claude-code',
        evolverExecutionMode: 'workspace-shell',
        providers: {
          'claude-code': 'C:/tools/claude.exe'
        },
        shellPath: ''
      },
      resolveBundledEvolverCli: vi.fn(async () => ({
        command: 'node',
        repoRoot: 'D:/repo/research/upstreams/evolver',
        argsPrefix: ['index.js'],
        env: {}
      }))
    })

    expect(host.availability).toBe('full')
    expect(host.evolverBridge).toBeDefined()
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
      resolveBundledEvolverCli: vi.fn(async () => ({
        command: 'node',
        repoRoot: 'D:/repo/research/upstreams/evolver',
        argsPrefix: ['index.js'],
        env: {}
      })),
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
      resolveBundledEvolverCli: vi.fn(async () => ({
        command: 'node',
        repoRoot: 'D:/repo/research/upstreams/evolver',
        argsPrefix: ['index.js'],
        env: {}
      })),
      detectShell: vi.fn(async () => 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'),
      detectProvider: vi.fn(async () => null)
    })

    expect(host.availability).toBe('recall-only')
    expect(host.evolverBridge).toBeDefined()
    expect(host.turnMaintenanceRunner).toBeDefined()
    expect(host.diagnostics[0]).toContain('Provider executable for "claude-code" could not be resolved.')
  })
})
