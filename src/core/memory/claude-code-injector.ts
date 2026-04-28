import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { EvolverClient } from './evolver-client'
import { resolveBundledEvolverCli } from './bundled-evolver'
import { RuntimeStateStore } from './runtime-state-store'

interface RuntimeStateStoreLike {
  getRunRecord: RuntimeStateStore['getRunRecord']
  findLatestApprovedRun: RuntimeStateStore['findLatestApprovedRun']
  findLatestPublishableRun: RuntimeStateStore['findLatestPublishableRun']
  getPublishedRecord: RuntimeStateStore['getPublishedRecord']
  upsertPublishedRecord: RuntimeStateStore['upsertPublishedRecord']
}

interface EvolverClientLike {
  publishContext: EvolverClient['publishContext']
}

export interface InjectClaudeCodeContextInput {
  projectId: string
  stoaSessionId: string
  projectPath: string
}

export interface InjectClaudeCodeContextResult {
  filePath: string
  hash: string
}

export interface ClaudeCodeInjectorOptions {
  createStateStore?: (projectPath: string) => RuntimeStateStoreLike
  buildEvolverClient?: (options: {
    cwd: string
    env: NodeJS.ProcessEnv
  }) => Promise<EvolverClientLike>
  readTextFile?: (filePath: string) => Promise<string>
  writeTextFile?: (filePath: string, content: string) => Promise<void>
  nowIso?: () => string
}

function isPublishableReviewStatus(status: string): boolean {
  return status === 'approved' || status === 'none'
}

function isSuccessfulPublishableRun(record: {
  reviewStatus: string
  lastError: string | null
} | null): record is {
  reviewStatus: string
  lastError: null
} {
  return record !== null && isPublishableReviewStatus(record.reviewStatus) && record.lastError === null
}

export class ClaudeCodeInjector {
  private readonly createStateStore: (projectPath: string) => RuntimeStateStoreLike
  private readonly buildEvolverClient: (options: {
    cwd: string
    env: NodeJS.ProcessEnv
  }) => Promise<EvolverClientLike>
  private readonly readTextFile: (filePath: string) => Promise<string>
  private readonly writeTextFile: (filePath: string, content: string) => Promise<void>
  private readonly nowIso: () => string

  constructor(options: ClaudeCodeInjectorOptions = {}) {
    this.createStateStore = options.createStateStore ?? (projectPath => new RuntimeStateStore(projectPath))
    this.buildEvolverClient = options.buildEvolverClient ?? defaultBuildEvolverClient
    this.readTextFile = options.readTextFile ?? (filePath => readFile(filePath, 'utf8'))
    this.writeTextFile = options.writeTextFile ?? writeTextFile
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async injectLatestContext(input: InjectClaudeCodeContextInput): Promise<InjectClaudeCodeContextResult | null> {
    const stateStore = this.createStateStore(input.projectPath)
    const exactRunRecord = await stateStore.getRunRecord(input.projectId, input.stoaSessionId)
    const runRecord = isSuccessfulPublishableRun(exactRunRecord)
      ? exactRunRecord
      : await stateStore.findLatestPublishableRun(input.projectId)
    if (!runRecord) {
      return null
    }

    const targetFilePath = getClaudeCodePublishedContextPath(input.projectPath)
    const publishedRecord = await stateStore.getPublishedRecord(input.projectId, input.stoaSessionId, 'claude-code')
    const existingHash = await readExistingHash(targetFilePath, this.readTextFile)
    if (
      publishedRecord?.deliveryState === 'published'
      && publishedRecord.runId === runRecord.runId
      && publishedRecord.publishedHash !== null
      && publishedRecord.publishedHash === existingHash
    ) {
      return {
        filePath: targetFilePath,
        hash: existingHash
      }
    }

    try {
      const evolverClient = await this.buildEvolverClient({
        cwd: runRecord.worktreePath,
        env: {
          EVOLVER_REPO_ROOT: runRecord.worktreePath,
          MEMORY_DIR: runRecord.memoryDir,
          EVOLUTION_DIR: runRecord.evolutionDir,
          GEP_ASSETS_DIR: runRecord.gepAssetsDir
        }
      })
      const publishedContext = await evolverClient.publishContext('claude-code')
      if (!publishedContext.ok) {
        throw new Error(publishedContext.error ?? 'publish-context failed')
      }

      await this.writeTextFile(targetFilePath, publishedContext.content)
      const hash = createPublishedHash(publishedContext.content)
      await stateStore.upsertPublishedRecord({
        projectId: input.projectId,
        stoaSessionId: input.stoaSessionId,
        consumer: 'claude-code',
        deliveryState: 'published',
        runId: runRecord.runId,
        publishedHash: hash,
        updatedAt: this.nowIso()
      })

      return {
        filePath: targetFilePath,
        hash
      }
    } catch (error) {
      await rm(targetFilePath, { force: true }).catch(() => {})
      await stateStore.upsertPublishedRecord({
        projectId: input.projectId,
        stoaSessionId: input.stoaSessionId,
        consumer: 'claude-code',
        deliveryState: 'failed',
        runId: runRecord.runId,
        publishedHash: null,
        updatedAt: this.nowIso()
      })
      throw error
    }
  }
}

export function getClaudeCodePublishedContextPath(projectPath: string): string {
  return join(projectPath, '.stoa', 'generated', 'evolver-context', 'claude-code.jsonl')
}

function createPublishedHash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

async function readExistingHash(
  filePath: string,
  readTextFile: (filePath: string) => Promise<string>
): Promise<string | null> {
  try {
    return createPublishedHash(await readTextFile(filePath))
  } catch {
    return null
  }
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
