import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PromoPaths } from './types'

const DEFAULT_SEARCH_QUERIES = {
  queries: [
    'Claude Code too many sessions',
    'Codex parallel sessions',
    'OpenCode session restore',
    'AI CLI terminal workflow',
    'multi agent terminal context loss'
  ]
}

const DEFAULT_SETTINGS = {
  defaultPostsToPublish: 1,
  defaultSearchLimit: 5,
  postCadencePerDay: 1
}

const DEFAULT_VOICE = [
  '# Stoa X Voice',
  '',
  'You write like a builder account, not a marketing account.',
  'Lead with real pain, real observations, and small build notes.',
  'Do not use hype words such as revolutionary, game-changing, or must-have.',
  'Remember that Stoa is an open-source, non-commercial project.',
  'Soft CTA only. Point people to the GitHub repo if it feels natural.'
].join('\n')

export function resolvePromoPaths(repoRoot: string): PromoPaths {
  const root = join(repoRoot, 'automation', 'promo')
  const configDir = join(root, 'config')
  const outDir = join(root, 'out')
  const stateDir = join(root, 'state')

  return {
    repoRoot,
    root,
    assetsDir: join(root, 'assets'),
    configDir,
    outDir,
    stateDir,
    searchQueriesPath: join(configDir, 'search-queries.json'),
    settingsPath: join(configDir, 'settings.json'),
    voicePath: join(configDir, 'voice.md'),
    factPackPath: join(outDir, 'fact-pack.json'),
    todayPostsJsonPath: join(outDir, 'today-posts.json'),
    todayPostsMarkdownPath: join(outDir, 'today-posts.md'),
    replyQueueJsonPath: join(outDir, 'reply-queue.json'),
    replyQueueMarkdownPath: join(outDir, 'reply-queue.md'),
    postHistoryPath: join(stateDir, 'post-history.json'),
    replyHistoryPath: join(stateDir, 'reply-history.json'),
    runLogPath: join(stateDir, 'run-log.json')
  }
}

export async function ensurePromoScaffold(repoRoot: string): Promise<PromoPaths> {
  const paths = resolvePromoPaths(repoRoot)
  await mkdir(paths.assetsDir, { recursive: true })
  await mkdir(paths.configDir, { recursive: true })
  await mkdir(paths.outDir, { recursive: true })
  await mkdir(paths.stateDir, { recursive: true })

  await writeFileIfMissing(paths.searchQueriesPath, `${JSON.stringify(DEFAULT_SEARCH_QUERIES, null, 2)}\n`)
  await writeFileIfMissing(paths.settingsPath, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`)
  await writeFileIfMissing(paths.voicePath, `${DEFAULT_VOICE}\n`)

  return paths
}

async function writeFileIfMissing(path: string, content: string): Promise<void> {
  if (existsSync(path)) {
    return
  }
  await writeFile(path, content, 'utf8')
}
