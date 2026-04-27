import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { writePublishedContext } from './context-delivery'
import type { EvolverPublishedContext } from '@shared/direct-memory'

const tempDirs: string[] = []

function published(overrides: Partial<EvolverPublishedContext> = {}): EvolverPublishedContext {
  return {
    ok: true,
    target: 'codex',
    format: 'jsonl',
    run_id: 'run_1',
    source_checkpoint_id: 'chk_1',
    source_refs: [],
    content: '{"type":"MemoryGraphEvent"}\n',
    metadata: {
      generated_at: '2026-04-26T00:00:00.000Z',
      token_budget: null,
      selection_policy: 'test'
    },
    bridge: null,
    error: null,
    ...overrides
  }
}

describe('writePublishedContext', () => {
  let repoRoot: string

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'stoa-context-delivery-'))
    tempDirs.push(repoRoot)
  })

  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  test('writes Codex markdown context under generated Stoa path', async () => {
    const result = await writePublishedContext(repoRoot, published({ target: 'codex', content: '{"type":"MemoryGraphEvent","scope":"codex"}\n' }))

    expect(result.filePath).toBe(join(repoRoot, '.stoa', 'generated', 'evolver-context', 'codex.jsonl'))
    await expect(readFile(result.filePath, 'utf-8')).resolves.toBe('{"type":"MemoryGraphEvent","scope":"codex"}\n')
    expect(result.hash).toMatch(/^sha256:/)
  })

  test('writes Claude Code memory graph context under generated Stoa path', async () => {
    const result = await writePublishedContext(repoRoot, published({
      target: 'claude-code',
      content: [
        JSON.stringify({
          timestamp: '2026-04-27T00:00:00.000Z',
          signals: ['tooling_preference'],
          outcome: {
            status: 'success',
            score: 0.9,
            note: 'Use uv instead of pip for Python package management in this repository.'
          }
        })
      ].join('\n') + '\n'
    }))

    expect(result.filePath).toBe(join(repoRoot, '.stoa', 'generated', 'evolver-context', 'claude-code.jsonl'))
    await expect(readFile(result.filePath, 'utf-8')).resolves.toContain('Use uv instead of pip')
    await expect(readFile(join(repoRoot, 'CLAUDE.md'), 'utf-8')).resolves.toContain('Use uv instead of pip')
    await expect(readFile(join(repoRoot, 'CLAUDE.md'), 'utf-8')).resolves.toContain('STOA DIRECT MEMORY')
  })

  test('refreshes managed Claude block without overwriting unrelated CLAUDE.md content', async () => {
    await writeFile(join(repoRoot, 'CLAUDE.md'), [
      '# Existing Project Instructions',
      '',
      'Keep responses concise.',
      ''
    ].join('\n'), 'utf-8')

    await writePublishedContext(repoRoot, published({
      target: 'claude-code',
      content: [
        JSON.stringify({
          timestamp: '2026-04-27T00:00:00.000Z',
          signals: ['tooling_preference'],
          outcome: {
            status: 'success',
            score: 0.9,
            note: 'Use uv for project dependency changes.'
          }
        })
      ].join('\n') + '\n'
    }))

    await writePublishedContext(repoRoot, published({
      target: 'claude-code',
      content: [
        JSON.stringify({
          timestamp: '2026-04-27T00:00:00.000Z',
          signals: ['tooling_preference'],
          outcome: {
            status: 'success',
            score: 0.9,
            note: 'Use uv add for project dependencies.'
          }
        })
      ].join('\n') + '\n'
    }))

    const claudeMd = await readFile(join(repoRoot, 'CLAUDE.md'), 'utf-8')
    expect(claudeMd).toContain('# Existing Project Instructions')
    expect(claudeMd).toContain('Use uv add for project dependencies.')
    expect(claudeMd).not.toContain('Use uv for project dependency changes.')
    expect(claudeMd.match(/STOA DIRECT MEMORY/g)?.length).toBe(2)
  })

  test('writes generic memory graph context with stable hash', async () => {
    const context = published({
      target: 'generic',
      content: '{"type":"MemoryGraphEvent","scope":"generic"}\n'
    })

    const first = await writePublishedContext(repoRoot, context)
    const second = await writePublishedContext(repoRoot, context)

    expect(first.filePath).toBe(join(repoRoot, '.stoa', 'generated', 'evolver-context', 'generic.jsonl'))
    expect(first.hash).toBe(second.hash)
    await expect(readFile(first.filePath, 'utf-8')).resolves.toBe('{"type":"MemoryGraphEvent","scope":"generic"}\n')
  })

  test('rejects unsuccessful publisher result', async () => {
    await expect(writePublishedContext(repoRoot, published({ ok: false, error: 'failed' }))).rejects.toThrow('Cannot deliver failed published context')
  })
})
