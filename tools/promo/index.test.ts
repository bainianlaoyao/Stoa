import { beforeEach, describe, expect, test, vi } from 'vitest'

describe('promo cli', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('declares smoke, run-daily, publish-posts, and send-reply commands in usage text', async () => {
    const module = await import('./index')

    expect(module.USAGE_TEXT).toContain('smoke')
    expect(module.USAGE_TEXT).toContain('run-daily [--publish]')
    expect(module.USAGE_TEXT).toContain('publish-posts [--all|--id <postId>]')
    expect(module.USAGE_TEXT).toContain('send-reply --id <replyId> --option <n> [--yes]')
  })

  test('runs smoke checks and prints the result', async () => {
    const module = await import('./index')
    const writes: string[] = []

    const exitCode = await module.run(['smoke'], {
      smokeCheck: vi.fn(async () => ({
        ok: true,
        composeUrl: 'https://x.com/compose/post',
        details: 'compose page reachable'
      })),
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} }
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('compose page reachable')
  })

  test('runs the daily orchestrator and forwards the publish flag', async () => {
    const module = await import('./index')
    const runDaily = vi.fn(async () => ({
      posts: [{ id: 'post_1', publishToday: true }],
      replies: [{ id: 'reply_1' }],
      outputPaths: {
        todayPostsJsonPath: 'D:/repo/automation/promo/out/today-posts.json',
        todayPostsMarkdownPath: 'D:/repo/automation/promo/out/today-posts.md',
        replyQueueJsonPath: 'D:/repo/automation/promo/out/reply-queue.json',
        replyQueueMarkdownPath: 'D:/repo/automation/promo/out/reply-queue.md'
      }
    }))
    const writes: string[] = []

    const exitCode = await module.run(['run-daily', '--publish'], {
      runDailyOrchestrator: runDaily,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} }
    })

    expect(exitCode).toBe(0)
    expect(runDaily).toHaveBeenCalledWith(expect.objectContaining({
      publish: true
    }))
    expect(writes.join('')).toContain('today-posts.json')
  })

  test('publishes all queued posts from the artifact file', async () => {
    const module = await import('./index')
    const publishQueuedPosts = vi.fn(async () => ({
      published: ['post_1', 'post_2']
    }))

    const exitCode = await module.run(['publish-posts', '--all'], {
      publishQueuedPosts,
      stdout: { write() {} },
      stderr: { write() {} }
    })

    expect(exitCode).toBe(0)
    expect(publishQueuedPosts).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'all'
    }))
  })

  test('previews a reply without sending when --yes is absent', async () => {
    const module = await import('./index')
    const previewReply = vi.fn(async () => ({
      id: 'reply_1',
      selectedText: 'Same pain here. I ended up building Stoa around it.',
      dryRun: true
    }))
    const writes: string[] = []

    const exitCode = await module.run(['send-reply', '--id', 'reply_1', '--option', '1'], {
      previewOrSendReply: previewReply,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} }
    })

    expect(exitCode).toBe(0)
    expect(previewReply).toHaveBeenCalledWith(expect.objectContaining({
      replyId: 'reply_1',
      optionIndex: 1,
      confirm: false
    }))
    expect(writes.join('')).toContain('Same pain here')
  })

  test('sends a reply when --yes is provided', async () => {
    const module = await import('./index')
    const previewReply = vi.fn(async () => ({
      id: 'reply_1',
      selectedText: 'Same pain here. I ended up building Stoa around it.',
      dryRun: false
    }))

    const exitCode = await module.run(['send-reply', '--id', 'reply_1', '--option', '0', '--yes'], {
      previewOrSendReply: previewReply,
      stdout: { write() {} },
      stderr: { write() {} }
    })

    expect(exitCode).toBe(0)
    expect(previewReply).toHaveBeenCalledWith(expect.objectContaining({
      replyId: 'reply_1',
      optionIndex: 0,
      confirm: true
    }))
  })
})

