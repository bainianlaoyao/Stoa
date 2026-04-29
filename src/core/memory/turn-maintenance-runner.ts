import type { ExecutionCapability, InferenceCapability, ProcessTurnResult } from '@shared/memory-runtime'
import type {
  CompleteDistillOptions,
  CompleteReviewOptions,
  CompleteSolidifyOptions,
  ProcessTurnOptions,
  TurnScopedBridgeOptions
} from './evolver-client'

interface TurnMaintenanceGateway {
  processTurn: (options: ProcessTurnOptions) => Promise<ProcessTurnResult>
  prepareReview: (options: TurnScopedBridgeOptions) => Promise<{ prompt: string; responseFormat: 'text' | 'json' } | null>
  completeReview: (options: CompleteReviewOptions) => Promise<void>
  prepareSolidify: (options: TurnScopedBridgeOptions) => Promise<{ commands: string[] } | null>
  completeSolidify: (options: CompleteSolidifyOptions) => Promise<void>
  prepareDistill: (options: TurnScopedBridgeOptions) => Promise<{ prompt: string; responseFormat: 'text' | 'json' } | null>
  completeDistill: (options: CompleteDistillOptions) => Promise<void>
}

interface InferenceCapabilityResolver {
  resolve: () => Promise<InferenceCapability>
}

interface ExecutionCapabilityResolver {
  resolve: () => Promise<ExecutionCapability>
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
    private readonly execution: ExecutionCapabilityResolver
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

      const solidify = await this.gateway.prepareSolidify(turnScope)
      if (solidify) {
        const result = await execution.run({
          commands: solidify.commands,
          projectRoot: input.projectRoot
        })
        await this.gateway.completeSolidify({
          ...turnScope,
          result
        })
      }

      const distill = await this.gateway.prepareDistill(turnScope)
      if (distill) {
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
