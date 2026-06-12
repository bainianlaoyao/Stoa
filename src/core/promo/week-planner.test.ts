import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTestTempDir } from '../../../testing/test-temp'
import { planPromoWeek } from './week-planner'
import { ensurePromoScaffold } from './promo-paths'

const tempDirs: string[] = []

describe('week-planner', () => {
  afterEach(async () => {
    await Promise.allSettled(
      tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true })))
    )
  })

  test('writes 7-day week-plan json and markdown artifacts', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-week-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')
    await mkdir(join(paths.assetsDir, 'overview-app-shell'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'overview-app-shell', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'overview-app-shell', 'index.md'), 'Shell overview.', 'utf8')
    await mkdir(join(paths.assetsDir, 'overview-workspace-multi-session'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'overview-workspace-multi-session', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'overview-workspace-multi-session', 'index.md'), 'Workspace overview.', 'utf8')
    await mkdir(join(paths.assetsDir, 'overview-provider-mix'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'overview-provider-mix', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'overview-provider-mix', 'index.md'), 'Provider mix.', 'utf8')
    await mkdir(join(paths.assetsDir, 'overview-terminal-live-output'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'overview-terminal-live-output', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'overview-terminal-live-output', 'index.md'), 'Live terminal.', 'utf8')

    const result = await planPromoWeek({
      repoRoot,
      now: () => '2026-05-17T00:00:00.000Z',
      generateStructured: vi.fn(async () => ({
        days: [
          {
            date: '2026-05-17',
            topic: 'session restore',
            angle: 'tiny-proof',
            whyNow: 'Good first impression material.',
            packId: 'pack-first-impression',
            assetPaths: [],
            seedText: 'Restore matters more than adding more agents.'
          },
          {
            date: '2026-05-18',
            topic: 'meta session',
            angle: 'build-note',
            whyNow: 'Distinctive system framing.',
            packId: 'pack-meta-session',
            assetPaths: [],
            seedText: 'Meta session is how I keep the big picture visible.'
          },
          {
            date: '2026-05-19',
            topic: 'open source',
            angle: 'sharp-opinion',
            whyNow: 'Good trust anchor.',
            assetPaths: [],
            seedText: 'Apache-2.0 changes what people can safely build on top.'
          },
          {
            date: '2026-05-20',
            topic: 'session status',
            angle: 'build-note',
            whyNow: 'Explains the product philosophy.',
            assetPaths: [],
            seedText: 'Session state is a first-class UI concept in Stoa.'
          },
          {
            date: '2026-05-21',
            topic: 'new session flow',
            angle: 'tiny-proof',
            whyNow: 'Short, visual, concrete.',
            assetPaths: [],
            seedText: 'A clean new-session flow saves repeated mental friction.'
          },
          {
            date: '2026-05-22',
            topic: 'release speed',
            angle: 'build-note',
            whyNow: 'Shows momentum without sounding like hype.',
            assetPaths: [],
            seedText: 'Fast iteration only matters when the basics stay stable.'
          },
          {
            date: '2026-05-23',
            topic: 'apache license',
            angle: 'sharp-opinion',
            whyNow: 'Reinforces open-source trust.',
            assetPaths: [],
            seedText: 'Apache-2.0 is part of the product story, not a footer detail.'
          }
        ],
        notes: ['Keep it builder-like.']
      }))
    })

    expect(result.days).toHaveLength(7)
    expect(result.days[0]?.packId).toBe('pack-first-impression')
    expect(result.days[0]?.assetPaths.length).toBeGreaterThan(0)
    expect(result.weekPlanJsonPath).toBe(paths.weekPlanJsonPath)
    expect(await import('node:fs/promises').then(({ readFile }) => readFile(paths.weekPlanMarkdownPath, 'utf8'))).toContain('session restore')
  })

  test('keeps richer promo assets in the fact-pack shape used for week planning', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-week-assets-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')
    await mkdir(join(paths.generatedAssetsDir, 'pack-social-preview'), { recursive: true })
    await writeFile(join(paths.generatedAssetsDir, 'pack-social-preview', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.generatedAssetsDir, 'pack-social-preview', 'index.md'), 'Wide social preview image.', 'utf8')
    await mkdir(join(paths.assetsDir, 'closeup-session-status-blocked'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'closeup-session-status-blocked', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'closeup-session-status-blocked', 'index.md'), 'Shows the blocked session status indicator.', 'utf8')

    const generateStructured = vi.fn(async (input: {
      factPack: {
        assets: Array<{ category: string; kind: string; scene: string; source: string; pointId: string }>
        packs: Array<{ id: string; pointIds: string[] }>
      }
    }) => {
      expect(input.factPack.assets.some((asset) => asset.category === 'pack' && asset.kind === 'social-preview')).toBe(true)
      expect(input.factPack.assets.some((asset) => asset.scene === 'session-status-blocked' && asset.source === 'manual-capture')).toBe(true)
      expect(input.factPack.assets.some((asset) => asset.pointId === 'closeup-session-status-blocked')).toBe(true)
      expect(input.factPack.packs.some((pack) => pack.id === 'pack-first-impression' && pack.pointIds.length > 0)).toBe(true)
      return {
        days: Array.from({ length: 7 }, (_, index) => ({
          date: `2026-05-${String(17 + index).padStart(2, '0')}`,
          topic: `topic-${index + 1}`,
          angle: 'build-note',
          whyNow: 'because',
          packId: 'pack-open-source-trust',
          assetPaths: [],
          seedText: `seed-${index + 1}`
        })),
        notes: []
      }
    })

    await planPromoWeek({
      repoRoot,
      now: () => '2026-05-17T00:00:00.000Z',
      generateStructured
    })

    expect(generateStructured).toHaveBeenCalledOnce()
  }, 15_000)

  test('expands chosen pack ids into concrete asset paths for persisted week plans', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-week-pack-expansion-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')
    await mkdir(join(paths.assetsDir, 'overview-app-shell'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'overview-app-shell', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'overview-app-shell', 'index.md'), 'Shell overview.', 'utf8')
    await mkdir(join(paths.assetsDir, 'overview-workspace-multi-session'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'overview-workspace-multi-session', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'overview-workspace-multi-session', 'index.md'), 'Workspace overview.', 'utf8')
    await mkdir(join(paths.assetsDir, 'overview-provider-mix'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'overview-provider-mix', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'overview-provider-mix', 'index.md'), 'Provider mix.', 'utf8')
    await mkdir(join(paths.assetsDir, 'overview-terminal-live-output'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'overview-terminal-live-output', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'overview-terminal-live-output', 'index.md'), 'Live terminal.', 'utf8')

    const result = await planPromoWeek({
      repoRoot,
      now: () => '2026-05-17T00:00:00.000Z',
      generateStructured: vi.fn(async () => ({
        days: Array.from({ length: 7 }, (_, index) => ({
          date: `2026-05-${String(17 + index).padStart(2, '0')}`,
          topic: `topic-${index + 1}`,
          angle: 'build-note',
          whyNow: 'because',
          packId: 'pack-first-impression',
          assetPaths: [],
          seedText: `seed-${index + 1}`
        })),
        notes: []
      }))
    })

    expect(result.days[0]?.assetPaths).toEqual([
      'overview-app-shell/01.png',
      'overview-workspace-multi-session/01.png',
      'overview-provider-mix/01.png',
      'overview-terminal-live-output/01.png'
    ])
  })

  test('normalizes returned day dates onto the next 7-day window starting today', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-week-normalize-')
    tempDirs.push(repoRoot)
    await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')

    const result = await planPromoWeek({
      repoRoot,
      now: () => '2026-05-17T12:00:00.000Z',
      generateStructured: vi.fn(async () => ({
        days: Array.from({ length: 7 }, (_, index) => ({
          date: `2099-12-${String(index + 1).padStart(2, '0')}`,
          topic: `topic-${index + 1}`,
          angle: 'build-note',
          whyNow: 'because',
          assetPaths: [],
          seedText: `seed-${index + 1}`
        })),
        notes: []
      }))
    })

    expect(result.days.map((day) => day.date)).toEqual([
      '2026-05-17',
      '2026-05-18',
      '2026-05-19',
      '2026-05-20',
      '2026-05-21',
      '2026-05-22',
      '2026-05-23'
    ])
  }, 15_000)

  test('normalizes the week window using configured local timezone instead of UTC date slicing', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-week-timezone-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')
    await writeFile(paths.settingsPath, JSON.stringify({
      defaultPostsToPublish: 1,
      defaultSearchLimit: 5,
      postCadencePerDay: 1,
      timeZone: 'Asia/Shanghai'
    }, null, 2), 'utf8')

    const result = await planPromoWeek({
      repoRoot,
      now: () => '2026-05-19T17:45:23.476Z',
      generateStructured: vi.fn(async () => ({
        days: Array.from({ length: 7 }, (_, index) => ({
          date: `2099-12-${String(index + 1).padStart(2, '0')}`,
          topic: `topic-${index + 1}`,
          angle: 'build-note',
          whyNow: 'because',
          assetPaths: [],
          seedText: `seed-${index + 1}`
        })),
        notes: []
      }))
    })

    expect(result.days[0]?.date).toBe('2026-05-20')
    expect(result.days[1]?.date).toBe('2026-05-21')
  })
})
