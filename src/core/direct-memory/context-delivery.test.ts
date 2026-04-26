import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
    format: 'markdown',
    run_id: 'run_1',
    source_checkpoint_id: 'chk_1',
    selected_assets: [],
    content: '# Context',
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
    const result = await writePublishedContext(repoRoot, published({ target: 'codex', content: '# Codex Context' }))

    expect(result.filePath).toBe(join(repoRoot, '.stoa', 'generated', 'evolver-context', 'codex.md'))
    await expect(readFile(result.filePath, 'utf-8')).resolves.toBe('# Codex Context')
    expect(result.hash).toMatch(/^sha256:/)
  })

  test('writes Claude Code markdown context under generated Stoa path', async () => {
    const result = await writePublishedContext(repoRoot, published({ target: 'claude-code', content: '# Claude Context' }))

    expect(result.filePath).toBe(join(repoRoot, '.stoa', 'generated', 'evolver-context', 'claude-code.md'))
    await expect(readFile(result.filePath, 'utf-8')).resolves.toBe('# Claude Context')
  })

  test('writes generic JSON context with stable hash', async () => {
    const context = published({
      target: 'generic',
      format: 'json',
      content: { instructions: ['Use stable fix'] }
    })

    const first = await writePublishedContext(repoRoot, context)
    const second = await writePublishedContext(repoRoot, context)

    expect(first.filePath).toBe(join(repoRoot, '.stoa', 'generated', 'evolver-context', 'generic.json'))
    expect(first.hash).toBe(second.hash)
    await expect(readFile(first.filePath, 'utf-8').then(JSON.parse)).resolves.toEqual({ instructions: ['Use stable fix'] })
  })

  test('rejects unsuccessful publisher result', async () => {
    await expect(writePublishedContext(repoRoot, published({ ok: false, error: 'failed' }))).rejects.toThrow('Cannot deliver failed published context')
  })
})
