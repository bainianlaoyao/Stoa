import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestTempDir } from '../../../testing/test-temp'
import { buildFactPack, writeFactPackArtifact } from './fact-pack'
import { ensurePromoScaffold, resolvePromoPaths } from './promo-paths'

const tempDirs: string[] = []

describe('fact-pack', () => {
  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))))
  })

  test('builds a grounded fact pack from repo docs, assets, and post history', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-facts-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)

    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')
    await writeFile(join(repoRoot, 'README.zh-CN.md'), '# Stoa\n本地 AI CLI 工作台。\n', 'utf8')
    await mkdir(join(repoRoot, 'docs', 'product'), { recursive: true })
    await writeFile(join(repoRoot, 'docs', 'product', 'promotion-copy.md'), '# Copy\n- local-first\n- multi session\n', 'utf8')
    await writeFile(join(repoRoot, 'release-notes-0.2.2.md'), '0.2.2\n- fixed codex hooks\n', 'utf8')

    const assetPath = join(paths.assetsDir, 'terminal-proof.png')
    await writeFile(assetPath, 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'terminal-proof.md'), 'Shows one terminal deck with multiple CLI sessions.', 'utf8')
    await writeFile(paths.postHistoryPath, JSON.stringify([
      {
        id: 'post_1',
        createdAt: '2026-05-15T08:00:00.000Z',
        topic: 'context loss',
        text: 'I kept losing context across AI CLI sessions.'
      }
    ], null, 2), 'utf8')

    const factPack = await buildFactPack(repoRoot)

    expect(factPack.project.name).toBe('Stoa')
    expect(factPack.repoFacts.some((entry) => entry.path === 'README.md')).toBe(true)
    expect(factPack.repoFacts.some((entry) => entry.path === 'release-notes-0.2.2.md')).toBe(true)
    expect(factPack.assets).toHaveLength(1)
    expect(factPack.assets[0]).toMatchObject({
      fileName: basename(assetPath),
      note: 'Shows one terminal deck with multiple CLI sessions.'
    })
    expect(factPack.recentPosts[0]?.topic).toBe('context loss')
  })

  test('writes the fact-pack artifact to the promo output directory', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-facts-out-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')

    const factPack = await buildFactPack(repoRoot)
    await writeFactPackArtifact(paths, factPack)

    const stored = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(paths.factPackPath, 'utf8'))) as {
      project?: { name?: string }
    }
    expect(stored.project?.name).toBe('Stoa')
  })
})

