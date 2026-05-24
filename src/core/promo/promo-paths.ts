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
  postCadencePerDay: 1,
  timeZone: 'Asia/Shanghai'
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

const DEFAULT_MANUAL_SHOT_LIST = [
  '# Manual Shot List',
  '',
  '资产目录现在分成两层：point 和 pack。',
  'point 是原子宣传点：每个宣传点一个文件夹，文件夹里放 1 到 n 张图片，再配一个自然语言 `index.md`。',
  'pack 是组合层：放在 `automation/promo/packs/*.json`，只引用 point id，不复制图片。',
  '',
  '推荐先补这些 point：',
  '- overview-solution-style',
  '- overview-app-shell',
  '- overview-workspace-multi-session',
  '- overview-provider-mix',
  '- overview-settings-surface',
  '- overview-update-status-surface',
  '- overview-terminal-live-output',
  '- workflow-new-project',
  '- workflow-project-create-to-visible',
  '- workflow-new-session',
  '- workflow-new-session-floating-entry',
  '- workflow-new-session-radial-entry',
  '- workflow-session-switching',
  '- workflow-session-state-lifecycle',
  '- workflow-session-maintenance-menu',
  '- workflow-archive-restore',
  '- workflow-session-archive-to-restore',
  '- workflow-restore-return',
  '- workflow-project-delete',
  '- workflow-project-delete-entry',
  '- workflow-meta-session-archive-restore',
  '- closeup-new-project-modal-filled',
  '- closeup-new-project-path-picker',
  '- closeup-new-project-submit-ready',
  '- closeup-provider-floating-card',
  '- closeup-provider-radial-menu',
  '- closeup-session-context-menu-restart',
  '- closeup-session-context-menu-regenerate-title',
  '- closeup-session-status-running',
  '- closeup-session-status-ready',
  '- closeup-session-status-blocked',
  '- closeup-session-status-permission-block',
  '- closeup-session-status-complete',
  '- closeup-session-status-failure',
  '- closeup-terminal-meta-bar',
  '- closeup-terminal-meta-explanation',
  '- closeup-project-delete-confirm',
  '- closeup-workspace-archive-action',
  '- closeup-active-session-indicator',
  '- meta-meta-session-overview',
  '- meta-meta-session-create-flow',
  '- meta-meta-session-list-and-inspector',
  '- meta-meta-session-action-panel',
  '- meta-meta-session-status-chip',
  '- meta-meta-session-archived-list',
  '- meta-meta-session-restore-action',
  '- trust-apache-open-source',
  '- trust-release-velocity',
  '- trust-github-stars-surface',
  '- trust-builder-led-shipping',
  '- trust-session-lifecycle-mental-model'
].join('\n')

const DEFAULT_PACK_DEFINITIONS: Array<{
  fileName: string
  content: {
    id: string
    title: string
    goal: string
    pointIds: string[]
    platforms: string[]
    note: string
  }
}> = [
  {
    fileName: 'pack-closeup-details.json',
    content: {
      id: 'pack-closeup-details',
      title: 'Closeup details',
      goal: 'Show the product through tight, human-readable detail shots.',
      pointIds: [
        'closeup-provider-floating-card',
        'closeup-active-session-indicator',
        'closeup-terminal-meta-bar',
        'closeup-project-delete-confirm'
      ],
      platforms: ['x-thread', 'x-carousel'],
      note: 'Use when the post is about interaction craft rather than broad overview.'
    }
  },
  {
    fileName: 'pack-first-impression.json',
    content: {
      id: 'pack-first-impression',
      title: 'First impression',
      goal: 'Explain what Stoa is in one quick pass.',
      pointIds: [
        'overview-app-shell',
        'overview-workspace-multi-session',
        'overview-provider-mix',
        'overview-terminal-live-output'
      ],
      platforms: ['x-thread', 'x-carousel', 'github-social'],
      note: 'Use when the post needs fast product comprehension before detail.'
    }
  },
  {
    fileName: 'pack-launch-story.json',
    content: {
      id: 'pack-launch-story',
      title: 'Launch story',
      goal: 'Tell the builder story from pain to working product.',
      pointIds: [
        'overview-solution-style',
        'overview-app-shell',
        'workflow-new-session',
        'trust-builder-led-shipping'
      ],
      platforms: ['x-thread', 'github-social'],
      note: 'Use for intro threads, pinned posts, and launch-context storytelling.'
    }
  },
  {
    fileName: 'pack-meta-session.json',
    content: {
      id: 'pack-meta-session',
      title: 'Meta session',
      goal: 'Explain the meta-session surface as a distinct product idea.',
      pointIds: [
        'meta-meta-session-overview',
        'meta-meta-session-create-flow',
        'meta-meta-session-list-and-inspector',
        'meta-meta-session-action-panel'
      ],
      platforms: ['x-thread', 'x-carousel'],
      note: 'Use when you want to explain how Stoa keeps coordination visible.'
    }
  },
  {
    fileName: 'pack-open-source-trust.json',
    content: {
      id: 'pack-open-source-trust',
      title: 'Open source trust',
      goal: 'Anchor the post in verifiable open-source proof instead of slogans.',
      pointIds: [
        'trust-apache-open-source',
        'trust-release-velocity',
        'trust-github-stars-surface',
        'trust-builder-led-shipping'
      ],
      platforms: ['x-thread', 'github-social', 'link-post'],
      note: 'Use when the post needs credibility, repo proof, or a soft star CTA.'
    }
  },
  {
    fileName: 'pack-recovery-loop.json',
    content: {
      id: 'pack-recovery-loop',
      title: 'Recovery loop',
      goal: 'Show that archive and restore are first-class workflow behaviors.',
      pointIds: [
        'workflow-archive-restore',
        'workflow-session-archive-to-restore',
        'workflow-restore-return',
        'closeup-workspace-archive-action'
      ],
      platforms: ['x-thread', 'x-carousel'],
      note: 'Use when the post is about continuity, restoration, and session hygiene.'
    }
  },
  {
    fileName: 'pack-session-control.json',
    content: {
      id: 'pack-session-control',
      title: 'Session control',
      goal: 'Explain create, status, and recovery behavior.',
      pointIds: [
        'workflow-new-session',
        'closeup-session-status-permission-block',
        'workflow-session-archive-to-restore',
        'closeup-terminal-meta-explanation'
      ],
      platforms: ['x-thread', 'x-carousel'],
      note: 'Mix one broad workflow point with hard proof closeups.'
    }
  },
  {
    fileName: 'pack-workflow-proof.json',
    content: {
      id: 'pack-workflow-proof',
      title: 'Workflow proof',
      goal: 'Prove the product with full-path workflow screenshots instead of isolated UI.',
      pointIds: [
        'workflow-new-project',
        'workflow-project-create-to-visible',
        'workflow-new-session',
        'workflow-session-switching'
      ],
      platforms: ['x-thread', 'x-carousel'],
      note: 'Use when the post needs end-to-end proof that this is a working desktop flow.'
    }
  }
]

export function resolvePromoPaths(repoRoot: string): PromoPaths {
  const root = join(repoRoot, 'automation', 'promo')
  const configDir = join(root, 'config')
  const outDir = join(root, 'out')
  const stateDir = join(root, 'state')
  const assetsDir = join(root, 'assets')
  const packsDir = join(root, 'packs')

  return {
    repoRoot,
    root,
    assetsDir,
    generatedAssetsDir: join(assetsDir, 'generated'),
    packsDir,
    configDir,
    outDir,
    stateDir,
    searchQueriesPath: join(configDir, 'search-queries.json'),
    settingsPath: join(configDir, 'settings.json'),
    voicePath: join(configDir, 'voice.md'),
    manualShotListPath: join(configDir, 'manual-shot-list.md'),
    assetManifestPath: join(outDir, 'asset-manifest.json'),
    factPackPath: join(outDir, 'fact-pack.json'),
    weekPlanJsonPath: join(outDir, 'week-plan.json'),
    weekPlanMarkdownPath: join(outDir, 'week-plan.md'),
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
  await mkdir(paths.generatedAssetsDir, { recursive: true })
  await mkdir(paths.packsDir, { recursive: true })
  await mkdir(paths.configDir, { recursive: true })
  await mkdir(paths.outDir, { recursive: true })
  await mkdir(paths.stateDir, { recursive: true })

  await writeFileIfMissing(paths.searchQueriesPath, `${JSON.stringify(DEFAULT_SEARCH_QUERIES, null, 2)}\n`)
  await writeFileIfMissing(paths.settingsPath, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`)
  await writeFileIfMissing(paths.voicePath, `${DEFAULT_VOICE}\n`)
  await writeFileIfMissing(paths.manualShotListPath, `${DEFAULT_MANUAL_SHOT_LIST}\n`)
  for (const pack of DEFAULT_PACK_DEFINITIONS) {
    await writeFileIfMissing(join(paths.packsDir, pack.fileName), `${JSON.stringify(pack.content, null, 2)}\n`)
  }

  return paths
}

async function writeFileIfMissing(path: string, content: string): Promise<void> {
  if (existsSync(path)) {
    return
  }
  await writeFile(path, content, 'utf8')
}
