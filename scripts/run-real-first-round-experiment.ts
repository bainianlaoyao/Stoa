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
import type { TurnMaintenancePhaseEvent } from '../src/core/memory/turn-maintenance-runner'

const HIDDEN_VERIFY_COMMAND =
  'npx vitest run src/core/memory/runtime-host.test.ts src/core/memory/turn-maintenance-runner.test.ts src/main/session-event-bridge.test.ts'

const HIDDEN_RULE_DESCRIPTION =
  'Before making any changes to the memory runtime, always run the targeted verification suite first to catch regressions in the memory subsystem.'

const SESSION1_ANSWER_FILE = '.memory-runtime-verify-command.txt'
const SESSION2_ANSWER_FILE = '.memory-runtime-verify-command.session2.txt'
const HEADLESS_TIMEOUT_MS = 15 * 60 * 1000
const JOB_TIMEOUT_MS = 5 * 60 * 1000
const SEALED_TURN_TIMEOUT_MS = 30 * 1000

type ScenarioLabel = 'memory-off' | 'memory-on'

interface PhaseEventRecord {
  phase: string
  status: string
  jobId: string
  turnId: string
  error?: string
}

interface ChainState {
  turnsSealed: number
  turnIds: string[]
  jobsCompleted: number
  jobIds: string[]
  processTurnTriggered: boolean
  phasesObserved: PhaseEventRecord[]
  chainStoppedAt: string
}

interface ScenarioResult {
  label: ScenarioLabel
  memoryEnabled: boolean
  repoRoot: string
  artifactsDir: string
  commands: {
    session1Answer: string
    session2Answer: string
  }
  assertions: {
    session1CapturedRule: boolean
    session2RecalledRule: boolean
  }
  chainState: {
    session1: ChainState | null
    session2: ChainState | null
  }
  invocations: InvocationRecord[]
  notes: {
    hiddenRule: string
    hiddenCommand: string
    prompts: {
      session1: string
      session2: string
    }
    debugLogs: string[]
  }
}

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

let lastBaseDir: string | null = null
let lastOutputFilePath: string | null = null

async function main(): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), 'stoa-memory-verify-'))
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

  const session2RecallMatch = checkAnswerMatch(memoryOn.commands.session2Answer)
  const reportPath = join(baseDir, 'experiment-report.json')
  const report = {
    ok: session2RecallMatch && memoryOn.assertions.session2RecalledRule,
    baseDir,
    reportPath,
    experimentTopic: 'Memory runtime pre-change verification command preference',
    hiddenRule: HIDDEN_RULE_DESCRIPTION,
    hiddenCommand: HIDDEN_VERIFY_COMMAND,
    verdict: {
      memoryOnSession2Recall: memoryOn.assertions.session2RecalledRule,
      memoryOffSession2Recall: memoryOff.assertions.session2RecalledRule,
      session2RecallMatch
    },
    chainState: {
      memoryOn: {
        session1: formatChainState(memoryOn.chainState.session1),
        session2: formatChainState(memoryOn.chainState.session2)
      },
      memoryOff: {
        session1: formatChainState(memoryOff.chainState.session1),
        session2: formatChainState(memoryOff.chainState.session2)
      }
    },
    scenarios: [memoryOff, memoryOn]
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
}

function formatChainState(chain: ChainState | null): string {
  if (!chain) {
    return 'no-chain (memory-off)'
  }
  return [
    `turnsSealed=${chain.turnsSealed}`,
    `jobsCompleted=${chain.jobsCompleted}`,
    `processTurnTriggered=${chain.processTurnTriggered}`,
    `phasesObserved=${chain.phasesObserved.length}`,
    `chainStoppedAt=${chain.chainStoppedAt}`
  ].join(' | ')
}

function checkAnswerMatch(answer: string): boolean {
  const normalized = answer.trim().toLowerCase()
  if (!normalized) {
    return false
  }
  return normalized.includes('runtime-host.test.ts')
    && normalized.includes('turn-maintenance-runner.test.ts')
    && normalized.includes('session-event-bridge.test.ts')
    && normalized.includes('npx vitest run')
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
    join(artifactsDir, 'claude-session1-rule.debug.log'),
    join(artifactsDir, 'claude-session2-recall.debug.log')
  ]
  const phaseEvents: PhaseEventRecord[] = []

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
    name: `memory-verify-${input.label}`,
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
      detectProvider,
      onTurnPhaseEvent: (event: TurnMaintenancePhaseEvent) => {
        phaseEvents.push({
          phase: event.phase,
          status: event.status,
          jobId: event.jobId,
          turnId: event.turnId,
          error: event.error
        })
      }
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
  const runtimeStateStore = new RuntimeStateStore(repoRoot)

  const session1OutputPath = join(repoRoot, SESSION1_ANSWER_FILE)
  const session2OutputPath = join(repoRoot, SESSION2_ANSWER_FILE)
  const session1Prompt = buildSession1Prompt(session1OutputPath)
  const session2Prompt = buildSession2Prompt(session2OutputPath)

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

    const session1Key = sessionKey(project.id, session1.id)

    const ruleResult = await invokeClaudeHeadless(
      await provider.buildStartCommand(session1Target, session1Context),
      session1Prompt,
      debugLogs[0]
    )
    const session1Answer = await readOutputFile(session1OutputPath)
    lastOutputFilePath = session1OutputPath
    if (session1Answer !== HIDDEN_VERIFY_COMMAND) {
      throw new Error(
        `Session 1 did not capture the hidden verify command exactly.\nExpected: ${HIDDEN_VERIFY_COMMAND}\nActual: ${session1Answer}\nStdout: ${ruleResult.stdout}`
      )
    }
    invocations.push(buildInvocationRecord(1, 'session1:rule', session1, ruleResult.command, ruleResult, session1OutputPath, session1Answer))

    const session1PhasesSnapshot = [...phaseEvents]
    const session1Chain = memoryEnabled
      ? await collectChainState(runtimeStateStore, session1Key, session1PhasesSnapshot, 1)
      : null

    if (memoryEnabled) {
      await waitForCompletedJobs(runtimeStateStore, session1Key, 1)
    }

    const session2 = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: `${input.label} Session 2`
    })
    const session2Secret = bridge.issueSessionSecret(session2.id)
    const session2Context = createProviderContext(webhookPort, session2Secret, input.providerPath)
    const session2Target = toProviderTarget(project.id, repoRoot, session2)

    await provider.installSidecar(session2Target, session2Context)

    const session2Key = sessionKey(project.id, session2.id)

    const recallResult = await invokeClaudeHeadless(
      await provider.buildStartCommand(session2Target, session2Context),
      session2Prompt,
      debugLogs[1]
    )
    const session2Answer = await readOutputFile(session2OutputPath)
    lastOutputFilePath = session2OutputPath
    const session2Recalled = checkAnswerMatch(session2Answer)
    invocations.push(buildInvocationRecord(2, 'session2:recall', session2, recallResult.command, recallResult, session2OutputPath, session2Answer))

    const session2PhasesSnapshot = phaseEvents.slice(session1PhasesSnapshot.length)
    const session2Chain = memoryEnabled
      ? await collectChainState(runtimeStateStore, session2Key, session2PhasesSnapshot, 1)
      : null

    return {
      label: input.label,
      memoryEnabled,
      repoRoot,
      artifactsDir,
      commands: {
        session1Answer,
        session2Answer
      },
      assertions: {
        session1CapturedRule: session1Answer === HIDDEN_VERIFY_COMMAND,
        session2RecalledRule: session2Recalled
      },
      chainState: {
        session1: session1Chain,
        session2: session2Chain
      },
      invocations,
      notes: {
        hiddenRule: HIDDEN_RULE_DESCRIPTION,
        hiddenCommand: HIDDEN_VERIFY_COMMAND,
        prompts: {
          session1: session1Prompt,
          session2: session2Prompt
        },
        debugLogs
      }
    }
  } finally {
    await bridge.stop()
  }
}

async function collectChainState(
  store: RuntimeStateStore,
  key: string,
  phases: PhaseEventRecord[],
  expectedTurnCount: number
): Promise<ChainState> {
  const turns = await waitForSealedTurns(store, key, expectedTurnCount)
  const jobs = await store.listJobsForSession(key)
  const doneJobs = jobs.filter(job => job.state === 'done')
  const processTurnTriggered = jobs.length > 0

  const relevantPhases = phases.filter(event =>
    turns.some(turn => turn.turnId === event.turnId)
  )

  let chainStoppedAt = 'end'
  if (relevantPhases.length === 0 && processTurnTriggered) {
    chainStoppedAt = 'processTurn-noop (all phases null — gateway is no-op)'
  } else if (relevantPhases.length > 0) {
    const lastPhase = relevantPhases[relevantPhases.length - 1]
    chainStoppedAt = lastPhase.status === 'failed'
      ? `phase-${lastPhase.phase}-failed`
      : `phase-${lastPhase.phase}-completed`
  }

  return {
    turnsSealed: turns.length,
    turnIds: turns.map(turn => turn.turnId),
    jobsCompleted: doneJobs.length,
    jobIds: jobs.map(job => job.jobId),
    processTurnTriggered,
    phasesObserved: relevantPhases,
    chainStoppedAt
  }
}

async function seedExperimentRepo(repoRoot: string): Promise<void> {
  await writeFile(
    join(repoRoot, 'package.json'),
    `${JSON.stringify({
      name: 'memory-verify-experiment',
      version: '0.1.0',
      description: 'Memory runtime verification experiment probe',
      scripts: { test: 'vitest run' },
      devDependencies: { vitest: '^3.0.0' }
    }, null, 2)}\n`,
    'utf8'
  )

  await writeFile(
    join(repoRoot, 'vitest.config.ts'),
    [
      'import { defineConfig } from "vitest/config";',
      'export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });',
      ''
    ].join('\n'),
    'utf8'
  )

  const testStub = (name: string): string => [
    'import { describe, it, expect } from "vitest";',
    '',
    `describe("${name}", () => {`,
    '  it("passes", () => {',
    '    expect(true).toBe(true);',
    '  });',
    '});',
    ''
  ].join('\n')

  await mkdir(join(repoRoot, 'src', 'core', 'memory'), { recursive: true })
  await mkdir(join(repoRoot, 'src', 'main'), { recursive: true })

  await writeFile(
    join(repoRoot, 'src', 'core', 'memory', 'runtime-host.test.ts'),
    testStub('runtime-host'),
    'utf8'
  )
  await writeFile(
    join(repoRoot, 'src', 'core', 'memory', 'turn-maintenance-runner.test.ts'),
    testStub('turn-maintenance-runner'),
    'utf8'
  )
  await writeFile(
    join(repoRoot, 'src', 'main', 'session-event-bridge.test.ts'),
    testStub('session-event-bridge'),
    'utf8'
  )

  await writeFile(join(repoRoot, SESSION1_ANSWER_FILE), 'PENDING\n', 'utf8')
  await writeFile(join(repoRoot, SESSION2_ANSWER_FILE), 'PENDING\n', 'utf8')
}

function buildSession1Prompt(outputFilePath: string): string {
  return [
    'Repository-specific house rule (not written anywhere in the repo):',
    HIDDEN_RULE_DESCRIPTION,
    `For this task, always use exactly: ${HIDDEN_VERIFY_COMMAND}`,
    'This private rule is specific to this repository and overrides any general knowledge.',
    'Do not inspect files or hidden folders.',
    'Do not run the command.',
    'Use a direct file write only.',
    `Overwrite the file at ${formatPromptPath(outputFilePath)} with only that exact command.`,
    'Do not add explanation.'
  ].join(' ')
}

function buildSession2Prompt(outputFilePath: string): string {
  return [
    'A teammate asks: What command should I run before making changes to the memory runtime in this repository?',
    'Do not inspect files or hidden folders.',
    'Do not run any command.',
    'Use a direct file write only.',
    `Overwrite the file at ${formatPromptPath(outputFilePath)} with only the exact command you would recommend.`,
    'Do not add explanation.'
  ].join(' ')
}

function formatPromptPath(filePath: string): string {
  return `"${filePath.replaceAll('\\', '/')}"`
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
      throw new Error(`Turn maintenance job failed: ${JSON.stringify(failedJobs, null, 2)}`)
    }
    if (doneJobs.length >= expectedDoneCount) {
      return jobs
    }
    if (Date.now() - startedAt > JOB_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for ${expectedDoneCount} completed jobs. Jobs: ${JSON.stringify(jobs, null, 2)}`)
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
