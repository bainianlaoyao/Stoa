import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type {
  DeliveryEnvelope,
  EvolverDistillationCompleteResult,
  EvolverDistillationPrepareResult,
  EvolverReviewExport,
  EvolverReviewState,
  ProcessTurnResult
} from '@shared/memory-runtime'
import type {
  CompleteDistillOptions,
  CompleteReviewOptions,
  CompleteSolidifyOptions,
  ExplainRecallOptions,
  GetAssetOptions,
  ObserveWriteOptions,
  ProcessTurnOptions,
  RecallOptions,
  StateSummaryOptions,
  TurnScopedBridgeOptions,
  WarmStartOptions
} from './evolver-client'
import type { EvolverClient } from './evolver-client'

const require = createRequire(import.meta.url)
const DEFAULT_DISTILL_RESPONSE_FORMAT = 'text'
const EVOLVER_ENV_KEYS = [
  'STOA_EVOLVER_PROJECT_ROOT',
  'EVOLVER_REPO_ROOT',
  'MEMORY_DIR',
  'EVOLUTION_DIR',
  'GEP_ASSETS_DIR',
  'EVOLVER_SESSION_SCOPE',
  'EVOLVER_QUIET_PARENT_GIT'
] as const

type EvolverBridgeDelegate = Pick<
  EvolverClient,
  'warmStart' | 'recall' | 'observeWrite' | 'getStateSummary' | 'explainRecall' | 'getAsset'
>

interface StoaEvolverBridgeOptions {
  repoRoot: string
  delegate: EvolverBridgeDelegate
}

interface StoredTurnRecord {
  key: string
  projectRoot: string | null
  stoaSessionId: string | null
  providerSessionId: string | null
  turnId: string | null
  jobId: string
  processTurn: {
    inference: ProcessTurnOptions['inference'] | null
    execution: ProcessTurnOptions['execution'] | null
    processedAt: string
  }
  trace: {
    evidenceCount: number
    evidenceIds: string[]
    toolNames: string[]
    textPreview: string
    signals?: string[]
    distilledCapsules?: Array<{
      id?: string | null
      summary?: string | null
    }>
  }
  review: {
    prepared: StoredPreparedReview | null
    decision: StoredReviewDecision | null
  }
  solidify: {
    prepared: StoredPreparedSolidify | null
    completed: boolean
    completedAt?: string
    result: CompleteSolidifyOptions['result'] | null
  }
  distill: {
    prepared: StoredPreparedDistill | null
    completed: boolean
    completedAt?: string
    result: EvolverDistillationCompleteResult | null
  }
}

interface StoredPreparedReview {
  review: EvolverReviewExport['review']
  gene: EvolverReviewExport['gene']
  mutation: EvolverReviewExport['mutation']
  diff: string
  prompt: string
  responseFormat: 'json'
  preparedAt: string
}

interface StoredReviewDecision {
  approved: boolean
  response: Record<string, unknown>
  decidedAt: string
  rejected?: EvolverReviewState
}

interface StoredPreparedSolidify {
  commands: string[]
  preparedAt: string
}

interface StoredPreparedDistill {
  prompt: string
  responseFormat: 'text' | 'json'
  promptPath: string | null
  requestPath: string | null
  inputCapsuleCount: number | null
  preparedAt: string
}

interface ReviewBridgeModule {
  exportReview: () => EvolverReviewExport
  rejectReview: () => EvolverReviewState
}

interface DistillBridgeModule {
  prepareDistillationPayload: () => EvolverDistillationPrepareResult
  completeDistillationPayload: (responseFilePath: string) => EvolverDistillationCompleteResult
}

interface LlmReviewModule {
  buildReviewPrompt: (input: {
    diff: string
    gene: Record<string, unknown> | null
    signals: string[]
    mutation: Record<string, unknown> | null
  }) => string
}

interface HostBridgeModule {
  runHostBridge: (
    action:
      | 'process-turn'
      | 'prepare-review'
      | 'complete-review'
      | 'prepare-solidify'
      | 'complete-solidify'
      | 'prepare-distill'
      | 'complete-distill'
      | 'trace-turn',
    request: object
  ) => Promise<unknown> | unknown
}

let evolverExecutionLock: Promise<void> = Promise.resolve()

export class StoaEvolverBridge {
  private readonly repoRoot: string
  private readonly delegate: EvolverBridgeDelegate

  constructor(options: StoaEvolverBridgeOptions) {
    this.repoRoot = resolve(options.repoRoot)
    this.delegate = options.delegate
  }

  async warmStart(options: WarmStartOptions): Promise<DeliveryEnvelope | null> {
    return await this.delegate.warmStart(options)
  }

  async recall(options: RecallOptions): Promise<DeliveryEnvelope | null> {
    return await this.delegate.recall(options)
  }

  async observeWrite(options: ObserveWriteOptions): Promise<void> {
    await this.delegate.observeWrite(options)
  }

  async processTurn(options: ProcessTurnOptions): Promise<ProcessTurnResult> {
    return await this.withEvolverEnv(options.projectRoot, async () => {
      return await loadHostBridge(this.repoRoot).runHostBridge('process-turn', options) as ProcessTurnResult
    })
  }

  async prepareReview(
    options: TurnScopedBridgeOptions
  ): Promise<{ prompt: string; responseFormat: 'text' | 'json' } | null> {
    const prepared = await this.withEvolverEnv(options.projectRoot, async () => {
      const reviewBridge = loadReviewBridge(this.repoRoot)
      const llmReview = loadLlmReview(this.repoRoot)
      const exportedReview = reviewBridge.exportReview()
      if (!exportedReview.review || exportedReview.review.status !== 'pending') {
        return null
      }

      const prompt = llmReview.buildReviewPrompt({
        diff: exportedReview.diff,
        gene: exportedReview.gene,
        signals: exportedReview.review.signals,
        mutation: exportedReview.mutation
      })

      return {
        prompt,
        exportedReview
      }
    })

    if (!prepared) {
      return null
    }

    const recordPath = getTurnRecordPath(options.projectRoot, options)
    const record = await readRequiredTurnRecord(recordPath)
    record.review.prepared = {
      review: prepared.exportedReview.review,
      gene: prepared.exportedReview.gene,
      mutation: prepared.exportedReview.mutation,
      diff: prepared.exportedReview.diff,
      prompt: prepared.prompt,
      responseFormat: 'json',
      preparedAt: new Date().toISOString()
    }
    await writeJsonAtomic(recordPath, record)

    return {
      prompt: prepared.prompt,
      responseFormat: 'json'
    }
  }

  async completeReview(options: CompleteReviewOptions): Promise<void> {
    const response = parseReviewResponse(options.response)
    const recordPath = getTurnRecordPath(options.projectRoot, options)
    const record = await readRequiredTurnRecord(recordPath)

    if (response.approved === false) {
      const rejected = await this.withEvolverEnv(options.projectRoot, async () => {
        return loadReviewBridge(this.repoRoot).rejectReview()
      })

      record.review.decision = {
        approved: false,
        response,
        decidedAt: new Date().toISOString(),
        rejected
      }
      await writeJsonAtomic(recordPath, record)
      return
    }

    if (response.approved === true) {
      record.review.decision = {
        approved: true,
        response,
        decidedAt: new Date().toISOString()
      }
      await writeJsonAtomic(recordPath, record)
      return
    }

    throw new Error('Review response must include approved=true|false')
  }

  async prepareSolidify(
    options: TurnScopedBridgeOptions
  ): Promise<{ commands: string[] } | null> {
    const recordPath = getTurnRecordPath(options.projectRoot, options)
    const record = await readRequiredTurnRecord(recordPath)
    if (record.review.decision?.approved !== true) {
      return null
    }

    const commands = extractValidationCommands(record.review.prepared?.gene ?? null)
    record.solidify.prepared = {
      commands,
      preparedAt: new Date().toISOString()
    }
    await writeJsonAtomic(recordPath, record)

    return { commands }
  }

  async completeSolidify(options: CompleteSolidifyOptions): Promise<void> {
    const recordPath = getTurnRecordPath(options.projectRoot, options)
    const record = await readRequiredTurnRecord(recordPath)
    record.solidify.completed = true
    record.solidify.result = options.result
    record.solidify.completedAt = new Date().toISOString()
    await writeJsonAtomic(recordPath, record)
  }

  async prepareDistill(
    options: TurnScopedBridgeOptions
  ): Promise<{ prompt: string; responseFormat: 'text' | 'json' } | null> {
    const prepared = await this.withEvolverEnv(options.projectRoot, async () => {
      const distillBridge = loadDistillBridge(this.repoRoot)
      const result = distillBridge.prepareDistillationPayload()
      if (!result.ok || !result.prompt_path) {
        return null
      }

      return {
        prompt: await readFile(result.prompt_path, 'utf8'),
        result
      }
    })

    if (!prepared) {
      return null
    }

    const recordPath = getTurnRecordPath(options.projectRoot, options)
    const record = await readRequiredTurnRecord(recordPath)
    record.distill.prepared = {
      prompt: prepared.prompt,
      responseFormat: DEFAULT_DISTILL_RESPONSE_FORMAT,
      promptPath: prepared.result.prompt_path,
      requestPath: prepared.result.request_path,
      inputCapsuleCount: prepared.result.input_capsule_count,
      preparedAt: new Date().toISOString()
    }
    await writeJsonAtomic(recordPath, record)

    return {
      prompt: prepared.prompt,
      responseFormat: DEFAULT_DISTILL_RESPONSE_FORMAT
    }
  }

  async completeDistill(options: CompleteDistillOptions): Promise<void> {
    const responseFilePath = await writeBridgeResponseFile(options.projectRoot, 'distill', options.response)
    const result = await this.withEvolverEnv(options.projectRoot, async () => {
      return loadDistillBridge(this.repoRoot).completeDistillationPayload(responseFilePath)
    })

    const recordPath = getTurnRecordPath(options.projectRoot, options)
    const record = await readRequiredTurnRecord(recordPath)
    record.distill.completed = true
    record.distill.result = result
    record.distill.completedAt = new Date().toISOString()
    await writeJsonAtomic(recordPath, record)
  }

  async getStateSummary(options: StateSummaryOptions): Promise<Record<string, unknown>> {
    return await this.delegate.getStateSummary(options)
  }

  async traceTurn(options: TurnScopedBridgeOptions): Promise<Record<string, unknown>> {
    const record = await readOptionalTurnRecord(getTurnRecordPath(options.projectRoot, options))
    if (!record) {
      return {}
    }

    return {
      projectRoot: record.projectRoot,
      stoaSessionId: record.stoaSessionId,
      providerSessionId: record.providerSessionId,
      turnId: record.turnId,
      evidenceCount: record.trace.evidenceCount,
      evidenceIds: record.trace.evidenceIds,
      toolNames: record.trace.toolNames,
      signals: record.trace.signals ?? [],
      review: record.review,
      distilledCapsules: record.trace.distilledCapsules ?? [],
      textPreview: record.trace.textPreview,
      solidify: record.solidify,
      distill: record.distill
    }
  }

  async explainRecall(options: ExplainRecallOptions): Promise<Record<string, unknown>> {
    return await this.delegate.explainRecall(options)
  }

  async getAsset(options: GetAssetOptions): Promise<Record<string, unknown> | null> {
    return await this.delegate.getAsset(options)
  }

  private async withEvolverEnv<T>(
    projectRoot: string,
    work: () => Promise<T> | T
  ): Promise<T> {
    return await withSerializedEvolverAccess(async () => {
      const originalEnv = snapshotEvolverEnv()
      applyEvolverEnv(projectRoot)
      clearEvolverRequireCache(this.repoRoot)

      try {
        return await work()
      } finally {
        clearEvolverRequireCache(this.repoRoot)
        restoreEvolverEnv(originalEnv)
      }
    })
  }
}

function formatTurnKey(request: Pick<TurnScopedBridgeOptions, 'stoaSessionId' | 'providerSessionId' | 'turnId'>): string {
  const stoaSessionId = request.stoaSessionId.trim()
  const providerSessionId = request.providerSessionId?.trim() ?? ''
  const turnId = request.turnId.trim()
  if (!stoaSessionId || !turnId) {
    throw new Error('Turn-scoped bridge action requires stoaSessionId and turnId')
  }

  return [
    stoaSessionId,
    providerSessionId || 'no-provider-session',
    turnId
  ].map(sanitizeBridgeKeySegment).join('__')
}

function sanitizeBridgeKeySegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function getTurnRecordPath(
  projectRoot: string,
  request: Pick<TurnScopedBridgeOptions, 'stoaSessionId' | 'providerSessionId' | 'turnId'>
): string {
  return join(
    projectRoot,
    '.stoa',
    'evolver',
    'memory',
    'evolution',
    'stoa-bridge-turns',
    `${formatTurnKey(request)}.json`
  )
}

function extractValidationCommands(gene: EvolverReviewExport['gene']): string[] {
  if (!gene || typeof gene !== 'object' || Array.isArray(gene)) {
    return []
  }

  const validation = (gene as Record<string, unknown>).validation
  if (!Array.isArray(validation)) {
    return []
  }

  return validation.filter((command): command is string => typeof command === 'string')
}

function parseReviewResponse(responseText: string): Record<string, unknown> & { approved?: boolean } {
  const parsed = JSON.parse(responseText) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Review response must be a JSON object')
  }

  return parsed as Record<string, unknown> & { approved?: boolean }
}

async function writeBridgeResponseFile(projectRoot: string, prefix: string, response: string): Promise<string> {
  const directoryPath = join(
    projectRoot,
    '.stoa',
    'evolver',
    'memory',
    'evolution',
    'stoa-host-bridge'
  )
  await mkdir(directoryPath, { recursive: true })

  const filePath = join(directoryPath, `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}.txt`)
  await writeFile(filePath, response, 'utf8')
  return filePath
}

async function readOptionalTurnRecord(filePath: string): Promise<StoredTurnRecord | null> {
  if (!existsSync(filePath)) {
    return null
  }

  const content = await readFile(filePath, 'utf8')
  return JSON.parse(content) as StoredTurnRecord
}

async function readRequiredTurnRecord(filePath: string): Promise<StoredTurnRecord> {
  const record = await readOptionalTurnRecord(filePath)
  if (!record) {
    throw new Error(`Missing turn bridge record: ${filePath}`)
  }

  return record
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  if (existsSync(filePath)) {
    await rm(filePath, { force: true })
  }
  await rename(tempPath, filePath)
}

async function withSerializedEvolverAccess<T>(work: () => Promise<T>): Promise<T> {
  const previous = evolverExecutionLock
  let release!: () => void
  evolverExecutionLock = new Promise<void>((resolveLock) => {
    release = resolveLock
  })

  await previous
  try {
    return await work()
  } finally {
    release()
  }
}

function snapshotEvolverEnv(): Partial<Record<(typeof EVOLVER_ENV_KEYS)[number], string | undefined>> {
  return Object.fromEntries(
    EVOLVER_ENV_KEYS.map((key) => [key, process.env[key]])
  ) as Partial<Record<(typeof EVOLVER_ENV_KEYS)[number], string | undefined>>
}

function applyEvolverEnv(projectRoot: string): void {
  process.env.STOA_EVOLVER_PROJECT_ROOT = projectRoot
  process.env.EVOLVER_REPO_ROOT = projectRoot
  process.env.MEMORY_DIR = join(projectRoot, '.stoa', 'evolver', 'memory')
  process.env.EVOLUTION_DIR = join(projectRoot, '.stoa', 'evolver', 'memory', 'evolution')
  process.env.GEP_ASSETS_DIR = join(projectRoot, '.stoa', 'evolver', 'assets', 'gep')
  process.env.EVOLVER_QUIET_PARENT_GIT = 'true'
  delete process.env.EVOLVER_SESSION_SCOPE
}

function restoreEvolverEnv(snapshot: Partial<Record<(typeof EVOLVER_ENV_KEYS)[number], string | undefined>>): void {
  for (const key of EVOLVER_ENV_KEYS) {
    const value = snapshot[key]
    if (typeof value === 'string') {
      process.env[key] = value
    } else {
      delete process.env[key]
    }
  }
}

function clearEvolverRequireCache(repoRoot: string): void {
  const normalizedRoot = `${resolve(repoRoot)}\\`.replaceAll('/', '\\').toLowerCase()

  for (const modulePath of Object.keys(require.cache)) {
    const normalizedPath = modulePath.replaceAll('/', '\\').toLowerCase()
    if (normalizedPath.startsWith(normalizedRoot)) {
      delete require.cache[modulePath]
    }
  }
}

function loadReviewBridge(repoRoot: string): ReviewBridgeModule {
  return require(join(repoRoot, 'src', 'stoa', 'reviewBridge.js')) as ReviewBridgeModule
}

function loadDistillBridge(repoRoot: string): DistillBridgeModule {
  return require(join(repoRoot, 'src', 'stoa', 'distillBridge.js')) as DistillBridgeModule
}

function loadLlmReview(repoRoot: string): LlmReviewModule {
  return require(join(repoRoot, 'src', 'gep', 'llmReview.js')) as LlmReviewModule
}

function loadHostBridge(repoRoot: string): HostBridgeModule {
  return require(join(repoRoot, 'src', 'stoa', 'hostBridge.js')) as HostBridgeModule
}
