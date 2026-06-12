import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTestTempDir } from '../../../testing/test-temp'
import { runDailyOrchestrator } from './daily-orchestrator'
import { ensurePromoScaffold } from './promo-paths'

const tempDirs: string[] = []

describe('daily-orchestrator', () => {
  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))))
  })

  test('builds daily post and reply artifacts from fact pack, search matches, and llm output', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-orchestrator-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')
    await mkdir(join(repoRoot, 'docs', 'product'), { recursive: true })
    await writeFile(join(repoRoot, 'docs', 'product', 'promotion-copy.md'), 'local first\n', 'utf8')

    const result = await runDailyOrchestrator({
      repoRoot,
      now: () => '2026-05-16T08:00:00.000Z',
      collectSearchMatches: vi.fn(async () => [{
        id: 'tweet_1',
        query: 'Claude Code',
        url: 'https://x.com/someone/status/1',
        authorHandle: '@someone',
        text: 'Claude Code gets messy after too many sessions.'
      }]),
      generateStructured: vi.fn(async () => ({
        posts: [
          {
            id: 'post_1',
            topic: 'context loss',
            text: 'I kept losing context across too many AI CLI sessions, so I built Stoa.',
            publishToday: true,
            assetPaths: []
          }
        ],
        replies: [
          {
            id: 'reply_1',
            createdAt: '2026-05-16T08:00:00.000Z',
            query: 'Claude Code',
            targetUrl: 'https://x.com/someone/status/1',
            targetText: 'Claude Code gets messy after too many sessions.',
            whyReply: 'Strong pain signal from a likely target user.',
            options: [
              'Same pain here. I ended up building Stoa around it.'
            ]
          }
        ],
        notes: ['Keep the tone builder-like, not salesy.']
      }))
    })

    expect(result.posts).toHaveLength(1)
    expect(result.replies).toHaveLength(1)
    expect(result.posts[0]?.publishToday).toBe(true)
    expect(result.outputPaths.todayPostsJsonPath).toBe(paths.todayPostsJsonPath)
    expect(await import('node:fs/promises').then(({ readFile }) => readFile(paths.todayPostsMarkdownPath, 'utf8'))).toContain('context loss')
    expect(await import('node:fs/promises').then(({ readFile }) => readFile(paths.replyQueueMarkdownPath, 'utf8'))).toContain('Strong pain signal')
  })

  test('falls back to fact-pack-only orchestration when X search collection fails', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-orchestrator-fallback-')
    tempDirs.push(repoRoot)
    await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')

    const result = await runDailyOrchestrator({
      repoRoot,
      now: () => '2026-05-16T08:00:00.000Z',
      collectSearchMatches: vi.fn(async () => {
        throw new Error('x search unavailable')
      }),
      generateStructured: vi.fn(async (input) => {
        expect(input.searchMatches).toEqual([])
        return {
          posts: [
            {
              id: 'post_1',
              topic: 'build note',
              text: 'Small builder note from Stoa today.',
              publishToday: true,
              assetPaths: []
            }
          ],
          replies: [],
          notes: ['Search unavailable, generated posts only.']
        }
      })
    })

    expect(result.posts).toHaveLength(1)
    expect(result.replies).toEqual([])
  })

  test('injects today week-plan context when a week plan artifact exists', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-orchestrator-week-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')
    await writeFile(paths.weekPlanJsonPath, JSON.stringify({
      generatedAt: '2026-05-17T00:00:00.000Z',
      notes: ['Follow the weekly rhythm.'],
      days: [
        {
          date: '2026-05-17',
          topic: 'session restore',
          angle: 'tiny-proof',
          whyNow: 'Concrete and visual.',
          packId: 'pack-first-impression',
          assetPaths: ['generated/overview-readme-stoa-claude-code-session/01.png'],
          seedText: 'Restore is the first thing I miss in most AI CLI setups.'
        }
      ]
    }, null, 2), 'utf8')

    const generateStructured = vi.fn(async (input: {
      weekPlanFocus?: {
        topic: string
        angle: string
        whyNow: string
        assetPaths: string[]
        seedText: string
      } | null
    }) => {
      expect(input.weekPlanFocus).toMatchObject({
        topic: 'session restore',
        angle: 'tiny-proof'
      })
      return {
        posts: [
          {
            id: 'post_1',
            topic: 'session restore',
            text: 'Restore is still an underrated part of AI CLI UX.',
            publishToday: true,
            packId: 'pack-first-impression',
            assetPaths: ['generated/overview-readme-stoa-claude-code-session/01.png']
          }
        ],
        replies: [],
        notes: ['Used week plan focus.']
      }
    })

    const result = await runDailyOrchestrator({
      repoRoot,
      now: () => '2026-05-17T08:00:00.000Z',
      collectSearchMatches: vi.fn(async () => []),
      generateStructured
    })

    expect(result.posts[0]?.topic).toBe('session restore')
    expect(generateStructured).toHaveBeenCalledOnce()
  }, 15_000)

  test('passes richer derived-pack assets through the fact pack for daily orchestration', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-orchestrator-assets-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')
    await mkdir(join(paths.generatedAssetsDir, 'pack-workflow-core-carousel-1'), { recursive: true })
    await writeFile(join(paths.generatedAssetsDir, 'pack-workflow-core-carousel-1', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.generatedAssetsDir, 'pack-workflow-core-carousel-1', 'index.md'), 'Derived carousel slide.', 'utf8')

    const generateStructured = vi.fn(async (input: {
      factPack: {
        assets: Array<{ scene: string; source: string; pointId: string }>
        packs: Array<{ id: string; pointIds: string[] }>
      }
    }) => {
      expect(input.factPack.assets.some((asset) => asset.scene === 'workflow-core-carousel-1' && asset.source === 'derived-pack')).toBe(true)
      expect(input.factPack.assets.some((asset) => asset.pointId === 'pack-workflow-core-carousel-1')).toBe(true)
      expect(input.factPack.packs.some((pack) => pack.id === 'pack-first-impression')).toBe(true)
      return {
        posts: [
          {
            id: 'post_1',
            topic: 'workflow pack',
            text: 'A 4-image workflow pack is more useful than another generic product shot.',
            publishToday: true,
            packId: 'pack-workflow-proof',
            assetPaths: ['generated/pack-workflow-core-carousel-1/01.png']
          }
        ],
        replies: [],
        notes: ['Derived pack assets available.']
      }
    })

    const result = await runDailyOrchestrator({
      repoRoot,
      now: () => '2026-05-18T08:00:00.000Z',
      collectSearchMatches: vi.fn(async () => []),
      generateStructured
    })

    expect(result.posts[0]?.assetPaths).toEqual(['generated/pack-workflow-core-carousel-1/01.png'])
  }, 15_000)

  test('expands post pack ids into concrete asset paths when the model returns pack-first output', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-orchestrator-pack-expansion-')
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
    await mkdir(join(paths.generatedAssetsDir, 'overview-app-shell'), { recursive: true })
    await writeFile(join(paths.generatedAssetsDir, 'overview-app-shell', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.generatedAssetsDir, 'overview-app-shell', 'index.md'), 'Generated shell overview.', 'utf8')
    await mkdir(join(paths.generatedAssetsDir, 'overview-workspace-multi-session'), { recursive: true })
    await writeFile(join(paths.generatedAssetsDir, 'overview-workspace-multi-session', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.generatedAssetsDir, 'overview-workspace-multi-session', 'index.md'), 'Generated workspace overview.', 'utf8')

    const result = await runDailyOrchestrator({
      repoRoot,
      now: () => '2026-05-18T08:00:00.000Z',
      collectSearchMatches: vi.fn(async () => []),
      generateStructured: vi.fn(async () => ({
        posts: [
          {
            id: 'post_1',
            topic: 'what is stoa',
            text: 'The simplest way I explain Stoa now is: one local place to keep AI CLI sessions legible.',
            publishToday: true,
            packId: 'pack-first-impression',
            assetPaths: []
          }
        ],
        replies: [],
        notes: ['Pack-first output.']
      }))
    })

    expect(result.posts[0]?.packId).toBe('pack-first-impression')
    expect(result.posts[0]?.assetPaths).toEqual([
      'generated/overview-app-shell/01.png',
      'generated/overview-workspace-multi-session/01.png',
      'overview-provider-mix/01.png',
      'overview-terminal-live-output/01.png'
    ])
    expect(result.posts[0]?.assetPaths).toHaveLength(4)
  }, 15_000)

  test('deduplicates point variants when pack expansion sees both generated and manual assets', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-orchestrator-pack-dedupe-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')
    for (const pointId of [
      'overview-app-shell',
      'overview-workspace-multi-session',
      'overview-provider-mix',
      'overview-terminal-live-output'
    ]) {
      await mkdir(join(paths.assetsDir, pointId), { recursive: true })
      await writeFile(join(paths.assetsDir, pointId, '01.png'), 'fake-png', 'utf8')
      await writeFile(join(paths.assetsDir, pointId, 'index.md'), `${pointId} manual.`, 'utf8')
      await mkdir(join(paths.generatedAssetsDir, pointId), { recursive: true })
      await writeFile(join(paths.generatedAssetsDir, pointId, '01.png'), 'fake-png', 'utf8')
      await writeFile(join(paths.generatedAssetsDir, pointId, 'index.md'), `${pointId} generated.`, 'utf8')
    }

    const result = await runDailyOrchestrator({
      repoRoot,
      now: () => '2026-05-18T08:00:00.000Z',
      collectSearchMatches: vi.fn(async () => []),
      generateStructured: vi.fn(async () => ({
        posts: [
          {
            id: 'post_1',
            topic: 'what is stoa',
            text: 'The simplest way I explain Stoa now is: one local place to keep AI CLI sessions legible.',
            publishToday: true,
            packId: 'pack-first-impression',
            assetPaths: []
          }
        ],
        replies: [],
        notes: ['Pack-first output.']
      }))
    })

    expect(result.posts[0]?.assetPaths).toEqual([
      'generated/overview-app-shell/01.png',
      'generated/overview-workspace-multi-session/01.png',
      'generated/overview-provider-mix/01.png',
      'generated/overview-terminal-live-output/01.png'
    ])
    expect(result.posts[0]?.assetPaths).toHaveLength(4)
    expect(new Set(result.posts[0]?.assetPaths.map((path) => path.split('/').slice(0, -1).join('/'))).size).toBe(4)
  }, 15_000)

  test('limits fallback asset paths to four media items', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-orchestrator-fallback-limit-')
    tempDirs.push(repoRoot)
    await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')

    const result = await runDailyOrchestrator({
      repoRoot,
      now: () => '2026-05-18T08:00:00.000Z',
      collectSearchMatches: vi.fn(async () => []),
      generateStructured: vi.fn(async () => ({
        posts: [
          {
            id: 'post_1',
            topic: 'manual selection',
            text: 'Only four media should survive to publishing.',
            publishToday: true,
            assetPaths: [
              'a/01.png',
              'b/01.png',
              'c/01.png',
              'd/01.png',
              'e/01.png'
            ]
          }
        ],
        replies: [],
        notes: []
      }))
    })

    expect(result.posts[0]?.assetPaths).toEqual([
      'a/01.png',
      'b/01.png',
      'c/01.png',
      'd/01.png'
    ])
  })

  test('limits publishToday posts to the configured daily publish count', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-orchestrator-limit-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')
    await writeFile(paths.settingsPath, JSON.stringify({
      defaultPostsToPublish: 1,
      defaultSearchLimit: 5,
      postCadencePerDay: 1
    }, null, 2), 'utf8')

    const result = await runDailyOrchestrator({
      repoRoot,
      now: () => '2026-05-17T08:00:00.000Z',
      collectSearchMatches: vi.fn(async () => []),
      generateStructured: vi.fn(async () => ({
        posts: [
          {
            id: 'post_1',
            topic: 'a',
            text: 'a',
            publishToday: true,
            assetPaths: []
          },
          {
            id: 'post_2',
            topic: 'b',
            text: 'b',
            publishToday: true,
            assetPaths: []
          },
          {
            id: 'post_3',
            topic: 'c',
            text: 'c',
            publishToday: true,
            assetPaths: []
          }
        ],
        replies: [],
        notes: []
      }))
    })

    expect(result.posts.map((post) => post.publishToday)).toEqual([true, false, false])
  })

  test('selects today week-plan focus using configured local timezone instead of raw UTC date', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-orchestrator-timezone-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\nA local AI CLI workbench.\n', 'utf8')
    await writeFile(paths.settingsPath, JSON.stringify({
      defaultPostsToPublish: 1,
      defaultSearchLimit: 5,
      postCadencePerDay: 1,
      timeZone: 'Asia/Shanghai'
    }, null, 2), 'utf8')
    await writeFile(paths.weekPlanJsonPath, JSON.stringify({
      generatedAt: '2026-05-19T17:45:23.476Z',
      notes: [],
      days: [
        {
          date: '2026-05-20',
          topic: 'session state',
          angle: 'state-focus',
          whyNow: 'Local day has rolled over.',
          assetPaths: ['closeup-session-status-permission-block/01.png'],
          seedText: 'Use the local day, not the UTC day.'
        }
      ]
    }, null, 2), 'utf8')

    const generateStructured = vi.fn(async (input: {
      weekPlanFocus?: {
        topic: string
      } | null
    }) => {
      expect(input.weekPlanFocus).toMatchObject({
        topic: 'session state'
      })

      return {
        posts: [
          {
            id: 'post_1',
            topic: 'session state',
            text: 'Use local day boundaries for promo scheduling.',
            publishToday: true,
            assetPaths: []
          }
        ],
        replies: [],
        notes: []
      }
    })

    await runDailyOrchestrator({
      repoRoot,
      now: () => '2026-05-19T17:46:53.888Z',
      collectSearchMatches: vi.fn(async () => []),
      generateStructured
    })

    expect(generateStructured).toHaveBeenCalledOnce()
  })
})
