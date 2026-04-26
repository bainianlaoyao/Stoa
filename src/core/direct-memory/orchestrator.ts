import { join } from 'node:path'
import type {
  DirectMemoryProviderType,
  EntireStoaCheckpointExport,
  EvolverPublishedContext,
  EvolverStoaRunResult,
  MemoryEvolutionBridgeRef,
  PublishedContextTarget
} from '@shared/direct-memory'
import type { DirectMemoryBridgeStore } from './bridge-store'
import type { DirectMemoryWorktree } from './worktree'
import { createDirectMemoryWorktree } from './worktree'
import { writePublishedContext, type DeliveredContext } from './context-delivery'

interface EntireLike {
  exportCheckpoint: (checkpointId: string) => Promise<EntireStoaCheckpointExport>
}

interface EvolverLike {
  run: (options: {
    bridge: EvolverStoaRunResult['bridge']
    repoRoot: string
    memoryDir: string
    evolutionDir: string
    gepAssetsDir: string
    sessionScope: string
  }) => Promise<EvolverStoaRunResult>
  publishContext: (target: PublishedContextTarget, format: 'markdown' | 'json') => Promise<EvolverPublishedContext>
}

export interface EvolveAndPublishRequest {
  projectId: string
  stoaSessionId: string
  providerSessionId: string
  providerType: DirectMemoryProviderType
  repoRoot: string
  checkpointId: string
  target: PublishedContextTarget
}

export interface EvolveAndPublishResult {
  checkpoint: EntireStoaCheckpointExport
  run: EvolverStoaRunResult
  published: EvolverPublishedContext
  delivery: DeliveredContext
  bridgeRef: MemoryEvolutionBridgeRef
}

export class DirectMemoryOrchestrator {
  constructor(private readonly options: {
    entire: EntireLike
    evolver: EvolverLike
    store: DirectMemoryBridgeStore
    createWorktree?: (options: {
      repoRoot: string
      runId: string
      sourceWorktreeCommitSha: string | null
    }) => Promise<DirectMemoryWorktree>
    nowIso?: () => string
  }) {}

  async evolveAndPublish(request: EvolveAndPublishRequest): Promise<EvolveAndPublishResult> {
    const checkpoint = await this.options.entire.exportCheckpoint(request.checkpointId)
    const runId = `${checkpoint.checkpoint_id}-${request.stoaSessionId}-${Date.now()}`
    const worktree = await (this.options.createWorktree ?? createDirectMemoryWorktree)({
      repoRoot: request.repoRoot,
      runId,
      sourceWorktreeCommitSha: checkpoint.source_worktree_commit_sha
    })
    const memoryDir = join(request.repoRoot, '.stoa', 'direct-memory', runId, 'memory')
    const evolutionDir = join(memoryDir, 'evolution')
    const gepAssetsDir = join(request.repoRoot, '.stoa', 'direct-memory', runId, 'assets', 'gep')
    const bridge = {
      project_id: request.projectId,
      stoa_session_id: request.stoaSessionId,
      provider_session_id: request.providerSessionId,
      source_checkpoint_id: checkpoint.checkpoint_id,
      checkpoint_metadata_commit_sha: checkpoint.checkpoint_metadata_commit_sha,
      source_worktree_commit_sha: checkpoint.source_worktree_commit_sha
    }
    const startedAt = this.now()
    const preRunRef = this.toBridgeRef(request, checkpoint, {
      runId: null,
      worktreePath: worktree.path,
      memoryDir,
      evolutionDir,
      gepAssetsDir,
      reviewStateRef: null,
      createdAt: startedAt,
      updatedAt: startedAt
    })

    await this.options.store.upsert(preRunRef)

    const run = await this.options.evolver.run({
      bridge,
      repoRoot: worktree.path,
      memoryDir,
      evolutionDir,
      gepAssetsDir,
      sessionScope: request.providerSessionId
    })
    const postRunRef = this.toBridgeRef(request, checkpoint, {
      runId: run.run_id,
      worktreePath: worktree.path,
      memoryDir: run.memory_dir,
      evolutionDir: run.evolution_dir,
      gepAssetsDir: run.gep_assets_dir,
      reviewStateRef: run.review_state_ref,
      createdAt: startedAt,
      updatedAt: this.now()
    })
    await this.options.store.upsert(postRunRef)

    if (!run.ok) {
      throw new Error(run.error ?? 'Evolver run failed')
    }

    const published = await this.options.evolver.publishContext(
      request.target,
      request.target === 'generic' ? 'json' : 'markdown'
    )
    const delivery = await writePublishedContext(request.repoRoot, published)
    await this.options.store.updateDelivery({
      projectId: request.projectId,
      stoaSessionId: request.stoaSessionId,
      entireCheckpointId: checkpoint.checkpoint_id,
      target: request.target,
      hash: delivery.hash,
      updatedAt: this.now()
    })

    const [bridgeRef] = await this.options.store.list()
    if (!bridgeRef) {
      throw new Error('Direct memory bridge ref missing after delivery')
    }

    return {
      checkpoint,
      run,
      published,
      delivery,
      bridgeRef
    }
  }

  private toBridgeRef(
    request: EvolveAndPublishRequest,
    checkpoint: EntireStoaCheckpointExport,
    refs: {
      runId: string | null
      worktreePath: string | null
      memoryDir: string | null
      evolutionDir: string | null
      gepAssetsDir: string | null
      reviewStateRef: string | null
      createdAt: string
      updatedAt: string
    }
  ): MemoryEvolutionBridgeRef {
    return {
      projectId: request.projectId,
      stoaSessionId: request.stoaSessionId,
      providerSessionId: request.providerSessionId,
      providerType: request.providerType,
      repoRoot: request.repoRoot,
      entireCheckpointId: checkpoint.checkpoint_id,
      entireCheckpointMetadataCommitSha: checkpoint.checkpoint_metadata_commit_sha,
      entireSourceWorktreeCommitSha: checkpoint.source_worktree_commit_sha,
      evolverRunId: refs.runId,
      evolverWorktreePath: refs.worktreePath,
      evolverMemoryDir: refs.memoryDir,
      evolverEvolutionDir: refs.evolutionDir,
      evolverGepAssetsDir: refs.gepAssetsDir,
      evolverReviewStateRef: refs.reviewStateRef,
      lastPublishedContextTarget: null,
      lastPublishedContextHash: null,
      createdAt: refs.createdAt,
      updatedAt: refs.updatedAt
    }
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}
