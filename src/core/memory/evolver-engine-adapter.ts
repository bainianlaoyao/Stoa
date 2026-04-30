import type { DeliveryEnvelope, EvidenceRef, ProcessTurnResult } from '@shared/memory-runtime'
import { resolveBundledEvolverRepoRoot } from './bundled-evolver'

export interface EngineAdapterWarmStartOptions {
  projectRoot: string
  consumer: 'claude-code' | 'codex' | 'opencode' | 'generic'
  stoaSessionId: string
  providerSessionId?: string
}

export interface EngineAdapterRecallOptions extends EngineAdapterWarmStartOptions {
  taskText: string
}

export interface EngineAdapterObserveWriteOptions {
  projectRoot: string
  stoaSessionId: string
  providerSessionId?: string
  turnId?: string
  evidenceRefs: EvidenceRef[]
}

export interface EvolverEngineAdapter {
  readonly repoRoot: string
  warmStart: (options: EngineAdapterWarmStartOptions) => Promise<DeliveryEnvelope | null>
  recall: (options: EngineAdapterRecallOptions) => Promise<DeliveryEnvelope | null>
  observeWrite: (options: EngineAdapterObserveWriteOptions) => Promise<void>
}

export async function createEvolverEngineAdapter(cwd?: string): Promise<EvolverEngineAdapter> {
  const repoRoot = await resolveBundledEvolverRepoRoot(cwd ?? process.cwd())

  return {
    repoRoot,
    warmStart: async () => null,
    recall: async () => null,
    observeWrite: async () => {}
  }
}

export function createNoOpEngineAdapter(): EvolverEngineAdapter {
  return {
    repoRoot: '',
    warmStart: async () => null,
    recall: async () => null,
    observeWrite: async () => {}
  }
}

export interface TurnMaintenanceGateway {
  processTurn: (options: TurnScopedBridgeOptions & { evidenceRefs: EvidenceRef[]; inference?: { provider?: string; modelHint?: string }; execution?: { mode?: string } }) => Promise<ProcessTurnResult>
  prepareReview: (options: TurnScopedBridgeOptions) => Promise<{ prompt: string; responseFormat: 'text' | 'json' } | null>
  completeReview: (options: TurnScopedBridgeOptions & { response: string }) => Promise<void>
  prepareSolidify: (options: TurnScopedBridgeOptions) => Promise<{ commands: string[] } | null>
  completeSolidify: (options: TurnScopedBridgeOptions & { result: ExecutionResult }) => Promise<void>
  prepareDistill: (options: TurnScopedBridgeOptions) => Promise<{ prompt: string; responseFormat: 'text' | 'json' } | null>
  completeDistill: (options: TurnScopedBridgeOptions & { response: string }) => Promise<void>
}

export interface TurnScopedBridgeOptions {
  projectRoot: string
  stoaSessionId: string
  providerSessionId?: string
  turnId: string
}

export interface ExecutionResult {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  commandResults: Array<{
    command: string
    exitCode: number
    stdout: string
    stderr: string
  }>
}

export function createNoOpTurnMaintenanceGateway(): TurnMaintenanceGateway {
  return {
    async processTurn(options) {
      return { jobId: `job_${options.turnId}_noop` }
    },
    async prepareReview() {
      return null
    },
    async completeReview() {},
    async prepareSolidify() {
      return null
    },
    async completeSolidify() {},
    async prepareDistill() {
      return null
    },
    async completeDistill() {}
  }
}
