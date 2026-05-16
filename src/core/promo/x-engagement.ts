import { existsSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import type {
  PromoPostCandidate,
  PromoPublishResult,
  PromoReplyCandidate,
  PromoReplySendResult,
  PromoSearchMatch,
  PromoSmokeCheckResult,
  WebbridgeClient
} from './types'

export async function smokeCheckXCompose(client: WebbridgeClient): Promise<PromoSmokeCheckResult> {
  const sessionName = `promo-smoke-${Date.now()}`
  try {
    const status = await client.readStatus()
    if (!status.running || !status.extension_connected) {
      return {
        ok: false,
        composeUrl: '',
        details: 'kimi-webbridge is not healthy'
      }
    }

    await client.command(sessionName, 'navigate', {
      url: 'https://x.com/compose/post',
      newTab: true,
      group_title: 'stoa-promo'
    })
    const snapshot = await client.command<{ url?: string }>(sessionName, 'snapshot', {})

    return {
      ok: true,
      composeUrl: snapshot.url ?? 'https://x.com/compose/post',
      details: 'compose page reachable'
    }
  } finally {
    await client.closeSession(sessionName)
  }
}

export async function collectSearchMatches(
  client: Pick<WebbridgeClient, 'command' | 'closeSession'>,
  input: {
    sessionName: string
    query: string
    limit: number
  }
): Promise<PromoSearchMatch[]> {
  try {
    await client.command(input.sessionName, 'navigate', {
      url: `https://x.com/search?q=${encodeURIComponent(input.query)}&src=typed_query&f=live`,
      newTab: true,
      group_title: 'stoa-promo-search'
    })

    const evaluation = await client.command<{
      type?: string
      value?: unknown
    }>(input.sessionName, 'evaluate', {
      code: `(() => {
        const matches = []
        const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'))
        for (const tweet of tweets) {
          const link = tweet.querySelector('a[href*="/status/"]')
          const textNode = tweet.querySelector('[data-testid="tweetText"]')
          const handleNode = tweet.querySelector('a[href^="/"][role="link"] span')
          const href = link instanceof HTMLAnchorElement ? link.href : null
          const text = textNode?.textContent?.trim() ?? ''
          const authorHandle = handleNode?.textContent?.trim() ?? ''
          if (!href || !text) continue
          matches.push({
            id: href.split('/status/')[1] ?? href,
            url: href,
            authorHandle,
            text
          })
          if (matches.length >= ${Math.max(1, input.limit)}) break
        }
        return matches
      })()`
    })

    const value = Array.isArray(evaluation.value) ? evaluation.value : []
    return value
      .map((entry) => entry as Record<string, unknown>)
      .filter((entry) => typeof entry.url === 'string' && typeof entry.text === 'string')
      .map((entry) => ({
        id: typeof entry.id === 'string' ? entry.id : String(entry.url),
        query: input.query,
        url: entry.url as string,
        authorHandle: typeof entry.authorHandle === 'string' ? entry.authorHandle : '',
        text: entry.text as string
      }))
  } finally {
    await client.closeSession(input.sessionName)
  }
}

export async function publishPostCandidate(
  client: Pick<WebbridgeClient, 'command' | 'closeSession'>,
  input: {
    repoRoot: string
    sessionName: string
    assetsDir: string
    candidate: PromoPostCandidate
    dryRun: boolean
  }
): Promise<PromoPublishResult> {
  try {
    await client.command(input.sessionName, 'navigate', {
      url: 'https://x.com/compose/post',
      newTab: true,
      group_title: 'stoa-promo-post'
    })

    const uploadFiles = input.candidate.assetFileNames
      .map((fileName) => resolvePromoAssetPath({
        repoRoot: input.repoRoot,
        assetsDir: input.assetsDir,
        assetReference: fileName
      }))
      .filter((path): path is string => !!path)

    if (uploadFiles.length > 0) {
      await client.command(input.sessionName, 'upload', {
        selector: 'input[type="file"]',
        files: uploadFiles
      })
    }

    await client.command(input.sessionName, 'fill', {
      selector: 'div[role="textbox"]',
      value: input.candidate.text
    })

    if (!input.dryRun) {
      await client.command(input.sessionName, 'click', {
        selector: 'button[data-testid="tweetButton"]'
      })
    }

    return {
      id: input.candidate.id,
      dryRun: input.dryRun
    }
  } finally {
    await client.closeSession(input.sessionName)
  }
}

function resolvePromoAssetPath(input: {
  repoRoot: string
  assetsDir: string
  assetReference: string
}): string | null {
  const reference = input.assetReference.trim()
  if (!reference) {
    return null
  }

  const candidates = [
    isAbsolute(reference) ? reference : '',
    join(input.assetsDir, reference),
    join(input.repoRoot, reference),
    join(input.assetsDir, basename(reference))
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export async function sendReplyCandidate(
  client: Pick<WebbridgeClient, 'command' | 'closeSession'>,
  input: {
    sessionName: string
    candidate: PromoReplyCandidate
    optionIndex: number
    dryRun: boolean
  }
): Promise<PromoReplySendResult> {
  const selectedText = input.candidate.options[input.optionIndex]
  if (!selectedText) {
    throw new Error(`Reply option ${input.optionIndex} does not exist`)
  }

  if (input.dryRun) {
    return {
      id: input.candidate.id,
      selectedText,
      dryRun: true
    }
  }

  try {
    await client.command(input.sessionName, 'navigate', {
      url: input.candidate.targetUrl,
      newTab: true,
      group_title: 'stoa-promo-reply'
    })
    await client.command(input.sessionName, 'click', {
      selector: 'button[data-testid="reply"]'
    })
    await client.command(input.sessionName, 'fill', {
      selector: 'div[role="textbox"]',
      value: selectedText
    })
    await client.command(input.sessionName, 'click', {
      selector: 'button[data-testid="tweetButton"]'
    })

    return {
      id: input.candidate.id,
      selectedText,
      dryRun: false
    }
  } finally {
    await client.closeSession(input.sessionName)
  }
}
