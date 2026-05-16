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
            assetFileNames: []
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
              assetFileNames: []
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
})
