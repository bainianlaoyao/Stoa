import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { DeliveryEnvelope, EvidenceRef, ProcessTurnResult } from '@shared/memory-runtime'
import { EvolverClient } from './evolver-client'

const tempDirs: string[] = []

function evidenceRef(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    evidenceId: 'event_1',
    projectId: 'project_1',
    stoaSessionId: 'session_1',
    providerSessionId: 'provider-session-1',
    turnId: 'turn_1',
    eventId: 'event_1',
    eventType: 'codex.Stop',
    evidenceKey: 'codex:provider-session-1:turn_1',
    kind: 'turn-slice',
    metadataPath: 'C:/repo/.stoa/memory/evidence/session_1/event_1/metadata.json',
    path: 'C:/repo/.stoa/memory/evidence/session_1/event_1/turn-slice.json',
    createdAt: '2026-04-28T00:00:00.000Z',
    toolName: null,
    ...overrides
  }
}

afterEach(async () => {
  await Promise.allSettled(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('EvolverClient', () => {
  test('dispatches warmStart through the host-bridge command with a JSON request file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const delivery: DeliveryEnvelope = {
      content: 'Warm memory',
      sourceRefs: [{ ref: 'memory-graph.jsonl', reason: 'recent outcomes', score: 0.9 }],
      selectionPolicy: 'warm-start-v1'
    }
    const runner = vi.fn(async (options: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }) => {
      const requestFileArg = options.args.find(arg => arg.startsWith('--request-file='))
      const requestPath = requestFileArg!.slice('--request-file='.length)
      const request = JSON.parse(await readFile(requestPath, 'utf8'))
      expect(request).toEqual({
        projectRoot: 'C:/repo',
        consumer: 'claude-code',
        stoaSessionId: 'session_1',
        providerSessionId: 'provider-session-1'
      })
      return delivery
    })
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.warmStart({
      projectRoot: 'C:/repo',
      consumer: 'claude-code',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1'
    })).resolves.toEqual(delivery)

    expect(runner).toHaveBeenCalledOnce()
    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      command: 'node',
      args: ['index.js', 'host-bridge', 'warm-start', expect.stringMatching(/^--request-file=/), '--json'],
      cwd,
      env: {
        EVOLVER_QUIET_PARENT_GIT: 'true',
        STOA_EVOLVER_PROJECT_ROOT: 'C:/repo',
        EVOLVER_REPO_ROOT: 'C:/repo',
        MEMORY_DIR: 'C:/repo/.stoa/evolver/memory',
        EVOLUTION_DIR: 'C:/repo/.stoa/evolver/memory/evolution',
        GEP_ASSETS_DIR: 'C:/repo/.stoa/evolver/assets/gep'
      }
    })
  })

  test('dispatches recall through the host-bridge command', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const runner = vi.fn().mockResolvedValue({
      content: 'Recall memory',
      sourceRefs: [],
      selectionPolicy: 'task-recall-v1'
    } satisfies DeliveryEnvelope)
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.recall({
      projectRoot: 'C:/repo',
      consumer: 'codex',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      taskText: 'Fix the failing tests in the provider hook bridge.'
    })).resolves.toMatchObject({
      content: 'Recall memory',
      selectionPolicy: 'task-recall-v1'
    })

    expect(runner).toHaveBeenCalledOnce()
    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      command: 'node',
      args: ['index.js', 'host-bridge', 'recall', expect.stringMatching(/^--request-file=/), '--json'],
      cwd,
      env: expect.objectContaining({
        STOA_EVOLVER_PROJECT_ROOT: 'C:/repo',
        EVOLVER_REPO_ROOT: 'C:/repo'
      })
    })
  })

  test('dispatches observeWrite through the host-bridge command with evidence refs', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const runner = vi.fn(async (options: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }) => {
      const requestFileArg = options.args.find(arg => arg.startsWith('--request-file='))
      const requestPath = requestFileArg!.slice('--request-file='.length)
      const request = JSON.parse(await readFile(requestPath, 'utf8'))
      expect(request).toEqual({
        projectRoot: 'C:/repo',
        stoaSessionId: 'session_1',
        providerSessionId: 'provider-session-1',
        turnId: 'turn_1',
        evidenceRefs: [
          evidenceRef({
            toolName: 'Write'
          })
        ]
      })
      return { ok: true }
    })
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.observeWrite({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      evidenceRefs: [evidenceRef({ toolName: 'Write' })]
    })).resolves.toBeUndefined()

    expect(runner).toHaveBeenCalledOnce()
    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      command: 'node',
      args: ['index.js', 'host-bridge', 'observe-write', expect.stringMatching(/^--request-file=/), '--json'],
      cwd,
      env: expect.objectContaining({
        STOA_EVOLVER_PROJECT_ROOT: 'C:/repo'
      })
    })
  })

  test('dispatches processTurn through the host-bridge command and returns the job id', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const runner = vi.fn().mockResolvedValue({
      jobId: 'job_turn_1'
    } satisfies ProcessTurnResult)
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.processTurn({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      evidenceRefs: [evidenceRef()]
    })).resolves.toEqual({
      jobId: 'job_turn_1'
    })

    expect(runner).toHaveBeenCalledOnce()
    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      command: 'node',
      args: ['index.js', 'host-bridge', 'process-turn', expect.stringMatching(/^--request-file=/), '--json'],
      cwd,
      env: expect.objectContaining({
        STOA_EVOLVER_PROJECT_ROOT: 'C:/repo'
      })
    })
  })
})

function normalizeRunnerCall(value: {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
}) {
  return {
    ...value,
    env: normalizePathRecord(value.env ?? {})
  }
}

function normalizePathRecord(record: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.replaceAll('\\', '/') : value
    ])
  ) as Record<string, string>
}
