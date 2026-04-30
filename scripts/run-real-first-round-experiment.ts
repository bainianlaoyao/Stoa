import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectSessionManager } from '../src/core/project-session-manager'
import { createMemoryRuntimeHost } from '../src/core/memory/runtime-host'
import { RuntimeStateStore } from '../src/core/memory/runtime-state-store'
import { detectProvider, detectShell } from '../src/core/settings-detector'
import { SessionEventBridge } from '../src/main/session-event-bridge'
import { createClaudeCodeProvider } from '../src/extensions/providers/claude-code-provider'
import { DEFAULT_SETTINGS, type ProviderCommand, type ProviderCommandContext } from '../src/shared/project-session'

const HIDDEN_TEAM_COMMAND = 'uv pip install requests'
const HIDDEN_TEAM_RULE = 'Use uv instead of pip for Python environments and package installation in this repository.'
const SESSION1_COMMAND_FILE = '.python-local-install-command.txt'
const SESSION2_COMMAND_FILE = '.python-local-install-command.session2.txt'
const DISALLOWED_WORKSPACE_ARTIFACTS = ['uv.lock', '.venv', 'requirements.txt', 'Pipfile', 'poetry.lock'] as const
const HEADLESS_TIMEOUT_MS = 15 * 60 * 1000
const JOB_TIMEOUT_MS = 5 * 60 * 1000
const SEALED_TURN_TIMEOUT_MS = 30 * 1000

type ScenarioLabel = 'memory-off' | 'memory-on'
type CommandPreference = 'uv' | 'pip' | 'unknown'

interface InvocationRecord {
  index: number
  label: string
  sessionId: string
  providerSessionId: string
  command: string
  args: string[]
  resultSessionId: string | null
  stdoutPreview: string
  outputFilePath: string
  outputValue: string
}

interface ScenarioResult {
  label: ScenarioLabel
  memoryEnabled: boolean
  repoRoot: string
  artifactsDir: string
  commands: {
    baseline: string
    session1Rule: string
    session2Recall: string
  }
  preferences: {
    baseline: CommandPreference
    session1Rule: CommandPreference
    session2Recall: CommandPreference
  }
  assertions: {
    baselineAvoidedUv: boolean
    session1CapturedRule: boolean
    session2PreferredUv: boolean
    disallowedArtifactsAbsent: boolean
  }
  runtimeState: {
    session1Jobs: Awaited<ReturnType<RuntimeStateStore['listJobsForSession']>> | null
    session2Jobs: Awaited<ReturnType<RuntimeStateStore['listJobsForSession']>> | null
    session1TurnIds: string[]
    session2TurnIds: string[]
  }
  invocations: InvocationRecord[]
  notes: {
    hiddenTeamRule: string
    hiddenTeamCommand: string
    disallowedWorkspaceArtifacts: readonly string[]
    prompts: {
      baseline: string
      session1Rule: string
      session2Recall: string
    }
    debugLogs: string[]
  }
}

let lastBaseDir: string | null = null
let lastOutputFilePath: string | null = null

async function main(): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), 'stoa-hidden-rule-real-'))
  lastBaseDir = baseDir
  const providerPath = process.env.CLAUDE_CLI_PATH?.trim() || undefined

  const memoryOff = await runScenario({
    label: 'memory-off',
    baseDir,
    providerPath
  })
  const memoryOn = await runScenario({
    label: 'memory-on',
    baseDir,
    providerPath
  })
  const reportPath = join(baseDir, 'experiment-report.json')
  const report = {
    ok: memoryOn.preferences.session2Recall === 'uv'
      && memoryOff.preferences.session2Recall !== 'uv',
    baseDir,
    reportPath,
    hiddenTeamRule: HIDDEN_TEAM_RULE,
    hiddenTeamCommand: HIDDEN_TEAM_COMMAND,
    verdict: {
      memoryOnPreferredUv: memoryOn.preferences.session2Recall === 'uv',
      memoryOffPreferredUv: memoryOff.preferences.session2Recall === 'uv'
    },
    scenarios: [memoryOff, memoryOn]
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  if (memoryOn.preferences.session2Recall !== 'uv') {
    throw new Error(
      `Memory-on scenario did not recover the repository-specific uv preference.\nExpected preference: uv\nActual command: ${memoryOn.commands.session2Recall}\nReport: ${reportPath}`
    )
  }
  if (memoryOff.preferences.session2Recall === 'uv') {
    throw new Error(
      `Memory-off scenario unexpectedly preferred uv.\nThis means the experiment still leaked the repository preference outside the memory system.\nActual: ${memoryOff.commands.session2Recall}\nReport: ${reportPath}`
    )
  }

  console.log(JSON.stringify(report, null, 2))
}

async function runScenario(input: {
  label: ScenarioLabel
  baseDir: string
  providerPath?: string
}): Promise<ScenarioResult> {
  const scenarioDir = join(input.baseDir, input.label)
  const repoRoot = join(scenarioDir, 'project')
  const artifactsDir = join(scenarioDir, 'artifacts')
  const globalStatePath = join(scenarioDir, 'global.json')
  const memoryEnabled = input.label === 'memory-on'
  const debugLogs = [
    join(artifactsDir, 'claude-session1-baseline.debug.log'),
    join(artifactsDir, 'claude-session1-rule.debug.log'),
    join(artifactsDir, 'claude-session2-recall.debug.log')
  ]

  await mkdir(repoRoot, { recursive: true })
  await mkdir(artifactsDir, { recursive: true })
  await seedExperimentRepo(repoRoot)

  runChecked('git', ['init'], repoRoot)
  runChecked('git', ['config', 'user.name', 'Stoa Test'], repoRoot)
  runChecked('git', ['config', 'user.email', 'stoa@example.com'], repoRoot)
  runChecked('git', ['add', '.'], repoRoot)
  runChecked('git', ['commit', '-m', 'init'], repoRoot)

  const manager = await ProjectSessionManager.create({
    webhookPort: null,
    globalStatePath
  })
  const project = await manager.createProject({
    path: repoRoot,
    name: `real-claude-memory-${input.label}`,
    defaultSessionType: 'claude-code'
  })

  const memoryRuntimeHost = memoryEnabled
    ? await createMemoryRuntimeHost({
      settings: {
        ...DEFAULT_SETTINGS,
        evolverInferenceProvider: 'claude-code',
        evolverExecutionMode: 'workspace-shell',
        providers: input.providerPath ? { 'claude-code': input.providerPath } : {}
      },
      cwd: process.cwd(),
      detectShell,
      detectProvider
    })
    : null

  if (memoryEnabled && (
    memoryRuntimeHost?.availability !== 'full'
    || !memoryRuntimeHost.turnMaintenanceRunner
  )) {
    throw new Error(
      `Memory runtime host is unavailable for ${input.label}: ${memoryRuntimeHost?.diagnostics.join(' | ') ?? 'unknown'}`
    )
  }

  const bridge = new SessionEventBridge(
    manager,
    {
      applyProviderStatePatch: async (patch) => {
        await manager.applySessionStatePatch(patch)
      }
    },
    undefined,
    memoryEnabled && memoryRuntimeHost?.turnMaintenanceRunner
      ? {
        turnMaintenanceRunner: memoryRuntimeHost.turnMaintenanceRunner
      }
      : {}
  )

  const provider = createClaudeCodeProvider()
  const invocations: InvocationRecord[] = []

  const baselineOutputPath = join(repoRoot, SESSION1_COMMAND_FILE)
  const ruleOutputPath = join(repoRoot, SESSION1_COMMAND_FILE)
  const recallOutputPath = join(repoRoot, SESSION2_COMMAND_FILE)
  const baselinePrompt = buildBaselinePrompt(baselineOutputPath)
  const session1RulePrompt = buildRulePrompt(ruleOutputPath)
  const session2RecallPrompt = buildRecallPrompt(recallOutputPath)

  try {
    const webhookPort = await bridge.start()

    const session1 = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: `${input.label} Session 1`
    })
    const session1Secret = bridge.issueSessionSecret(session1.id)
    const session1Context = createProviderContext(webhookPort, session1Secret, input.providerPath)
    const session1Target = toProviderTarget(project.id, repoRoot, session1)

    await provider.installSidecar(session1Target, session1Context)

    const baselineResult = await invokeClaudeHeadless(
      await provider.buildStartCommand(session1Target, session1Context),
      baselinePrompt,
      debugLogs[0]
    )
    const baselineCommand = await readOutputFile(baselineOutputPath)
    const baselinePreference = classifyCommandPreference(baselineCommand)
    lastOutputFilePath = baselineOutputPath
    if (baselinePreference === 'uv') {
      throw new Error(
        `Baseline invocation unexpectedly preferred uv before any repository-specific memory existed.\nOutput: ${baselineCommand}\nStdout: ${baselineResult.stdout}`
      )
    }
    assertDisallowedWorkspaceArtifacts(repoRoot)
    invocations.push(buildInvocationRecord(1, 'session1:baseline', session1, baselineResult.command, baselineResult, baselineOutputPath, baselineCommand))

    const ruleResult = await invokeClaudeHeadless(
      await provider.buildResumeCommand(session1Target, session1.externalSessionId!, session1Context),
      session1RulePrompt,
      debugLogs[1]
    )
    const session1RuleCommand = await readOutputFile(ruleOutputPath)
    const session1RulePreference = classifyCommandPreference(session1RuleCommand)
    lastOutputFilePath = ruleOutputPath
    if (session1RuleCommand !== HIDDEN_TEAM_COMMAND) {
      throw new Error(
        `Session 1 did not capture the hidden team command exactly.\nExpected: ${HIDDEN_TEAM_COMMAND}\nActual: ${session1RuleCommand}\nStdout: ${ruleResult.stdout}`
      )
    }
    if (session1RulePreference !== 'uv') {
      throw new Error(`Session 1 rule command must be uv-based. Actual: ${session1RuleCommand}`)
    }
    assertDisallowedWorkspaceArtifacts(repoRoot)
    invocations.push(buildInvocationRecord(2, 'session1:rule', session1, ruleResult.command, ruleResult, ruleOutputPath, session1RuleCommand))

    const runtimeStateStore = new RuntimeStateStore(repoRoot)
    const session1Jobs = memoryEnabled
      ? await waitForCompletedJobs(runtimeStateStore, sessionKey(project.id, session1.id), 2)
      : null
    const session1Turns = await waitForSealedTurns(runtimeStateStore, sessionKey(project.id, session1.id), 2)

    const session2 = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: `${input.label} Session 2`
    })
    const session2Secret = bridge.issueSessionSecret(session2.id)
    const session2Context = createProviderContext(webhookPort, session2Secret, input.providerPath)
    const session2Target = toProviderTarget(project.id, repoRoot, session2)

    await provider.installSidecar(session2Target, session2Context)

    const recallResult = await invokeClaudeHeadless(
      await provider.buildStartCommand(session2Target, session2Context),
      session2RecallPrompt,
      debugLogs[2]
    )
    const session2RecallCommand = await readOutputFile(recallOutputPath)
    const session2RecallPreference = classifyCommandPreference(session2RecallCommand)
    lastOutputFilePath = recallOutputPath
    assertDisallowedWorkspaceArtifacts(repoRoot)
    invocations.push(buildInvocationRecord(3, 'session2:recall', session2, recallResult.command, recallResult, recallOutputPath, session2RecallCommand))

    const session2Jobs = memoryEnabled
      ? await waitForCompletedJobs(runtimeStateStore, sessionKey(project.id, session2.id), 1)
      : null
    const session2Turns = await waitForSealedTurns(runtimeStateStore, sessionKey(project.id, session2.id), 1)

    return {
      label: input.label,
      memoryEnabled,
      repoRoot,
      artifactsDir,
      commands: {
        baseline: baselineCommand,
        session1Rule: session1RuleCommand,
        session2Recall: session2RecallCommand
      },
      preferences: {
        baseline: baselinePreference,
        session1Rule: session1RulePreference,
        session2Recall: session2RecallPreference
      },
      assertions: {
        baselineAvoidedUv: baselinePreference !== 'uv',
        session1CapturedRule: session1RuleCommand === HIDDEN_TEAM_COMMAND,
        session2PreferredUv: session2RecallPreference === 'uv',
        disallowedArtifactsAbsent: true
      },
      runtimeState: {
        session1Jobs,
        session2Jobs,
        session1TurnIds: session1Turns.map((turn) => turn.turnId),
        session2TurnIds: session2Turns.map((turn) => turn.turnId)
      },
      invocations,
      notes: {
        hiddenTeamRule: HIDDEN_TEAM_RULE,
        hiddenTeamCommand: HIDDEN_TEAM_COMMAND,
        disallowedWorkspaceArtifacts: DISALLOWED_WORKSPACE_ARTIFACTS,
        prompts: {
          baseline: baselinePrompt,
          session1Rule: session1RulePrompt,
          session2Recall: session2RecallPrompt
        },
        debugLogs
      }
    }
  } finally {
    await bridge.stop()
  }
}

async function seedExperimentRepo(repoRoot: string): Promise<void> {
  await writeFile(join(repoRoot, 'pyproject.toml'), [
    '[project]',
    'name = "demo-python-project"',
    'version = "0.1.0"',
    'description = "Real Claude hidden-rule memory probe"',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(repoRoot, 'README.md'), [
    '# Demo Python Project',
    '',
    'This repository contains a tiny Python app.',
    'The experiment updates command note files inside the repository.',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(repoRoot, 'app.py'), [
    'def greet() -> str:',
    '    return "hello"',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(repoRoot, SESSION1_COMMAND_FILE), 'PENDING\n', 'utf8')
  await writeFile(join(repoRoot, SESSION2_COMMAND_FILE), 'PENDING\n', 'utf8')
}

function buildBaselinePrompt(outputFilePath: string): string {
  return [
    'A teammate asks what one-line command you would normally use to install the Python package "requests" into the current environment for a quick local check in this repository.',
    'Do not inspect files or hidden folders.',
    'Do not run the install command.',
    'Use a direct file write only.',
    `Overwrite the file at ${formatPromptPath(outputFilePath)} with only the exact command you would personally choose.`,
    'Do not add explanation.'
  ].join(' ')
}

function buildRulePrompt(outputFilePath: string): string {
  return [
    'Repository-specific house rule not written anywhere in the repo:',
    HIDDEN_TEAM_RULE,
    `For this task, always use exactly "${HIDDEN_TEAM_COMMAND}".`,
    'This private rule overrides your normal preference.',
    'Do not inspect files or hidden folders.',
    'Do not run the install command.',
    'Use a direct file write only.',
    `Overwrite the file at ${formatPromptPath(outputFilePath)} with only that exact command.`,
    'Do not add explanation.'
  ].join(' ')
}

function buildRecallPrompt(outputFilePath: string): string {
  return [
    'A teammate asks what one-line command should be used in this repository to install the Python package "requests" into the current environment for a quick local check.',
    'Do not inspect files or hidden folders.',
    'Do not run the install command.',
    'Use a direct file write only.',
    `Overwrite the file at ${formatPromptPath(outputFilePath)} with only the exact command you would use.`,
    'Do not add explanation.'
  ].join(' ')
}

function classifyCommandPreference(command: string): CommandPreference {
  const normalized = command.trim().toLowerCase()
  if (!normalized) {
    return 'unknown'
  }
  if (/\buv\b/.test(normalized)) {
    return 'uv'
  }
  if (/\bpython(?:\d+(?:\.\d+)*)?\b\s+-m\s+pip\b/.test(normalized) || /\bpip(?:\d+(?:\.\d+)*)?\b/.test(normalized)) {
    return 'pip'
  }
  return 'unknown'
}

function formatPromptPath(filePath: string): string {
  return `"${filePath.replaceAll('\\', '/')}"` 
}

function assertDisallowedWorkspaceArtifacts(repoRoot: string): void {
  for (const relativePath of DISALLOWED_WORKSPACE_ARTIFACTS) {
    const absolutePath = join(repoRoot, relativePath)
    if (existsSync(absolutePath)) {
      throw new Error(`Workspace pollution detected: ${absolutePath}`)
    }
  }
}

function createProviderContext(
  webhookPort: number,
  sessionSecret: string,
  providerPath?: string
): ProviderCommandContext {
  return {
    webhookPort,
    sessionSecret,
    providerPort: 0,
    ...(providerPath ? { providerPath } : {})
  }
}

function toProviderTarget(
  projectId: string,
  repoRoot: string,
  session: Awaited<ReturnType<ProjectSessionManager['createSession']>>
): {
  session_id: string
  project_id: string
  path: string
  title: string
  type: 'claude-code'
  external_session_id: string
} {
  if (!session.externalSessionId) {
    throw new Error(`Session ${session.id} is missing an external Claude session id.`)
  }

  return {
    session_id: session.id,
    project_id: projectId,
    path: repoRoot,
    title: session.title,
    type: 'claude-code',
    external_session_id: session.externalSessionId
  }
}

async function invokeClaudeHeadless(command: ProviderCommand, prompt: string): Promise<{
  command: ProviderCommand
  stdout: string
  parsed: Record<string, unknown> | null
  debugFilePath: string
}>;
async function invokeClaudeHeadless(
  command: ProviderCommand,
  prompt: string,
  debugFilePath: string
): Promise<{
  command: ProviderCommand
  stdout: string
  parsed: Record<string, unknown> | null
  debugFilePath: string
}> {
  const headlessArgs = [
    ...command.args,
    '-p',
    prompt,
    '--output-format',
    'json',
    '--permission-mode',
    'bypassPermissions',
    '--debug-file',
    debugFilePath
  ]
  const output = await runCheckedAsync(command.command, headlessArgs, command.cwd, {
    env: command.env,
    timeoutMs: HEADLESS_TIMEOUT_MS,
    shell: false
  })

  const parsed = parseJsonTail(output.stdout)
  return {
    command: {
      ...command,
      args: headlessArgs
    },
    stdout: output.stdout,
    parsed: isRecord(parsed) ? parsed : null,
    debugFilePath
  }
}

function buildInvocationRecord(
  index: number,
  label: string,
  session: Awaited<ReturnType<ProjectSessionManager['createSession']>>,
  command: ProviderCommand,
  result: {
    command: ProviderCommand
    stdout: string
    parsed: Record<string, unknown> | null
  },
  outputFilePath: string,
  outputValue: string
): InvocationRecord {
  return {
    index,
    label,
    sessionId: session.id,
    providerSessionId: session.externalSessionId ?? 'unknown',
    command: command.command,
    args: command.args,
    resultSessionId: typeof result.parsed?.session_id === 'string' ? result.parsed.session_id : null,
    stdoutPreview: trim(result.stdout, 600),
    outputFilePath,
    outputValue
  }
}

async function waitForCompletedJobs(
  store: RuntimeStateStore,
  key: string,
  expectedDoneCount: number
): Promise<Awaited<ReturnType<RuntimeStateStore['listJobsForSession']>>> {
  const startedAt = Date.now()

  while (true) {
    const jobs = await store.listJobsForSession(key)
    const doneJobs = jobs.filter(job => job.state === 'done')
    const failedJobs = jobs.filter(job => job.state === 'failed')

    if (failedJobs.length > 0) {
      throw new Error(`Evolver processTurn job failed: ${JSON.stringify(failedJobs, null, 2)}`)
    }
    if (doneJobs.length >= expectedDoneCount) {
      return jobs
    }
    if (Date.now() - startedAt > JOB_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for ${expectedDoneCount} completed Evolver jobs. Jobs: ${JSON.stringify(jobs, null, 2)}`)
    }

    await sleep(500)
  }
}

async function waitForSealedTurns(
  store: RuntimeStateStore,
  key: string,
  expectedCount: number
): Promise<Array<{ turnId: string; sealedAt: string }>> {
  const startedAt = Date.now()

  while (true) {
    const runtimeState = await store.read()
    const turns = runtimeState.sealedTurns
      .filter(turn => turn.sessionKey === key)
      .sort((left, right) => {
        if (left.sealedAt !== right.sealedAt) {
          return left.sealedAt.localeCompare(right.sealedAt)
        }
        return left.turnId.localeCompare(right.turnId)
      })
      .map(turn => ({
        turnId: turn.turnId,
        sealedAt: turn.sealedAt
      }))

    if (turns.length >= expectedCount) {
      return turns
    }
    if (Date.now() - startedAt > SEALED_TURN_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for ${expectedCount} sealed turns. Turns: ${JSON.stringify(turns, null, 2)}`)
    }

    await sleep(250)
  }
}

async function readOutputFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf8').catch(() => null)
  if (content === null) {
    throw new Error(`Claude did not create the output file at ${filePath}.`)
  }

  return content.trim()
}

function sessionKey(projectId: string, sessionId: string): string {
  return `${projectId}\n${sessionId}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function trim(value: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 3)}...`
}

function parseJsonTail(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const lines = trimmed.split(/\r?\n/)
    for (let index = 1; index < lines.length; index += 1) {
      const candidate = lines.slice(index).join('\n').trim()
      if (!candidate) {
        continue
      }

      try {
        return JSON.parse(candidate) as unknown
      } catch {
        // Keep scanning.
      }
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function runChecked(
  command: string,
  args: string[],
  cwd: string,
  options?: {
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    shell?: boolean
  }
): {
  status: number
  stdout: string
  stderr: string
} {
  const result = spawnSync(command, args, {
    cwd,
    env: options?.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options?.timeoutMs ?? 120_000,
    maxBuffer: 50 * 1024 * 1024,
    shell: options?.shell ?? false
  })

  if (result.error) {
    throw result.error
  }

  const normalized = {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }

  if (normalized.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      `cwd=${cwd}`,
      `exitCode=${normalized.status}`,
      `stdout=${normalized.stdout}`,
      `stderr=${normalized.stderr}`
    ].join('\n'))
  }

  return normalized
}

async function runCheckedAsync(
  command: string,
  args: string[],
  cwd: string,
  options?: {
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    shell?: boolean
  }
): Promise<{
  status: number
  stdout: string
  stderr: string
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: options?.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: options?.shell ?? false
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      child.kill()
      reject(new Error(`Command timed out: ${command} ${args.join(' ')}`))
    }, options?.timeoutMs ?? 120_000)

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      reject(error)
    })

    child.on('close', (code) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      const normalized = {
        status: code ?? 1,
        stdout,
        stderr
      }

      if (normalized.status !== 0) {
        reject(new Error([
          `Command failed: ${command} ${args.join(' ')}`,
          `cwd=${cwd}`,
          `exitCode=${normalized.status}`,
          `stdout=${normalized.stdout}`,
          `stderr=${normalized.stderr}`
        ].join('\n')))
        return
      }

      resolve(normalized)
    })
  })
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  const outputPreview = lastOutputFilePath && existsSync(lastOutputFilePath)
    ? `\nlastOutputFile=${lastOutputFilePath}\nlastOutputValue=${(await readFile(lastOutputFilePath, 'utf8')).trim()}`
    : ''
  const baseDirLine = lastBaseDir ? `\nbaseDir=${lastBaseDir}` : ''
  console.error(`${message}${outputPreview}${baseDirLine}`)
  process.exitCode = 1
})
