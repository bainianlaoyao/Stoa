import { join } from 'node:path'
import type {
  BootstrapState,
  CanonicalSessionEvent,
  ProjectSummary,
  SessionSummary
} from '@shared/project-session'
import type {
  EntireStoaCheckpointRef,
  MemoryEvolutionBridgeRef
} from '@shared/direct-memory'
import { DirectMemoryBridgeStore } from './bridge-store'
import { EntireClient } from './entire-client'
import { EvolverClient } from './evolver-client'
import { DirectMemoryOrchestrator } from './orchestrator'
import { resolveGitRepoRoot } from './worktree'

interface EntireCheckpointReader {
  listCheckpoints: () => Promise<EntireStoaCheckpointRef[]>
}

interface BridgeRefReader {
  listBridgeRefs: () => Promise<MemoryEvolutionBridgeRef[]>
}

interface DirectMemoryRunner {
  evolveAndPublish: (request: {
    projectId: string
    stoaSessionId: string
    providerSessionId: string
    providerType: 'opencode' | 'claude-code'
    repoRoot: string
    checkpointId: string
    target: 'opencode' | 'claude-code'
  }) => Promise<unknown>
}

interface DirectMemoryRepoRuntime extends EntireCheckpointReader, BridgeRefReader, DirectMemoryRunner {}

interface SnapshotReader {
  snapshot: () => BootstrapState
}

export interface DirectMemoryCompletionServiceOptions {
  manager: SnapshotReader
  appRoot?: string
  evolverRepoRoot?: string
  pollIntervalMs?: number
  maxPollAttempts?: number
  resolveRepoRoot?: (cwd: string) => Promise<string>
  sleep?: (ms: number) => Promise<void>
  createRepoRuntime?: (repoRoot: string) => DirectMemoryRepoRuntime
  onError?: (error: Error, context: { sessionId: string; projectId: string }) => void
}

interface ResolvedCaptureSessionContext {
  project: ProjectSummary
  session: SessionSummary & {
    type: 'opencode' | 'claude-code'
    externalSessionId: string
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isCompletionEvent(event: CanonicalSessionEvent): boolean {
  return event.payload.intent === 'agent.turn_completed'
}

function isCaptureSupportedSession(session: SessionSummary): session is SessionSummary & {
  type: 'opencode' | 'claude-code'
  externalSessionId: string
} {
  return (session.type === 'opencode' || session.type === 'claude-code')
    && typeof session.externalSessionId === 'string'
    && session.externalSessionId.length > 0
}

function matchesProviderSession(ref: EntireStoaCheckpointRef, providerSessionId: string): boolean {
  return ref.latest_session_id === providerSessionId || ref.session_ids.includes(providerSessionId)
}

function selectLatestUnseenCheckpoint(
  refs: EntireStoaCheckpointRef[],
  providerSessionId: string,
  handledCheckpointIds: Set<string>
): EntireStoaCheckpointRef | null {
  return refs.find(ref =>
    matchesProviderSession(ref, providerSessionId) && !handledCheckpointIds.has(ref.checkpoint_id)
  ) ?? null
}

export class DirectMemoryCompletionService {
  private readonly pollIntervalMs: number
  private readonly maxPollAttempts: number
  private readonly resolveRepoRoot: (cwd: string) => Promise<string>
  private readonly sleep: (ms: number) => Promise<void>
  private readonly createRepoRuntime: (repoRoot: string) => DirectMemoryRepoRuntime
  private readonly sessionQueues = new Map<string, Promise<void>>()
  private stopped = false
  private readonly stopSignal: Promise<void>
  private resolveStopSignal!: () => void

  constructor(private readonly options: DirectMemoryCompletionServiceOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000
    this.maxPollAttempts = options.maxPollAttempts ?? 10
    this.resolveRepoRoot = options.resolveRepoRoot ?? resolveGitRepoRoot
    this.sleep = options.sleep ?? sleep
    this.createRepoRuntime = options.createRepoRuntime ?? createDefaultRepoRuntimeFactory({
      appRoot: options.appRoot,
      evolverRepoRoot: options.evolverRepoRoot
    })
    this.stopSignal = new Promise<void>((resolve) => {
      this.resolveStopSignal = resolve
    })
  }

  notifyCanonicalEvent(event: CanonicalSessionEvent): void {
    if (this.stopped || !isCompletionEvent(event)) {
      return
    }

    this.enqueueSession(event.session_id, event.project_id)
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return
    }

    this.stopped = true
    this.resolveStopSignal()
  }

  async waitForIdle(sessionId?: string): Promise<void> {
    if (sessionId) {
      await this.sessionQueues.get(sessionId)
      return
    }

    await Promise.all([...this.sessionQueues.values()])
  }

  private enqueueSession(sessionId: string, projectId: string): void {
    if (this.stopped) {
      return
    }

    const previous = this.sessionQueues.get(sessionId) ?? Promise.resolve()
    const next = previous
      .catch(() => {
        // Preserve the per-session queue even when a previous attempt failed.
      })
      .then(async () => {
        if (this.stopped) {
          return
        }
        try {
          await this.processSession(sessionId)
        } catch (error) {
          this.reportError(error, { sessionId, projectId })
        }
      })

    this.sessionQueues.set(sessionId, next)
    const cleanup = () => {
      if (this.sessionQueues.get(sessionId) === next) {
        this.sessionQueues.delete(sessionId)
      }
    }
    next.then(cleanup, cleanup)
  }

  private async processSession(sessionId: string): Promise<void> {
    if (this.stopped) {
      return
    }

    const captureContext = this.resolveCaptureSessionContext(sessionId)
    if (!captureContext) {
      return
    }

    const repoRoot = await this.tryResolveRepoRoot(captureContext.project.path)
    if (!repoRoot) {
      return
    }
    const runtime = this.createRepoRuntime(repoRoot)
    const handledCheckpointIds = new Set(
      (await runtime.listBridgeRefs())
        .filter(ref =>
          ref.projectId === captureContext.project.id
          && ref.stoaSessionId === captureContext.session.id
        )
        .map(ref => ref.entireCheckpointId)
    )

    const checkpoint = await this.findCheckpoint(runtime, captureContext.session.externalSessionId, handledCheckpointIds)
    if (!checkpoint || this.stopped) {
      return
    }

    await runtime.evolveAndPublish({
      projectId: captureContext.project.id,
      stoaSessionId: captureContext.session.id,
      providerSessionId: captureContext.session.externalSessionId,
      providerType: captureContext.session.type,
      repoRoot,
      checkpointId: checkpoint.checkpoint_id,
      target: captureContext.session.type
    })
  }

  private resolveCaptureSessionContext(sessionId: string): ResolvedCaptureSessionContext | null {
    const snapshot = this.options.manager.snapshot()
    const session = snapshot.sessions.find(candidate => candidate.id === sessionId)
    if (!session || !isCaptureSupportedSession(session)) {
      return null
    }

    const project = snapshot.projects.find(candidate => candidate.id === session.projectId)
    if (!project) {
      return null
    }

    return {
      project,
      session
    }
  }

  private async findCheckpoint(
    runtime: EntireCheckpointReader,
    providerSessionId: string,
    handledCheckpointIds: Set<string>
  ): Promise<EntireStoaCheckpointRef | null> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      if (this.stopped) {
        return null
      }

      const checkpoint = selectLatestUnseenCheckpoint(
        await runtime.listCheckpoints(),
        providerSessionId,
        handledCheckpointIds
      )
      if (checkpoint) {
        return checkpoint
      }

      if (attempt < this.maxPollAttempts - 1) {
        await this.waitForNextPoll()
      }
    }

    return null
  }

  private async waitForNextPoll(): Promise<void> {
    await Promise.race([
      this.sleep(this.pollIntervalMs),
      this.stopSignal
    ])
  }

  private async tryResolveRepoRoot(projectPath: string): Promise<string | null> {
    try {
      return await this.resolveRepoRoot(projectPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith('Direct memory mode requires a git worktree:')) {
        return null
      }
      throw error
    }
  }

  private reportError(error: unknown, context: { sessionId: string; projectId: string }): void {
    const normalized = error instanceof Error ? error : new Error(String(error))
    this.options.onError?.(normalized, context)
    if (!this.options.onError) {
      console.warn(
        `[direct-memory] completion pipeline failed for session ${context.sessionId}: ${normalized.message}`
      )
    }
  }
}

function resolveDefaultEvolverRepoRoot(appRoot?: string): string {
  return join(appRoot ?? process.cwd(), 'research', 'upstreams', 'evolver')
}

function createDefaultRepoRuntimeFactory(options: {
  appRoot?: string
  evolverRepoRoot?: string
}): (repoRoot: string) => DirectMemoryRepoRuntime {
  const runtimes = new Map<string, DirectMemoryRepoRuntime>()
  const evolverRepoRoot = options.evolverRepoRoot ?? resolveDefaultEvolverRepoRoot(options.appRoot)

  return (repoRoot: string) => {
    const existing = runtimes.get(repoRoot)
    if (existing) {
      return existing
    }

    const store = new DirectMemoryBridgeStore(join(repoRoot, '.stoa', 'direct-memory', 'bridge-refs.json'))
    const entire = new EntireClient({
      cwd: repoRoot,
      appRoot: options.appRoot
    })
    const evolver = new EvolverClient({
      command: 'node',
      cwd: evolverRepoRoot,
      argsPrefix: ['index.js']
    })
    const orchestrator = new DirectMemoryOrchestrator({
      entire,
      evolver,
      store
    })
    const runtime: DirectMemoryRepoRuntime = {
      listCheckpoints: async () => await entire.listCheckpoints(),
      listBridgeRefs: async () => await store.list(),
      evolveAndPublish: async (request) => {
        await orchestrator.evolveAndPublish(request)
      }
    }
    runtimes.set(repoRoot, runtime)
    return runtime
  }
}
