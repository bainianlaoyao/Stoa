import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, normalize } from 'node:path'
import type { EvidenceRef, ProcessTurnResult } from '@shared/memory-runtime'
import { buildEvolverProjectEnv, resolveEvolverProjectPaths } from '@shared/evolver-project-paths'
import { resolveBundledEvolverRepoRoot } from './bundled-evolver'

const require = createRequire(import.meta.url)
const AUTO_DISTILL_INTERVAL = 5
const EVOLVER_ENV_KEYS = [
  'EVOLVER_ROOT',
  'EVOLVER_REPO_ROOT',
  'MEMORY_DIR',
  'EVOLUTION_DIR',
  'GEP_ASSETS_DIR',
  'MEMORY_GRAPH_PATH',
  'EVOLVER_QUIET_PARENT_GIT'
] as const

let upstreamOperationQueue: Promise<void> = Promise.resolve()

interface UpstreamSolidifyResult {
  ok?: boolean
  reason?: string
  message?: string
  hubReviewPromise?: Promise<unknown>
}

interface UpstreamDistillationResult {
  ok?: boolean
  reason?: string
  gene?: {
    id?: string
  }
}

interface UpstreamPreparedDistillation {
  ok?: boolean
  reason?: string
  promptPath?: string
}

type UpstreamLoader = <T>(relativePath: string) => T

export type DistillPlan =
  | { kind: 'none' }
  | { kind: 'auto' }
  | { kind: 'llm'; prompt: string; responseFormat: 'text' }

export interface TurnScopedBridgeOptions {
  projectRoot: string
  stoaSessionId: string
  providerSessionId?: string
  turnId: string
}

export interface EvolverEngineAdapter {
  readonly repoRoot: string
  stageTurn: (options: TurnScopedBridgeOptions & { evidenceRefs: EvidenceRef[] }) => Promise<ProcessTurnResult>
  solidify: (options: TurnScopedBridgeOptions) => Promise<void>
  prepareDistill: (options: TurnScopedBridgeOptions) => Promise<DistillPlan>
  completeDistill: (options: TurnScopedBridgeOptions & { response: string }) => Promise<void>
}

interface CreateEvolverEngineAdapterOptions {
  cwd?: string
  resolveBundledEvolverRepoRoot?: typeof resolveBundledEvolverRepoRoot
}

interface UpstreamSolidifyModule {
  solidify: (options?: { rollbackOnFailure?: boolean }) => UpstreamSolidifyResult
  writeStateForSolidify: (state: Record<string, unknown>) => void
  readStateForSolidify: () => Record<string, unknown>
}

interface UpstreamSkillDistillerModule {
  shouldDistill: () => boolean
  prepareDistillation: () => UpstreamPreparedDistillation
  completeDistillation: (response: string) => UpstreamDistillationResult
  autoDistill: () => UpstreamDistillationResult
  shouldDistillFromFailures: () => boolean
  autoDistillFromFailures: () => UpstreamDistillationResult
}

class UpstreamEvolverEngineAdapter implements EvolverEngineAdapter {
  constructor(readonly repoRoot: string) {}

  async stageTurn(options: TurnScopedBridgeOptions & { evidenceRefs: EvidenceRef[] }): Promise<ProcessTurnResult> {
    await this.withProjectScope(options.projectRoot, (load) => {
      const solidifyModule = load<UpstreamSolidifyModule>('src/gep/solidify.js')
      solidifyModule.writeStateForSolidify({
        project_root: options.projectRoot,
        stoa_session_id: options.stoaSessionId,
        provider_session_id: options.providerSessionId,
        turn_id: options.turnId,
        evidence_refs: options.evidenceRefs
      })
    })

    return {
      jobId: `job_${options.turnId}`
    }
  }

  async solidify(options: TurnScopedBridgeOptions): Promise<void> {
    await this.withProjectScope(options.projectRoot, async (load) => {
      const solidifyModule = load<UpstreamSolidifyModule>('src/gep/solidify.js')
      const result = solidifyModule.solidify({
        rollbackOnFailure: true
      })

      await result.hubReviewPromise

      if (!result.ok) {
        throw new Error(resolveUpstreamFailureMessage('solidify', result))
      }
    })
  }

  async prepareDistill(options: TurnScopedBridgeOptions): Promise<DistillPlan> {
    return await this.withProjectScope(options.projectRoot, async (load) => {
      const distiller = load<UpstreamSkillDistillerModule>('src/gep/skillDistiller.js')
      const solidifyModule = load<UpstreamSolidifyModule>('src/gep/solidify.js')
      const solidifyState = solidifyModule.readStateForSolidify()
      const solidifyCount = typeof solidifyState.solidify_count === 'number'
        ? solidifyState.solidify_count
        : 0
      const autoTrigger = solidifyCount > 0 && solidifyCount % AUTO_DISTILL_INTERVAL === 0

      let autoDistillPerformed = false
      if (autoTrigger || distiller.shouldDistill()) {
        const autoDistillResult = distiller.autoDistill()
        if (autoDistillResult.ok && autoDistillResult.gene?.id) {
          autoDistillPerformed = true
        } else {
          const prepared = distiller.prepareDistillation()
          if (prepared.ok && prepared.promptPath) {
            const prompt = await readFile(prepared.promptPath, 'utf8')
            return {
              kind: 'llm',
              prompt,
              responseFormat: 'text'
            }
          }
        }
      }

      const failureDistillPerformed = this.tryAutoDistillFromFailures(distiller)
      if (autoDistillPerformed || failureDistillPerformed) {
        return {
          kind: 'auto'
        }
      }

      return {
        kind: 'none'
      }
    })
  }

  async completeDistill(options: TurnScopedBridgeOptions & { response: string }): Promise<void> {
    await this.withProjectScope(options.projectRoot, (load) => {
      const distiller = load<UpstreamSkillDistillerModule>('src/gep/skillDistiller.js')
      const result = distiller.completeDistillation(options.response)
      if (!result.ok) {
        throw new Error(resolveUpstreamFailureMessage('distill', result))
      }

      this.tryAutoDistillFromFailures(distiller)
    })
  }

  private tryAutoDistillFromFailures(distiller: UpstreamSkillDistillerModule): boolean {
    if (!distiller.shouldDistillFromFailures()) {
      return false
    }

    const result = distiller.autoDistillFromFailures()
    return result.ok === true && Boolean(result.gene?.id)
  }

  private async withProjectScope<T>(
    projectRoot: string,
    operation: (load: UpstreamLoader) => Promise<T> | T
  ): Promise<T> {
    return await enqueueUpstreamOperation(async () => {
      const projectPaths = resolveEvolverProjectPaths(projectRoot, this.repoRoot)
      const nextEnv = buildEvolverProjectEnv(projectPaths)
      const previousEnv = new Map<string, string | undefined>()
      const previousCwd = process.cwd()
      const load: UpstreamLoader = (relativePath) => require(join(this.repoRoot, relativePath))

      for (const key of EVOLVER_ENV_KEYS) {
        previousEnv.set(key, process.env[key])
        const nextValue = nextEnv[key]
        if (typeof nextValue === 'string') {
          process.env[key] = nextValue
        } else {
          delete process.env[key]
        }
      }

      clearUpstreamModuleCache(this.repoRoot)
      process.chdir(projectRoot)

      try {
        return await operation(load)
      } finally {
        process.chdir(previousCwd)
        clearUpstreamModuleCache(this.repoRoot)

        for (const key of EVOLVER_ENV_KEYS) {
          const previousValue = previousEnv.get(key)
          if (previousValue === undefined) {
            delete process.env[key]
          } else {
            process.env[key] = previousValue
          }
        }
      }
    })
  }
}

export async function createEvolverEngineAdapter(
  options: CreateEvolverEngineAdapterOptions = {}
): Promise<EvolverEngineAdapter> {
  const repoRoot = await (options.resolveBundledEvolverRepoRoot ?? resolveBundledEvolverRepoRoot)(
    options.cwd ?? process.cwd()
  )
  return new UpstreamEvolverEngineAdapter(repoRoot)
}

export function createNoOpEngineAdapter(): EvolverEngineAdapter {
  return {
    repoRoot: '',
    stageTurn: async (options) => ({ jobId: `job_${options.turnId}_noop` }),
    solidify: async () => {},
    prepareDistill: async () => ({ kind: 'none' }),
    completeDistill: async () => {}
  }
}

async function enqueueUpstreamOperation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = upstreamOperationQueue
  let release!: () => void
  upstreamOperationQueue = new Promise<void>((resolve) => {
    release = resolve
  })

  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
  }
}

function clearUpstreamModuleCache(repoRoot: string): void {
  const normalizedRepoRoot = normalize(repoRoot)
  for (const modulePath of Object.keys(require.cache)) {
    if (normalize(modulePath).startsWith(normalizedRepoRoot)) {
      delete require.cache[modulePath]
    }
  }
}

function resolveUpstreamFailureMessage(
  phase: 'solidify' | 'distill',
  result: { reason?: string; message?: string }
): string {
  const detail = result.message?.trim() || result.reason?.trim()
  return detail
    ? `Evolver ${phase} failed: ${detail}`
    : `Evolver ${phase} failed.`
}
