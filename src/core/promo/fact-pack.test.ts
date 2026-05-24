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

    await mkdir(join(paths.assetsDir, 'overview-terminal-proof'), { recursive: true })
    const assetPath = join(paths.assetsDir, 'overview-terminal-proof', '01.png')
    await writeFile(assetPath, 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'overview-terminal-proof', 'index.md'), 'Shows one terminal deck with multiple CLI sessions.', 'utf8')
    await mkdir(join(paths.generatedAssetsDir, 'workflow-session-flows'), { recursive: true })
    await writeFile(join(paths.generatedAssetsDir, 'workflow-session-flows', '01.png'), 'fake-png', 'utf8')
    await writeFile(
      join(paths.generatedAssetsDir, 'workflow-session-flows', 'index.md'),
      'Shows session restore after app relaunch.',
      'utf8'
    )
    await mkdir(join(paths.assetsDir, 'closeup-provider-floating-card'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'closeup-provider-floating-card', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'closeup-provider-floating-card', 'index.md'), 'Shows the quick new-session provider card.', 'utf8')
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
    expect(factPack.packs.map((pack) => pack.id)).toEqual([
      'pack-closeup-details',
      'pack-first-impression',
      'pack-launch-story',
      'pack-meta-session',
      'pack-open-source-trust',
      'pack-recovery-loop',
      'pack-session-control',
      'pack-workflow-proof'
    ])
    expect(factPack.packs.every((pack) => pack.pointIds.length >= 3)).toBe(true)
    expect(factPack.assets).toHaveLength(3)
    const manualAsset = factPack.assets.find((asset) => asset.relativePath === 'overview-terminal-proof/01.png')
    const generatedAsset = factPack.assets.find((asset) => asset.relativePath === 'generated/workflow-session-flows/01.png')
    const manualCaptureAsset = factPack.assets.find((asset) => asset.relativePath === 'closeup-provider-floating-card/01.png')
    expect(manualAsset).toMatchObject({
      fileName: basename(assetPath),
      pointId: 'overview-terminal-proof',
      note: 'Shows one terminal deck with multiple CLI sessions.',
      category: 'overview',
      kind: 'screenshot',
      source: 'readme-sync',
      derivesFrom: []
    })
    expect(generatedAsset).toMatchObject({
      fileName: '01.png',
      pointId: 'workflow-session-flows',
      relativePath: 'generated/workflow-session-flows/01.png',
      note: 'Shows session restore after app relaunch.',
      category: 'workflow',
      kind: 'screenshot',
      source: 'electron-capture',
      derivesFrom: []
    })
    expect(manualCaptureAsset).toMatchObject({
      fileName: '01.png',
      pointId: 'closeup-provider-floating-card',
      relativePath: 'closeup-provider-floating-card/01.png',
      category: 'closeup',
      source: 'manual-capture'
    })
    expect(factPack.recentPosts[0]?.topic).toBe('context loss')
  })

  test('reads bundle metadata from index markdown and infers pack fields from folder name', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-facts-sidecar-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')

    await mkdir(join(paths.generatedAssetsDir, 'pack-social-preview'), { recursive: true })
    await writeFile(join(paths.generatedAssetsDir, 'pack-social-preview', '01.png'), 'fake-png', 'utf8')
    await writeFile(
      join(paths.generatedAssetsDir, 'pack-social-preview', 'index.md'),
      'Wide social preview for Stoa.',
      'utf8'
    )

    const factPack = await buildFactPack(repoRoot)
    const asset = factPack.assets.find((entry) => entry.relativePath === 'generated/pack-social-preview/01.png')

    expect(asset).toMatchObject({
      pointId: 'pack-social-preview',
      category: 'pack',
      scene: 'pack-social-preview',
      kind: 'social-preview',
      alt: null,
      source: 'derived-pack',
      tags: ['pack', 'social', 'preview'],
      derivesFrom: []
    })
  })

  test('reads reusable pack definitions that reference point ids without copying assets', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-facts-packs-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')
    await mkdir(join(paths.assetsDir, 'overview-app-shell'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'overview-app-shell', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'overview-app-shell', 'index.md'), 'Shell overview.', 'utf8')
    await writeFile(join(paths.packsDir, 'pack-session-control.json'), JSON.stringify({
      id: 'pack-session-control',
      title: 'Session control',
      goal: 'Explain create, block, and recover.',
      pointIds: ['overview-app-shell', 'closeup-session-status-permission-block'],
      platforms: ['x-thread', 'x-carousel'],
      note: 'Mix broad context with one hard proof closeup.'
    }, null, 2), 'utf8')

    const factPack = await buildFactPack(repoRoot)

    expect(factPack.packs).toContainEqual({
      id: 'pack-session-control',
      title: 'Session control',
      goal: 'Explain create, block, and recover.',
      pointIds: ['overview-app-shell', 'closeup-session-status-permission-block'],
      platforms: ['x-thread', 'x-carousel'],
      note: 'Mix broad context with one hard proof closeup.'
    })
    expect(factPack.packs.some((pack) => pack.id === 'pack-open-source-trust')).toBe(true)
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
