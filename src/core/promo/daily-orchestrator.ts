import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { buildFactPack, writeFactPackArtifact } from './fact-pack'
import { appendRunLog, loadPromoHistory } from './history-store'
import { expandPostCandidatePacks, summarizePacksForPrompt } from './pack-expansion'
import { ensurePromoScaffold } from './promo-paths'
import { resolvePromoDateParts } from './promo-time'
import type {
  PromoModelOutput,
  PromoOrchestratorResult,
  PromoPaths,
  PromoSearchMatch,
  PromoWeekPlanArtifact,
  PromoWeekPlanDay
} from './types'
import { createClaudeStructuredOutputClient } from './claude-cli'
import { createWebbridgeClient } from './webbridge-client'
import { collectSearchMatches as collectSingleSearchMatches } from './x-engagement'

export async function runDailyOrchestrator(input: {
  repoRoot: string
  publish?: boolean
  now?: () => string
  collectSearchMatches?: (input: {
    repoRoot: string
    queries: string[]
    limitPerQuery: number
  }) => Promise<PromoSearchMatch[]>
  generateStructured?: (input: {
    repoRoot: string
    now: string
    factPack: Awaited<ReturnType<typeof buildFactPack>>
    searchMatches: PromoSearchMatch[]
    voicePrompt: string
    historySummary: string[]
    weekPlanFocus: PromoWeekPlanDay | null
  }) => Promise<PromoModelOutput>
}): Promise<PromoOrchestratorResult> {
  const paths = await ensurePromoScaffold(input.repoRoot)
  const generatedAt = input.now?.() ?? new Date().toISOString()
  const factPack = await buildFactPack(input.repoRoot)
  await writeFactPackArtifact(paths, factPack)

  const history = await loadPromoHistory(paths)
  const voicePrompt = await readFile(paths.voicePath, 'utf8')
  const queryConfig = JSON.parse(await readFile(paths.searchQueriesPath, 'utf8')) as {
    queries?: string[]
  }
  const settings = JSON.parse(await readFile(paths.settingsPath, 'utf8')) as {
    defaultPostsToPublish?: number
    defaultSearchLimit?: number
    timeZone?: string
  }
  const promoDate = resolvePromoDateParts({
    nowIso: generatedAt,
    timeZone: settings.timeZone
  })

  let searchMatches: PromoSearchMatch[] = []
  try {
    const collectMatches = input.collectSearchMatches ?? defaultCollectSearchMatches
    searchMatches = await collectMatches({
      repoRoot: input.repoRoot,
      queries: queryConfig.queries ?? [],
      limitPerQuery: settings.defaultSearchLimit ?? 5
    })
  } catch {
    searchMatches = []
  }

  const weekPlanFocus = await loadTodayWeekPlanFocus(paths, promoDate.date)
  const generateStructured = input.generateStructured ?? defaultGenerateStructured
  const structured = await generateStructured({
    repoRoot: input.repoRoot,
    now: generatedAt,
    factPack,
    searchMatches,
    voicePrompt,
    historySummary: history.posts.map((post) => post.topic),
    weekPlanFocus
  })
  const posts = limitPublishTodayPosts(
    expandPostCandidatePacks(structured.posts, factPack),
    settings.defaultPostsToPublish ?? 1
  )

  const todayArtifact = {
    generatedAt,
    notes: structured.notes,
    posts
  }
  const replyArtifact = {
    generatedAt,
    notes: structured.notes,
    replies: structured.replies
  }

  await writeFile(paths.todayPostsJsonPath, `${JSON.stringify(todayArtifact, null, 2)}\n`, 'utf8')
  await writeFile(paths.replyQueueJsonPath, `${JSON.stringify(replyArtifact, null, 2)}\n`, 'utf8')
  await writeFile(paths.todayPostsMarkdownPath, renderTodayPostsMarkdown(todayArtifact), 'utf8')
  await writeFile(paths.replyQueueMarkdownPath, renderReplyQueueMarkdown(replyArtifact), 'utf8')

  await appendRunLog(paths, {
    id: `run_${generatedAt}`,
    startedAt: generatedAt,
    completedAt: generatedAt,
    publishedPostIds: [],
    generatedReplyIds: structured.replies.map((reply) => reply.id)
  })

  return {
    generatedAt,
    posts,
    replies: structured.replies,
    notes: structured.notes,
    outputPaths: {
      todayPostsJsonPath: paths.todayPostsJsonPath,
      todayPostsMarkdownPath: paths.todayPostsMarkdownPath,
      replyQueueJsonPath: paths.replyQueueJsonPath,
      replyQueueMarkdownPath: paths.replyQueueMarkdownPath
    }
  }
}

function limitPublishTodayPosts<T extends PromoModelOutput['posts'][number]>(posts: T[], maxPublished: number): T[] {
  const publishLimit = Math.max(0, maxPublished)
  let publishedCount = 0

  return posts.map((post) => {
    if (!post.publishToday) {
      return post
    }
    if (publishedCount < publishLimit) {
      publishedCount += 1
      return post
    }
    return {
      ...post,
      publishToday: false
    }
  })
}

function renderTodayPostsMarkdown(input: {
  generatedAt: string
  notes: string[]
  posts: PromoModelOutput['posts']
}): string {
  const lines = [`# Today Posts`, '', `Generated: ${input.generatedAt}`, '']
  for (const note of input.notes) {
    lines.push(`- Note: ${note}`)
  }
  if (input.notes.length > 0) {
    lines.push('')
  }
  for (const post of input.posts) {
    lines.push(`## ${post.id}`)
    lines.push(`- Topic: ${post.topic}`)
    lines.push(`- Publish today: ${post.publishToday ? 'yes' : 'no'}`)
    lines.push('')
    lines.push(post.text)
    lines.push('')
  }
  return `${lines.join('\n').trim()}\n`
}

function renderReplyQueueMarkdown(input: {
  generatedAt: string
  notes: string[]
  replies: PromoModelOutput['replies']
}): string {
  const lines = [`# Reply Queue`, '', `Generated: ${input.generatedAt}`, '']
  for (const note of input.notes) {
    lines.push(`- Note: ${note}`)
  }
  if (input.notes.length > 0) {
    lines.push('')
  }
  for (const reply of input.replies) {
    lines.push(`## ${reply.id}`)
    lines.push(`- Query: ${reply.query}`)
    lines.push(`- Why: ${reply.whyReply}`)
    lines.push(`- Target: ${reply.targetUrl}`)
    lines.push('')
    reply.options.forEach((option, index) => {
      lines.push(`${index}. ${option}`)
    })
    lines.push('')
  }
  return `${lines.join('\n').trim()}\n`
}

async function defaultCollectSearchMatches(input: {
  repoRoot: string
  queries: string[]
  limitPerQuery: number
}): Promise<PromoSearchMatch[]> {
  const client = createWebbridgeClient({})
  const matches: PromoSearchMatch[] = []

  for (const [index, query] of input.queries.entries()) {
    matches.push(...await collectSingleSearchMatches(client, {
      sessionName: `promo-search-${index}-${Date.now()}`,
      query,
      limit: input.limitPerQuery
    }))
  }

  return matches
}

async function defaultGenerateStructured(input: {
  repoRoot: string
  now: string
  factPack: Awaited<ReturnType<typeof buildFactPack>>
  searchMatches: PromoSearchMatch[]
  voicePrompt: string
  historySummary: string[]
  weekPlanFocus: PromoWeekPlanDay | null
}): Promise<PromoModelOutput> {
  const client = createClaudeStructuredOutputClient({})
  return await client.generateObject<PromoModelOutput>({
    repoRoot: input.repoRoot,
    prompt: [
      input.voicePrompt.trim(),
      '',
      'Produce a JSON object with fields: posts, replies, notes.',
      'Posts should be short English builder-account posts about Stoa.',
      'Replies should only be drafted when search matches show real pain from likely AI CLI users.',
      'Avoid hype and obvious ads.',
      'Prefer choosing a reusable packId from factPack.packs when one fits the post.',
      'Always return assetPaths, but it is valid to leave assetPaths empty when packId is set and the system can expand it.',
      '',
      `Now: ${input.now}`,
      `Recent topics: ${JSON.stringify(input.historySummary)}`,
      `Week plan focus: ${JSON.stringify(input.weekPlanFocus)}`,
      `Pack summary: ${JSON.stringify(summarizePacksForPrompt(input.factPack.packs))}`,
      `Fact pack: ${JSON.stringify(input.factPack)}`,
      `Search matches: ${JSON.stringify(input.searchMatches)}`
    ].join('\n'),
    schema: {
      type: 'object',
      properties: {
        posts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              topic: { type: 'string' },
              text: { type: 'string' },
              publishToday: { type: 'boolean' },
              packId: { type: ['string', 'null'] },
              assetPaths: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['id', 'topic', 'text', 'publishToday', 'assetPaths']
          }
        },
        replies: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              createdAt: { type: 'string' },
              query: { type: 'string' },
              targetUrl: { type: 'string' },
              targetText: { type: 'string' },
              whyReply: { type: 'string' },
              options: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['id', 'createdAt', 'query', 'targetUrl', 'targetText', 'whyReply', 'options']
          }
        },
        notes: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['posts', 'replies', 'notes']
    }
  })
}

async function loadTodayWeekPlanFocus(paths: PromoPaths, today: string): Promise<PromoWeekPlanDay | null> {
  if (!existsSync(paths.weekPlanJsonPath)) {
    return null
  }

  const parsed = JSON.parse(await readFile(paths.weekPlanJsonPath, 'utf8')) as PromoWeekPlanArtifact
  return parsed.days.find((day) => day.date === today) ?? null
}
