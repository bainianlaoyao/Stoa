import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryRuntimeEvidence, MemoryRuntimeEvidenceProvider } from '@shared/memory-runtime'
import type { SessionEvidenceSnapshot } from './session-evidence-store'

export type { SessionEvidenceSnapshot } from './session-evidence-store'

const DEFAULT_AGENT_NAME = 'main'
const SESSION_LOG_SOURCE = 'stoa-memory-runtime'

export interface MaterializeEvolverInputsOptions {
  snapshots: SessionEvidenceSnapshot[]
  worktreeRepoRoot: string
  memoryDir: string
  agentName?: string
  now?: () => Date
}

export interface MaterializedEvolverInputs {
  runtimeHomeDir: string
  agentName: string
  sessionDir: string
  memoryPath: string
  userPath: string
  datedMemoryPath: string
  sessionFilePaths: string[]
}

interface SnapshotGroup {
  key: string
  provider: MemoryRuntimeEvidenceProvider
  providerSessionId: string | null
  sessionId: string
  snapshots: SessionEvidenceSnapshot[]
}

export async function materializeEvidenceSnapshotsIntoEvolverInputs(
  options: MaterializeEvolverInputsOptions
): Promise<MaterializedEvolverInputs> {
  const now = options.now?.() ?? new Date()
  const dateStamp = now.toISOString().slice(0, 10)
  const agentName = sanitizeAgentName(options.agentName ?? DEFAULT_AGENT_NAME)
  const runtimeHomeDir = join(options.memoryDir, 'runtime-home')
  const sessionDir = join(runtimeHomeDir, '.openclaw', 'agents', agentName, 'sessions')
  const memoryPath = join(options.worktreeRepoRoot, 'MEMORY.md')
  const userPath = join(options.worktreeRepoRoot, 'USER.md')
  const datedMemoryPath = join(options.memoryDir, `${dateStamp}.md`)
  const groups = groupSnapshots(options.snapshots)

  await mkdir(options.worktreeRepoRoot, { recursive: true })
  await mkdir(options.memoryDir, { recursive: true })
  await mkdir(sessionDir, { recursive: true })

  await writeFile(memoryPath, buildMemoryMarkdown(groups), 'utf8')
  await writeFile(userPath, buildUserMarkdown(groups), 'utf8')
  await writeFile(datedMemoryPath, buildDatedMemoryMarkdown(groups, now), 'utf8')

  const sessionFilePaths: string[] = []
  for (const group of groups) {
    const sessionLog = buildSessionLog(options.worktreeRepoRoot, group)
    if (!sessionLog) {
      continue
    }

    const sessionFilePath = join(
      sessionDir,
      buildSessionFileName(group)
    )
    await writeFile(sessionFilePath, sessionLog, 'utf8')
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

function groupSnapshots(snapshots: SessionEvidenceSnapshot[]): SnapshotGroup[] {
  const sorted = [...snapshots].sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp.localeCompare(right.timestamp)
    }
    return left.eventId.localeCompare(right.eventId)
  })

  const groups = new Map<string, SnapshotGroup>()
  for (const snapshot of sorted) {
    const key = `${snapshot.provider}:${snapshot.sessionId}`
    const existing = groups.get(key)
    if (existing) {
      existing.snapshots.push(snapshot)
      if (snapshot.providerSessionId) {
        existing.providerSessionId = snapshot.providerSessionId
      }
      continue
    }

    groups.set(key, {
      key,
      provider: snapshot.provider,
      providerSessionId: snapshot.providerSessionId,
      sessionId: snapshot.sessionId,
      snapshots: [snapshot]
    })
  }

  return [...groups.values()]
}

function buildMemoryMarkdown(groups: SnapshotGroup[]): string {
  const lines = [
    '# Stoa Materialized Memory',
    '',
    `- Source evidence groups: \`${groups.length}\``,
    ''
  ]

  if (groups.length === 0) {
    lines.push('No evidence snapshots were materialized.', '')
    return lines.join('\n')
  }

  lines.push('## Session Notes', '')
  for (const group of groups) {
    const representative = selectRepresentativeSnapshot(group)
    if (!representative) {
      continue
    }

    lines.push(`### ${group.providerSessionId ?? group.sessionId}`)
    lines.push(`- Provider: ${group.provider}${representative.evidence.model ? ` (${representative.evidence.model})` : ''}`)
    lines.push(`- Summary: ${clip(representative.payload.summary, 400)}`)

    const prompt = extractPromptEntries(representative.evidence)[0]
    if (prompt) {
      lines.push(`- Prompt: ${clip(prompt, 400)}`)
    }

    const outcome = normalizeText(representative.evidence.lastAssistantMessage)
    if (outcome) {
      lines.push(`- Outcome: ${clip(outcome, 400)}`)
    }

    if (representative.payload.error) {
      lines.push(`- Error: ${clip(representative.payload.error, 400)}`)
    }

    lines.push('')
  }

  return lines.join('\n')
}

function buildUserMarkdown(groups: SnapshotGroup[]): string {
  const lines = [
    '# Stoa Materialized User Registry',
    '',
    'Recent user-authored prompts and corrections captured from session evidence.',
    ''
  ]

  if (groups.length === 0) {
    lines.push('No captured user inputs were materialized.', '')
    return lines.join('\n')
  }

  for (const group of groups) {
    lines.push(`## ${group.providerSessionId ?? group.sessionId}`)
    for (const prompt of collectGroupPrompts(group)) {
      lines.push(`- Prompt: ${clip(prompt, 400)}`)
    }
    lines.push(`- Summary: ${clip(group.snapshots[group.snapshots.length - 1]?.payload.summary ?? 'No summary.', 400)}`)
    lines.push('')
  }

  return lines.join('\n')
}

function buildDatedMemoryMarkdown(groups: SnapshotGroup[], now: Date): string {
  const lines = [
    `# ${now.toISOString().slice(0, 10)}`,
    '',
    `Evidence groups: ${groups.length}`,
    ''
  ]

  for (const group of groups) {
    const latest = group.snapshots[group.snapshots.length - 1]
    lines.push(`- ${group.providerSessionId ?? group.sessionId}: ${latest?.payload.summary ?? 'No summary.'}`)
  }

  lines.push('')
  return lines.join('\n')
}

function buildSessionLog(worktreeRepoRoot: string, group: SnapshotGroup): string | null {
  const body = resolveSessionLogBody(group)
  if (!body) {
    return null
  }

  const header = JSON.stringify({
    type: 'session_start',
    cwd: worktreeRepoRoot,
    session_id: group.providerSessionId ?? group.sessionId,
    source: SESSION_LOG_SOURCE
  })

  return `${header}\n${body}\n`
}

function resolveSessionLogBody(group: SnapshotGroup): string | null {
  const newestFullTranscriptIndex = findNewestFullTranscriptIndex(group.snapshots)
  if (newestFullTranscriptIndex >= 0) {
    const newestFullTranscript = group.snapshots[newestFullTranscriptIndex]
    if (!newestFullTranscript) {
      return null
    }

    const transcript = newestFullTranscript.snapshot.content.trim()
    if (transcript.length === 0) {
      const fallbackLines = group.snapshots
        .filter(snapshot => snapshot.snapshot.kind === 'turn-slice')
        .flatMap(snapshot => synthesizeTranscriptLines(group.provider, snapshot))

      return fallbackLines.length > 0 ? fallbackLines.join('\n') : null
    }

    const appendedLines = group.snapshots
      .slice(newestFullTranscriptIndex + 1)
      .filter(snapshot => snapshot.snapshot.kind === 'turn-slice')
      .flatMap(snapshot => synthesizeTranscriptLines(group.provider, snapshot))

    return appendedLines.length > 0
      ? `${transcript}\n${appendedLines.join('\n')}`
      : transcript
  }

  const lines = group.snapshots.flatMap(snapshot => synthesizeTranscriptLines(group.provider, snapshot))
  return lines.length > 0 ? lines.join('\n') : null
}

function findNewestFullTranscriptIndex(snapshots: SessionEvidenceSnapshot[]): number {
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    if (snapshots[index]?.snapshot.kind === 'provider-transcript') {
      return index
    }
  }

  return -1
}

function selectRepresentativeSnapshot(group: SnapshotGroup): SessionEvidenceSnapshot | null {
  const transcriptIndex = findNewestFullTranscriptIndex(group.snapshots)
  if (transcriptIndex >= 0) {
    return group.snapshots[transcriptIndex] ?? null
  }

  return group.snapshots[group.snapshots.length - 1] ?? null
}

function synthesizeTranscriptLines(
  provider: MemoryRuntimeEvidenceProvider,
  snapshot: SessionEvidenceSnapshot
): string[] {
  const lines: string[] = []

  for (const prompt of extractPromptEntries(snapshot.evidence)) {
    lines.push(JSON.stringify(buildUserRecord(provider, prompt)))
  }

  const assistantMessage = normalizeText(snapshot.evidence.lastAssistantMessage)
  if (assistantMessage) {
    lines.push(JSON.stringify(buildAssistantRecord(provider, assistantMessage)))
  }

  return lines
}

function buildUserRecord(provider: MemoryRuntimeEvidenceProvider, prompt: string): Record<string, unknown> {
  if (provider === 'codex') {
    return {
      type: 'item.added',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: prompt }]
      }
    }
  }

  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: prompt }]
    }
  }
}

function buildAssistantRecord(provider: MemoryRuntimeEvidenceProvider, message: string): Record<string, unknown> {
  if (provider === 'codex') {
    return {
      type: 'item.completed',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: message }]
      }
    }
  }

  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: message }]
    }
  }
}

function collectGroupPrompts(group: SnapshotGroup): string[] {
  const prompts: string[] = []
  for (const snapshot of group.snapshots) {
    for (const prompt of extractPromptEntries(snapshot.evidence)) {
      if (!prompts.includes(prompt)) {
        prompts.push(prompt)
      }
    }
  }
  return prompts
}

function buildSessionFileName(group: SnapshotGroup): string {
  const providerPrefix = sanitizeSessionFileStem(group.provider)
  const sessionStem = sanitizeSessionFileStem(group.sessionId)
  if (!group.providerSessionId) {
    return `${providerPrefix}-${sessionStem}.jsonl`
  }

  return `${providerPrefix}-${sanitizeSessionFileStem(group.providerSessionId)}-${sessionStem}.jsonl`
}

function extractPromptEntries(evidence: MemoryRuntimeEvidence): string[] {
  if (Array.isArray(evidence.inputMessages) && evidence.inputMessages.length > 0) {
    return evidence.inputMessages
      .map(normalizeText)
      .filter((entry): entry is string => entry !== null)
  }

  const prompt = normalizeText(evidence.promptText)
  return prompt ? [prompt] : []
}

function sanitizeAgentName(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9_\-.]/g, '-').slice(0, 64)
  if (!safe || safe === '.' || safe === '..') {
    return DEFAULT_AGENT_NAME
  }
  return safe
}

function sanitizeSessionFileStem(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9_\-.]/g, '-').slice(0, 128)
  if (!safe || safe === '.' || safe === '..') {
    return 'session'
  }
  return safe
}

function normalizeText(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function clip(value: string, maxLength: number): string {
  const normalized = normalizeText(value) ?? ''
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}
