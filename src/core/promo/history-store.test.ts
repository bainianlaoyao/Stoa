import { afterEach, describe, expect, test } from 'vitest'
import { createTestTempDir } from '../../../testing/test-temp'
import { ensurePromoScaffold } from './promo-paths'
import {
  appendPostHistory,
  appendReplyHistory,
  appendRunLog,
  loadPromoHistory,
  summarizeRecentTopics
} from './history-store'

const tempDirs: string[] = []

describe('history-store', () => {
  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))))
  })

  test('loads empty promo history when the state files do not exist yet', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-history-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)

    const history = await loadPromoHistory(paths)

    expect(history.posts).toEqual([])
    expect(history.replies).toEqual([])
    expect(history.runs).toEqual([])
  })

  test('appends post, reply, and run records and summarizes recent topics', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-history-write-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)

    await appendPostHistory(paths, {
      id: 'post_1',
      createdAt: '2026-05-16T08:00:00.000Z',
      topic: 'context loss',
      text: 'I built Stoa because I kept losing context.'
    })
    await appendPostHistory(paths, {
      id: 'post_2',
      createdAt: '2026-05-16T09:00:00.000Z',
      topic: 'session restore',
      text: 'Session restore matters more than people think.'
    })
    await appendReplyHistory(paths, {
      id: 'reply_1',
      createdAt: '2026-05-16T10:00:00.000Z',
      targetUrl: 'https://x.com/someone/status/1',
      selectedOptionIndex: 1,
      text: 'Same pain here. I ended up building Stoa around it.'
    })
    await appendRunLog(paths, {
      id: 'run_1',
      startedAt: '2026-05-16T07:55:00.000Z',
      completedAt: '2026-05-16T08:05:00.000Z',
      publishedPostIds: ['post_1'],
      generatedReplyIds: ['reply_1']
    })

    const history = await loadPromoHistory(paths)
    expect(history.posts).toHaveLength(2)
    expect(history.replies).toHaveLength(1)
    expect(history.runs).toHaveLength(1)
    expect(summarizeRecentTopics(history.posts, 7)).toEqual(['context loss', 'session restore'])
  })
})

