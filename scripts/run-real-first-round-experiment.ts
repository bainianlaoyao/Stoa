import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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

const COMMAND_FILE_NAME = '.python-install-command.txt'
const FIRST_PROMPT = [
  'Install the Python package "requests" for this repository using your normal default approach for a simple repo.',
  `After you finish, overwrite ${COMMAND_FILE_NAME} with only the exact shell command you chose.`,
  'Do not put any explanation in that file.'
].join(' ')
const SECOND_PROMPT = [
  `Update ${COMMAND_FILE_NAME} for this same repository.`,
  'Do not use pip-managed virtualenvs here.',
  'Use uv to manage the Python environment and package installation for this repository.',
  'Overwrite the file so it contains only the exact uv-based shell command you will use here.'
].join(' ')
const HEADLESS_TIMEOUT_MS = 15 * 60 * 1000
const JOB_TIMEOUT_MS = 5 * 60 * 1000
let lastRepoRoot: string | null = null
let lastBaseDir: string | null = null

async function main(): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), 'stoa-first-round-real-'))
  lastBaseDir = baseDir
  const repoRoot = join(baseDir, 'project')
  lastRepoRoot = repoRoot
  const globalStatePath = join(baseDir, 'global.json')
  const providerPath = process.env.CLAUDE_CLI_PATH?.trim() || undefined

  await mkdir(repoRoot, { recursive: true })
  await writeFile(join(repoRoot, 'pyproject.toml'), [
    '[project]',
    'name = "demo-python-project"',
    'version = "0.1.0"',
    'description = "Real Claude memory e2e probe"',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(repoRoot, 'README.md'), '# Demo Python Project\n', 'utf8')

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
    name: 'real-claude-memory-e2e',
    defaultSessionType: 'claude-code'
  })

  const memoryRuntimeHost = await createMemoryRuntimeHost({
    settings: {
      ...DEFAULT_SETTINGS,
      evolverInferenceProvider: 'claude-code',
      evolverExecutionMode: 'workspace-shell',
      providers: providerPath ? { 'claude-code': providerPath } : {}
    },
    cwd: process.cwd(),
    detectShell,
    detectProvider
  })

  if (
    memoryRuntimeHost.availability !== 'full'
    || !memoryRuntimeHost.evolverBridge
    || !memoryRuntimeHost.turnMaintenanceRunner
  ) {
    throw new Error(`Memory runtime host is unavailable: ${memoryRuntimeHost.diagnostics.join(' | ')}`)
  }

  const bridge = new SessionEventBridge(
    manager,
    {
      applyProviderStatePatch: async (patch) => {
        await manager.applySessionStatePatch(patch)
      }
    },
    undefined,
    {
      evolverBridge: memoryRuntimeHost.evolverBridge,
      turnMaintenanceRunner: memoryRuntimeHost.turnMaintenanceRunner
    }
  )

  const provider = createClaudeCodeProvider()
  const invocations: Array<{
    index: number
    label: string
    sessionId: string
    providerSessionId: string
    command: string
    args: string[]
    resultSessionId: string | null
    stdoutPreview: string
    commandFile: string
  }> = []

  try {
    const webhookPort = await bridge.start()

    const session1 = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Session 1'
    })
    const session1Secret = bridge.issueSessionSecret(session1.id)
    const session1Context = createProviderContext(webhookPort, session1Secret, providerPath)
    const session1Target = toProviderTarget(project.id, repoRoot, session1)

    await provider.installSidecar(session1Target, session1Context)

    const firstResult = await invokeClaudeHeadless(
      await provider.buildStartCommand(session1Target, session1Context),
      FIRST_PROMPT,
      join(baseDir, 'claude-session1-first.debug.log')
    )
    const firstCommandFile = await readCommandFile(repoRoot)
    if (!/\bpip\b/i.test(firstCommandFile) || /\buv\b/i.test(firstCommandFile)) {
      throw new Error(
        `First Claude invocation did not use the expected pip-style default.\nCommand file: ${firstCommandFile}\nStdout: ${firstResult.stdout}`
      )
    }
    invocations.push(buildInvocationRecord(1, 'session1:first', session1, firstResult.command, firstResult, firstCommandFile))

    const secondResult = await invokeClaudeHeadless(
      await provider.buildResumeCommand(session1Target, session1.externalSessionId!, session1Context),
      SECOND_PROMPT,
      join(baseDir, 'claude-session1-resume.debug.log')
    )
    const secondCommandFile = await readCommandFile(repoRoot)
    if (!/\buv\b/i.test(secondCommandFile)) {
      throw new Error(
        `Second Claude invocation did not update the repository rule to uv.\nCommand file: ${secondCommandFile}\nStdout: ${secondResult.stdout}`
      )
    }
    invocations.push(buildInvocationRecord(2, 'session1:resume', session1, secondResult.command, secondResult, secondCommandFile))

    const runtimeStateStore = new RuntimeStateStore(repoRoot)
    const session1Jobs = await waitForCompletedJobs(runtimeStateStore, sessionKey(project.id, session1.id), 2)

    const session2 = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Session 2'
    })
    const session2Secret = bridge.issueSessionSecret(session2.id)
    const session2Context = createProviderContext(webhookPort, session2Secret, providerPath)
    const session2Target = toProviderTarget(project.id, repoRoot, session2)

    await provider.installSidecar(session2Target, session2Context)

    const thirdResult = await invokeClaudeHeadless(
      await provider.buildStartCommand(session2Target, session2Context),
      FIRST_PROMPT,
      join(baseDir, 'claude-session2-first.debug.log')
    )
    const thirdCommandFile = await readCommandFile(repoRoot)
    if (!/\buv\b/i.test(thirdCommandFile)) {
      throw new Error(
        `Third Claude invocation did not automatically carry the uv preference into the new session.\nCommand file: ${thirdCommandFile}\nStdout: ${thirdResult.stdout}`
      )
    }
    invocations.push(buildInvocationRecord(3, 'session2:first', session2, thirdResult.command, thirdResult, thirdCommandFile))

    console.log(JSON.stringify({
      ok: true,
      repoRoot,
      webhookPort,
      invocations,
      runtimeState: {
        session1Jobs
      },
      notes: {
        scenario: [
          'Session 1, invocation 1: headless Claude uses its default approach and should choose pip.',
          'Session 1, invocation 2: same Claude session resumes and is corrected to use uv.',
          'Session 2, invocation 3: fresh Claude session should automatically carry the uv preference.'
        ],
        commandFile: COMMAND_FILE_NAME,
        providerPath: providerPath ?? 'claude',
        debugLogs: [
          join(baseDir, 'claude-session1-first.debug.log'),
          join(baseDir, 'claude-session1-resume.debug.log'),
          join(baseDir, 'claude-session2-first.debug.log')
        ]
      }
    }, null, 2))
  } finally {
    await bridge.stop()
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
  commandFile: string
): {
  index: number
  label: string
  sessionId: string
  providerSessionId: string
  command: string
  args: string[]
  resultSessionId: string | null
  stdoutPreview: string
  commandFile: string
} {
  return {
    index,
    label,
    sessionId: session.id,
    providerSessionId: session.externalSessionId ?? 'unknown',
    command: command.command,
    args: command.args,
    resultSessionId: typeof result.parsed?.session_id === 'string' ? result.parsed.session_id : null,
    stdoutPreview: trim(result.stdout, 600),
    commandFile
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

async function readCommandFile(repoRoot: string): Promise<string> {
  const filePath = join(repoRoot, COMMAND_FILE_NAME)
  const content = await readFile(filePath, 'utf8').catch(() => null)
  if (content === null) {
    throw new Error(`Claude did not create ${COMMAND_FILE_NAME} in ${repoRoot}.`)
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
  const diagnosticPath = lastRepoRoot ? join(lastRepoRoot, COMMAND_FILE_NAME) : null
  const diagnostic = diagnosticPath && existsSync(diagnosticPath)
    ? `\ncommandFileSha256=${createHash('sha256').update(await readFile(diagnosticPath, 'utf8')).digest('hex')}`
    : ''
  const baseDirLine = lastBaseDir ? `\nbaseDir=${lastBaseDir}` : ''
  console.error(`${message}${diagnostic}${baseDirLine}`)
  process.exitCode = 1
})
