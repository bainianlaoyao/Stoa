import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ProjectSessionManager } from '@core/project-session-manager'
import type { AppSettings, CanonicalSessionEvent } from '@shared/project-session'
import type {
  DistillationResponse,
  EvolverReviewExport,
  EvolverReviewState,
  MemoryRunRecord,
  ReviewDecision,
  SemanticSessionSummary
} from '@shared/memory-runtime'
import { CliAiProvider } from './cli-ai-provider'
import { materializeEvidenceSnapshotsIntoEvolverInputs } from './evolver-input-materializer'
import { EvolverClient } from './evolver-client'
import { resolveBundledEvolverCli } from './bundled-evolver'
import { RuntimeStateStore } from './runtime-state-store'
import { SessionEvidenceStore, type SessionEvidenceSnapshot } from './session-evidence-store'
import { createMemoryWorktree, resolveGitHeadCommitSha, resolveGitRepoRoot } from './worktree'

type ManagerLike = Pick<ProjectSessionManager, 'getSettings'>

interface CliAiProviderLike {
  summarizeSession: (request: { cwd: string; prompt: string; timeoutMs?: number }) => Promise<SemanticSessionSummary>
  review: (request: { cwd: string; prompt: string; timeoutMs?: number }) => Promise<ReviewDecision>
  distill: (request: { cwd: string; prompt: string; timeoutMs?: number }) => Promise<DistillationResponse>
}

interface EvolverClientLike {
  run: EvolverClient['run']
  exportReview: EvolverClient['exportReview']
  approveReview: EvolverClient['approveReview']
  rejectReview: EvolverClient['rejectReview']
  prepareDistillation: EvolverClient['prepareDistillation']
  completeDistillation: EvolverClient['completeDistillation']
}

export interface ProcessTurnCompletionInput {
  projectPath: string
  event: CanonicalSessionEvent
}

export interface EvolverMaintainerOptions {
  evidenceStore?: Pick<SessionEvidenceStore, 'listSnapshots'>
  buildCliAiProvider?: (settings: AppSettings) => CliAiProviderLike
  buildEvolverClient?: (options: {
    cwd: string
    env: NodeJS.ProcessEnv
  }) => Promise<EvolverClientLike>
  resolveRepoRoot?: typeof resolveGitRepoRoot
  resolveHeadCommitSha?: typeof resolveGitHeadCommitSha
  createWorktree?: typeof createMemoryWorktree
  readTextFile?: (filePath: string) => Promise<string>
  writeTextFile?: (filePath: string, content: string) => Promise<void>
  nowIso?: () => string
}

export class EvolverMaintainer {
  private readonly evidenceStore: Pick<SessionEvidenceStore, 'listSnapshots'>
  private readonly buildCliAiProvider: (settings: AppSettings) => CliAiProviderLike
  private readonly buildEvolverClient: (options: {
    cwd: string
    env: NodeJS.ProcessEnv
  }) => Promise<EvolverClientLike>
  private readonly resolveRepoRoot: typeof resolveGitRepoRoot
  private readonly resolveHeadCommitSha: typeof resolveGitHeadCommitSha
  private readonly createWorktree: typeof createMemoryWorktree
  private readonly readTextFile: (filePath: string) => Promise<string>
  private readonly writeTextFile: (filePath: string, content: string) => Promise<void>
  private readonly nowIso: () => string

  constructor(
    private readonly manager: ManagerLike,
    options: EvolverMaintainerOptions = {}
  ) {
    this.evidenceStore = options.evidenceStore ?? new SessionEvidenceStore()
    this.buildCliAiProvider = options.buildCliAiProvider ?? (settings => new CliAiProvider({ settings }))
    this.buildEvolverClient = options.buildEvolverClient ?? defaultBuildEvolverClient
    this.resolveRepoRoot = options.resolveRepoRoot ?? resolveGitRepoRoot
    this.resolveHeadCommitSha = options.resolveHeadCommitSha ?? resolveGitHeadCommitSha
    this.createWorktree = options.createWorktree ?? createMemoryWorktree
    this.readTextFile = options.readTextFile ?? (filePath => readFile(filePath, 'utf8'))
    this.writeTextFile = options.writeTextFile ?? writeTextFile
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async processTurnCompletion(input: ProcessTurnCompletionInput): Promise<void> {
    if (input.event.payload.intent !== 'agent.turn_completed') {
      return
    }

    const stateStore = new RuntimeStateStore(input.projectPath)
    const snapshots = await this.evidenceStore.listSnapshots(input.projectPath, input.event.session_id)
    const sessionProgress = await stateStore.getSessionProgress(input.event.project_id, input.event.session_id)
    const unseenSnapshots = sliceUnseenSnapshots(snapshots, sessionProgress?.lastProcessedEvidenceKey ?? null)
    const latestSnapshot = unseenSnapshots[unseenSnapshots.length - 1] ?? null

    if (!latestSnapshot) {
      return
    }

    const updatedAt = this.nowIso()

    try {
      const settings = this.manager.getSettings()
      const cliAiProvider = this.buildCliAiProvider(settings)
      const semanticSummary = await cliAiProvider.summarizeSession({
        cwd: input.projectPath,
        prompt: buildSemanticSummaryPrompt(unseenSnapshots)
      })

      const repoRoot = await this.resolveRepoRoot(input.projectPath)
      const sourceWorktreeCommitSha = await this.resolveHeadCommitSha(repoRoot)
      const runId = createRunId()
      const worktree = await this.createWorktree({
        repoRoot,
        runId,
        sourceWorktreeCommitSha
      })

      const providerSessionId = latestSnapshot.providerSessionId
        ?? input.event.payload.externalSessionId
        ?? input.event.evidence?.providerSessionId
        ?? input.event.session_id
      const materializedSnapshots = applySemanticSummary(snapshots, latestSnapshot.eventId, semanticSummary)
      const runBaseDir = join(input.projectPath, '.stoa', 'memory', 'runs', runId)
      const memoryDir = join(runBaseDir, 'memory')
      const evolutionDir = join(runBaseDir, 'evolution')
      const gepAssetsDir = join(runBaseDir, 'gep-assets')
      const materializedInputs = await materializeEvidenceSnapshotsIntoEvolverInputs({
        snapshots: materializedSnapshots,
        worktreeRepoRoot: worktree.path,
        memoryDir
      })

      const evolverClient = await this.buildEvolverClient({
        cwd: worktree.path,
        env: {
          HOME: materializedInputs.runtimeHomeDir,
          USERPROFILE: materializedInputs.runtimeHomeDir,
          AGENT_NAME: materializedInputs.agentName,
          EVOLVER_VALIDATOR_ENABLED: '0',
          A2A_HUB_URL: '',
          EVOMAP_HUB_URL: ''
        }
      })

      const runResult = await evolverClient.run({
        projectId: input.event.project_id,
        stoaSessionId: input.event.session_id,
        providerSessionId,
        repoRoot: worktree.path,
        memoryDir,
        evolutionDir,
        gepAssetsDir,
        sessionScope: providerSessionId
      })

      let reviewState: EvolverReviewState = {
        ok: runResult.ok,
        status: runResult.review_status,
        run_id: runResult.run_id,
        selected_gene_id: runResult.selected_gene_id,
        signals: runResult.signals,
        mutation_id: null,
        review_state_ref: runResult.artifact_refs.review_state_ref,
        diff_ref: null,
        validation_report_ref: null,
        bridge: runResult.bridge,
        error: runResult.error
      }

      if (runResult.review_status === 'pending') {
        const reviewExport = await evolverClient.exportReview()
        const reviewDecision = await cliAiProvider.review({
          cwd: input.projectPath,
          prompt: buildReviewPrompt(reviewExport)
        })
        reviewState = reviewDecision.decision === 'approve'
          ? await evolverClient.approveReview()
          : await evolverClient.rejectReview()
      }

      let lastError = reviewState.error ?? runResult.error
      if (reviewState.status === 'approved') {
        const distillationError = await this.tryCompleteDistillation({
          cliAiProvider,
          evolverClient,
          projectPath: input.projectPath
        })
        if (distillationError) {
          lastError = distillationError
        }
      }

      const runRecord: MemoryRunRecord = {
        projectId: input.event.project_id,
        stoaSessionId: input.event.session_id,
        providerSessionId,
        runId: runResult.run_id,
        worktreePath: worktree.path,
        memoryDir: runResult.memory_dir,
        evolutionDir: runResult.evolution_dir,
        gepAssetsDir: runResult.gep_assets_dir,
        reviewStateRef: reviewState.review_state_ref,
        reviewStatus: reviewState.status,
        lastError,
        updatedAt
      }
      await stateStore.upsertRunRecord(runRecord)

      if (lastError !== null) {
        throw new Error(lastError)
      }

      if (reviewState.status === 'approved') {
        await stateStore.upsertPublishedRecord({
          projectId: input.event.project_id,
          stoaSessionId: input.event.session_id,
          consumer: 'claude-code',
          deliveryState: 'pending',
          runId: runResult.run_id,
          publishedHash: null,
          updatedAt
        })
      }

      await stateStore.upsertSessionProgress({
        projectId: input.event.project_id,
        stoaSessionId: input.event.session_id,
        lastProcessedEvidenceKey: latestSnapshot.evidenceKey,
        updatedAt
      })
    } catch (error) {
      throw error
    }
  }

  private async tryCompleteDistillation(input: {
    cliAiProvider: CliAiProviderLike
    evolverClient: EvolverClientLike
    projectPath: string
  }): Promise<string | null> {
    const prepareResult = await input.evolverClient.prepareDistillation()
    if (!prepareResult.ok || !prepareResult.prompt_path) {
      return prepareResult.ok ? null : prepareResult.error ?? prepareResult.reason
    }

    const promptBody = await this.readTextFile(prepareResult.prompt_path)
    const requestBody = prepareResult.request_path
      ? await this.readTextFile(prepareResult.request_path).catch(() => '')
      : ''
    const distillationResponse = await input.cliAiProvider.distill({
      cwd: input.projectPath,
      prompt: buildDistillationPrompt(promptBody, requestBody)
    })
    const responseFilePath = join(dirname(prepareResult.request_path ?? prepareResult.prompt_path), 'stoa-distillation-response.txt')
    await this.writeTextFile(responseFilePath, distillationResponse.responseText)

    const completeResult = await input.evolverClient.completeDistillation(responseFilePath)
    if (completeResult.ok) {
      return null
    }

    return completeResult.error ?? completeResult.reason
  }
}

function createRunId(): string {
  return `memory-run-${Date.now()}-${randomUUID().slice(0, 8)}`
}

function sliceUnseenSnapshots(
  snapshots: SessionEvidenceSnapshot[],
  lastProcessedEvidenceKey: string | null
): SessionEvidenceSnapshot[] {
  if (!lastProcessedEvidenceKey) {
    return [...snapshots]
  }

  let lastSeenIndex = -1
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    if (snapshots[index]?.evidenceKey === lastProcessedEvidenceKey) {
      lastSeenIndex = index
      break
    }
  }

  return lastSeenIndex >= 0 ? snapshots.slice(lastSeenIndex + 1) : [...snapshots]
}

function applySemanticSummary(
  snapshots: SessionEvidenceSnapshot[],
  latestEventId: string,
  summary: SemanticSessionSummary
): SessionEvidenceSnapshot[] {
  const enrichedSummary = [
    summary.summary.trim(),
    ...summary.lessons.map(lesson => `Lesson: ${lesson.trim()}`)
  ].filter(line => line.length > 0).join('\n')

  return snapshots.map(snapshot => snapshot.eventId === latestEventId
    ? {
        ...snapshot,
        payload: {
          ...snapshot.payload,
          summary: enrichedSummary.length > 0 ? enrichedSummary : snapshot.payload.summary
        }
      }
    : snapshot)
}

function buildSemanticSummaryPrompt(snapshots: SessionEvidenceSnapshot[]): string {
  const sections = snapshots.map((snapshot, index) => {
    const promptInputs = extractPromptInputs(snapshot)
    const transcriptExcerpt = clip(snapshot.snapshot.content, 8_000)
    return [
      `Snapshot ${index + 1}`,
      `- provider: ${snapshot.provider}`,
      `- providerSessionId: ${snapshot.providerSessionId ?? 'unknown'}`,
      `- timestamp: ${snapshot.timestamp}`,
      `- rawSummary: ${snapshot.payload.summary}`,
      `- userInputs: ${promptInputs.length > 0 ? promptInputs.join(' | ') : 'none'}`,
      `- assistantOutcome: ${snapshot.evidence.lastAssistantMessage ?? 'none'}`,
      `- transcriptExcerpt:`,
      transcriptExcerpt
    ].join('\n')
  }).join('\n\n')

  return [
    'Summarize the following completed agent turn evidence for durable project memory.',
    'Focus on user corrections, workflow preferences, successful strategies, and failure lessons.',
    'Ignore ephemeral details that should not become future memory.',
    '',
    'Return JSON with:',
    '- summary: a concise memory-ready summary sentence or short paragraph',
    '- outcome: one of success | failure | mixed | unknown',
    '- lessons: string[] of durable lessons',
    '',
    sections
  ].join('\n')
}

function buildReviewPrompt(reviewExport: EvolverReviewExport): string {
  return [
    'Review this Evolver mutation result for whether it should be approved.',
    'Reject if the change looks unsafe, low-quality, irrelevant, or not justified by the evidence.',
    '',
    'Return JSON with:',
    '- decision: approve | reject',
    '- summary: one short rationale',
    '- concerns: string[] with specific review concerns',
    '',
    `Review status: ${reviewExport.review.status}`,
    `Run id: ${reviewExport.review.run_id ?? 'none'}`,
    `Selected gene: ${reviewExport.review.selected_gene_id ?? 'none'}`,
    `Signals: ${reviewExport.review.signals.join(', ') || 'none'}`,
    '',
    'Gene:',
    clip(JSON.stringify(reviewExport.gene ?? null, null, 2), 8_000),
    '',
    'Mutation:',
    clip(JSON.stringify(reviewExport.mutation ?? null, null, 2), 8_000),
    '',
    'Diff:',
    clip(reviewExport.diff, 16_000)
  ].join('\n')
}

function buildDistillationPrompt(promptBody: string, requestBody: string): string {
  return [
    'You are completing an Evolver skill distillation request.',
    'Return JSON with one field:',
    '- responseText: the exact plain-text response that should be written to the Evolver distillation response file.',
    '',
    'The responseText must contain exactly one Gene JSON object and no surrounding commentary.',
    '',
    'Distillation prompt:',
    promptBody,
    '',
    'Distillation request metadata:',
    requestBody
  ].join('\n')
}

function extractPromptInputs(snapshot: SessionEvidenceSnapshot): string[] {
  if (Array.isArray(snapshot.evidence.inputMessages) && snapshot.evidence.inputMessages.length > 0) {
    return snapshot.evidence.inputMessages.map(value => value.trim()).filter(value => value.length > 0)
  }

  if (typeof snapshot.evidence.promptText === 'string' && snapshot.evidence.promptText.trim().length > 0) {
    return [snapshot.evidence.promptText.trim()]
  }

  return []
}

function clip(value: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

async function defaultBuildEvolverClient(options: {
  cwd: string
  env: NodeJS.ProcessEnv
}): Promise<EvolverClientLike> {
  const bundledCli = await resolveBundledEvolverCli()
  return new EvolverClient({
    command: bundledCli.command,
    argsPrefix: bundledCli.argsPrefix,
    cwd: options.cwd,
    env: {
      ...bundledCli.env,
      ...options.env
    }
  })
}

async function writeTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}
