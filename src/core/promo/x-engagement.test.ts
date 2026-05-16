import { describe, expect, test, vi } from 'vitest'
import type { PromoPostCandidate, PromoReplyCandidate } from './types'
import type { WebbridgeClient } from './types'
import {
  collectSearchMatches,
  publishPostCandidate,
  sendReplyCandidate,
  smokeCheckXCompose
} from './x-engagement'

describe('x-engagement', () => {
  test('checks X compose availability through webbridge', async () => {
    const client = {
      readStatus: vi.fn(async () => ({ running: true, extension_connected: true })),
      command: vi.fn(async (_session: string, action: string) => {
        if (action === 'navigate') {
          return { success: true, url: 'https://x.com/compose/post' }
        }
        if (action === 'snapshot') {
          return { url: 'https://x.com/compose/post', title: 'Home / X', tree: [{ role: 'dialog' }] }
        }
        return { success: true }
      }),
      closeSession: vi.fn(async () => undefined)
    } as unknown as WebbridgeClient

    const result = await smokeCheckXCompose(client)
    expect(result.ok).toBe(true)
    expect(result.composeUrl).toBe('https://x.com/compose/post')
  })

  test('collects relevant search matches from evaluate output', async () => {
    const client = {
      command: vi.fn(async (_session: string, action: string) => {
        if (action === 'navigate') {
          return { success: true }
        }
        if (action === 'evaluate') {
          return {
            type: 'json',
            value: [
              {
                id: 'tweet_1',
                url: 'https://x.com/someone/status/1',
                authorHandle: '@someone',
                text: 'Claude Code gets messy after too many parallel sessions.'
              }
            ]
          }
        }
        return { success: true }
      }),
      closeSession: vi.fn(async () => undefined)
    } as unknown as Pick<WebbridgeClient, 'command' | 'closeSession'>

    const results = await collectSearchMatches(client, {
      sessionName: 'promo-search',
      query: 'Claude Code parallel sessions',
      limit: 3
    })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      url: 'https://x.com/someone/status/1',
      query: 'Claude Code parallel sessions'
    })
  })

  test('publishes a main post in dry-run mode without clicking send', async () => {
    const candidate: PromoPostCandidate = {
      id: 'post_1',
      topic: 'context loss',
      text: 'I kept losing context across too many AI CLI sessions.',
      publishToday: true,
      assetFileNames: ['terminal-proof.png']
    }
    const client = {
      command: vi.fn(async () => ({ success: true })),
      closeSession: vi.fn(async () => undefined)
    } as unknown as Pick<WebbridgeClient, 'command' | 'closeSession'>

    const result = await publishPostCandidate(client, {
      repoRoot: 'D:/repo',
      sessionName: 'promo-post',
      assetsDir: 'D:/repo/automation/promo/assets',
      candidate,
      dryRun: true
    })

    expect(result.dryRun).toBe(true)
    expect(client.command).toHaveBeenCalledWith('promo-post', 'fill', expect.objectContaining({
      selector: 'div[role="textbox"]',
      value: candidate.text
    }))
    expect(client.command).not.toHaveBeenCalledWith('promo-post', 'click', expect.objectContaining({
      selector: 'button[data-testid="tweetButton"]'
    }))
  })

  test('sends a selected reply option only when not in preview mode', async () => {
    const reply: PromoReplyCandidate = {
      id: 'reply_1',
      createdAt: '2026-05-16T10:00:00.000Z',
      query: 'Claude Code parallel sessions',
      targetUrl: 'https://x.com/someone/status/1',
      targetText: 'Claude Code gets messy after too many parallel sessions.',
      whyReply: 'High intent pain point',
      options: [
        'Same pain here. I ended up building Stoa around it.',
        'This is exactly why I wanted one place to manage AI CLI sessions.'
      ]
    }
    const client = {
      command: vi.fn(async () => ({ success: true })),
      closeSession: vi.fn(async () => undefined)
    } as unknown as Pick<WebbridgeClient, 'command' | 'closeSession'>

    const preview = await sendReplyCandidate(client, {
      sessionName: 'promo-reply',
      candidate: reply,
      optionIndex: 1,
      dryRun: true
    })
    expect(preview.selectedText).toContain('This is exactly why')
    expect(client.command).not.toHaveBeenCalledWith('promo-reply', 'click', expect.objectContaining({
      selector: 'button[data-testid="tweetButton"]'
    }))

    await sendReplyCandidate(client, {
      sessionName: 'promo-reply',
      candidate: reply,
      optionIndex: 0,
      dryRun: false
    })
    expect(client.command).toHaveBeenCalledWith('promo-reply', 'click', expect.objectContaining({
      selector: 'button[data-testid="reply"]'
    }))
    expect(client.command).toHaveBeenCalledWith('promo-reply', 'click', expect.objectContaining({
      selector: 'button[data-testid="tweetButton"]'
    }))
  })
})
