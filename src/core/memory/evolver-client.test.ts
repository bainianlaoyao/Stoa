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
      evidenceRefs: [evidenceRef()],
      inference: {
        provider: 'codex'
      },
      execution: {
        mode: 'workspace-shell'
      }
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

    const request = await readRequestFile(runner.mock.calls[0]![0].args)
    expect(request).toEqual({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      evidenceRefs: [evidenceRef()],
      inference: {
        provider: 'codex'
      },
      execution: {
        mode: 'workspace-shell'
      }
    })
  })

  test('dispatches prepareReview through the host-bridge command with a JSON request file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const runner = vi.fn(async (options: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }) => {
      const request = await readRequestFile(options.args)
      expect(request).toEqual({
        projectRoot: 'C:/repo',
        stoaSessionId: 'session_1',
        providerSessionId: 'provider-session-1',
        turnId: 'turn_1'
      })
      return {
        prompt: 'review this turn',
        responseFormat: 'json'
      }
    })
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.prepareReview({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1'
    })).resolves.toEqual({
      prompt: 'review this turn',
      responseFormat: 'json'
    })

    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      args: ['index.js', 'host-bridge', 'prepare-review', expect.stringMatching(/^--request-file=/), '--json'],
      env: expect.objectContaining({
        STOA_EVOLVER_PROJECT_ROOT: 'C:/repo'
      })
    })
  })

  test('dispatches completeReview through the host-bridge command with a JSON request file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const runner = vi.fn(async (options: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }) => {
      const request = await readRequestFile(options.args)
      expect(request).toEqual({
        projectRoot: 'C:/repo',
        stoaSessionId: 'session_1',
        providerSessionId: 'provider-session-1',
        turnId: 'turn_1',
        response: '{"approved":true}'
      })
      return undefined
    })
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.completeReview({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      response: '{"approved":true}'
    })).resolves.toBeUndefined()

    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      args: ['index.js', 'host-bridge', 'complete-review', expect.stringMatching(/^--request-file=/), '--json']
    })
  })

  test('dispatches prepareSolidify through the host-bridge command with a JSON request file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const runner = vi.fn(async (options: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }) => {
      const request = await readRequestFile(options.args)
      expect(request).toEqual({
        projectRoot: 'C:/repo',
        stoaSessionId: 'session_1',
        providerSessionId: 'provider-session-1',
        turnId: 'turn_1'
      })
      return {
        commands: ['npm test']
      }
    })
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.prepareSolidify({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1'
    })).resolves.toEqual({
      commands: ['npm test']
    })

    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      args: ['index.js', 'host-bridge', 'prepare-solidify', expect.stringMatching(/^--request-file=/), '--json']
    })
  })

  test('dispatches completeSolidify through the host-bridge command with a JSON request file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const runner = vi.fn(async (options: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }) => {
      const request = await readRequestFile(options.args)
      expect(request).toEqual({
        projectRoot: 'C:/repo',
        stoaSessionId: 'session_1',
        providerSessionId: 'provider-session-1',
        turnId: 'turn_1',
        result: {
          ok: true,
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          commandResults: [
            {
              command: 'npm test',
              exitCode: 0,
              stdout: 'ok',
              stderr: ''
            }
          ]
        }
      })
      return undefined
    })
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.completeSolidify({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      result: {
        ok: true,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        commandResults: [
          {
            command: 'npm test',
            exitCode: 0,
            stdout: 'ok',
            stderr: ''
          }
        ]
      }
    })).resolves.toBeUndefined()

    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      args: ['index.js', 'host-bridge', 'complete-solidify', expect.stringMatching(/^--request-file=/), '--json']
    })
  })

  test('dispatches prepareDistill through the host-bridge command with a JSON request file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const runner = vi.fn(async (options: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }) => {
      const request = await readRequestFile(options.args)
      expect(request).toEqual({
        projectRoot: 'C:/repo',
        stoaSessionId: 'session_1',
        providerSessionId: 'provider-session-1',
        turnId: 'turn_1'
      })
      return {
        prompt: 'distill this turn',
        responseFormat: 'text'
      }
    })
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.prepareDistill({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1'
    })).resolves.toEqual({
      prompt: 'distill this turn',
      responseFormat: 'text'
    })

    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      args: ['index.js', 'host-bridge', 'prepare-distill', expect.stringMatching(/^--request-file=/), '--json']
    })
  })

  test('dispatches completeDistill through the host-bridge command with a JSON request file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const runner = vi.fn(async (options: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }) => {
      const request = await readRequestFile(options.args)
      expect(request).toEqual({
        projectRoot: 'C:/repo',
        stoaSessionId: 'session_1',
        providerSessionId: 'provider-session-1',
        turnId: 'turn_1',
        response: 'distilled response'
      })
      return undefined
    })
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.completeDistill({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      response: 'distilled response'
    })).resolves.toBeUndefined()

    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      args: ['index.js', 'host-bridge', 'complete-distill', expect.stringMatching(/^--request-file=/), '--json']
    })
  })

  test('dispatches getStateSummary through the host-bridge command with a JSON request file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const runner = vi.fn(async (options: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }) => {
      const request = await readRequestFile(options.args)
      expect(request).toEqual({
        projectRoot: 'C:/repo',
        stoaSessionId: 'session_1',
        providerSessionId: 'provider-session-1'
      })
      return {
        pendingReview: 1
      }
    })
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.getStateSummary({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1'
    })).resolves.toEqual({
      pendingReview: 1
    })

    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      args: ['index.js', 'host-bridge', 'state-summary', expect.stringMatching(/^--request-file=/), '--json']
    })
  })

  test('dispatches traceTurn through the host-bridge command with a JSON request file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const runner = vi.fn(async (options: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }) => {
      const request = await readRequestFile(options.args)
      expect(request).toEqual({
        projectRoot: 'C:/repo',
        stoaSessionId: 'session_1',
        providerSessionId: 'provider-session-1',
        turnId: 'turn_1'
      })
      return {
        turnId: 'turn_1'
      }
    })
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.traceTurn({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1'
    })).resolves.toEqual({
      turnId: 'turn_1'
    })

    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      args: ['index.js', 'host-bridge', 'trace-turn', expect.stringMatching(/^--request-file=/), '--json']
    })
  })

  test('dispatches explainRecall through the host-bridge command with a JSON request file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const runner = vi.fn(async (options: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }) => {
      const request = await readRequestFile(options.args)
      expect(request).toEqual({
        projectRoot: 'C:/repo',
        consumer: 'codex',
        stoaSessionId: 'session_1',
        providerSessionId: 'provider-session-1',
        taskText: 'Fix the provider bridge'
      })
      return {
        selectionPolicy: 'task-recall-v1'
      }
    })
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.explainRecall({
      projectRoot: 'C:/repo',
      consumer: 'codex',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      taskText: 'Fix the provider bridge'
    })).resolves.toEqual({
      selectionPolicy: 'task-recall-v1'
    })

    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      args: ['index.js', 'host-bridge', 'explain-recall', expect.stringMatching(/^--request-file=/), '--json']
    })
  })

  test('dispatches getAsset through the host-bridge command with a JSON request file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stoa-evolver-client-'))
    tempDirs.push(cwd)
    const runner = vi.fn(async (options: { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }) => {
      const request = await readRequestFile(options.args)
      expect(request).toEqual({
        ref: 'memory/genes.json'
      })
      return {
        ref: 'memory/genes.json',
        content: '{}'
      }
    })
    const client = new EvolverClient({
      command: 'node',
      cwd,
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.getAsset({
      ref: 'memory/genes.json'
    })).resolves.toEqual({
      ref: 'memory/genes.json',
      content: '{}'
    })

    expect(normalizeRunnerCall(runner.mock.calls[0]![0])).toMatchObject({
      args: ['index.js', 'host-bridge', 'get-asset', expect.stringMatching(/^--request-file=/), '--json']
    })
  })
})

async function readRequestFile(args: string[]) {
  const requestFileArg = args.find(arg => arg.startsWith('--request-file='))
  const requestPath = requestFileArg!.slice('--request-file='.length)
  return JSON.parse(await readFile(requestPath, 'utf8'))
}

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
