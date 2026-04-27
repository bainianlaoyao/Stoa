import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { EvolverPublishedContext } from '@shared/direct-memory'

export interface DeliveredContext {
  filePath: string
  hash: string
}

const STOA_CLAUDE_BLOCK_START = '<!-- STOA DIRECT MEMORY:BEGIN -->'
const STOA_CLAUDE_BLOCK_END = '<!-- STOA DIRECT MEMORY:END -->'

function targetFileName(context: EvolverPublishedContext): string {
  return `${context.target}.jsonl`
}

export async function writePublishedContext(repoRoot: string, context: EvolverPublishedContext): Promise<DeliveredContext> {
  if (!context.ok) {
    throw new Error(`Cannot deliver failed published context: ${context.error ?? 'unknown error'}`)
  }

  const text = context.content
  const filePath = join(repoRoot, '.stoa', 'generated', 'evolver-context', targetFileName(context))
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, text, 'utf-8')
  await deliverTargetCompanionFiles(repoRoot, context)

  return {
    filePath,
    hash: `sha256:${createHash('sha256').update(text).digest('hex')}`
  }
}

async function deliverTargetCompanionFiles(repoRoot: string, context: EvolverPublishedContext): Promise<void> {
  if (context.target !== 'claude-code') {
    return
  }

  const markdown = buildClaudeInstructionMarkdown(context)
  const generatedMarkdownPath = join(repoRoot, '.stoa', 'generated', 'evolver-context', 'claude-code.md')
  await writeFile(generatedMarkdownPath, markdown, 'utf-8')
  await writeClaudeInstructionFile(repoRoot, markdown)
}

function buildClaudeInstructionMarkdown(context: EvolverPublishedContext): string {
  const notes = context.content
    .trim()
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => safeParseJson(line))
    .map((entry) => normalizeClaudeInstructionLine(entry))
    .filter((line): line is string => line !== null)

  const body = notes.length > 0
    ? notes.map((note) => `- ${note}`).join('\n')
    : '- No published direct-memory guidance is currently available.'

  return [
    '# Stoa Direct Memory',
    '',
    'Apply these learned project-specific behaviors unless the user explicitly overrides them:',
    body,
    ''
  ].join('\n')
}

function safeParseJson(line: string): unknown {
  try {
    return JSON.parse(line) as unknown
  } catch {
    return null
  }
}

function normalizeClaudeInstructionLine(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') {
    return null
  }

  const outcome = 'outcome' in entry && entry.outcome && typeof entry.outcome === 'object'
    ? entry.outcome as { note?: unknown }
    : null
  const note = typeof outcome?.note === 'string' ? outcome.note.replace(/\s+/g, ' ').trim() : ''
  return note.length > 0 ? note : null
}

async function writeClaudeInstructionFile(repoRoot: string, markdown: string): Promise<void> {
  const filePath = join(repoRoot, 'CLAUDE.md')
  const managedBlock = [
    STOA_CLAUDE_BLOCK_START,
    markdown.trimEnd(),
    STOA_CLAUDE_BLOCK_END,
    ''
  ].join('\n')

  const existing = await readExistingFile(filePath)
  if (!existing) {
    await writeFile(filePath, managedBlock, 'utf-8')
    return
  }

  if (existing.includes(STOA_CLAUDE_BLOCK_START) && existing.includes(STOA_CLAUDE_BLOCK_END)) {
    const startIndex = existing.indexOf(STOA_CLAUDE_BLOCK_START)
    const endIndex = existing.indexOf(STOA_CLAUDE_BLOCK_END) + STOA_CLAUDE_BLOCK_END.length
    const updated = `${existing.slice(0, startIndex)}${managedBlock}${existing.slice(endIndex).replace(/^\s*/, '')}`
    await writeFile(filePath, updated, 'utf-8')
    return
  }

  await writeFile(filePath, `${managedBlock}\n${existing.replace(/^\s*/, '')}`, 'utf-8')
}

async function readExistingFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}
