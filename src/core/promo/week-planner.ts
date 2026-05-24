import { readFile, writeFile } from 'node:fs/promises'
import { buildFactPack, writeFactPackArtifact } from './fact-pack'
import { loadPromoHistory, summarizeRecentTopics } from './history-store'
import { expandWeekPlanDayPacks, summarizePacksForPrompt } from './pack-expansion'
import { ensurePromoScaffold } from './promo-paths'
import { addDaysToPromoDate, resolvePromoDateParts } from './promo-time'
import { createClaudeStructuredOutputClient } from './claude-cli'
import type { PromoFactPack, PromoWeekPlanArtifact, PromoWeekPlanDay } from './types'

export async function planPromoWeek(input: {
  repoRoot: string
  now?: () => string
  generateStructured?: (input: {
    repoRoot: string
    now: string
    factPack: PromoFactPack
    voicePrompt: string
    recentTopics: string[]
  }) => Promise<{
    days: PromoWeekPlanDay[]
    notes: string[]
  }>
}): Promise<PromoWeekPlanArtifact & {
  weekPlanJsonPath: string
  weekPlanMarkdownPath: string
}> {
  const paths = await ensurePromoScaffold(input.repoRoot)
  const generatedAt = input.now?.() ?? new Date().toISOString()
  const factPack = await buildFactPack(input.repoRoot)
  await writeFactPackArtifact(paths, factPack)
  const history = await loadPromoHistory(paths)
  const voicePrompt = await readFile(paths.voicePath, 'utf8')
  const settings = JSON.parse(await readFile(paths.settingsPath, 'utf8')) as {
    timeZone?: string
  }
  const promoDate = resolvePromoDateParts({
    nowIso: generatedAt,
    timeZone: settings.timeZone
  })

  const generateStructured = input.generateStructured ?? defaultGenerateStructured
  const structured = await generateStructured({
    repoRoot: input.repoRoot,
    now: generatedAt,
    factPack,
    voicePrompt,
    recentTopics: summarizeRecentTopics(history.posts, 14)
  })

  const artifact: PromoWeekPlanArtifact = {
    generatedAt,
    days: expandWeekPlanDayPacks(normalizeWeekPlanDays(structured.days, promoDate.date), factPack),
    notes: structured.notes
  }

  await writeFile(paths.weekPlanJsonPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  await writeFile(paths.weekPlanMarkdownPath, renderWeekPlanMarkdown(artifact), 'utf8')

  return {
    ...artifact,
    weekPlanJsonPath: paths.weekPlanJsonPath,
    weekPlanMarkdownPath: paths.weekPlanMarkdownPath
  }
}

function normalizeWeekPlanDays(days: PromoWeekPlanDay[], startDate: string): PromoWeekPlanDay[] {
  return days.slice(0, 7).map((day, index) => {
    return {
      ...day,
      date: addDaysToPromoDate(startDate, index)
    }
  })
}

function renderWeekPlanMarkdown(artifact: PromoWeekPlanArtifact): string {
  const lines = ['# Week Plan', '', `Generated: ${artifact.generatedAt}`, '']
  for (const note of artifact.notes) {
    lines.push(`- Note: ${note}`)
  }
  if (artifact.notes.length > 0) {
    lines.push('')
  }
  for (const day of artifact.days) {
    lines.push(`## ${day.date}`)
    lines.push(`- Topic: ${day.topic}`)
    lines.push(`- Angle: ${day.angle}`)
    lines.push(`- Why now: ${day.whyNow}`)
    lines.push(`- Assets: ${day.assetPaths.join(', ') || '(none)'}`)
    lines.push('')
    lines.push(day.seedText)
    lines.push('')
  }
  return `${lines.join('\n').trim()}\n`
}

async function defaultGenerateStructured(input: {
  repoRoot: string
  now: string
  factPack: PromoFactPack
  voicePrompt: string
  recentTopics: string[]
}): Promise<{
  days: PromoWeekPlanDay[]
  notes: string[]
}> {
  const client = createClaudeStructuredOutputClient({})
  return await client.generateObject({
    repoRoot: input.repoRoot,
    prompt: [
      input.voicePrompt.trim(),
      '',
      'Produce a 7-day X content plan for Stoa.',
      'The project is open-source, non-commercial, and builder-led.',
      'Avoid ad-like tone and avoid repetitive topics.',
      'Prefer choosing a reusable packId from factPack.packs when one fits the angle.',
      'Always return assetPaths, but it is valid to leave assetPaths empty when packId is set and the system can expand it.',
      '',
      `Now: ${input.now}`,
      `Recent topics: ${JSON.stringify(input.recentTopics)}`,
      `Pack summary: ${JSON.stringify(summarizePacksForPrompt(input.factPack.packs))}`,
      `Fact pack: ${JSON.stringify(input.factPack)}`
    ].join('\n'),
    schema: {
      type: 'object',
      properties: {
        days: {
          type: 'array',
          minItems: 7,
          maxItems: 7,
          items: {
            type: 'object',
            properties: {
              date: { type: 'string' },
              topic: { type: 'string' },
              angle: { type: 'string' },
              whyNow: { type: 'string' },
              packId: { type: ['string', 'null'] },
              assetPaths: {
                type: 'array',
                items: { type: 'string' }
              },
              seedText: { type: 'string' }
            },
            required: ['date', 'topic', 'angle', 'whyNow', 'assetPaths', 'seedText']
          }
        },
        notes: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['days', 'notes']
    }
  })
}
