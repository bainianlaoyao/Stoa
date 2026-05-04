import type { EvidenceRef, InferenceCapability, ProcessTurnResult } from '@shared/memory-runtime'
import type { EvolverEngineAdapter, TurnScopedBridgeOptions } from './evolver-engine-adapter'

interface TurnMaintenanceRunInput extends TurnScopedBridgeOptions {
  projectId: string
  evidenceRefs: EvidenceRef[]
}

interface InferenceCapabilityResolver {
  resolve: () => Promise<InferenceCapability>
}

export interface TurnMaintenancePhaseEvent {
  phase: 'solidify' | 'distill'
  status: 'started' | 'completed' | 'failed'
  jobId: string
  projectId: string
  projectRoot: string
  stoaSessionId: string
  providerSessionId?: string
  turnId: string
  error?: string
}

interface TurnMaintenanceObserver {
  onPhaseEvent?: (event: TurnMaintenancePhaseEvent) => void
}

export class TurnMaintenancePhaseError extends Error {
  constructor(
    readonly jobId: string,
    message: string,
    readonly cause: unknown
  ) {
    super(message)
    this.name = 'TurnMaintenancePhaseError'
  }
}

const pendingProjectRuns = new Map<string, Promise<void>>()

export class TurnMaintenanceRunner {
  constructor(
    private readonly adapter: EvolverEngineAdapter,
    private readonly inference: InferenceCapabilityResolver,
    private readonly observer: TurnMaintenanceObserver = {}
  ) {}

  async run(input: TurnMaintenanceRunInput): Promise<ProcessTurnResult> {
    return await withProjectRunLock(input.projectRoot, async () => {
      const job = await this.adapter.stageTurn({
        projectRoot: input.projectRoot,
        stoaSessionId: input.stoaSessionId,
        providerSessionId: input.providerSessionId,
        turnId: input.turnId,
        evidenceRefs: input.evidenceRefs
      })

      const turnScope: TurnScopedBridgeOptions = {
        projectRoot: input.projectRoot,
        stoaSessionId: input.stoaSessionId,
        providerSessionId: input.providerSessionId,
        turnId: input.turnId
      }

      try {
        this.emitPhase(input, job.jobId, 'solidify', 'started')
        await this.adapter.solidify(turnScope)
        this.emitPhase(input, job.jobId, 'solidify', 'completed')
      } catch (error) {
        this.emitPhase(input, job.jobId, 'solidify', 'failed', error)
        throw new TurnMaintenancePhaseError(
          job.jobId,
          error instanceof Error ? error.message : String(error),
          error
        )
      }

      try {
        const distillPlan = await this.adapter.prepareDistill(turnScope)
        if (distillPlan.kind === 'auto') {
          this.emitPhase(input, job.jobId, 'distill', 'started')
          this.emitPhase(input, job.jobId, 'distill', 'completed')
        } else if (distillPlan.kind === 'llm') {
          this.emitPhase(input, job.jobId, 'distill', 'started')
          const inference = await this.inference.resolve()
          const response = await inference.invoke({
            purpose: 'distill',
            prompt: distillPlan.prompt,
            responseFormat: distillPlan.responseFormat,
            projectRoot: input.projectRoot,
            modelHint: inference.modelHint
          })
          await this.adapter.completeDistill({
            ...turnScope,
            response: response.content
          })
          this.emitPhase(input, job.jobId, 'distill', 'completed')
        }
      } catch (error) {
        this.emitPhase(input, job.jobId, 'distill', 'failed', error)
        throw new TurnMaintenancePhaseError(
          job.jobId,
          error instanceof Error ? error.message : String(error),
          error
        )
      }

      return job
    })
  }

  private emitPhase(
    input: TurnMaintenanceRunInput,
    jobId: string,
    phase: TurnMaintenancePhaseEvent['phase'],
    status: TurnMaintenancePhaseEvent['status'],
    error?: unknown
  ): void {
    this.observer.onPhaseEvent?.({
      phase,
      status,
      jobId,
      projectId: input.projectId,
      projectRoot: input.projectRoot,
      stoaSessionId: input.stoaSessionId,
      providerSessionId: input.providerSessionId,
      turnId: input.turnId,
      error: error === undefined ? undefined : error instanceof Error ? error.message : String(error)
    })
  }
}

async function withProjectRunLock<T>(projectRoot: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingProjectRuns.get(projectRoot) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  pendingProjectRuns.set(projectRoot, current)

  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
    if (pendingProjectRuns.get(projectRoot) === current) {
      pendingProjectRuns.delete(projectRoot)
    }
  }
}
