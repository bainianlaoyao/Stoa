import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EntireStoaCheckpointExport, EntireStoaSessionExport } from '@shared/direct-memory'

const DEFAULT_AGENT_NAME = 'main'

export interface ImportCheckpointIntoEvolverInputsOptions {
  checkpoint: EntireStoaCheckpointExport
  worktreeRepoRoot: string
  memoryDir: string
  agentName?: string
  now?: () => Date
}

export interface ImportedEvolverInputs {
  runtimeHomeDir: string
  agentName: string
  sessionDir: string
  memoryPath: string
  userPath: string
  datedMemoryPath: string
  sessionFilePaths: string[]
}

export async function importCheckpointIntoEvolverInputs(
  options: ImportCheckpointIntoEvolverInputsOptions
): Promise<ImportedEvolverInputs> {
  const now = options.now?.() ?? new Date()
  const dateStamp = now.toISOString().slice(0, 10)
  const agentName = sanitizeAgentName(options.agentName ?? DEFAULT_AGENT_NAME)
  const runtimeHomeDir = join(options.memoryDir, 'runtime-home')
  const sessionDir = join(runtimeHomeDir, '.openclaw', 'agents', agentName, 'sessions')
  const memoryPath = join(options.worktreeRepoRoot, 'MEMORY.md')
  const userPath = join(options.worktreeRepoRoot, 'USER.md')
  const datedMemoryPath = join(options.memoryDir, `${dateStamp}.md`)

  await mkdir(options.worktreeRepoRoot, { recursive: true })
  await mkdir(options.memoryDir, { recursive: true })
  await mkdir(sessionDir, { recursive: true })

  await writeFile(memoryPath, buildMemoryMarkdown(options.checkpoint), 'utf-8')
  await writeFile(userPath, buildUserMarkdown(options.checkpoint), 'utf-8')
  await writeFile(datedMemoryPath, buildDatedMemoryMarkdown(options.checkpoint, now), 'utf-8')

  const sessionFilePaths: string[] = []
  for (const session of options.checkpoint.sessions) {
    const sessionLog = buildSessionLog(options.worktreeRepoRoot, session)
    if (!sessionLog) {
      continue
    }

    const sessionFilePath = join(sessionDir, `${session.session_id}.jsonl`)
    await writeFile(sessionFilePath, sessionLog, 'utf-8')
    sessionFilePaths.push(sessionFilePath)
  }

  return {
    runtimeHomeDir,
    agentName,
    sessionDir,
    memoryPath,
    userPath,
    datedMemoryPath,
    sessionFilePaths
  }
}

function sanitizeAgentName(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9_\-.]/g, '-').slice(0, 64)
  if (!safe || safe === '.' || safe === '..') {
    return DEFAULT_AGENT_NAME
  }
  return safe
}

function buildMemoryMarkdown(checkpoint: EntireStoaCheckpointExport): string {
  const lines = [
    '# Stoa Imported Memory',
    '',
    `- Source checkpoint: \`${checkpoint.checkpoint_id}\``,
    ''
  ]

  if (checkpoint.sessions.length === 0) {
    lines.push('No checkpoint sessions were exported.', '')
    return lines.join('\n')
  }

  lines.push('## Session Notes', '')
  for (const session of checkpoint.sessions) {
    lines.push(`### ${session.session_id}`)
    lines.push(`- Agent: ${session.agent}${session.model ? ` (${session.model})` : ''}`)
    if (session.summary) {
      lines.push(`- Summary: ${session.summary}`)
    }
    if (session.prompt_text) {
      lines.push(`- Prompt: ${clip(session.prompt_text, 400)}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function buildUserMarkdown(checkpoint: EntireStoaCheckpointExport): string {
  const lines = [
    '# Stoa Imported User Registry',
    '',
    'Recent user-authored prompts and corrections captured from Entire checkpoints.',
    ''
  ]

  if (checkpoint.sessions.length === 0) {
    lines.push('No captured user inputs were exported.', '')
    return lines.join('\n')
  }

  for (const session of checkpoint.sessions) {
    lines.push(`## ${session.session_id}`)
    if (session.prompt_text) {
      lines.push(`- Prompt: ${clip(session.prompt_text, 400)}`)
    }
    if (session.summary) {
      lines.push(`- Summary: ${session.summary}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function buildDatedMemoryMarkdown(checkpoint: EntireStoaCheckpointExport, now: Date): string {
  const lines = [
    `# ${now.toISOString().slice(0, 10)}`,
    '',
    `Checkpoint: ${checkpoint.checkpoint_id}`,
    ''
  ]

  for (const session of checkpoint.sessions) {
    lines.push(`- ${session.session_id}: ${session.summary ?? 'No exported summary.'}`)
  }

  lines.push('')
  return lines.join('\n')
}

function buildSessionLog(worktreeRepoRoot: string, session: EntireStoaSessionExport): string | null {
  const body = normalizedTranscriptBody(session)
  if (!body) {
    return null
  }

  const header = JSON.stringify({
    type: 'session_start',
    cwd: worktreeRepoRoot,
    session_id: session.session_id,
    source: 'stoa-direct-memory'
  })

  return `${header}\n${body.trim()}\n`
}

function normalizedTranscriptBody(session: EntireStoaSessionExport): string | null {
  const transcript = session.transcript_text?.trim()
  if (transcript) {
    return transcript
  }

  const prompt = session.prompt_text?.trim()
  if (!prompt) {
    return null
  }

  if (session.agent === 'codex') {
    return JSON.stringify({
      type: 'item.added',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: prompt }]
      }
    })
  }

  return JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: prompt }]
    }
  })
}

function clip(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return `${trimmed.slice(0, maxLength)}...`
}
