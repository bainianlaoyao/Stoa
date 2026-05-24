import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestTempDir } from '../../../testing/test-temp'
import { ensurePromoScaffold, resolvePromoPaths } from './promo-paths'

const tempDirs: string[] = []

describe('promo-paths', () => {
  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))))
  })

  test('resolves the promotion workspace paths from the repository root', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-paths-')
    tempDirs.push(repoRoot)

    const paths = resolvePromoPaths(repoRoot)

    expect(paths.root).toBe(join(repoRoot, 'automation', 'promo'))
    expect(paths.assetsDir).toBe(join(repoRoot, 'automation', 'promo', 'assets'))
    expect(paths.voicePath).toBe(join(repoRoot, 'automation', 'promo', 'config', 'voice.md'))
    expect(paths.manualShotListPath).toBe(join(repoRoot, 'automation', 'promo', 'config', 'manual-shot-list.md'))
    expect(paths.packsDir).toBe(join(repoRoot, 'automation', 'promo', 'packs'))
    expect(paths.todayPostsJsonPath).toBe(join(repoRoot, 'automation', 'promo', 'out', 'today-posts.json'))
    expect(paths.weekPlanJsonPath).toBe(join(repoRoot, 'automation', 'promo', 'out', 'week-plan.json'))
    expect(paths.assetManifestPath).toBe(join(repoRoot, 'automation', 'promo', 'out', 'asset-manifest.json'))
    expect(paths.replyHistoryPath).toBe(join(repoRoot, 'automation', 'promo', 'state', 'reply-history.json'))
  })

  test('creates the promo scaffold and default config files', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-scaffold-')
    tempDirs.push(repoRoot)

    const paths = await ensurePromoScaffold(repoRoot)

    expect(existsSync(paths.assetsDir)).toBe(true)
    expect(existsSync(paths.generatedAssetsDir)).toBe(true)
    expect(existsSync(paths.outDir)).toBe(true)
    expect(existsSync(paths.stateDir)).toBe(true)
    expect(existsSync(paths.packsDir)).toBe(true)
    expect(existsSync(paths.searchQueriesPath)).toBe(true)
    expect(existsSync(paths.settingsPath)).toBe(true)
    expect(existsSync(paths.voicePath)).toBe(true)
    expect(existsSync(paths.manualShotListPath)).toBe(true)

    expect(readFileSync(paths.searchQueriesPath, 'utf8')).toContain('Claude Code')
    expect(readFileSync(paths.settingsPath, 'utf8')).toContain('"defaultPostsToPublish"')
    expect(readFileSync(paths.voicePath, 'utf8')).toContain('builder account')
    expect(readFileSync(paths.voicePath, 'utf8')).toContain('open-source, non-commercial project')
    expect(readFileSync(paths.manualShotListPath, 'utf8')).toContain('point')
    expect(readFileSync(paths.manualShotListPath, 'utf8')).toContain('pack')
    expect(readFileSync(join(paths.packsDir, 'pack-first-impression.json'), 'utf8')).toContain('"pointIds"')
    expect(readFileSync(join(paths.packsDir, 'pack-recovery-loop.json'), 'utf8')).toContain('"workflow-session-archive-to-restore"')
    expect(readFileSync(join(paths.packsDir, 'pack-meta-session.json'), 'utf8')).toContain('"meta-meta-session-overview"')
    expect(readFileSync(join(paths.packsDir, 'pack-open-source-trust.json'), 'utf8')).toContain('"trust-apache-open-source"')
  })
})
