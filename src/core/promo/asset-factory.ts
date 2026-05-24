import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { _electron as electron, expect as playwrightExpect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createTestTempDir } from '../../../testing/test-temp'
import { collectBundleAssets } from './asset-bundles'
import { ensurePromoScaffold } from './promo-paths'
import type {
  PromoAsset,
  PromoAssetCategory,
  PromoAssetKind,
  PromoPackDefinition,
  PromoAssetSource
} from './types'

const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mov'])
const LONG_PRESS_MS = 260
const ADD_SESSION_MOUSE_DOWN_TIME = 1_000
const ADD_SESSION_MOUSE_UP_TIME = ADD_SESSION_MOUSE_DOWN_TIME + 50
const ADD_SESSION_LONG_PRESS_MOUSE_UP_TIME = ADD_SESSION_MOUSE_DOWN_TIME + LONG_PRESS_MS + 40

export interface StableCaptureAssetInventoryItem {
  relativePath: string
  note: string
  alt: string
  category: PromoAssetCategory
  scene: string
  kind: PromoAssetKind
  tags: string[]
  source: PromoAssetSource
  derivesFrom: string[]
}

type CaptureAsset = StableCaptureAssetInventoryItem

interface PromoDebugSessionSnapshot {
  id: string
  projectId: string
  title: string
  runtimeState: string
  turnState: string
  lastTurnOutcome: string
  hasUnseenCompletion: boolean
  blockingReason: string | null
  failureReason: string | null
  summary: string | null
}

interface PromoMainE2EDebugState {
  webhookPort: number | null
  sessionSecrets: Record<string, string>
  snapshot: {
    sessions: PromoDebugSessionSnapshot[]
  } | null
}

interface PromoMainE2EDebugApi {
  getDebugState: () => PromoMainE2EDebugState
  queueDialogPickFolder: (path: string | null) => void
  getTerminalReplay: (sessionId: string) => Promise<string>
  appendTerminalData: (sessionId: string, data: string) => Promise<void>
}

interface SeededProjectHandle {
  row: Locator
  title: string
}

interface SeededSessionHandle {
  id: string
  projectId: string
  secret: string | null
  row: Locator
  title: string
}

interface SeededMetaSessionHandle {
  id: string
  row: Locator
  title: string
}

interface SeededCaptureContent {
  projects: {
    workspace: SeededProjectHandle
    lab: SeededProjectHandle
  }
  sessions: {
    workspaceShell: SeededSessionHandle
    workspaceOpencode: SeededSessionHandle
    workspaceCodex: SeededSessionHandle
    workspaceClaude: SeededSessionHandle
    archivedClaude: SeededSessionHandle
  }
  meta: {
    active: SeededMetaSessionHandle
    archived: SeededMetaSessionHandle
  }
}

interface CaptureExecutionContext {
  repoRoot: string
  generatedAssetsDir: string
  electronApp: ElectronApplication
  page: Page
  seeded: SeededCaptureContent
}

interface StableCaptureScene {
  scene: string
  assets: CaptureAsset[]
  execute: (context: CaptureExecutionContext) => Promise<CaptureAsset[]>
}

interface ResolvedDebugSession {
  session: PromoDebugSessionSnapshot
  secret: string | null
  webhookPort: number
}

const README_SEED_METADATA: Record<string, {
  bundleName: string
  note: string
  alt: string
  scene: string
  tags: string[]
}> = {
  'stoa-claude-code-session.png': {
    bundleName: 'overview-readme-stoa-claude-code-session',
    note: 'Shows Claude Code sessions managed inside Stoa.',
    alt: 'Stoa showing a Claude Code session inside the app.',
    scene: 'readme-claude-code-session',
    tags: ['readme', 'claude-code', 'session']
  },
  'stoa-opencode-session.png': {
    bundleName: 'overview-readme-stoa-opencode-session',
    note: 'Shows OpenCode sessions managed inside Stoa.',
    alt: 'Stoa showing an OpenCode session inside the app.',
    scene: 'readme-opencode-session',
    tags: ['readme', 'opencode', 'session']
  },
  'stoa-icon.png': {
    bundleName: 'overview-readme-stoa-icon',
    note: 'Stoa brand icon for lightweight visual posts.',
    alt: 'The Stoa project icon.',
    scene: 'stoa-icon',
    tags: ['readme', 'brand', 'icon']
  }
}

const STABLE_CAPTURE_ASSET_INVENTORY: StableCaptureAssetInventoryItem[] = [
  {
    relativePath: 'generated/overview-app-shell/01.png',
    note: 'Shows the main Stoa shell with workspace hierarchy on the left and a live terminal surface on the right. It is the quickest “what this product feels like” overview shot.',
    alt: 'Stoa app shell with workspace hierarchy and a live terminal session visible.',
    category: 'overview',
    scene: 'app-shell',
    kind: 'screenshot',
    tags: ['overview', 'shell', 'workspace', 'terminal'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/overview-workspace-multi-session/01.png',
    note: 'Shows that one workspace can hold multiple sessions side by side in the same project tree, which is a core part of the product mental model.',
    alt: 'Workspace hierarchy with multiple sessions grouped under projects in Stoa.',
    category: 'overview',
    scene: 'workspace-multi-session',
    kind: 'screenshot',
    tags: ['overview', 'workspace', 'multi-session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/overview-provider-mix/01.png',
    note: 'Shows that shell, OpenCode, Codex, and Claude Code sessions can all live in the same workspace instead of being split across separate tools.',
    alt: 'A Stoa project showing multiple provider types in one workspace list.',
    category: 'overview',
    scene: 'provider-mix',
    kind: 'screenshot',
    tags: ['overview', 'providers', 'mix', 'workspace'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/overview-settings-surface/01.png',
    note: 'Shows the full settings surface so people can see that Stoa is not just a terminal wrapper, but an opinionated local workstation.',
    alt: 'The Stoa settings surface with navigation and configuration panels visible.',
    category: 'overview',
    scene: 'settings-surface',
    kind: 'screenshot',
    tags: ['overview', 'settings'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/overview-update-status-surface/01.png',
    note: 'Shows the built-in update status card in the About section. It helps convey that the project ships actively and exposes update state inside the product.',
    alt: 'Stoa About panel showing the update status card.',
    category: 'overview',
    scene: 'update-status-surface',
    kind: 'screenshot',
    tags: ['overview', 'settings', 'updates', 'release-velocity'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/overview-terminal-live-output/01.png',
    note: 'Shows an active terminal with real replayed output, so the material does not feel like a static settings demo.',
    alt: 'A Stoa terminal session showing live output inside the workspace.',
    category: 'overview',
    scene: 'terminal-live-output',
    kind: 'screenshot',
    tags: ['overview', 'terminal', 'live-output'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/workflow-new-session-floating-entry/01.png',
    note: 'Shows the quick add-session flow using the floating provider card anchored to a project row. It explains the default, low-friction way to start a session.',
    alt: 'A project row in Stoa with the floating provider card open for creating a new session.',
    category: 'workflow',
    scene: 'new-session-floating-entry',
    kind: 'screenshot',
    tags: ['workflow', 'new-session', 'provider-card'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/workflow-new-session-radial-entry/01.png',
    note: 'Shows the long-press radial entry for new sessions. This is one of the more memorable interaction details and deserves a dedicated workflow shot.',
    alt: 'A Stoa project row with the radial new-session menu visible.',
    category: 'workflow',
    scene: 'new-session-radial-entry',
    kind: 'screenshot',
    tags: ['workflow', 'new-session', 'radial-menu'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/workflow-session-maintenance-menu/01.png',
    note: 'Shows the session maintenance menu opened from an existing session row, making restart and title regeneration discoverable in one frame.',
    alt: 'A Stoa session row with its context menu open.',
    category: 'workflow',
    scene: 'session-maintenance-menu',
    kind: 'screenshot',
    tags: ['workflow', 'session', 'context-menu', 'maintenance'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/workflow-session-archive-to-restore/01.png',
    note: 'Shows the archive-to-restore loop from both sides: first the archived session waiting in the archive surface, then the same session returned to the active command surface.',
    alt: 'The Stoa archive surface with a restorable archived session visible.',
    category: 'workflow',
    scene: 'session-archive-to-restore-archive',
    kind: 'screenshot',
    tags: ['workflow', 'archive', 'restore'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/workflow-session-archive-to-restore/02.png',
    note: 'Shows the archive-to-restore loop from both sides: first the archived session waiting in the archive surface, then the same session returned to the active command surface.',
    alt: 'The Stoa command surface after restoring an archived session.',
    category: 'workflow',
    scene: 'session-archive-to-restore-restored',
    kind: 'screenshot',
    tags: ['workflow', 'archive', 'restore'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-provider-floating-card/01.png',
    note: 'A close crop of the floating provider card, useful when a post wants to talk about elegant session creation rather than the whole app.',
    alt: 'Close-up of the floating provider card used to create sessions in Stoa.',
    category: 'closeup',
    scene: 'provider-floating-card',
    kind: 'screenshot',
    tags: ['closeup', 'provider-card', 'new-session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-provider-radial-menu/01.png',
    note: 'A close crop of the long-press radial provider menu, focused on the interaction detail itself.',
    alt: 'Close-up of the radial provider menu in Stoa.',
    category: 'closeup',
    scene: 'provider-radial-menu',
    kind: 'screenshot',
    tags: ['closeup', 'radial-menu', 'new-session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-session-context-menu-restart/01.png',
    note: 'A close crop of the session context menu with restart visible. This is useful for posts about recovery and maintenance details.',
    alt: 'Close-up of the Stoa session context menu showing restart.',
    category: 'closeup',
    scene: 'session-context-menu-restart',
    kind: 'screenshot',
    tags: ['closeup', 'context-menu', 'restart', 'session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-session-status-ready/01.png',
    note: 'Shows the ready session state as a compact row-level status close-up.',
    alt: 'A Stoa session row showing the ready status.',
    category: 'closeup',
    scene: 'session-status-ready',
    kind: 'screenshot',
    tags: ['closeup', 'status', 'ready', 'session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-session-status-running/01.png',
    note: 'Shows the running session state as a compact row-level status close-up.',
    alt: 'A Stoa session row showing the running status.',
    category: 'closeup',
    scene: 'session-status-running',
    kind: 'screenshot',
    tags: ['closeup', 'status', 'running', 'session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-session-status-blocked/01.png',
    note: 'Shows the blocked session state, which is especially useful for explaining approval or permission pauses in a live workflow.',
    alt: 'A Stoa session row showing the blocked status.',
    category: 'closeup',
    scene: 'session-status-blocked',
    kind: 'screenshot',
    tags: ['closeup', 'status', 'blocked', 'session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-session-status-complete/01.png',
    note: 'Shows the completed session state before the completion is cleared by user attention.',
    alt: 'A Stoa session row showing the complete status.',
    category: 'closeup',
    scene: 'session-status-complete',
    kind: 'screenshot',
    tags: ['closeup', 'status', 'complete', 'session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/closeup-session-status-failure/01.png',
    note: 'Shows the failure state with the same row-level visual language, useful when talking about observability or recoverability.',
    alt: 'A Stoa session row showing the failure status.',
    category: 'closeup',
    scene: 'session-status-failure',
    kind: 'screenshot',
    tags: ['closeup', 'status', 'failure', 'session'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/meta-meta-session-overview/01.png',
    note: 'Shows the main meta session surface with sidebar, terminal deck, and inspector in one view.',
    alt: 'The Stoa meta session surface overview.',
    category: 'meta',
    scene: 'meta-session-overview',
    kind: 'screenshot',
    tags: ['meta', 'meta-session', 'overview'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/meta-meta-session-archived-list/01.png',
    note: 'Shows that meta sessions also have an archived list, reinforcing that archive and restore are first-class behaviors across the product.',
    alt: 'The meta session sidebar with the archived session list expanded.',
    category: 'meta',
    scene: 'meta-session-archived-list',
    kind: 'screenshot',
    tags: ['meta', 'meta-session', 'archive'],
    source: 'electron-capture',
    derivesFrom: []
  },
  {
    relativePath: 'generated/meta-meta-session-restore-action/01.png',
    note: 'Shows the restore action on an archived meta session row, making the recovery affordance visible without needing a long explanation.',
    alt: 'An archived meta session row with its restore action visible.',
    category: 'meta',
    scene: 'meta-session-restore-action',
    kind: 'screenshot',
    tags: ['meta', 'meta-session', 'restore', 'archive'],
    source: 'electron-capture',
    derivesFrom: []
  }
]

const STABLE_CAPTURE_ASSET_MAP = new Map(
  STABLE_CAPTURE_ASSET_INVENTORY.map((asset) => [asset.relativePath, asset] as const)
)

export async function buildPromoAssets(input: {
  repoRoot: string
  now?: () => string
  captureGeneratedAssets?: (input: { repoRoot: string; generatedAssetsDir: string }) => Promise<CaptureAsset[]>
}): Promise<{
  generatedAt: string
  manifestPath: string
  assets: PromoAsset[]
  packs: PromoPackDefinition[]
}> {
  const paths = await ensurePromoScaffold(input.repoRoot)
  const generatedAt = input.now?.() ?? new Date().toISOString()
  await rm(paths.generatedAssetsDir, { recursive: true, force: true })
  await mkdir(paths.generatedAssetsDir, { recursive: true })

  const seededAssets = await seedReadmeAssets(input.repoRoot, paths.generatedAssetsDir)
  const captured = await ((input.captureGeneratedAssets ?? defaultCaptureGeneratedAssets)({
    repoRoot: input.repoRoot,
    generatedAssetsDir: paths.generatedAssetsDir
  }).catch((error) => {
    console.warn('[promo][asset-factory] live capture failed:', error instanceof Error ? error.stack ?? error.message : String(error))
    return []
  }))

  for (const asset of captured) {
    await materializeCapturedAsset(paths.generatedAssetsDir, asset)
  }

  const trustAssets = await buildTrustCards({
    repoRoot: input.repoRoot,
    generatedAssetsDir: paths.generatedAssetsDir
  })
  const atomicAssets = await collectBundleAssets({
    bundleRootDir: paths.assetsDir,
    excludeBundleNames: ['generated']
  })
  const capturedAssets = captured.map((asset) => toPromoAsset(asset, paths.generatedAssetsDir))
  const packAssets = await buildDistributionPacks({
    generatedAssetsDir: paths.generatedAssetsDir,
    assets: dedupeAssets([
      ...atomicAssets,
      ...seededAssets,
      ...capturedAssets,
      ...trustAssets
    ])
  })
  const packs = await collectPackDefinitions(paths.packsDir)

  const assets = dedupeAssets([
    ...atomicAssets,
    ...seededAssets,
    ...capturedAssets,
    ...trustAssets,
    ...packAssets
  ])

  await writeFile(paths.assetManifestPath, `${JSON.stringify({
    generatedAt,
    packs,
    assets
  }, null, 2)}\n`, 'utf8')

  return {
    generatedAt,
    manifestPath: paths.assetManifestPath,
    assets,
    packs
  }
}

async function seedReadmeAssets(repoRoot: string, generatedAssetsDir: string): Promise<PromoAsset[]> {
  const readmeDir = join(repoRoot, 'docs', 'assets', 'readme')
  if (!existsSync(readmeDir)) {
    return []
  }

  const entries = (await readdir(readmeDir)).sort()
  const assets: PromoAsset[] = []
  for (const entry of entries) {
    const extension = entry.slice(entry.lastIndexOf('.')).toLowerCase()
    if (!ASSET_EXTENSIONS.has(extension)) {
      continue
    }

    const metadata = README_SEED_METADATA[entry] ?? {
      bundleName: `overview-readme-${entry.replace(/\.[^.]+$/, '').replaceAll('_', '-').replaceAll('.', '-').toLowerCase()}`,
      note: `Promo seed asset copied from docs/assets/readme/${entry}.`,
      alt: `Promo seed asset ${entry}.`,
      scene: entry.replace(/\.[^.]+$/, ''),
      tags: ['readme']
    }
    const bundleDir = join(generatedAssetsDir, metadata.bundleName)
    await mkdir(bundleDir, { recursive: true })
    const fileName = '01' + extension
    await cp(join(readmeDir, entry), join(bundleDir, fileName), { force: true })
    await writeBundleNote(bundleDir, metadata.note)
    assets.push({
      fileName,
      relativePath: `generated/${metadata.bundleName}/${fileName}`,
      absolutePath: join(bundleDir, fileName),
      pointId: metadata.bundleName,
      note: metadata.note,
      alt: metadata.alt,
      category: 'overview',
      scene: metadata.scene,
      kind: 'screenshot',
      tags: [...metadata.tags],
      source: 'readme-sync',
      derivesFrom: []
    })
  }

  return assets
}

function dedupeAssets(assets: PromoAsset[]): PromoAsset[] {
  const seen = new Map<string, PromoAsset>()
  for (const asset of assets) {
    seen.set(asset.relativePath, asset)
  }
  return [...seen.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

async function materializeCapturedAsset(generatedAssetsDir: string, asset: CaptureAsset): Promise<void> {
  const outputPath = join(generatedAssetsDir, asset.relativePath.replace(/^generated[\\/]/, ''))
  await mkdir(join(outputPath, '..'), { recursive: true })
  await writeBundleNote(join(outputPath, '..'), asset.note)
}

async function writeBundleNote(bundleDir: string, note: string): Promise<void> {
  await writeFile(join(bundleDir, 'index.md'), `${note.trim()}\n`, 'utf8')
}

async function buildTrustCards(input: {
  repoRoot: string
  generatedAssetsDir: string
}): Promise<PromoAsset[]> {
  const readme = existsSync(join(input.repoRoot, 'README.md'))
    ? await import('node:fs/promises').then(({ readFile }) => readFile(join(input.repoRoot, 'README.md'), 'utf8'))
    : ''
  const releaseNotes = (await readdir(input.repoRoot).catch(() => []))
    .filter((entry) => /^release-notes-.*\.md$/i.test(entry))
    .sort()

  const cards: Array<{
    bundleName: string
    note: string
    lines: string[]
  }> = [
    {
      bundleName: 'trust-apache-open-source-card',
      note: 'Highlights that Stoa is Apache-2.0, open source, and non-commercial.',
      lines: ['Apache-2.0', 'Open source', 'Non-commercial']
    },
    {
      bundleName: 'trust-release-velocity-card',
      note: 'Summarizes recent release-note activity as a lightweight proof of iteration speed.',
      lines: [
        `Release notes: ${releaseNotes.length}`,
        readme.includes('Apache-2.0') ? 'License in README' : 'Builder-led shipping',
        releaseNotes.at(-1) ?? 'No release-notes file yet'
      ]
    }
  ]

  const assets: PromoAsset[] = []
  for (const card of cards) {
    const bundleDir = join(input.generatedAssetsDir, card.bundleName)
    await mkdir(bundleDir, { recursive: true })
    const fileName = '01.png'
    await renderCardImage({
      outputPath: join(bundleDir, fileName),
      title: 'Stoa',
      eyebrow: 'Trust Proof',
      lines: card.lines
    })
    await writeBundleNote(bundleDir, card.note)
    assets.push({
      fileName,
      relativePath: `generated/${card.bundleName}/${fileName}`,
      absolutePath: join(bundleDir, fileName),
      pointId: card.bundleName,
      note: card.note,
      alt: card.note,
      category: 'trust',
      scene: card.bundleName.replace(/^trust-/, ''),
      kind: 'fact-card',
      tags: ['trust', ...card.bundleName.replace(/^trust-/, '').split('-')],
      source: 'fact-card-generator',
      derivesFrom: []
    })
  }

  return assets
}

async function buildDistributionPacks(input: {
  generatedAssetsDir: string
  assets: PromoAsset[]
}): Promise<PromoAsset[]> {
  const candidates = input.assets.filter((asset) =>
    asset.kind === 'screenshot' &&
    (asset.category === 'overview' || asset.category === 'workflow' || asset.category === 'meta')
  ).slice(0, 4)

  const packAssets: PromoAsset[] = []
  if (candidates.length > 0) {
    const carouselDir = join(input.generatedAssetsDir, 'pack-workflow-core-carousel')
    await mkdir(carouselDir, { recursive: true })
    await writeBundleNote(carouselDir, 'Derived carousel pack for workflow-centric posts.')
    for (const [index, candidate] of candidates.entries()) {
      const targetName = `${String(index + 1).padStart(2, '0')}.png`
      await cp(candidate.absolutePath, join(carouselDir, targetName), { force: true })
      packAssets.push({
        fileName: targetName,
        relativePath: `generated/pack-workflow-core-carousel/${targetName}`,
        absolutePath: join(carouselDir, targetName),
        pointId: 'pack-workflow-core-carousel',
        note: `Derived carousel slide from ${candidate.scene}.`,
        alt: candidate.alt ?? candidate.note,
        category: 'pack',
        scene: `workflow-core-carousel-${index + 1}`,
        kind: 'screenshot',
        tags: ['carousel', ...candidate.tags],
        source: 'derived-pack',
        derivesFrom: [candidate.relativePath]
      })
    }

    const singleSlideDir = join(input.generatedAssetsDir, 'pack-workflow-core-carousel-1')
    await mkdir(singleSlideDir, { recursive: true })
    await writeBundleNote(singleSlideDir, 'Derived carousel slide.')
    await cp(candidates[0].absolutePath, join(singleSlideDir, '01.png'), { force: true })
    packAssets.push({
      fileName: '01.png',
      relativePath: 'generated/pack-workflow-core-carousel-1/01.png',
      absolutePath: join(singleSlideDir, '01.png'),
      pointId: 'pack-workflow-core-carousel-1',
      note: `Derived carousel slide from ${candidates[0].scene}.`,
      alt: candidates[0].alt ?? candidates[0].note,
      category: 'pack',
      scene: 'workflow-core-carousel-1',
      kind: 'screenshot',
      tags: ['carousel', ...candidates[0].tags],
      source: 'derived-pack',
      derivesFrom: [candidates[0].relativePath]
    })
  }

  const socialPreviewDir = join(input.generatedAssetsDir, 'pack-social-preview')
  await mkdir(socialPreviewDir, { recursive: true })
  await renderCardImage({
    outputPath: join(socialPreviewDir, '01.png'),
    title: 'Stoa',
    eyebrow: 'Local AI CLI Workbench',
    lines: [
      'Multi-session',
      'Restore-aware',
      'Apache-2.0 open source'
    ],
    width: 1280,
    height: 640
  })
  await writeBundleNote(socialPreviewDir, 'Wide social preview image for Stoa links and GitHub sharing.')
  packAssets.push({
    fileName: '01.png',
    relativePath: 'generated/pack-social-preview/01.png',
    absolutePath: join(socialPreviewDir, '01.png'),
    pointId: 'pack-social-preview',
    note: 'Wide social preview image for Stoa links and GitHub sharing.',
    alt: 'Wide Stoa social preview card highlighting its local AI CLI workflow focus.',
    category: 'pack',
    scene: 'pack-social-preview',
    kind: 'social-preview',
    tags: ['pack', 'social', 'preview', 'og'],
    source: 'derived-pack',
    derivesFrom: candidates.map((asset) => asset.relativePath)
  })

  return packAssets
}

async function renderCardImage(input: {
  outputPath: string
  title: string
  eyebrow: string
  lines: string[]
  width?: number
  height?: number
}): Promise<void> {
  const width = input.width ?? 1200
  const height = input.height ?? 675
  const escapedLines = input.lines.map((line, index) =>
    `<text x="72" y="${230 + index * 92}" font-family="Segoe UI, Arial, sans-serif" font-size="52" fill="#18303a">${escapeXml(line)}</text>`
  ).join('')
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f7faf8"/>
          <stop offset="100%" stop-color="#e7eef2"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" rx="36" fill="url(#bg)"/>
      <rect x="36" y="36" width="${width - 72}" height="${height - 72}" rx="28" fill="rgba(255,255,255,0.82)" stroke="rgba(20,32,43,0.08)"/>
      <text x="72" y="122" font-family="Segoe UI, Arial, sans-serif" font-size="28" letter-spacing="4" fill="#1c7c6d">${escapeXml(input.eyebrow)}</text>
      <text x="72" y="190" font-family="Segoe UI Semibold, Segoe UI, Arial, sans-serif" font-size="84" fill="#0f1f2a">${escapeXml(input.title)}</text>
      ${escapedLines}
    </svg>
  `
  await sharp(Buffer.from(svg)).png().toFile(input.outputPath)
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function listStableCaptureAssetInventory(): StableCaptureAssetInventoryItem[] {
  return STABLE_CAPTURE_ASSET_INVENTORY.map((asset) => ({
    ...asset,
    tags: [...asset.tags],
    derivesFrom: [...asset.derivesFrom]
  }))
}

async function defaultCaptureGeneratedAssets(input: {
  repoRoot: string
  generatedAssetsDir: string
}): Promise<CaptureAsset[]> {
  const entryPath = join(input.repoRoot, 'out', 'main', 'index.cjs')
  if (!existsSync(entryPath)) {
    return []
  }

  const stateDir = await createTestTempDir('stoa-promo-capture-')
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RENDERER_URL'
      )
    ),
    NODE_ENV: 'test',
    VIBECODING_E2E: '1',
    VIBECODING_STATE_DIR: stateDir
  }

  const electronApp = await electron.launch({
    args: [entryPath],
    env
  })

  try {
    const page = await electronApp.firstWindow()
    await playwrightExpect(page.getByTestId('app-viewport')).toBeVisible({ timeout: 15000 })
    await playwrightExpect(page.getByTestId('command-panel')).toBeVisible({ timeout: 15000 })

    await installFakeRuntimeProviders(page, stateDir)
    const seeded = await seedCaptureContent(electronApp, page)

    const context: CaptureExecutionContext = {
      repoRoot: input.repoRoot,
      generatedAssetsDir: input.generatedAssetsDir,
      electronApp,
      page,
      seeded
    }

    const captured: CaptureAsset[] = []
    for (const scene of createStableCaptureScenes()) {
      await captureScene(scene.scene, async () => {
        captured.push(...await scene.execute(context))
      })
    }

    return captured
  } finally {
    try {
      await electronApp.close()
    } catch {
      // Best effort only.
    }
  }
}

function createStableCaptureScenes(): StableCaptureScene[] {
  return [
    {
      scene: 'app-shell',
      assets: [captureAsset('generated/overview-app-shell/01.png')],
      execute: async (context) => {
        await openCommandSurface(context.page)
        await context.seeded.sessions.workspaceClaude.row.click()
        await playwrightExpect(getVisibleTerminalViewport(context.page)).toBeVisible({ timeout: 15000 })
        return await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.getByTestId('app-viewport'),
          captureAsset('generated/overview-app-shell/01.png')
        )
      }
    },
    {
      scene: 'workspace-multi-session',
      assets: [captureAsset('generated/overview-workspace-multi-session/01.png')],
      execute: async (context) => {
        await openCommandSurface(context.page)
        return await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.getByTestId('workspace-hierarchy-panel'),
          captureAsset('generated/overview-workspace-multi-session/01.png')
        )
      }
    },
    {
      scene: 'provider-mix',
      assets: [captureAsset('generated/overview-provider-mix/01.png')],
      execute: async (context) => {
        await openCommandSurface(context.page)
        return await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.getByTestId('workspace-hierarchy-panel'),
          captureAsset('generated/overview-provider-mix/01.png')
        )
      }
    },
    {
      scene: 'settings-surface',
      assets: [captureAsset('generated/overview-settings-surface/01.png')],
      execute: async (context) => {
        await openSettingsSurface(context.page)
        return await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.locator('[data-surface="settings"]'),
          captureAsset('generated/overview-settings-surface/01.png')
        )
      }
    },
    {
      scene: 'update-status-surface',
      assets: [captureAsset('generated/overview-update-status-surface/01.png')],
      execute: async (context) => {
        await openSettingsAboutTab(context.page)
        return await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.locator('.settings-about__status-card').first(),
          captureAsset('generated/overview-update-status-surface/01.png')
        )
      }
    },
    {
      scene: 'terminal-live-output',
      assets: [captureAsset('generated/overview-terminal-live-output/01.png')],
      execute: async (context) => {
        await openCommandSurface(context.page)
        await context.seeded.sessions.workspaceClaude.row.click()
        await playwrightExpect(getVisibleTerminalViewport(context.page)).toBeVisible({ timeout: 15000 })
        await appendTerminalReplay(context.electronApp, context.seeded.sessions.workspaceClaude.id, [
          '$ claude-code --resume workspace',
          'Restored 4 context anchors',
          'Scanning sessions...',
          'Ready for next instruction'
        ])
        return await captureLocatorScreenshot(
          context.generatedAssetsDir,
          getVisibleTerminalViewport(context.page),
          captureAsset('generated/overview-terminal-live-output/01.png')
        )
      }
    },
    {
      scene: 'new-session-floating-entry',
      assets: [
        captureAsset('generated/workflow-new-session-floating-entry/01.png'),
        captureAsset('generated/closeup-provider-floating-card/01.png')
      ],
      execute: async (context) => {
        await openCommandSurface(context.page)
        const addButton = context.seeded.projects.workspace.row.locator('..').locator('[data-testid="workspace.add-session"]')
        await dispatchQuickAddSessionPress(context.page, addButton)
        await playwrightExpect(context.page.getByTestId('provider-card')).toBeVisible({ timeout: 10000 })

        const assets: CaptureAsset[] = []
        assets.push(...await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.getByTestId('command-panel'),
          captureAsset('generated/workflow-new-session-floating-entry/01.png')
        ))
        assets.push(...await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.getByTestId('provider-card'),
          captureAsset('generated/closeup-provider-floating-card/01.png')
        ))
        await dismissOverlay(context.page)
        return assets
      }
    },
    {
      scene: 'new-session-radial-entry',
      assets: [
        captureAsset('generated/workflow-new-session-radial-entry/01.png'),
        captureAsset('generated/closeup-provider-radial-menu/01.png')
      ],
      execute: async (context) => {
        await openCommandSurface(context.page)
        const addButton = context.seeded.projects.workspace.row.locator('..').locator('[data-testid="workspace.add-session"]')
        await openRadialMenu(context.page, addButton)
        await playwrightExpect(context.page.getByTestId('provider-radial.item').first()).toBeVisible({ timeout: 10000 })

        const assets: CaptureAsset[] = []
        assets.push(...await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.getByTestId('command-panel'),
          captureAsset('generated/workflow-new-session-radial-entry/01.png')
        ))
        assets.push(...await captureClipScreenshotAroundLocator(
          context.page,
          context.generatedAssetsDir,
          addButton,
          { x: 140, y: 140 },
          captureAsset('generated/closeup-provider-radial-menu/01.png')
        ))
        await releaseRadialMenu(context.page)
        return assets
      }
    },
    {
      scene: 'session-maintenance-menu',
      assets: [
        captureAsset('generated/workflow-session-maintenance-menu/01.png'),
        captureAsset('generated/closeup-session-context-menu-restart/01.png')
      ],
      execute: async (context) => {
        await openCommandSurface(context.page)
        await context.seeded.sessions.workspaceCodex.row.click({ button: 'right' })
        const menu = context.page.getByTestId('session-context-menu')
        await playwrightExpect(menu).toBeVisible({ timeout: 10000 })

        const assets: CaptureAsset[] = []
        assets.push(...await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.getByTestId('workspace-hierarchy-panel'),
          captureAsset('generated/workflow-session-maintenance-menu/01.png')
        ))
        assets.push(...await captureLocatorScreenshot(
          context.generatedAssetsDir,
          menu,
          captureAsset('generated/closeup-session-context-menu-restart/01.png')
        ))
        await dismissOverlay(context.page)
        return assets
      }
    },
    {
      scene: 'session-archive-to-restore',
      assets: [
        captureAsset('generated/workflow-session-archive-to-restore/01.png'),
        captureAsset('generated/workflow-session-archive-to-restore/02.png')
      ],
      execute: async (context) => {
        await openArchiveSurface(context.page)
        const archivedRow = context.page.getByTestId('archive.session.row').first()
        const assets: CaptureAsset[] = []
        assets.push(...await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.getByTestId('surface.archive'),
          captureAsset('generated/workflow-session-archive-to-restore/01.png')
        ))
        await playwrightExpect(archivedRow).toBeVisible({ timeout: 10000 })
        await context.page.getByTestId('archive.session.restore').first().click()
        await openCommandSurface(context.page)
        await playwrightExpect(context.seeded.sessions.archivedClaude.row).toBeVisible({ timeout: 15000 })
        assets.push(...await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.getByTestId('command-panel'),
          captureAsset('generated/workflow-session-archive-to-restore/02.png')
        ))
        await context.page.locator(`[data-testid="workspace.archive-session"][data-session-id="${context.seeded.sessions.archivedClaude.id}"]`).click()
        return assets
      }
    },
    {
      scene: 'session-status-lifecycle',
      assets: [
        captureAsset('generated/closeup-session-status-ready/01.png'),
        captureAsset('generated/closeup-session-status-running/01.png'),
        captureAsset('generated/closeup-session-status-blocked/01.png'),
        captureAsset('generated/closeup-session-status-complete/01.png'),
        captureAsset('generated/closeup-session-status-failure/01.png')
      ],
      execute: async (context) => {
        await openCommandSurface(context.page)
        const target = context.seeded.sessions.workspaceOpencode
        await target.row.click()
        await postCanonicalSessionEvent(context.electronApp, target, {
          eventType: 'session.started',
          payload: {
            intent: 'runtime.alive',
            runtimeState: 'alive',
            summary: 'Session running'
          }
        })
        const statusAssets: CaptureAsset[] = []
        statusAssets.push(...await captureSessionRowScreenshot(
          context.generatedAssetsDir,
          target.row,
          captureAsset('generated/closeup-session-status-ready/01.png')
        ))

        await postCanonicalSessionEvent(context.electronApp, target, {
          eventType: 'session.activity',
          payload: {
            intent: 'agent.turn_started',
            turnEpoch: 1,
            summary: 'Turn started'
          }
        })
        await expectSessionStatus(target.row, 'running')
        statusAssets.push(...await captureSessionRowScreenshot(
          context.generatedAssetsDir,
          target.row,
          captureAsset('generated/closeup-session-status-running/01.png')
        ))

        await postCanonicalSessionEvent(context.electronApp, target, {
          eventType: 'session.blocked',
          payload: {
            intent: 'agent.permission_requested',
            turnEpoch: 1,
            blockingReason: 'permission',
            summary: 'Waiting for permission'
          }
        })
        await expectSessionStatus(target.row, 'blocked')
        statusAssets.push(...await captureSessionRowScreenshot(
          context.generatedAssetsDir,
          target.row,
          captureAsset('generated/closeup-session-status-blocked/01.png')
        ))

        await postCanonicalSessionEvent(context.electronApp, target, {
          eventType: 'session.idle',
          payload: {
            intent: 'agent.turn_completed',
            turnEpoch: 1,
            summary: 'Turn complete'
          }
        })
        await expectSessionStatus(target.row, 'complete')
        statusAssets.push(...await captureSessionRowScreenshot(
          context.generatedAssetsDir,
          target.row,
          captureAsset('generated/closeup-session-status-complete/01.png')
        ))

        await postRuntimeFailure(context.electronApp, target)
        await expectSessionStatus(target.row, 'failure')
        statusAssets.push(...await captureSessionRowScreenshot(
          context.generatedAssetsDir,
          target.row,
          captureAsset('generated/closeup-session-status-failure/01.png')
        ))

        return statusAssets
      }
    },
    {
      scene: 'meta-session-overview',
      assets: [captureAsset('generated/meta-meta-session-overview/01.png')],
      execute: async (context) => {
        await openMetaSessionSurface(context.page)
        return await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.getByTestId('surface.meta-session'),
          captureAsset('generated/meta-meta-session-overview/01.png')
        )
      }
    },
    {
      scene: 'meta-session-archived-list',
      assets: [captureAsset('generated/meta-meta-session-archived-list/01.png')],
      execute: async (context) => {
        await openMetaSessionSurface(context.page)
        await openMetaArchivedSection(context.page)
        return await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.getByTestId('meta-session-session-list'),
          captureAsset('generated/meta-meta-session-archived-list/01.png')
        )
      }
    },
    {
      scene: 'meta-session-restore-action',
      assets: [captureAsset('generated/meta-meta-session-restore-action/01.png')],
      execute: async (context) => {
        await openMetaSessionSurface(context.page)
        await openMetaArchivedSection(context.page)
        return await captureLocatorScreenshot(
          context.generatedAssetsDir,
          context.page.getByTestId('meta-session.session.archived-item').first().locator('..'),
          captureAsset('generated/meta-meta-session-restore-action/01.png')
        )
      }
    }
  ]
}

async function captureScene(
  scene: string,
  run: () => Promise<void>,
  cleanup?: () => Promise<void>
): Promise<void> {
  try {
    await run()
  } catch (error) {
    console.warn(`[promo][asset-factory] scene failed: ${scene}`, error instanceof Error ? error.stack ?? error.message : String(error))
  } finally {
    if (cleanup) {
      try {
        await cleanup()
      } catch {
        // Best effort only.
      }
    }
  }
}

async function seedCaptureContent(electronApp: ElectronApplication, page: Page): Promise<SeededCaptureContent> {
  const projectAPath = join(process.env.VIBECODING_STATE_DIR ?? await createTestTempDir('stoa-promo-workspace-'), 'promo-workspace')
  const projectBPath = join(process.env.VIBECODING_STATE_DIR ?? await createTestTempDir('stoa-promo-lab-'), 'promo-lab')

  const projectARow = await createProjectViaUi(electronApp, page, {
    name: 'promo-workspace',
    path: projectAPath
  })
  const projectBRow = await createProjectViaUi(electronApp, page, {
    name: 'promo-lab',
    path: projectBPath
  })

  const workspaceShell = await createSessionViaUi(electronApp, page, projectARow, 'shell')
  const workspaceOpencode = await createSessionViaUi(electronApp, page, projectARow, 'opencode')
  const workspaceCodex = await createSessionViaUi(electronApp, page, projectARow, 'codex')
  const workspaceClaude = await createSessionViaUi(electronApp, page, projectARow, 'claude-code')
  const archivedClaude = await createSessionViaUi(electronApp, page, projectBRow, 'claude-code')
  await archivedClaude.row.click()
  await page.locator(`[data-row-archive="${archivedClaude.id}"]`).click()

  await openMetaSessionSurface(page)
  const metaActive = await createMetaSessionViaUi(page, 'claude-code')
  const metaArchived = await createMetaSessionViaUi(page, 'codex')
  await page.locator(`[data-testid="meta-session.session.archive"][data-session-id="${metaArchived.id}"]`).click()
  await openCommandSurface(page)

  await playwrightExpect(page.getByTestId('project-row')).toHaveCount(2, { timeout: 15000 })
  await playwrightExpect(page.getByTestId('session-row')).toHaveCount(4, { timeout: 15000 })

  return {
    projects: {
      workspace: { row: projectARow, title: 'promo-workspace' },
      lab: { row: projectBRow, title: 'promo-lab' }
    },
    sessions: {
      workspaceShell,
      workspaceOpencode,
      workspaceCodex,
      workspaceClaude,
      archivedClaude
    },
    meta: {
      active: metaActive,
      archived: metaArchived
    }
  }
}

async function queueNextFolderPick(
  electronApp: ElectronApplication,
  path: string | null
): Promise<void> {
  await electronApp.evaluate(async (_electron, nextPath) => {
    const api = (globalThis as typeof globalThis & {
      __VIBECODING_MAIN_E2E__?: PromoMainE2EDebugApi
    }).__VIBECODING_MAIN_E2E__
    api?.queueDialogPickFolder(nextPath)
  }, path)
}

async function createProjectViaUi(
  electronApp: ElectronApplication,
  page: Page,
  options: { name: string; path: string }
): Promise<Locator> {
  await mkdir(options.path, { recursive: true })
  await queueNextFolderPick(electronApp, options.path)

  await page.getByTestId('workspace.new-project').click()

  const dialog = page.locator('[role="dialog"]').filter({
    has: page.getByTestId('new-project.submit')
  }).first()
  await playwrightExpect(dialog).toBeVisible({ timeout: 10000 })
  await dialog.getByTestId('form-input').fill(options.name)
  await dialog.getByTestId('path-field').getByRole('button').click()
  await playwrightExpect(dialog.getByTestId('path-field').locator('input')).toHaveValue(options.path)
  await dialog.getByTestId('new-project.submit').click()

  const projectRow = page.locator(`[data-testid="project-row"][data-project-name="${options.name}"]`).first()
  await playwrightExpect(projectRow).toBeVisible({ timeout: 15000 })
  return projectRow
}

async function createSessionViaUi(
  electronApp: ElectronApplication,
  page: Page,
  projectRow: Locator,
  type: 'shell' | 'opencode' | 'codex' | 'claude-code'
): Promise<SeededSessionHandle> {
  const existingSessions = await page.locator('[data-testid="session-row"]').count()
  await projectRow.click({ button: 'right' })
  const providerGroup = page.getByTestId('provider-card')
  await playwrightExpect(providerGroup).toBeVisible({ timeout: 10000 })
  await providerGroup.locator(`[data-provider-type="${type}"]`).click()

  await playwrightExpect(page.getByTestId('session-row')).toHaveCount(existingSessions + 1, { timeout: 15000 })
  const sessionRow = page.getByTestId('session-row').nth(existingSessions)
  await playwrightExpect(sessionRow).toBeVisible({ timeout: 15000 })
  const title = await sessionRow.getAttribute('data-session-title') ?? `${type}-session`
  const debugSession = await resolveDebugSessionByTitle(electronApp, title)
  if (type !== 'shell') {
    await waitForDebugSessionMatch(electronApp, debugSession.session.id, (session) => session.runtimeState === 'alive')
  }
  return {
    id: debugSession.session.id,
    projectId: debugSession.session.projectId,
    secret: debugSession.secret,
    row: page.locator(`[data-testid="session-row"][data-session-title="${title}"]`).first(),
    title
  }
}

async function createMetaSessionViaUi(
  page: Page,
  type: 'opencode' | 'codex' | 'claude-code'
): Promise<SeededMetaSessionHandle> {
  const existingRows = await page.getByTestId('meta-session.session.item').count()
  await page.getByTestId('meta-session.session.create').click()
  await playwrightExpect(page.getByTestId('provider-card')).toBeVisible({ timeout: 10000 })
  await page.locator(`[data-testid="provider-card.item"][data-provider-type="${type}"]`).click()
  await playwrightExpect(page.getByTestId('meta-session.session.item')).toHaveCount(existingRows + 1, { timeout: 15000 })
  const row = page.getByTestId('meta-session.session.item').nth(0)
  await playwrightExpect(row).toBeVisible({ timeout: 15000 })
  const id = await row.getAttribute('data-session-id')
  const title = await row.locator('.route-session-title').first().textContent() ?? `meta-session-${existingRows + 1}`
  return {
    id: id ?? `meta-session-${existingRows + 1}`,
    row,
    title: title.trim()
  }
}

async function captureLocatorScreenshot(
  generatedAssetsDir: string,
  locator: Locator,
  input: CaptureAsset
): Promise<CaptureAsset[]> {
  const outputPath = join(generatedAssetsDir, input.relativePath.replace(/^generated[\\/]/, ''))
  await mkdir(join(outputPath, '..'), { recursive: true })
  await playwrightExpect(locator).toBeVisible({ timeout: 15000 })
  await locator.screenshot({ path: outputPath })
  await writeBundleNote(join(outputPath, '..'), input.note)
  return [{ ...input, relativePath: input.relativePath.replaceAll('\\', '/') }]
}

async function captureSessionRowScreenshot(
  generatedAssetsDir: string,
  row: Locator,
  input: CaptureAsset
): Promise<CaptureAsset[]> {
  const wrapper = row.locator('..').first()
  return await captureLocatorScreenshot(generatedAssetsDir, wrapper, input)
}

async function captureClipScreenshotAroundLocator(
  page: Page,
  generatedAssetsDir: string,
  locator: Locator,
  padding: { x: number; y: number },
  input: CaptureAsset
): Promise<CaptureAsset[]> {
  const outputPath = join(generatedAssetsDir, input.relativePath.replace(/^generated[\\/]/, ''))
  await mkdir(join(outputPath, '..'), { recursive: true })
  const box = await locator.boundingBox()
  if (!box) {
    throw new Error('Unable to resolve locator bounding box for clipped promo capture.')
  }

  const viewport = page.viewportSize() ?? { width: 1440, height: 1024 }
  const x = Math.max(0, box.x - padding.x)
  const y = Math.max(0, box.y - padding.y)
  const width = Math.min(viewport.width - x, box.width + padding.x * 2)
  const height = Math.min(viewport.height - y, box.height + padding.y * 2)

  await page.screenshot({
    path: outputPath,
    clip: {
      x,
      y,
      width,
      height
    }
  })
  await writeBundleNote(join(outputPath, '..'), input.note)
  return [{ ...input, relativePath: input.relativePath.replaceAll('\\', '/') }]
}

function toPromoAsset(asset: CaptureAsset, generatedAssetsDir: string): PromoAsset {
  const pointId = asset.relativePath.split('/')[1] ?? asset.scene
  return {
    fileName: asset.relativePath.split('/').at(-1) ?? '01.png',
    relativePath: asset.relativePath.replaceAll('\\', '/'),
    absolutePath: join(generatedAssetsDir, asset.relativePath.replace(/^generated[\\/]/, '')),
    pointId,
    note: asset.note,
    alt: asset.alt,
    category: asset.category,
    scene: asset.scene,
    kind: asset.kind,
    tags: [...asset.tags],
    source: asset.source,
    derivesFrom: [...asset.derivesFrom]
  }
}

async function collectPackDefinitions(packsDir: string): Promise<PromoPackDefinition[]> {
  if (!existsSync(packsDir)) {
    return []
  }

  const { readFile } = await import('node:fs/promises')
  const entries = (await readdir(packsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))

  const packs: PromoPackDefinition[] = []
  for (const entry of entries) {
    const parsed = JSON.parse(await readFile(join(packsDir, entry.name), 'utf8')) as Partial<PromoPackDefinition>
    if (!parsed.id || !parsed.title || !parsed.goal || !Array.isArray(parsed.pointIds) || !Array.isArray(parsed.platforms)) {
      continue
    }
    packs.push({
      id: parsed.id,
      title: parsed.title,
      goal: parsed.goal,
      pointIds: [...parsed.pointIds],
      platforms: [...parsed.platforms],
      note: typeof parsed.note === 'string' ? parsed.note : null
    })
  }

  return packs
}

function captureAsset(relativePath: string): CaptureAsset {
  const asset = STABLE_CAPTURE_ASSET_MAP.get(relativePath)
  if (!asset) {
    throw new Error(`Unknown stable capture asset ${relativePath}`)
  }

  return {
    ...asset,
    tags: [...asset.tags],
    derivesFrom: [...asset.derivesFrom]
  }
}

async function installFakeRuntimeProviders(page: Page, stateDir: string): Promise<void> {
  const fakeRuntimePath = join(stateDir, process.platform === 'win32' ? 'fake-runtime.cmd' : 'fake-runtime.sh')
  const script = process.platform === 'win32'
    ? '@echo off\r\nping -n 60 127.0.0.1 >nul\r\n'
    : '#!/bin/sh\nsleep 60\n'

  await writeFile(fakeRuntimePath, script, 'utf8')
  if (process.platform !== 'win32') {
    await chmod(fakeRuntimePath, 0o755)
  }

  await page.evaluate(async (providerPath) => {
    await window.stoa.setSetting('providers', {
      'claude-code': providerPath,
      codex: providerPath,
      opencode: providerPath
    })
  }, fakeRuntimePath)
}

async function openCommandSurface(page: Page): Promise<void> {
  await page.locator('[data-activity-item="command"]').click()
  await playwrightExpect(page.getByTestId('command-panel')).toBeVisible({ timeout: 15000 })
}

async function openSettingsSurface(page: Page): Promise<void> {
  await page.locator('[data-activity-item="settings"]').click()
  await playwrightExpect(page.locator('[data-surface="settings"]')).toBeVisible({ timeout: 15000 })
}

async function openSettingsAboutTab(page: Page): Promise<void> {
  await openSettingsSurface(page)
  await page.locator('[data-settings-tab="about"]').click()
  await playwrightExpect(page.locator('#settings-panel-about')).toBeVisible({ timeout: 15000 })
}

async function openArchiveSurface(page: Page): Promise<void> {
  await page.locator('[data-activity-item="archive"]').click()
  await playwrightExpect(page.getByTestId('surface.archive')).toBeVisible({ timeout: 15000 })
}

async function openMetaSessionSurface(page: Page): Promise<void> {
  await page.locator('[data-activity-item="meta-session"]').click()
  await playwrightExpect(page.getByTestId('surface.meta-session')).toBeVisible({ timeout: 15000 })
}

async function dismissOverlay(page: Page): Promise<void> {
  await page.mouse.click(24, 24)
}

async function openRadialMenu(_page: Page, addButton: Locator): Promise<void> {
  await addButton.dispatchEvent('mousedown')
  await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 80))
}

async function releaseRadialMenu(page: Page): Promise<void> {
  await page.mouse.up()
  await dismissOverlay(page)
}

async function dispatchQuickAddSessionPress(_page: Page, addSessionButton: Locator): Promise<void> {
  await addSessionButton.dispatchEvent('mousedown')
  await new Promise((resolve) => setTimeout(resolve, 40))
  await addSessionButton.dispatchEvent('mouseup')
}

async function resolveDebugState(
  electronApp: ElectronApplication
): Promise<PromoMainE2EDebugState & { snapshot: NonNullable<PromoMainE2EDebugState['snapshot']>; webhookPort: number }> {
  const debugState = await electronApp.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      __VIBECODING_MAIN_E2E__?: PromoMainE2EDebugApi
    }).__VIBECODING_MAIN_E2E__
    return api?.getDebugState() ?? null
  })

  if (!debugState?.snapshot || !debugState.webhookPort) {
    throw new Error('Promo capture debug state is unavailable.')
  }

  return debugState as PromoMainE2EDebugState & {
    snapshot: NonNullable<PromoMainE2EDebugState['snapshot']>
    webhookPort: number
  }
}

async function resolveDebugSessionByTitle(
  electronApp: ElectronApplication,
  title: string
): Promise<ResolvedDebugSession> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const debugState = await resolveDebugState(electronApp)
    const session = debugState.snapshot.sessions.find((candidate) => candidate.title === title)
    if (session) {
      return {
        session,
        secret: debugState.sessionSecrets[session.id] ?? null,
        webhookPort: debugState.webhookPort
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Timed out waiting for debug session ${title}`)
}

async function waitForDebugSessionMatch(
  electronApp: ElectronApplication,
  sessionId: string,
  predicate: (session: PromoDebugSessionSnapshot) => boolean
): Promise<PromoDebugSessionSnapshot> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const debugState = await resolveDebugState(electronApp)
    const session = debugState.snapshot.sessions.find((candidate) => candidate.id === sessionId)
    if (session && predicate(session)) {
      return session
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Timed out waiting for session predicate ${sessionId}`)
}

async function appendTerminalReplay(
  electronApp: ElectronApplication,
  sessionId: string,
  lines: string[]
): Promise<void> {
  await electronApp.evaluate(async (_electron, payload) => {
    const api = (globalThis as typeof globalThis & {
      __VIBECODING_MAIN_E2E__?: PromoMainE2EDebugApi
    }).__VIBECODING_MAIN_E2E__
    await api?.appendTerminalData(payload.sessionId, payload.data)
  }, {
    sessionId,
    data: `${lines.join('\r\n')}\r\n`
  })
}

async function expectSessionStatus(row: Locator, status: 'ready' | 'running' | 'blocked' | 'complete' | 'failure'): Promise<void> {
  await playwrightExpect(row.locator('[data-testid="session-status-dot"]')).toHaveAttribute(
    'data-session-status-testid',
    `session-status-${status}`,
    { timeout: 15000 }
  )
}

function getVisibleTerminalViewport(page: Page): Locator {
  return page.locator('[data-testid="terminal-viewport"]:visible').first()
}

async function postClaudeHook(
  electronApp: ElectronApplication,
  session: SeededSessionHandle,
  hookEventName: 'UserPromptSubmit' | 'PermissionRequest' | 'PreToolUse' | 'Stop'
): Promise<void> {
  const debugState = await resolveDebugState(electronApp)
  const secret = session.secret ?? debugState.sessionSecrets[session.id]
  if (!secret || !debugState.webhookPort) {
    throw new Error(`Missing webhook secret for session ${session.id}`)
  }

  const response = await fetch(`http://127.0.0.1:${debugState.webhookPort}/hooks/claude-code`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stoa-secret': secret,
      'x-stoa-session-id': session.id,
      'x-stoa-project-id': session.projectId
    },
    body: JSON.stringify({
      hook_event_name: hookEventName
    })
  })

  if (response.status !== 204) {
    throw new Error(`Claude hook ${hookEventName} failed with status ${response.status}`)
  }
}

async function postRuntimeFailure(
  electronApp: ElectronApplication,
  session: SeededSessionHandle
): Promise<void> {
  const debugState = await resolveDebugState(electronApp)
  const secret = session.secret ?? debugState.sessionSecrets[session.id]
  if (!secret || !debugState.webhookPort) {
    throw new Error(`Missing runtime secret for session ${session.id}`)
  }

  const response = await fetch(`http://127.0.0.1:${debugState.webhookPort}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stoa-secret': secret
    },
    body: JSON.stringify({
      event_version: 1,
      event_id: `evt_${randomUUID()}`,
      event_type: 'runtime.exited_failed',
      timestamp: new Date().toISOString(),
      session_id: session.id,
      project_id: session.projectId,
      source: 'provider-adapter',
      payload: {
        intent: 'runtime.exited_failed',
        runtimeExitCode: 42,
        runtimeExitReason: 'failed',
        summary: 'Runtime failed'
      }
    })
  })

  if (response.status !== 202) {
    throw new Error(`Runtime failure event failed with status ${response.status}`)
  }
}

async function postCanonicalSessionEvent(
  electronApp: ElectronApplication,
  session: SeededSessionHandle,
  input: {
    eventType: string
    payload: Record<string, unknown>
  }
): Promise<void> {
  const debugState = await resolveDebugState(electronApp)
  const secret = session.secret ?? debugState.sessionSecrets[session.id]
  if (!secret || !debugState.webhookPort) {
    throw new Error(`Missing canonical event secret for session ${session.id}`)
  }

  const response = await fetch(`http://127.0.0.1:${debugState.webhookPort}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stoa-secret': secret
    },
    body: JSON.stringify({
      event_version: 1,
      event_id: `evt_${randomUUID()}`,
      event_type: input.eventType,
      timestamp: new Date().toISOString(),
      session_id: session.id,
      project_id: session.projectId,
      source: 'provider-adapter',
      payload: input.payload
    })
  })

  if (response.status !== 202) {
    throw new Error(`Canonical event ${input.eventType} failed with status ${response.status}`)
  }
}

async function openMetaArchivedSection(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /Archived/i }).first()
  await playwrightExpect(toggle).toBeVisible({ timeout: 10000 })
  if (await page.getByTestId('meta-session.session.archived-item').count() === 0) {
    await toggle.click()
  }
  await playwrightExpect(page.getByTestId('meta-session.session.archived-item').first()).toBeVisible({ timeout: 10000 })
}
