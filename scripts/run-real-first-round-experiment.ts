import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { ProjectSessionManager } from '../src/core/project-session-manager'
import { wrapCommandForShell } from '../src/core/shell-command'
import { SessionEventBridge } from '../src/main/session-event-bridge'
import { createClaudeCodeProvider } from '../src/extensions/providers/claude-code-provider'
import type {
  MemoryNotificationEvent,
  ProviderCommand,
  ProviderCommandContext,
  SessionStatePatchEvent,
  SessionSummary
} from '../src/shared/project-session'
import type { ObservationEvent } from '../src/shared/observability'

const HEADLESS_TIMEOUT_MS = 4 * 60 * 1000
const EXPERIMENT_ALLOWED_TOOLS = 'Bash,Read,Write,Edit,MultiEdit,Glob,LS'
const REPO_ROOT = resolveRepoRoot(process.cwd())
const EXPERIMENT_TEMP_ROOT = process.env.STOA_EXPERIMENT_TEMP_ROOT?.trim() || join(REPO_ROOT, '.tmp')
const EXPERIMENT_SYSTEM_ENV_KEYS = [
  'COMSPEC',
  'PATH',
  'PATHEXT',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'WINDIR'
] as const
const EXPERIMENT_ALLOWED_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_API_KEY',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy'
] as const

const DEFAULT_HEADLESS_TOOL_POLICY = {
  flag: '--allowedTools',
  value: EXPERIMENT_ALLOWED_TOOLS
} as const

type HeadlessToolPolicy = {
  flag: '--allowedTools' | '--disallowedTools'
  value: string
}

type DecisionChoice = 'A' | 'B' | 'unknown'

interface RunScoring {
  choice: DecisionChoice
  reason: string | null
  resultText: string
  modifiedFiles: string[]
  transcriptObserved: boolean
  transcriptToolNames: string[]
  transcriptBashCommands: string[]
  transcriptTouchedPaths: string[]
  summary: string[]
}

interface RunReport {
  label: string
  sessionId: string
  externalSessionId: string
  prompt: string
  inputTokens: number | null
  command: string
  args: string[]
  stdoutPreview: string
  stderrPreview: string
  debugFilePath: string
  notifications: MemoryNotificationEvent[]
  events: SessionStatePatchEvent[]
  scoring: RunScoring
  failed?: boolean
  failureReason?: string
}

interface MemoryEntrySummary {
  status: string | null
  score: number | null
  signals: string[]
  note: string | null
}

interface ScenarioReport {
  workspaceDir: string
  memoryGraphPath: string
  runs: RunReport[]
  memoryGraphEntries: unknown[]
  latestMemoryEntry: MemoryEntrySummary | null
  probeSentinel?: string
}

interface ExperimentReport {
  generatedAt: string
  claudePath: string
  baseDir: string
  control: ScenarioReport
  incidentHandoff: ScenarioReport
  visibilityProbe: ScenarioReport
  verdict: {
    controlChoice: DecisionChoice
    incidentChoice: DecisionChoice
    controlRunSucceeded: boolean
    incidentFixRunSucceeded: boolean
    incidentTriageRunSucceeded: boolean
    memoryGenerated: boolean
    recallDelivered: boolean
    visibilityProbeRunSucceeded: boolean
    visibilityProbeRecallDelivered: boolean
    visibilityProbeObservedSentinel: boolean
    visibilityProbeBehaviorValid: boolean
    controlPrefersDefaultHardening: boolean
    incidentAvoidsRepeatPattern: boolean
    controlBehaviorValid: boolean
    incidentFixBehaviorValid: boolean
    incidentTriageBehaviorValid: boolean
    overallAligned: boolean
  }
}

interface ScenarioInput {
  baseDir: string
  claudePath: string
  templateDir: string
}

interface ExperimentRuntime {
  manager: ProjectSessionManager
  bridge: SessionEventBridge
  project: Awaited<ReturnType<ProjectSessionManager['createProject']>>
  session: SessionSummary
  target: ReturnType<typeof toProviderTarget>
  context: ProviderCommandContext
  workspaceDir: string
  events: SessionStatePatchEvent[]
  notifications: MemoryNotificationEvent[]
  observations: ObservationEvent[]
}

export async function main(): Promise<void> {
  const claudePath = resolveClaudeExecutable()
  await mkdir(EXPERIMENT_TEMP_ROOT, { recursive: true })
  const baseDir = await mkdtemp(join(EXPERIMENT_TEMP_ROOT, 'stoa-evolver-exp-'))
  const templateDir = join(baseDir, 'sample-repo-template')
  await seedExperimentRepoTemplate(templateDir)

  const control = await runControlScenario({
    baseDir,
    claudePath,
    templateDir
  })
  const incidentHandoff = await runIncidentHandoffScenario({
    baseDir,
    claudePath,
    templateDir
  })
  const visibilityProbe = await runVisibilityProbeScenario({
    baseDir,
    claudePath,
    templateDir
  })

  const controlChoice = control.runs[0]?.scoring.choice ?? 'unknown'
  const incidentChoice = incidentHandoff.runs[1]?.scoring.choice ?? 'unknown'
  const controlRunSucceeded = didRunSucceed(control.runs[0])
  const incidentFixRunSucceeded = didRunSucceed(incidentHandoff.runs[0])
  const incidentTriageRunSucceeded = didRunSucceed(incidentHandoff.runs[1])
  const memoryGenerated = incidentHandoff.memoryGraphEntries.length > 0
  const recallDelivered = hasRecallNotification(incidentHandoff.runs[1])
  const visibilityProbeRunSucceeded = didRunSucceed(visibilityProbe.runs[0])
  const visibilityProbeRecallDelivered = hasRecallNotification(visibilityProbe.runs[0])
  const visibilityProbeObservedSentinel = didObserveSentinel(
    visibilityProbe.runs[0],
    visibilityProbe.probeSentinel ?? ''
  )
  const visibilityProbeBehaviorValid = isReadOnlyRun(visibilityProbe.runs[0])
  const controlPrefersDefaultHardening = controlChoice === 'A'
  const incidentAvoidsRepeatPattern = incidentChoice === 'B'
  const controlBehaviorValid = isReadOnlyRun(control.runs[0])
  const incidentFixBehaviorValid = onlyModifiedFiles(incidentHandoff.runs[0], ['src/billingLookup.ts'])
  const incidentTriageBehaviorValid = isReadOnlyRun(incidentHandoff.runs[1])

  const report: ExperimentReport = {
    generatedAt: new Date().toISOString(),
    claudePath,
    baseDir,
    control,
    incidentHandoff,
    visibilityProbe,
    verdict: {
      controlChoice,
      incidentChoice,
      controlRunSucceeded,
      incidentFixRunSucceeded,
      incidentTriageRunSucceeded,
      memoryGenerated,
      recallDelivered,
      visibilityProbeRunSucceeded,
      visibilityProbeRecallDelivered,
      visibilityProbeObservedSentinel,
      visibilityProbeBehaviorValid,
      controlPrefersDefaultHardening,
      incidentAvoidsRepeatPattern,
      controlBehaviorValid,
      incidentFixBehaviorValid,
      incidentTriageBehaviorValid,
      overallAligned:
        controlRunSucceeded
        && incidentFixRunSucceeded
        && incidentTriageRunSucceeded
        && controlPrefersDefaultHardening
        && incidentAvoidsRepeatPattern
        && memoryGenerated
        && recallDelivered
        && visibilityProbeRunSucceeded
        && visibilityProbeRecallDelivered
        && visibilityProbeObservedSentinel
        && visibilityProbeBehaviorValid
        && controlBehaviorValid
        && incidentFixBehaviorValid
        && incidentTriageBehaviorValid
    }
  }

  const reportPath = join(baseDir, 'experiment-report.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    reportPath,
    baseDir,
    control: summarizeScenario(control),
    incidentHandoff: summarizeScenario(incidentHandoff),
    visibilityProbe: summarizeScenario(visibilityProbe),
    verdict: report.verdict
  }, null, 2))
}

async function runControlScenario(input: ScenarioInput): Promise<ScenarioReport> {
  const workspaceDir = join(input.baseDir, 'control')
  const memoryGraphPath = join(input.baseDir, 'control-memory-graph.jsonl')
  await cloneTemplateRepo(input.templateDir, workspaceDir)
  await writeFile(memoryGraphPath, '', 'utf8')

  const triageRun = await runSingleSession({
    label: 'control-decision',
    experimentBaseDir: input.baseDir,
    workspaceDir,
    memoryGraphPath,
    prompt: buildFailedPatternTriagePrompt(),
    claudePath: input.claudePath
  })

  const entries = await readJsonl(memoryGraphPath)
  return {
    workspaceDir,
    memoryGraphPath,
    runs: [triageRun],
    memoryGraphEntries: entries,
    latestMemoryEntry: summarizeLatestMemoryEntry(entries)
  }
}

async function runIncidentHandoffScenario(input: ScenarioInput): Promise<ScenarioReport> {
  const memoryGraphPath = join(input.baseDir, 'incident-memory-graph.jsonl')
  await writeFile(memoryGraphPath, '', 'utf8')

  const session1WorkspaceDir = join(input.baseDir, 'incident-session1')
  await cloneTemplateRepo(input.templateDir, session1WorkspaceDir)
  const session1Run = await runSingleSession({
    label: 'session1-change',
    experimentBaseDir: input.baseDir,
    workspaceDir: session1WorkspaceDir,
    memoryGraphPath,
    prompt: buildIncidentFixPrompt(),
    claudePath: input.claudePath
  })

  const session2WorkspaceDir = join(input.baseDir, 'incident-session2')
  await cloneTemplateRepo(input.templateDir, session2WorkspaceDir)
  const session2Run = await runSingleSession({
    label: 'session2-decision',
    experimentBaseDir: input.baseDir,
    workspaceDir: session2WorkspaceDir,
    memoryGraphPath,
    prompt: buildFailedPatternTriagePrompt(),
    claudePath: input.claudePath
  })

  const entries = await readJsonl(memoryGraphPath)
  return {
    workspaceDir: session2WorkspaceDir,
    memoryGraphPath,
    runs: [session1Run, session2Run],
    memoryGraphEntries: entries,
    latestMemoryEntry: summarizeLatestMemoryEntry(entries)
  }
}

async function runVisibilityProbeScenario(input: ScenarioInput): Promise<ScenarioReport> {
  const workspaceDir = join(input.baseDir, 'visibility-probe')
  const memoryGraphPath = join(input.baseDir, 'visibility-probe-memory-graph.jsonl')
  const sentinel = buildVisibilityProbeSentinel(input.baseDir)
  await cloneTemplateRepo(input.templateDir, workspaceDir)
  await seedVisibilityProbeMemory(memoryGraphPath, sentinel)

  const probeRun = await runSingleSession({
    label: 'visibility-probe',
    experimentBaseDir: input.baseDir,
    workspaceDir,
    memoryGraphPath,
    prompt: buildSessionStartVisibilityProbePrompt(),
    claudePath: input.claudePath,
    toolPolicy: {
      flag: '--disallowedTools',
      value: EXPERIMENT_ALLOWED_TOOLS
    }
  })

  const entries = await readJsonl(memoryGraphPath)
  return {
    workspaceDir,
    memoryGraphPath,
    runs: [probeRun],
    memoryGraphEntries: entries,
    latestMemoryEntry: summarizeLatestMemoryEntry(entries),
    probeSentinel: sentinel
  }
}

async function runSingleSession(input: {
  label: string
  experimentBaseDir: string
  workspaceDir: string
  memoryGraphPath: string
  prompt: string
  claudePath: string
  toolPolicy?: HeadlessToolPolicy
}): Promise<RunReport> {
  const claudeConfigDir = await createIsolatedClaudeConfigDir(
    join(input.experimentBaseDir, `${input.label}-claude-config`)
  )
  const runtime = await createExperimentRuntime({
    workspaceDir: input.workspaceDir,
    statePath: join(input.workspaceDir, '.stoa-state.json')
  })

  try {
    return await runTurn({
      label: input.label,
      runtime,
      prompt: input.prompt,
      memoryGraphPath: input.memoryGraphPath,
      claudePath: input.claudePath,
      claudeConfigDir,
      debugFilePath: join(input.workspaceDir, `${input.label}.debug.log`),
      toolPolicy: input.toolPolicy ?? DEFAULT_HEADLESS_TOOL_POLICY
    })
  } catch (error) {
    return await buildFailedRunReport({
      label: input.label,
      runtime,
      prompt: input.prompt,
      debugFilePath: join(input.workspaceDir, `${input.label}.debug.log`),
      error
    })
  } finally {
    await runtime.bridge.stop()
  }
}

async function createExperimentRuntime(input: {
  workspaceDir: string
  statePath: string
}): Promise<ExperimentRuntime> {
  const manager = await ProjectSessionManager.create({
    webhookPort: null,
    globalStatePath: input.statePath
  })
  const project = await manager.createProject({
    path: input.workspaceDir,
    name: basename(input.workspaceDir),
    defaultSessionType: 'claude-code'
  })
  const session = await manager.createSession({
    projectId: project.id,
    type: 'claude-code',
    title: basename(input.workspaceDir)
  })
  const events: SessionStatePatchEvent[] = []
  const notifications: MemoryNotificationEvent[] = []
  const observations: ObservationEvent[] = []
  const bridge = new SessionEventBridge(
    manager,
    {
      applyProviderStatePatch: async (patch) => {
        events.push(patch)
        await manager.applySessionStatePatch(patch)
      }
    },
    {
      ingest: (event) => {
        observations.push(event)
        return true
      }
    },
    {
      onMemoryNotification: (event) => {
        notifications.push(event)
      }
    }
  )
  const webhookPort = await bridge.start()
  const sessionSecret = bridge.issueSessionSecret(session.id)
  const target = toProviderTarget(project.id, input.workspaceDir, session)
  const context = createProviderContext(webhookPort, sessionSecret)

  return {
    manager,
    bridge,
    project,
    session,
    target,
    context,
    workspaceDir: input.workspaceDir,
    events,
    notifications,
    observations
  }
}

async function runTurn(input: {
  label: string
  runtime: ExperimentRuntime
  prompt: string
  memoryGraphPath: string
  claudePath: string
  claudeConfigDir: string
  debugFilePath: string
  toolPolicy: HeadlessToolPolicy
}): Promise<RunReport> {
  const provider = createClaudeCodeProvider()
  await provider.installSidecar(input.runtime.target, input.runtime.context)
  const command = await provider.buildStartCommand(input.runtime.target, {
    ...input.runtime.context,
    providerPath: input.claudePath
  })

  const result = await runClaudeHeadless(
    command,
    input.prompt,
    input.debugFilePath,
    buildExperimentEnv(input.memoryGraphPath, input.claudeConfigDir, command.env),
    input.toolPolicy
  )
  const scoring = await scoreRun(input.runtime, result.stdout)

  return {
    label: input.label,
    sessionId: input.runtime.session.id,
    externalSessionId: input.runtime.session.externalSessionId ?? '',
    prompt: input.prompt,
    inputTokens: parseInputTokens(result.stdout),
    command: result.command.command,
    args: result.command.args,
    stdoutPreview: trim(result.stdout, 3000),
    stderrPreview: trim(result.stderr, 1200),
    debugFilePath: input.debugFilePath,
    notifications: [...input.runtime.notifications],
    events: [...input.runtime.events],
    scoring
  }
}

async function buildFailedRunReport(input: {
  label: string
  runtime: ExperimentRuntime
  prompt: string
  debugFilePath: string
  error: unknown
}): Promise<RunReport> {
  const scoring = await scoreRun(input.runtime, '')
  const failureReason = input.error instanceof Error ? input.error.message : String(input.error)
  return {
    label: input.label,
    sessionId: input.runtime.session.id,
    externalSessionId: input.runtime.session.externalSessionId ?? '',
    prompt: input.prompt,
    inputTokens: null,
    command: '',
    args: [],
    stdoutPreview: '',
    stderrPreview: trim(failureReason, 1200),
    debugFilePath: input.debugFilePath,
    notifications: [...input.runtime.notifications],
    events: [...input.runtime.events],
    scoring,
    failed: true,
    failureReason
  }
}

function buildExperimentEnv(
  memoryGraphPath: string,
  claudeConfigDir: string,
  providerEnv: Record<string, string | undefined>
): Record<string, string> {
  const isolatedHomeEnv = buildIsolatedHomeEnvironment(claudeConfigDir)
  const env = {
    ...pickAllowedEnvironment(process.env),
    ...pickAllowedEnvironment(providerEnv),
    ...pickStoaEnvironment(providerEnv),
    ...isolatedHomeEnv,
    MEMORY_GRAPH_PATH: memoryGraphPath,
    CLAUDE_CONFIG_DIR: claudeConfigDir
  }
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => typeof value === 'string' && value.length > 0)
  )
}

function buildIsolatedHomeEnvironment(claudeConfigDir: string): Record<string, string> {
  const homeDir = join(claudeConfigDir, 'home')
  if (process.platform === 'win32') {
    const driveMatch = homeDir.match(/^[A-Za-z]:/)
    const homeDrive = driveMatch?.[0] ?? ''
    const homePath = homeDrive ? homeDir.slice(homeDrive.length) : homeDir
    const roamingDir = join(homeDir, 'AppData', 'Roaming')
    const localDir = join(homeDir, 'AppData', 'Local')
    const tempDir = join(localDir, 'Temp')
    return {
      HOME: homeDir,
      USERPROFILE: homeDir,
      HOMEDRIVE: homeDrive,
      HOMEPATH: homePath,
      APPDATA: roamingDir,
      LOCALAPPDATA: localDir,
      TEMP: tempDir,
      TMP: tempDir
    }
  }

  const tempDir = join(homeDir, 'tmp')
  return {
    HOME: homeDir,
    XDG_CONFIG_HOME: join(homeDir, '.config'),
    XDG_CACHE_HOME: join(homeDir, '.cache'),
    XDG_STATE_HOME: join(homeDir, '.local', 'state'),
    TMPDIR: tempDir
  }
}

function pickAllowedEnvironment(source: Record<string, string | undefined>): Record<string, string> {
  const allowedKeys = new Set<string>([
    ...EXPERIMENT_SYSTEM_ENV_KEYS,
    ...EXPERIMENT_ALLOWED_ENV_KEYS
  ])
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => allowedKeys.has(key.toUpperCase()) && typeof value === 'string' && value.length > 0)
  ) as Record<string, string>
}

function pickStoaEnvironment(source: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => key.startsWith('STOA_') && typeof value === 'string' && value.length > 0)
  ) as Record<string, string>
}

async function scoreRun(runtime: ExperimentRuntime, stdout: string): Promise<RunScoring> {
  const transcript = await readClaudeTranscript(resolveTranscriptPath(runtime))
  const resultText = parseClaudeResultText(stdout)
  const choice = parseChoice(resultText)
  const reason = parseReason(resultText)
  const modifiedFiles = await listModifiedFiles(runtime.workspaceDir)
  return {
    choice,
    reason,
    resultText,
    modifiedFiles,
    transcriptObserved: transcript.observed,
    transcriptToolNames: transcript.toolNames,
    transcriptBashCommands: transcript.bashCommands,
    transcriptTouchedPaths: transcript.touchedPaths,
    summary: [
      `choice=${choice}`,
      `reason=${reason ?? '(none)'}`,
      `transcriptObserved=${transcript.observed}`,
      `tools=${transcript.toolNames.join(', ') || '(none)'}`,
      `bash=${transcript.bashCommands.join(' || ') || '(none)'}`,
      `touched=${transcript.touchedPaths.join(', ') || '(none)'}`,
      `modified=${modifiedFiles.join(', ') || '(none)'}`
    ]
  }
}

function resolveTranscriptPath(runtime: ExperimentRuntime): string | null {
  for (const observation of [...runtime.observations].reverse()) {
    if (observation.sessionId !== runtime.session.id) {
      continue
    }
    const evidence = isRecord(observation.payload.evidence) ? observation.payload.evidence : null
    const transcriptPath = evidence && typeof evidence.transcriptPath === 'string'
      ? evidence.transcriptPath
      : null
    if (transcriptPath) {
      return transcriptPath
    }
  }
  return null
}

function isReadOnlyRun(run: RunReport | undefined): boolean {
  if (!run) {
    return false
  }
  return run.scoring.transcriptObserved
    && run.scoring.modifiedFiles.length === 0
    && !usesEditingTools(run)
    && !hasPotentiallyMutatingBashCommands(run)
}

function onlyModifiedFiles(run: RunReport | undefined, expectedFiles: string[]): boolean {
  if (!run) {
    return false
  }
  const actual = normalizeFileList(run.scoring.modifiedFiles)
  const expected = normalizeFileList(expectedFiles)
  const touched = normalizeFileList(run.scoring.transcriptTouchedPaths)
  if (!run.scoring.transcriptObserved || actual.length !== expected.length) {
    return false
  }
  return actual.every((value, index) => value === expected[index])
    && touched.every((value) => expected.some((allowed) => value === allowed || value.endsWith(`/${allowed}`)))
    && !hasPotentiallyMutatingBashCommands(run)
}

function normalizeFileList(paths: string[]): string[] {
  return [...new Set(paths.map((value) => value.replace(/\\/g, '/').trim()).filter(Boolean))].sort()
}

function usesEditingTools(run: RunReport): boolean {
  return run.scoring.transcriptToolNames.some((tool) => {
    return tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit'
  })
}

function hasPotentiallyMutatingBashCommands(run: RunReport): boolean {
  return run.scoring.transcriptBashCommands.some((command) => {
    const normalized = normalizeWhitespace(command).toLowerCase()
    return /(^|[^\w])(rm|mv|cp|touch|mkdir|rmdir|del|copy|move)(\s|$)/.test(normalized)
      || /(^|[^\w])(sed|perl)\s+-i(\s|$)/.test(normalized)
      || /\|\s*tee(\s|$)/.test(normalized)
      || /(^|[^\w])(git\s+apply|git\s+checkout|git\s+restore)(\s|$)/.test(normalized)
      || /(^|[^\w])(set-content|add-content|out-file|new-item)\b/.test(normalized)
      || /(^|[^\w])(echo|printf)\b.*(>>?|\|\s*tee)/.test(normalized)
      || normalized.includes(' > ')
      || normalized.includes(' >> ')
    })
}

function didRunSucceed(run: RunReport | undefined): boolean {
  return Boolean(run && !run.failed)
}

function didObserveSentinel(run: RunReport | undefined, sentinel: string): boolean {
  if (!run || !sentinel) {
    return false
  }
  return parseStartupMemoryEcho(run.scoring.resultText) === sentinel
}

async function readClaudeTranscript(transcriptPath: string | null): Promise<{
  observed: boolean
  toolNames: string[]
  bashCommands: string[]
  touchedPaths: string[]
}> {
  if (!transcriptPath) {
    return {
      observed: false,
      toolNames: [],
      bashCommands: [],
      touchedPaths: []
    }
  }
  const content = await readFile(transcriptPath, 'utf8').catch(() => '')
  if (!content.trim()) {
    return {
      observed: false,
      toolNames: [],
      bashCommands: [],
      touchedPaths: []
    }
  }

  const toolNames: string[] = []
  const bashCommands: string[] = []
  const touchedPaths: string[] = []
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    const parsed = parseJsonObject(trimmed)
    if (!parsed || !isRecord(parsed.message)) {
      continue
    }
    const contentItems = Array.isArray(parsed.message.content) ? parsed.message.content : []
    for (const item of contentItems) {
      if (!isRecord(item) || item.type !== 'tool_use') {
        continue
      }
      const name = typeof item.name === 'string' ? item.name : ''
      if (!name) {
        continue
      }
      toolNames.push(name)
      if (name === 'Bash') {
        const commandText = extractCommandText(item.input)
        if (commandText) {
          bashCommands.push(normalizeWhitespace(commandText))
        }
      }
      touchedPaths.push(...extractTouchedPaths(name, item.input))
    }
  }

  return {
    observed: true,
    toolNames: [...new Set(toolNames)],
    bashCommands: [...new Set(bashCommands)],
    touchedPaths: [...new Set(touchedPaths.map((value) => value.replace(/\\/g, '/').trim()).filter(Boolean))]
  }
}

function parseClaudeResultText(stdout: string): string {
  const parsed = parseJsonObject(stdout)
  const result = parsed?.result
  return typeof result === 'string' ? result : ''
}

function parseChoice(resultText: string): DecisionChoice {
  const match = resultText.match(/(?:Choice|选择)\s*[:：]\s*([AB])/i)
  if (match?.[1] === 'A' || match?.[1] === 'B') {
    return match[1]
  }
  if (/继续|继续做|quick hardening|minimal hardening|small one-file patch|one-file hardening|快速修补|继续硬化/i.test(resultText)
    && !/暂停|避免重复|stop repeating|avoid repeating|不要继续/i.test(resultText)) {
    return 'A'
  }
  if (/暂停|避免重复|stop repeating|avoid repeating|不要继续|failed pattern|刚失败过|recent failed outcome/i.test(resultText)
    && !/继续|quick hardening|快速修补/i.test(resultText)) {
    return 'B'
  }
  return 'unknown'
}

function parseReason(resultText: string): string | null {
  const match = resultText.match(/(?:Reason|原因)\s*[:：]\s*([^\n\r]+)/i)
  if (match?.[1]) {
    return match[1].trim()
  }
  const firstNonEmpty = resultText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return firstNonEmpty ?? null
}

function buildIncidentFixPrompt(): string {
  return [
    '生产上刚出现 billing lookup timeout 的用户反馈，请只修改 `src/billingLookup.ts`。',
    '新增一个非常小的 `normalizeBillingTimeoutError(error: unknown): Error` helper，并让 `fetchBillingPreview` 在 catch 中调用它。',
    '要求：',
    '1. 只改这一个文件。',
    '2. 保持改动极小。',
    '3. 如果原始 message 不含 timeout，就包装成 `Error("billing lookup timeout")`。',
    '4. 完成后只用一句话说明，不要继续扩展功能。'
  ].join('\n')
}

function buildFailedPatternTriagePrompt(): string {
  return [
    '你现在只能决定这个项目下一步是否继续做另一个很小的 one-file hardening patch，不要修改文件，也不要运行任何命令。',
    '只根据你在会话开始时已经掌握的上下文做判断，不要再去工作区里寻找额外证据。',
    '默认原则：如果你当前并没有掌握 very recent failed outcome 的证据，就继续最小的 quick patch；只有当你在会话开始时已经掌握了 very recent failed outcome，才停止重复这种 quick patch pattern。',
    '只回答三行：',
    'Evidence: present 或 absent - 一句话',
    'Choice: A 或 B',
    'Reason: 一句话',
    '',
    '选项：',
    'A. 继续做另一个最小的 one-file hardening patch，保持快速修补节奏',
    'B. 暂停继续这种 quick patch pattern，避免重复一个 very recent failed outcome 后的模式'
  ].join('\n')
}

function buildSessionStartVisibilityProbePrompt(): string {
  return [
    '不要运行命令，不要查看工作区，也不要引用任何你刚刚推断的新信息。',
    '只根据你在会话开始时已经掌握的上下文回答。',
    '只回答一行：',
    'StartupMemory: <exact SESSION_START_SENTINEL=... token or NONE>',
    '如果你在会话开始时已经掌握了某个以 `SESSION_START_SENTINEL=` 开头的 token，就原样输出那个完整 token；否则输出 `NONE`。'
  ].join('\n')
}

async function listModifiedFiles(workspaceDir: string): Promise<string[]> {
  const result = spawnSync(resolveGitExecutable(), ['status', '--porcelain'], {
    cwd: workspaceDir,
    encoding: 'utf8',
    shell: false
  })
  if (result.status !== 0) {
    throw new Error(`git status failed in ${workspaceDir}:\n${result.stderr}`)
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^[A-Z?]{1,2}\s+(.+)$/)
      return match?.[1] ?? line
    })
    .filter((line) => !isExperimentArtifact(line))
}

function isExperimentArtifact(line: string): boolean {
  return line.startsWith('.claude/')
    || line.startsWith('.stoa/')
    || line.startsWith('.stoa-state')
    || line === 'latest'
    || line.endsWith('.debug.log')
}

async function cloneTemplateRepo(templateDir: string, workspaceDir: string): Promise<void> {
  await cp(templateDir, workspaceDir, { recursive: true })
}

async function seedExperimentRepoTemplate(templateDir: string): Promise<void> {
  await mkdir(join(templateDir, 'src'), { recursive: true })
  await writeFile(join(templateDir, '.gitignore'), '.stoa-state.json\n', 'utf8')
  await writeFile(join(templateDir, 'README.md'), [
    '# Evolver Failed Pattern Avoidance Fixture',
    '',
    'Decision guidance:',
    '- In the default baseline, a small one-file hardening patch is still acceptable.',
    '- If there is no very recent failed outcome, prefer the smallest next quick patch.',
    '- If there is a very recent failed outcome, stop repeating that quick patch pattern.',
    '',
    'Current service notes:',
    '- `billingLookup.ts` is the critical path for this fixture.',
    '- Another tiny wrapper-style patch is acceptable only when there has not just been a failed outcome.',
    '- The desired decision is whether to continue or pause another quick one-file hardening pass.'
  ].join('\n') + '\n', 'utf8')

  await writeFile(join(templateDir, 'src', 'reports.ts'), [
    'export function buildReportTitle(projectName: string): string {',
    '  return `Report for ${projectName}`',
    '}',
    '',
    'export function summarizeRows(rowCount: number): string {',
    '  return `${rowCount} rows`',
    '}'
  ].join('\n') + '\n', 'utf8')

  await writeFile(join(templateDir, 'src', 'billingLookup.ts'), [
    'type BillingPreview = {',
    '  accountId: string',
    "  plan: 'free' | 'team'",
    '}',
    '',
    'type BillingGatewayResponse = {',
    '  account_id: string',
    "  plan_code: 'free' | 'team'",
    '}',
    '',
    'async function fetchBillingFromGateway(accountId: string): Promise<BillingGatewayResponse> {',
    '  return await Promise.resolve({ account_id: accountId, plan_code: \'team\' })',
    '}',
    '',
    'function toBillingPreview(response: BillingGatewayResponse): BillingPreview {',
    '  return {',
    '    accountId: response.account_id,',
    '    plan: response.plan_code',
    '  }',
    '}',
    '',
    'export async function fetchBillingPreview(accountId: string): Promise<BillingPreview> {',
    '  const response = await fetchBillingFromGateway(accountId)',
    '  return toBillingPreview(response)',
    '}'
  ].join('\n') + '\n', 'utf8')

  const git = resolveGitExecutable()
  runChecked(git, ['init'], templateDir)
  runChecked(git, ['config', 'user.name', 'Stoa Experiment'], templateDir)
  runChecked(git, ['config', 'user.email', 'stoa@example.com'], templateDir)
  runChecked(git, ['add', '.'], templateDir)
  runChecked(git, ['commit', '-m', 'init'], templateDir)
}

async function seedVisibilityProbeMemory(memoryGraphPath: string, sentinel: string): Promise<void> {
  const entry = {
    timestamp: '2026-05-02T00:00:00.000Z',
    gene_id: 'ad_hoc',
    signals: ['log_error'],
    outcome: {
      status: 'failed',
      score: 0.3,
      note: sentinel
    },
    source: 'probe:seeded-memory'
  }
  await writeFile(memoryGraphPath, `${JSON.stringify(entry)}\n`, 'utf8')
}

async function createIsolatedClaudeConfigDir(configDir: string): Promise<string> {
  await mkdir(configDir, { recursive: true })
  await mkdir(join(configDir, 'home', 'AppData', 'Roaming'), { recursive: true })
  await mkdir(join(configDir, 'home', 'AppData', 'Local', 'Temp'), { recursive: true })
  await mkdir(join(configDir, 'home', '.config'), { recursive: true })
  await mkdir(join(configDir, 'home', '.cache'), { recursive: true })
  await mkdir(join(configDir, 'home', '.local', 'state'), { recursive: true })
  await mkdir(join(configDir, 'home', 'tmp'), { recursive: true })
  await mkdir(join(configDir, 'plugins', 'cache'), { recursive: true })
  await mkdir(join(configDir, 'skills'), { recursive: true })
  await mkdir(join(configDir, 'commands'), { recursive: true })
  await mkdir(join(configDir, 'agents'), { recursive: true })
  await mkdir(join(configDir, 'output-styles'), { recursive: true })

  const sourceSettingsPath = join(
    process.env.USERPROFILE ?? process.env.HOME ?? '',
    '.claude',
    'settings.json'
  )
  const sourceSettings = parseJsonObject(await readFile(sourceSettingsPath, 'utf8').catch(() => '')) ?? {}
  const envSettings = isRecord(sourceSettings.env) ? sourceSettings.env : {}
  const minimalSettings = {
    env: pickAllowedEnvironment(
      Object.fromEntries(
        Object.entries(envSettings).filter(([, value]) => typeof value === 'string')
      ) as Record<string, string>
    ),
    hooks: {},
    enabledPlugins: {},
    effortLevel: 'medium',
    skipDangerousModePermissionPrompt: true
  }

  await writeFile(
    join(configDir, 'settings.json'),
    `${JSON.stringify(minimalSettings, null, 2)}\n`,
    'utf8'
  )
  await writeFile(
    join(configDir, 'plugins', 'installed_plugins.json'),
    `${JSON.stringify({ version: 2, plugins: {} }, null, 2)}\n`,
    'utf8'
  )

  return configDir
}

async function runClaudeHeadless(
  command: ProviderCommand,
  prompt: string,
  debugFilePath: string,
  extraEnv: Record<string, string>,
  toolPolicy: HeadlessToolPolicy
): Promise<{
  command: ProviderCommand
  stdout: string
  stderr: string
  debugFilePath: string
}> {
  const args = [
    ...command.args,
    '-p',
    prompt,
    '--setting-sources',
    'user,project',
    '--output-format',
    'json',
    '--permission-mode',
    'bypassPermissions',
    '--disable-slash-commands',
    '--debug-file',
    debugFilePath,
    toolPolicy.flag,
    toolPolicy.value
  ]

  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  const invocation = resolveHeadlessInvocation({
    command: command.command,
    args,
    cwd: command.cwd,
    env: extraEnv
  })

  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      shell: false,
      windowsHide: true
    })
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Timed out waiting for Claude headless run. Debug file: ${debugFilePath}`))
    }, HEADLESS_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(chunk)
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk)
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      const stdout = stdoutChunks.join('')
      const stderr = stderrChunks.join('')
      if (code !== 0) {
        reject(new Error(
          `Claude exited with code ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}\nDebug file: ${debugFilePath}`
        ))
        return
      }
      const parsed = parseJsonObject(stdout)
      if (parsed && parsed.is_error === true) {
        reject(new Error(`Claude returned an error result.\nstdout:\n${stdout}\nstderr:\n${stderr}\nDebug file: ${debugFilePath}`))
        return
      }
      resolve()
    })
  })

  return {
    command: invocation,
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    debugFilePath
  }
}

function resolveHeadlessInvocation(command: ProviderCommand): ProviderCommand {
  if (process.platform === 'win32' && (
    requiresWindowsShellWrap(command.command)
    || isExtensionlessWindowsCommand(command.command)
  )) {
    return wrapCommandForShell(process.env.COMSPEC ?? 'cmd.exe', command)
  }
  return command
}

function requiresWindowsShellWrap(commandPath: string): boolean {
  const normalized = commandPath.trim().toLowerCase()
  return normalized.endsWith('.cmd')
    || normalized.endsWith('.bat')
    || normalized.endsWith('.ps1')
}

function isExtensionlessWindowsCommand(commandPath: string): boolean {
  const trimmed = commandPath.trim()
  if (trimmed.length === 0) {
    return false
  }
  if (/[\\/]/.test(trimmed)) {
    return false
  }
  return !trimmed.includes('.')
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return null
  }
}

function parseInputTokens(stdout: string): number | null {
  const parsed = parseJsonObject(stdout)
  const usage = isRecord(parsed?.usage) ? parsed.usage : null
  return typeof usage?.input_tokens === 'number' ? usage.input_tokens : null
}

function parseStartupMemoryEcho(resultText: string): string | null {
  const match = resultText.match(/^StartupMemory:\s*(.+)$/m)
  return match?.[1]?.trim() || null
}

function createProviderContext(
  webhookPort: number,
  sessionSecret: string
): ProviderCommandContext {
  return {
    webhookPort,
    sessionSecret,
    providerPort: 0
  }
}

function toProviderTarget(projectId: string, workspaceDir: string, session: SessionSummary) {
  if (!session.externalSessionId) {
    throw new Error(`Session ${session.id} is missing an external Claude session id.`)
  }

  return {
    session_id: session.id,
    project_id: projectId,
    path: workspaceDir,
    title: session.title,
    type: 'claude-code' as const,
    external_session_id: session.externalSessionId
  }
}

function summarizeLatestMemoryEntry(entries: unknown[]): MemoryEntrySummary | null {
  const last = entries.at(-1)
  if (!isRecord(last)) {
    return null
  }
  const outcome = isRecord(last.outcome) ? last.outcome : null
  const signals = Array.isArray(last.signals) ? last.signals.filter((value): value is string => typeof value === 'string') : []
  return {
    status: typeof outcome?.status === 'string' ? outcome.status : null,
    score: typeof outcome?.score === 'number' ? outcome.score : null,
    signals,
    note: typeof outcome?.note === 'string' ? outcome.note : null
  }
}

function summarizeScenario(scenario: ScenarioReport) {
  return {
    workspaceDir: scenario.workspaceDir,
    memoryGraphPath: scenario.memoryGraphPath,
    probeSentinel: scenario.probeSentinel,
    memoryEntries: scenario.memoryGraphEntries.length,
    latestMemoryEntry: scenario.latestMemoryEntry,
    runs: scenario.runs.map((run) => ({
      label: run.label,
      failed: run.failed ?? false,
      inputTokens: run.inputTokens,
      choice: run.scoring.choice,
      reason: run.scoring.reason,
      resultText: run.scoring.resultText,
      tools: run.scoring.transcriptToolNames,
      bash: run.scoring.transcriptBashCommands,
      modifiedFiles: run.scoring.modifiedFiles,
      notifications: run.notifications.map((entry) => `${entry.kind}:${entry.status}`)
    }))
  }
}

function hasRecallNotification(run: RunReport | undefined): boolean {
  return Boolean(run?.notifications.some((notification) => notification.kind === 'recall'))
}

function resolveClaudeExecutable(): string {
  const configured = process.env.CLAUDE_CLI_PATH?.trim()
  if (configured) {
    return configured
  }

  const lookup = process.platform === 'win32'
    ? spawnSync('where', ['claude'], { encoding: 'utf8', shell: false })
    : spawnSync('which', ['claude'], { encoding: 'utf8', shell: false })
  if (lookup.status === 0) {
    const first = lookup.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    if (first) {
      return first
    }
  }

  throw new Error('Claude CLI executable was not found. Set CLAUDE_CLI_PATH to continue.')
}

function buildVisibilityProbeSentinel(baseDir: string): string {
  return `SESSION_START_SENTINEL=${basename(baseDir).toUpperCase()}_${randomUUID().replace(/-/g, '').toUpperCase()}`
}

function resolveGitExecutable(): string {
  const configured = process.env.GIT_EXE_PATH?.trim()
  if (configured) {
    return configured
  }

  const candidates = process.platform === 'win32'
    ? [
      'git.exe',
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'git.exe'),
      'D:\\ProgramFiles\\Git\\cmd\\git.exe',
      'D:\\ProgramFiles\\Git\\mingw64\\bin\\git.exe'
    ]
    : [
      'git'
    ]
  const filteredCandidates = candidates.filter((value): value is string => Boolean(value))

  for (const candidate of filteredCandidates) {
    const result = spawnSync(candidate, ['--version'], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true
    })
    if (!result.error && result.status === 0) {
      return candidate
    }
  }

  throw new Error('Git executable was not found. Set GIT_EXE_PATH to continue.')
}

function resolveRepoRoot(startDir: string): string {
  let current = startDir
  while (true) {
    const packageJsonPath = join(current, 'package.json')
    if (existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string }
        if (parsed.name === 'stoa') {
          return current
        }
      } catch {
        // Ignore invalid package.json while walking upward.
      }
    }

    const parent = dirname(current)
    if (parent === current) {
      throw new Error(
        `Failed to locate the Stoa repo root from ${startDir}. Run this script from inside the repository or set STOA_EXPERIMENT_TEMP_ROOT explicitly.`
      )
    }
    current = parent
  }
}

function runChecked(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}\nerror:\n${result.error?.message ?? '(none)'}\nstdout:\n${result.stdout ?? ''}\nstderr:\n${result.stderr ?? ''}`
    )
  }
}

async function readJsonl(filePath: string): Promise<unknown[]> {
  const content = await readFile(filePath, 'utf8').catch(() => '')
  if (!content.trim()) {
    return []
  }
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown)
}

function extractCommandText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  if (!isRecord(value)) {
    return null
  }
  const command = value.command
  return typeof command === 'string' && command.trim().length > 0 ? command : null
}

function extractTouchedPaths(toolName: string, input: unknown): string[] {
  if (toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'MultiEdit') {
    return []
  }
  if (!isRecord(input)) {
    return []
  }

  const paths: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (!/path|file/i.test(key)) {
      continue
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      paths.push(value)
      continue
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string' && entry.trim().length > 0) {
          paths.push(entry)
        }
      }
    }
  }
  return paths
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function trim(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength)}...<trimmed>`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
