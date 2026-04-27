import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { EntireStoaCheckpointExport, EvolverStoaRunResult } from '../src/shared/direct-memory'
import { importCheckpointIntoEvolverInputs } from '../src/core/direct-memory/evolver-input-importer'
import { buildPublishedContext } from '../src/core/direct-memory/published-context-builder'
import { writePublishedContext } from '../src/core/direct-memory/context-delivery'
import { createClaudeCodeProvider } from '../src/extensions/providers/claude-code-provider'

interface JsonRecord {
  [key: string]: unknown
}

async function main(): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), 'stoa-first-round-'))
  const repoRoot = join(baseDir, 'project')
  const memoryDir = join(baseDir, 'memory')
  const evolutionDir = join(memoryDir, 'evolution')
  const sessionScope = 'provider-session-1'
  const scopedEvolutionDir = join(evolutionDir, 'scopes', sessionScope)
  const gepAssetsDir = join(baseDir, 'assets', 'gep')
  const scopedAssetsDir = join(gepAssetsDir, 'scopes', sessionScope)
  const importedMemoryDir = join(baseDir, 'imported-memory')
  const fakeEvolverRoot = join(baseDir, 'fake-evolver-root')

  await mkdir(repoRoot, { recursive: true })
  await mkdir(scopedEvolutionDir, { recursive: true })
  await mkdir(scopedAssetsDir, { recursive: true })
  await mkdir(fakeEvolverRoot, { recursive: true })

  await writeFile(join(repoRoot, 'pyproject.toml'), [
    '[project]',
    'name = "demo-python-project"',
    'version = "0.1.0"',
    ''
  ].join('\n'), 'utf-8')
  await writeFile(join(repoRoot, 'README.md'), '# Demo Python Project\n', 'utf-8')
  await writeFile(join(fakeEvolverRoot, 'package.json'), JSON.stringify({ name: '@evomap/evolver' }, null, 2) + '\n', 'utf-8')

  runChecked('git', ['init'], repoRoot)
  runChecked('git', ['config', 'user.name', 'Stoa Test'], repoRoot)
  runChecked('git', ['config', 'user.email', 'stoa@example.com'], repoRoot)
  runChecked('git', ['add', '.'], repoRoot)
  runChecked('git', ['commit', '-m', 'init'], repoRoot)

  const sourceWorktreeCommitSha = runChecked('git', ['rev-parse', 'HEAD'], repoRoot).stdout.trim()

  const checkpoint: EntireStoaCheckpointExport = {
    checkpoint_id: 'chk_uv_pref_1',
    checkpoint_format_version: 'v1',
    checkpoint_metadata_commit_sha: 'meta-sha-1',
    source_worktree_commit_sha: sourceWorktreeCommitSha,
    root_metadata_ref: '.entire/checkpoints/chk_uv_pref_1/metadata.json',
    sessions: [{
      session_id: sessionScope,
      agent: 'claude-code',
      model: 'claude-sonnet',
      turn_id: 'turn-1',
      metadata_ref: '.entire/checkpoints/chk_uv_pref_1/sessions/provider-session-1/metadata.json',
      transcript_ref: '.entire/checkpoints/chk_uv_pref_1/sessions/provider-session-1/transcript.jsonl',
      transcript_text: [
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'Install a Python environment for this project.' }]
          }
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'I will create a virtual environment with pip and then use pip install for dependencies.' }]
          }
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'Do not use pip-managed virtualenvs here. Use uv to manage the environment and packages for this repository.' }]
          }
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Understood. I will switch to uv and use uv venv plus uv pip or uv add style package management for this project.' }]
          }
        })
      ].join('\n'),
      prompt_ref: '.entire/checkpoints/chk_uv_pref_1/sessions/provider-session-1/prompt.txt',
      prompt_text: 'Install a Python environment for this project. The user corrected pip to uv.',
      summary: 'The user corrected the agent: for this repo, Python environments and packages must be managed with uv instead of raw pip.',
      initial_attribution: null
    }],
    token_usage: null,
    combined_attribution: null
  }

  const imported = await importCheckpointIntoEvolverInputs({
    checkpoint,
    worktreeRepoRoot: repoRoot,
    memoryDir: importedMemoryDir,
    agentName: 'main',
    now: () => new Date('2026-04-27T12:00:00.000Z')
  })

  const evolverRepoRoot = join(process.cwd(), 'research', 'upstreams', 'evolver')
  const stdoutPath = join(scopedEvolutionDir, 'stoa-evolver-run.stdout.log')
  const stderrPath = join(scopedEvolutionDir, 'stoa-evolver-run.stderr.log')
  const memoryGraphPath = join(evolutionDir, 'memory_graph.jsonl')
  const runCommand = runChecked(
    'node',
    ['index.js'],
    evolverRepoRoot,
    {
      env: {
        ...process.env,
        EVOLVER_REPO_ROOT: repoRoot,
        EVOLVER_QUIET_PARENT_GIT: '1',
        MEMORY_DIR: memoryDir,
        EVOLUTION_DIR: evolutionDir,
        GEP_ASSETS_DIR: gepAssetsDir,
        MEMORY_GRAPH_PATH: memoryGraphPath,
        EVOLVER_SESSION_SCOPE: sessionScope,
        HOME: imported.runtimeHomeDir,
        USERPROFILE: imported.runtimeHomeDir,
        AGENT_NAME: imported.agentName,
        EVOLVER_VALIDATOR_ENABLED: '0',
        A2A_HUB_URL: '',
        EVOMAP_HUB_URL: ''
      },
      timeoutMs: 120_000,
      allowFailure: true
    }
  )

  await writeFile(stdoutPath, runCommand.stdout, 'utf-8')
  await writeFile(stderrPath, runCommand.stderr, 'utf-8')

  const solidifyStatePath = join(scopedEvolutionDir, 'evolution_solidify_state.json')
  const solidifyState = await readJsonFile(solidifyStatePath)
  const lastRun = asRecord(solidifyState?.last_run)
  const runResult: EvolverStoaRunResult = {
    ok: runCommand.status === 0,
    run_id: asString(lastRun?.run_id) ?? 'unknown-run',
    repo_root: repoRoot,
    memory_dir: memoryDir,
    evolution_dir: scopedEvolutionDir,
    gep_assets_dir: scopedAssetsDir,
    session_scope: sessionScope,
    selected_gene_id: asString(lastRun?.selected_gene_id),
    signals: asStringArray(lastRun?.signals),
    review_status: existsSync(solidifyStatePath) ? 'pending' : 'none',
    exit_code: runCommand.status,
    artifact_refs: {
      review_state_ref: existsSync(solidifyStatePath) ? solidifyStatePath : null,
      genes_ref: existingPath(join(scopedAssetsDir, 'genes.json')),
      genes_jsonl_ref: existingPath(join(scopedAssetsDir, 'genes.jsonl')),
      capsules_ref: existingPath(join(scopedAssetsDir, 'capsules.json')),
      capsules_jsonl_ref: existingPath(join(scopedAssetsDir, 'capsules.jsonl')),
      events_ref: existingPath(join(scopedAssetsDir, 'events.jsonl')),
      candidates_ref: existingPath(join(scopedAssetsDir, 'candidates.jsonl')),
      external_candidates_ref: existingPath(join(scopedAssetsDir, 'external_candidates.jsonl')),
      failed_capsules_ref: existingPath(join(scopedAssetsDir, 'failed_capsules.json')),
      memory_graph_ref: existingPath(memoryGraphPath),
      stdout_ref: stdoutPath,
      stderr_ref: stderrPath
    },
    bridge: {
      project_id: 'project_first_round',
      stoa_session_id: 'stoa-session-1',
      provider_session_id: sessionScope,
      source_checkpoint_id: checkpoint.checkpoint_id,
      checkpoint_metadata_commit_sha: checkpoint.checkpoint_metadata_commit_sha,
      source_worktree_commit_sha: checkpoint.source_worktree_commit_sha
    },
    error: runCommand.status === 0 ? null : `evolver exited with ${runCommand.status}`
  }

  const published = await buildPublishedContext({
    checkpoint,
    run: runResult,
    repoRoot,
    target: 'claude-code'
  })
  const delivered = await writePublishedContext(repoRoot, published)

  const provider = createClaudeCodeProvider()
  await provider.installSidecar({
    session_id: 'session_claude_first_round',
    project_id: 'project_first_round',
    path: repoRoot,
    title: 'Claude First Round',
    type: 'claude-code',
    external_session_id: 'external-provider-session-2'
  }, {
    webhookPort: 43127,
    sessionSecret: 'secret-env',
    providerPort: 43128
  })

  const hookRun = runChecked(
    'node',
    [join(repoRoot, '.claude', 'hooks', 'stoa-evolver-session-start.cjs')],
    repoRoot,
    {
      env: {
        ...process.env,
        EVOLVER_ROOT: fakeEvolverRoot
      }
    }
  )
  const hookPayload = JSON.parse(hookRun.stdout) as {
    agent_message?: string
    additionalContext?: string
  }

  if (!hookPayload.agent_message?.includes('uv')) {
    throw new Error(`Claude hook output did not surface the uv preference.\nOutput: ${hookRun.stdout}`)
  }

  const publishedContent = await readFile(delivered.filePath, 'utf-8')
  console.log(JSON.stringify({
    ok: true,
    scenario: {
      session_1: 'agent used pip, user corrected to uv',
      session_2: 'user only asks to install a Python package; session-start context should surface uv'
    },
    paths: {
      baseDir,
      repoRoot,
      publishedContextPath: delivered.filePath,
      memoryGraphPath
    },
    evolver: {
      exitCode: runResult.exit_code,
      runId: runResult.run_id,
      selectedGeneId: runResult.selected_gene_id,
      signals: runResult.signals
    },
    publishedContextPreview: publishedContent.trim().split('\n').map((line) => JSON.parse(line)),
    claudeSessionStart: hookPayload,
    stdoutLog: stdoutPath,
    stderrLog: stderrPath
  }, null, 2))
}

function runChecked(
  command: string,
  args: string[],
  cwd: string,
  options?: {
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    allowFailure?: boolean
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
    timeout: options?.timeoutMs ?? 30_000,
    maxBuffer: 20 * 1024 * 1024
  })

  const normalized = {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }

  if (normalized.status !== 0 && options?.allowFailure !== true) {
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

async function readJsonFile(filePath: string): Promise<JsonRecord | null> {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as JsonRecord
  } catch {
    return null
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' ? value as JsonRecord : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}

function existingPath(filePath: string): string | null {
  return existsSync(filePath) ? filePath : null
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
