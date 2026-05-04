import { describe, expect, test, vi } from 'vitest'
import type { DistillPlan, EvolverEngineAdapter } from './evolver-engine-adapter'
import { TurnMaintenancePhaseError, TurnMaintenanceRunner } from './turn-maintenance-runner'

function createAdapter(overrides: Partial<EvolverEngineAdapter> = {}): EvolverEngineAdapter {
  return {
    repoRoot: 'repo-root',
    stageTurn: async (input) => ({ jobId: `job_${input.turnId}` }),
    solidify: async () => {},
    prepareDistill: async () => ({ kind: 'none' }),
    completeDistill: async () => {},
    ...overrides
  }
}

function createInput() {
  return {
    projectId: 'project-1',
    projectRoot: '/repo/project-1',
    stoaSessionId: 'session-1',
    providerSessionId: 'provider-1',
    turnId: 'turn-1',
    evidenceRefs: [
      {
        evidenceId: 'evidence-1',
        projectId: 'project-1',
        stoaSessionId: 'session-1',
        providerSessionId: 'provider-1',
        turnId: 'turn-1',
        eventId: 'event-1',
        eventType: 'claude-code.Stop',
        evidenceKey: 'claude-code:provider-1:turn-1',
        kind: 'turn-slice' as const,
        metadataPath: '/repo/project-1/.stoa/memory/evidence/session-1/event-1/metadata.json',
        path: '/repo/project-1/.stoa/memory/evidence/session-1/event-1/turn-slice.json',
        createdAt: '2026-05-01T00:00:00.000Z',
        toolName: null
      }
    ]
  }
}

describe('TurnMaintenanceRunner', () => {
  test('runs solidify, invokes inference for llm distill, and completes distillation', async () => {
    const completeDistill = vi.fn(async () => {})
    const adapter = createAdapter({
      prepareDistill: async (): Promise<DistillPlan> => ({
        kind: 'llm',
        prompt: 'distill this turn',
        responseFormat: 'text'
      }),
      completeDistill
    })
    const invoke = vi.fn(async () => ({ content: 'distilled lesson' }))
    const resolve = vi.fn(async () => ({
      modelHint: 'claude-sonnet',
      invoke
    }))
    const phases: string[] = []
    const runner = new TurnMaintenanceRunner(adapter, { resolve }, {
      onPhaseEvent: (event) => {
        phases.push(`${event.phase}:${event.status}`)
      }
    })

    const result = await runner.run(createInput())

    expect(result).toEqual({ jobId: 'job_turn-1' })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith({
      purpose: 'distill',
      prompt: 'distill this turn',
      responseFormat: 'text',
      projectRoot: '/repo/project-1',
      modelHint: 'claude-sonnet'
    })
    expect(completeDistill).toHaveBeenCalledWith({
      projectRoot: '/repo/project-1',
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-1',
      turnId: 'turn-1',
      response: 'distilled lesson'
    })
    expect(phases).toEqual([
      'solidify:started',
      'solidify:completed',
      'distill:started',
      'distill:completed'
    ])
  })

  test('marks auto distill as a completed distill phase without invoking inference', async () => {
    const adapter = createAdapter({
      prepareDistill: async () => ({ kind: 'auto' })
    })
    const resolve = vi.fn(async () => ({
      invoke: vi.fn(async () => ({ content: 'unused' }))
    }))
    const phases: string[] = []
    const runner = new TurnMaintenanceRunner(adapter, { resolve }, {
      onPhaseEvent: (event) => {
        phases.push(`${event.phase}:${event.status}`)
      }
    })

    await runner.run(createInput())

    expect(resolve).not.toHaveBeenCalled()
    expect(phases).toEqual([
      'solidify:started',
      'solidify:completed',
      'distill:started',
      'distill:completed'
    ])
  })

  test('wraps solidify failures with the job id and emits a failed solidify phase', async () => {
    const adapter = createAdapter({
      solidify: async () => {
        throw new Error('solidify failed')
      }
    })
    const phases: string[] = []
    const runner = new TurnMaintenanceRunner(adapter, {
      resolve: async () => ({
        invoke: async () => ({ content: 'unused' })
      })
    }, {
      onPhaseEvent: (event) => {
        phases.push(`${event.phase}:${event.status}:${event.error ?? ''}`)
      }
    })

    const failure = runner.run(createInput())

    await expect(failure).rejects.toBeInstanceOf(TurnMaintenancePhaseError)
    await expect(failure).rejects.toMatchObject({
      jobId: 'job_turn-1',
      message: 'solidify failed'
    })
    expect(phases).toContain('solidify:failed:solidify failed')
  })

  test('wraps distill failures with the job id and emits a failed distill phase', async () => {
    const adapter = createAdapter({
      prepareDistill: async (): Promise<DistillPlan> => ({
        kind: 'llm',
        prompt: 'distill this turn',
        responseFormat: 'text'
      }),
      completeDistill: async () => {
        throw new Error('distill failed')
      }
    })
    const phases: string[] = []
    const runner = new TurnMaintenanceRunner(adapter, {
      resolve: async () => ({
        invoke: async () => ({ content: 'distilled lesson' })
      })
    }, {
      onPhaseEvent: (event) => {
        phases.push(`${event.phase}:${event.status}:${event.error ?? ''}`)
      }
    })

    const failure = runner.run(createInput())

    await expect(failure).rejects.toBeInstanceOf(TurnMaintenancePhaseError)
    await expect(failure).rejects.toMatchObject({
      jobId: 'job_turn-1',
      message: 'distill failed'
    })
    expect(phases).toContain('distill:failed:distill failed')
  })
})
