import { readFile, writeFile } from 'node:fs/promises'
import { buildFactPack, writeFactPackArtifact } from './fact-pack'
import { appendRunLog, loadPromoHistory } from './history-store'
import { ensurePromoScaffold } from './promo-paths'
import type {
  PromoModelOutput,
  PromoOrchestratorResult,
  PromoPaths,
  PromoSearchMatch
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
    defaultSearchLimit?: number
  }

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

  const generateStructured = input.generateStructured ?? defaultGenerateStructured
  const structured = await generateStructured({
    repoRoot: input.repoRoot,
    now: generatedAt,
    factPack,
    searchMatches,
    voicePrompt,
    historySummary: history.posts.map((post) => post.topic)
  })

  const todayArtifact = {
    generatedAt,
    notes: structured.notes,
    posts: structured.posts
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
    posts: structured.posts,
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
      '',
      `Now: ${input.now}`,
      `Recent topics: ${JSON.stringify(input.historySummary)}`,
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
              assetFileNames: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['id', 'topic', 'text', 'publishToday', 'assetFileNames']
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

