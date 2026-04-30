import { describe, expect, test, vi } from 'vitest'
import type { EvidenceRef, ExecutionCapability, InferenceCapability } from '@shared/memory-runtime'
import { createNoOpTurnMaintenanceGateway } from './evolver-engine-adapter'
import { TurnMaintenancePhaseError, TurnMaintenanceRunner } from './turn-maintenance-runner'

describe('TurnMaintenanceRunner', () => {
  test('runs review then solidify then distill with host capabilities', async () => {
    const gateway = {
      processTurn: vi.fn(async () => ({ jobId: 'job_turn_1' })),
      prepareReview: vi.fn(async () => ({ prompt: 'review me', responseFormat: 'json' as const })),
      completeReview: vi.fn(async () => undefined),
      prepareSolidify: vi.fn(async () => ({ commands: ['npm test'] })),
      completeSolidify: vi.fn(async () => undefined),
      prepareDistill: vi.fn(async () => ({ prompt: 'distill me', responseFormat: 'text' as const })),
      completeDistill: vi.fn(async () => undefined)
    }
    const inference: InferenceCapability = {
      provider: 'codex',
      modelHint: 'gpt-5.5',
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          content: '{"approved":true}',
          provider: 'codex',
          model: 'gpt-5.5'
        })
        .mockResolvedValueOnce({
          content: 'distilled response',
          provider: 'codex',
          model: 'gpt-5.5'
        })
    }
    const execution: ExecutionCapability = {
      mode: 'workspace-shell',
      run: vi.fn(async () => ({
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
      }))
    }

    const runner = new TurnMaintenanceRunner(
      gateway,
      { resolve: vi.fn(async () => inference) },
      { resolve: vi.fn(async () => execution) }
    )
    await expect(runner.run({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      evidenceRefs: [evidenceRef()]
    })).resolves.toEqual({
      jobId: 'job_turn_1'
    })

    expect(gateway.processTurn).toHaveBeenCalledWith({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      evidenceRefs: [evidenceRef()],
      inference: {
        provider: 'codex',
        modelHint: 'gpt-5.5'
      },
      execution: {
        mode: 'workspace-shell'
      }
    })
    expect(inference.invoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      purpose: 'llm-review',
      prompt: 'review me',
      responseFormat: 'json',
      projectRoot: 'C:/repo',
      modelHint: 'gpt-5.5'
    }))
    expect(gateway.completeReview).toHaveBeenCalledWith({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      response: '{"approved":true}'
    })
    expect(execution.run).toHaveBeenCalledWith({
      commands: ['npm test'],
      projectRoot: 'C:/repo'
    })
    expect(gateway.completeSolidify).toHaveBeenCalledWith(expect.objectContaining({
      turnId: 'turn_1',
      result: expect.objectContaining({
        ok: true,
        exitCode: 0
      })
    }))
    expect(inference.invoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      purpose: 'distill',
      prompt: 'distill me',
      responseFormat: 'text',
      projectRoot: 'C:/repo',
      modelHint: 'gpt-5.5'
    }))
    expect(gateway.completeDistill).toHaveBeenCalledWith({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      response: 'distilled response'
    })
  })

  test('emits started and completion events when maintenance phases finish', async () => {
    const gateway = {
      processTurn: vi.fn(async () => ({ jobId: 'job_turn_notify' })),
      prepareReview: vi.fn(async () => null),
      completeReview: vi.fn(async () => undefined),
      prepareSolidify: vi.fn(async () => ({ commands: ['npm test'] })),
      completeSolidify: vi.fn(async () => undefined),
      prepareDistill: vi.fn(async () => ({ prompt: 'distill me', responseFormat: 'text' as const })),
      completeDistill: vi.fn(async () => undefined)
    }
    const inference: InferenceCapability = {
      provider: 'codex',
      modelHint: 'gpt-5.5',
      invoke: vi.fn(async () => ({
        content: 'distilled response',
        provider: 'codex',
        model: 'gpt-5.5'
      }))
    }
    const execution: ExecutionCapability = {
      mode: 'workspace-shell',
      run: vi.fn(async () => ({
        ok: true,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        commandResults: []
      }))
    }
    const onPhaseEvent = vi.fn()

    const runner = new TurnMaintenanceRunner(
      gateway,
      { resolve: vi.fn(async () => inference) },
      { resolve: vi.fn(async () => execution) },
      { onPhaseEvent }
    )

    await expect(runner.run({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_notify',
      evidenceRefs: [evidenceRef()]
    })).resolves.toEqual({
      jobId: 'job_turn_notify'
    })

    expect(onPhaseEvent).toHaveBeenNthCalledWith(1, {
      phase: 'solidify',
      status: 'started',
      jobId: 'job_turn_notify',
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_notify'
    })
    expect(onPhaseEvent).toHaveBeenNthCalledWith(2, {
      phase: 'solidify',
      status: 'completed',
      jobId: 'job_turn_notify',
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_notify'
    })
    expect(onPhaseEvent).toHaveBeenNthCalledWith(3, {
      phase: 'distill',
      status: 'started',
      jobId: 'job_turn_notify',
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_notify'
    })
    expect(onPhaseEvent).toHaveBeenNthCalledWith(4, {
      phase: 'distill',
      status: 'completed',
      jobId: 'job_turn_notify',
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_notify'
    })
  })

  test('returns a skipped job when inference capability is unavailable', async () => {
    const gateway = {
      processTurn: vi.fn(async () => ({ jobId: 'job_turn_1' })),
      prepareReview: vi.fn(async () => ({ prompt: 'review me', responseFormat: 'json' as const })),
      completeReview: vi.fn(async () => undefined),
      prepareSolidify: vi.fn(async () => ({ commands: ['npm test'] })),
      completeSolidify: vi.fn(async () => undefined),
      prepareDistill: vi.fn(async () => ({ prompt: 'distill me', responseFormat: 'text' as const })),
      completeDistill: vi.fn(async () => undefined)
    }
    const execution: ExecutionCapability = {
      mode: 'workspace-shell',
      run: vi.fn(async () => ({
        ok: true,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        commandResults: []
      }))
    }

    const runner = new TurnMaintenanceRunner(
      gateway,
      {
        resolve: vi.fn(async () => {
          throw new Error('inference unavailable')
        })
      },
      { resolve: vi.fn(async () => execution) }
    )

    await expect(runner.run({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      evidenceRefs: [evidenceRef()]
    })).resolves.toEqual({
      jobId: 'job_turn_1_skipped'
    })

    expect(gateway.processTurn).not.toHaveBeenCalled()
    expect(gateway.prepareReview).not.toHaveBeenCalled()
    expect(execution.run).not.toHaveBeenCalled()
  })

  test('returns a skipped job when execution capability is unavailable', async () => {
    const gateway = {
      processTurn: vi.fn(async () => ({ jobId: 'job_turn_1' })),
      prepareReview: vi.fn(async () => null),
      completeReview: vi.fn(async () => undefined),
      prepareSolidify: vi.fn(async () => null),
      completeSolidify: vi.fn(async () => undefined),
      prepareDistill: vi.fn(async () => null),
      completeDistill: vi.fn(async () => undefined)
    }
    const inference: InferenceCapability = {
      provider: 'codex',
      modelHint: 'gpt-5.5',
      invoke: vi.fn(async () => ({
        content: 'ok',
        provider: 'codex',
        model: 'gpt-5.5'
      }))
    }

    const runner = new TurnMaintenanceRunner(
      gateway,
      { resolve: vi.fn(async () => inference) },
      {
        resolve: vi.fn(async () => {
          throw new Error('execution unavailable')
        })
      }
    )

    await expect(runner.run({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      evidenceRefs: [evidenceRef()]
    })).resolves.toEqual({
      jobId: 'job_turn_1_skipped'
    })

    expect(gateway.processTurn).not.toHaveBeenCalled()
    expect(inference.invoke).not.toHaveBeenCalled()
  })

  test('runs through all no-op phases without error', async () => {
    const gateway = createNoOpTurnMaintenanceGateway()
    const inference: InferenceCapability = {
      provider: 'codex',
      modelHint: 'gpt-5.5',
      invoke: vi.fn(async () => ({
        content: 'ok',
        provider: 'codex',
        model: 'gpt-5.5'
      }))
    }
    const execution: ExecutionCapability = {
      mode: 'workspace-shell',
      run: vi.fn(async () => ({
        ok: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        commandResults: []
      }))
    }

    const runner = new TurnMaintenanceRunner(
      gateway,
      { resolve: vi.fn(async () => inference) },
      { resolve: vi.fn(async () => execution) }
    )

    await expect(runner.run({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_noop',
      evidenceRefs: [evidenceRef()]
    })).resolves.toEqual({
      jobId: 'job_turn_noop_noop'
    })

    expect(inference.invoke).not.toHaveBeenCalled()
    expect(execution.run).not.toHaveBeenCalled()
  })

  test('preserves the real processTurn job id when a later phase fails', async () => {
    const gateway = {
      processTurn: vi.fn(async () => ({ jobId: 'job_real_123' })),
      prepareReview: vi.fn(async () => ({ prompt: 'review me', responseFormat: 'json' as const })),
      completeReview: vi.fn(async () => undefined),
      prepareSolidify: vi.fn(async () => null),
      completeSolidify: vi.fn(async () => undefined),
      prepareDistill: vi.fn(async () => null),
      completeDistill: vi.fn(async () => undefined)
    }
    const inference: InferenceCapability = {
      provider: 'claude-code',
      invoke: vi.fn(async () => {
        throw new Error('review failed')
      })
    }
    const execution: ExecutionCapability = {
      mode: 'workspace-shell',
      run: vi.fn(async () => ({
        ok: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        commandResults: []
      }))
    }

    const runner = new TurnMaintenanceRunner(
      gateway,
      { resolve: vi.fn(async () => inference) },
      { resolve: vi.fn(async () => execution) }
    )

    await expect(runner.run({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      evidenceRefs: [evidenceRef()]
    })).rejects.toMatchObject({
      name: 'TurnMaintenancePhaseError',
      jobId: 'job_real_123',
      message: 'review failed'
    } satisfies Partial<TurnMaintenancePhaseError>)
  })

  test('emits distill started and failure events before surfacing the phase error', async () => {
    const gateway = {
      processTurn: vi.fn(async () => ({ jobId: 'job_real_distill' })),
      prepareReview: vi.fn(async () => null),
      completeReview: vi.fn(async () => undefined),
      prepareSolidify: vi.fn(async () => null),
      completeSolidify: vi.fn(async () => undefined),
      prepareDistill: vi.fn(async () => ({ prompt: 'distill me', responseFormat: 'json' as const })),
      completeDistill: vi.fn(async () => undefined)
    }
    const inference: InferenceCapability = {
      provider: 'claude-code',
      invoke: vi.fn(async () => {
        throw new Error('distill failed')
      })
    }
    const execution: ExecutionCapability = {
      mode: 'workspace-shell',
      run: vi.fn(async () => ({
        ok: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        commandResults: []
      }))
    }
    const onPhaseEvent = vi.fn()

    const runner = new TurnMaintenanceRunner(
      gateway,
      { resolve: vi.fn(async () => inference) },
      { resolve: vi.fn(async () => execution) },
      { onPhaseEvent }
    )

    await expect(runner.run({
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_distill_fail',
      evidenceRefs: [evidenceRef()]
    })).rejects.toMatchObject({
      name: 'TurnMaintenancePhaseError',
      jobId: 'job_real_distill',
      message: 'distill failed'
    } satisfies Partial<TurnMaintenancePhaseError>)

    expect(onPhaseEvent).toHaveBeenNthCalledWith(1, {
      phase: 'distill',
      status: 'started',
      jobId: 'job_real_distill',
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_distill_fail'
    })
    expect(onPhaseEvent).toHaveBeenNthCalledWith(2, {
      phase: 'distill',
      status: 'failed',
      jobId: 'job_real_distill',
      projectRoot: 'C:/repo',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_distill_fail',
      error: 'distill failed'
    })
  })
})

function evidenceRef(): EvidenceRef {
  return {
    evidenceId: 'evt_1',
    projectId: 'project_1',
    stoaSessionId: 'session_1',
    providerSessionId: 'provider-session-1',
    turnId: 'turn_1',
    eventId: 'event_1',
    eventType: 'claude-code.Stop',
    evidenceKey: 'claude-code:provider-session-1:turn_1',
    kind: 'turn-slice',
    metadataPath: 'C:/repo/.stoa/memory/evidence/session_1/evt_1/metadata.json',
    path: 'C:/repo/.stoa/memory/evidence/session_1/evt_1/turn-slice.json',
    createdAt: '2026-04-29T00:00:00.000Z',
    toolName: null
  }
}
