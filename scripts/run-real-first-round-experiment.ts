import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { CanonicalSessionEvent, ProviderCommandContext } from '../src/shared/project-session'
import { DEFAULT_SETTINGS } from '../src/shared/project-session'
import { SessionEvidenceStore } from '../src/core/memory/session-evidence-store'
import { EvolverMaintainer } from '../src/core/memory/evolver-maintainer'
import { ClaudeCodeInjector, getClaudeCodePublishedContextPath } from '../src/core/memory/claude-code-injector'
import { RuntimeStateStore } from '../src/core/memory/runtime-state-store'
import { createClaudeCodeProvider } from '../src/extensions/providers/claude-code-provider'

async function main(): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), 'stoa-first-round-'))
  const repoRoot = join(baseDir, 'project')
  const projectId = 'project_first_round'
  const firstSessionId = 'session_1'
  const secondSessionId = 'session_2'
  const providerSessionId = 'provider-session-uv-1'
  const transcriptSourcePath = join(repoRoot, 'provider-transcript.jsonl')
  const evidenceStore = new SessionEvidenceStore()

  await mkdir(repoRoot, { recursive: true })
  await writeFile(join(repoRoot, 'pyproject.toml'), [
    '[project]',
    'name = "demo-python-project"',
    'version = "0.1.0"',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(repoRoot, 'README.md'), '# Demo Python Project\n', 'utf8')

  runChecked('git', ['init'], repoRoot)
  runChecked('git', ['config', 'user.name', 'Stoa Test'], repoRoot)
  runChecked('git', ['config', 'user.email', 'stoa@example.com'], repoRoot)
  runChecked('git', ['add', '.'], repoRoot)
  runChecked('git', ['commit', '-m', 'init'], repoRoot)

  const firstTranscript = [
    jsonLine({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Install a Python environment for this project.' }]
      }
    }),
    jsonLine({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'I will create a virtual environment with pip and then use pip install for dependencies.' }]
      }
    }),
    jsonLine({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Do not use pip-managed virtualenvs here. Use uv to manage the environment and packages for this repository.' }]
      }
    }),
    jsonLine({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Understood. I will use uv for Python environments and package installation in this repository.' }]
      }
    })
  ].join('\n') + '\n'
  await writeFile(transcriptSourcePath, firstTranscript, 'utf8')

  const completionEvent: CanonicalSessionEvent = {
    event_version: 1,
    event_id: 'evt_uv_preference',
    event_type: 'claude-code.Stop',
    timestamp: '2026-04-28T09:00:00.000Z',
    session_id: firstSessionId,
    project_id: projectId,
    source: 'hook-sidecar',
    payload: {
      intent: 'agent.turn_completed',
      agentState: 'idle',
      hasUnseenCompletion: true,
      summary: 'The user corrected pip to uv for Python environment management.',
      externalSessionId: providerSessionId
    },
    evidence: {
      rawSource: {
        provider: 'claude-code',
        channel: 'hook',
        rawEventName: 'Stop'
      },
      hookEventName: 'Stop',
      providerSessionId,
      turnId: 'turn-uv-1',
      transcriptPath: transcriptSourcePath,
      cwd: repoRoot,
      model: 'claude-sonnet',
      inputMessages: [
        'Install a Python environment for this project.',
        'Do not use pip-managed virtualenvs here. Use uv to manage the environment and packages for this repository.'
      ],
      lastAssistantMessage: 'Understood. I will use uv for Python environments and package installation in this repository.'
    }
  }

  await evidenceStore.persist({
    projectPath: repoRoot,
    event: completionEvent,
    snapshot: {
      kind: 'provider-transcript',
      fileName: 'transcript.jsonl',
      content: Buffer.from(firstTranscript, 'utf8'),
      sourceTranscriptPath: transcriptSourcePath
    }
  })

  const maintainer = new EvolverMaintainer(
    {
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        memoryAiProvider: 'claude-code'
      })
    },
    {
      buildCliAiProvider: () => ({
        summarizeSession: async () => ({
          summary: 'For this repository, manage Python environments and package installation with uv instead of pip.',
          outcome: 'success',
          lessons: ['Use uv rather than pip for Python environments and packages in this project.']
        }),
        review: async () => ({
          decision: 'approve',
          summary: 'Approved for publication.',
          concerns: []
        }),
        distill: async () => ({
          responseText: JSON.stringify({
            type: 'Gene',
            id: 'gene_distilled_uv',
            category: 'repair',
            signals_match: ['tooling_preference'],
            strategy: [
              'Use uv instead of pip for Python environments and package installation in this repository.'
            ],
            constraints: {
              max_files: 5,
              forbidden_paths: ['.git', 'node_modules']
            }
          })
        })
      })
    }
  )

  await maintainer.processTurnCompletion({
    projectPath: repoRoot,
    event: completionEvent
  })

  const injector = new ClaudeCodeInjector()
  const publishResult = await injector.injectLatestContext({
    projectId,
    stoaSessionId: secondSessionId,
    projectPath: repoRoot
  })
  if (!publishResult) {
    throw new Error('Injector did not find an approved run to publish for the second session.')
  }

  const provider = createClaudeCodeProvider()
  const providerContext: ProviderCommandContext = {
    webhookPort: 43127,
    sessionSecret: 'secret-env',
    providerPort: 43128
  }
  await provider.installSidecar({
    session_id: secondSessionId,
    project_id: projectId,
    path: repoRoot,
    title: 'Second Claude Session',
    type: 'claude-code',
    external_session_id: 'provider-session-uv-2'
  }, providerContext)

  const hookSettings = JSON.parse(await readFile(join(repoRoot, '.claude', 'settings.local.json'), 'utf8')) as {
    hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>
  }
  const sessionStartCommand = hookSettings.hooks?.SessionStart?.[0]?.hooks?.[0]?.command
  if (!sessionStartCommand) {
    throw new Error('Claude SessionStart hook command is missing from .claude/settings.local.json.')
  }

  const hookOutput = runShellChecked(
    sessionStartCommand,
    repoRoot,
    {
      env: {
        ...process.env,
        EVOLVER_SESSION_START_DEDUP: '0'
      }
    }
  )
  const hookPayload = parseJsonTail(hookOutput.stdout) as {
    agent_message?: string
    additionalContext?: string
  }
  const injectedText = `${hookPayload.agent_message ?? ''}\n${hookPayload.additionalContext ?? ''}`
  if (!injectedText.includes('uv')) {
    throw new Error(`Claude SessionStart output did not surface the uv preference.\nOutput: ${hookOutput.stdout}`)
  }

  const stateStore = new RuntimeStateStore(repoRoot)
  const firstRunRecord = await stateStore.getRunRecord(projectId, firstSessionId)
  const secondPublishedRecord = await stateStore.getPublishedRecord(projectId, secondSessionId, 'claude-code')
  const publishedContent = await readFile(getClaudeCodePublishedContextPath(repoRoot), 'utf8')

  console.log(JSON.stringify({
    ok: true,
    scenario: {
      session_1: 'agent started with pip, user corrected to uv',
      session_2: 'user only asks to install a Python package; injected memory should surface uv'
    },
    note: 'This script exercises the Stoa-owned evidence -> Evolver -> Claude consumer path. Entire is intentionally not used.',
    paths: {
      baseDir,
      repoRoot,
      evidenceDir: join(repoRoot, '.stoa', 'memory', 'evidence', firstSessionId, completionEvent.event_id),
      runtimeStatePath: join(repoRoot, '.stoa', 'memory', 'runtime-state.json'),
      publishedContextPath: publishResult.filePath
    },
    runtimeState: {
      firstRunRecord,
      secondPublishedRecord
    },
    publishedContext: {
      hash: publishResult.hash,
      lineCount: publishedContent.trim().length === 0 ? 0 : publishedContent.trim().split('\n').length,
      preview: previewJsonLines(publishedContent, 3)
    },
    sessionStartHook: hookPayload
  }, null, 2))
}

function jsonLine(value: unknown): string {
  return JSON.stringify(value)
}

function previewJsonLines(content: string, limit: number): unknown[] {
  const lines = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(0, limit)

  return lines.map(line => {
    try {
      return JSON.parse(line) as unknown
    } catch {
      return line
    }
  })
}

function parseJsonTail(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (!trimmed) {
    throw new Error('Expected JSON output but command stdout was empty.')
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

  throw new Error(`Expected JSON output but could not parse stdout:\n${stdout}`)
}

function runChecked(
  command: string,
  args: string[],
  cwd: string,
  options?: {
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
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
    maxBuffer: 20 * 1024 * 1024
  })
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

function runShellChecked(
  command: string,
  cwd: string,
  options?: {
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
  }
): {
  status: number
  stdout: string
  stderr: string
} {
  const result = spawnSync(command, {
    cwd,
    env: options?.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options?.timeoutMs ?? 120_000,
    maxBuffer: 20 * 1024 * 1024,
    shell: true
  })
  const normalized = {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }

  if (normalized.status !== 0) {
    throw new Error([
      `Command failed: ${command}`,
      `cwd=${cwd}`,
      `exitCode=${normalized.status}`,
      `stdout=${normalized.stdout}`,
      `stderr=${normalized.stderr}`
    ].join('\n'))
  }

  return normalized
}

main().catch(async (error) => {
  const publishedContextPath = getClaudeCodePublishedContextPath(process.cwd())
  const diagnostic = existsSync(publishedContextPath)
    ? `\npublishedContextSha256=${createHash('sha256').update(await readFile(publishedContextPath, 'utf8')).digest('hex')}`
    : ''
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(`${message}${diagnostic}`)
  process.exitCode = 1
})
