import type { EvidenceRef, ExecutionCapability, InferenceCapability, ProcessTurnResult } from '@shared/memory-runtime'
import type { ExecutionResult, TurnMaintenanceGateway, TurnScopedBridgeOptions } from './evolver-engine-adapter'

interface ProcessTurnOptions extends TurnScopedBridgeOptions {
  evidenceRefs: EvidenceRef[]
  jobId?: string
  inference?: {
    provider?: string
    modelHint?: string
  }
  execution?: {
    mode?: string
  }
}

interface InferenceCapabilityResolver {
  resolve: () => Promise<InferenceCapability>
}

interface ExecutionCapabilityResolver {
  resolve: () => Promise<ExecutionCapability>
}

export interface TurnMaintenancePhaseEvent {
  phase: 'solidify' | 'distill'
  status: 'started' | 'completed' | 'failed'
  jobId: string
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

export class TurnMaintenanceRunner {
  constructor(
    private readonly gateway: TurnMaintenanceGateway,
    private readonly inference: InferenceCapabilityResolver,
    private readonly execution: ExecutionCapabilityResolver,
    private readonly observer: TurnMaintenanceObserver = {}
  ) {}

  async run(input: TurnScopedBridgeOptions & Pick<ProcessTurnOptions, 'evidenceRefs'>): Promise<ProcessTurnResult> {
    const turnScope: TurnScopedBridgeOptions = {
      projectRoot: input.projectRoot,
      stoaSessionId: input.stoaSessionId,
      providerSessionId: input.providerSessionId,
      turnId: input.turnId
    }

    let inference: InferenceCapability
    let execution: ExecutionCapability
    try {
      inference = await this.inference.resolve()
      execution = await this.execution.resolve()
    } catch (error) {
      console.warn(
        `[turn-maintenance-runner] Skipping turn maintenance for ${input.turnId}: ${error instanceof Error ? error.message : String(error)}`
      )
      return {
        jobId: `job_${input.turnId}_skipped`
      }
    }

    const job = await this.gateway.processTurn({
      ...input,
      inference: {
        provider: inference.provider,
        modelHint: inference.modelHint
      },
      execution: {
        mode: execution.mode
      }
    })

    try {
      const review = await this.gateway.prepareReview(turnScope)
      if (review) {
        const reviewResponse = await inference.invoke({
          purpose: 'llm-review',
          prompt: review.prompt,
          responseFormat: review.responseFormat,
          projectRoot: input.projectRoot,
          modelHint: inference.modelHint
        })
        await this.gateway.completeReview({
          ...turnScope,
          response: reviewResponse.content
        })
      }

      try {
        const solidify = await this.gateway.prepareSolidify(turnScope)
        if (solidify) {
          this.observer.onPhaseEvent?.({
            phase: 'solidify',
            status: 'started',
            jobId: job.jobId,
            projectRoot: input.projectRoot,
            stoaSessionId: input.stoaSessionId,
            providerSessionId: input.providerSessionId,
            turnId: input.turnId
          })
          const result = await execution.run({
            commands: solidify.commands,
            projectRoot: input.projectRoot
          })
          await this.gateway.completeSolidify({
            ...turnScope,
            result
          })
          this.observer.onPhaseEvent?.({
            phase: 'solidify',
            status: 'completed',
            jobId: job.jobId,
            projectRoot: input.projectRoot,
            stoaSessionId: input.stoaSessionId,
            providerSessionId: input.providerSessionId,
            turnId: input.turnId
          })
        }
      } catch (error) {
        this.observer.onPhaseEvent?.({
          phase: 'solidify',
          status: 'failed',
          jobId: job.jobId,
          projectRoot: input.projectRoot,
          stoaSessionId: input.stoaSessionId,
          providerSessionId: input.providerSessionId,
          turnId: input.turnId,
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      }

      try {
        const distill = await this.gateway.prepareDistill(turnScope)
        if (distill) {
          this.observer.onPhaseEvent?.({
            phase: 'distill',
            status: 'started',
            jobId: job.jobId,
            projectRoot: input.projectRoot,
            stoaSessionId: input.stoaSessionId,
            providerSessionId: input.providerSessionId,
            turnId: input.turnId
          })
          const distillResponse = await inference.invoke({
            purpose: 'distill',
            prompt: distill.prompt,
            responseFormat: distill.responseFormat,
            projectRoot: input.projectRoot,
            modelHint: inference.modelHint
          })
          await this.gateway.completeDistill({
            ...turnScope,
            response: distillResponse.content
          })
          this.observer.onPhaseEvent?.({
            phase: 'distill',
            status: 'completed',
            jobId: job.jobId,
            projectRoot: input.projectRoot,
            stoaSessionId: input.stoaSessionId,
            providerSessionId: input.providerSessionId,
            turnId: input.turnId
          })
        }
      } catch (error) {
        this.observer.onPhaseEvent?.({
          phase: 'distill',
          status: 'failed',
          jobId: job.jobId,
          projectRoot: input.projectRoot,
          stoaSessionId: input.stoaSessionId,
          providerSessionId: input.providerSessionId,
          turnId: input.turnId,
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    } catch (error) {
      throw new TurnMaintenancePhaseError(
        job.jobId,
        error instanceof Error ? error.message : String(error),
        error
      )
    }

    return job
  }
}
