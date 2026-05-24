import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import sharp from 'sharp'
import { materializeCapturedBundles, type FinalBundleCapture } from './final-asset-capture'
import { ensurePromoScaffold } from './promo-paths'
import {
  createCanonicalPromoScenes,
  listStableCaptureAssetInventory,
  runCanonicalPromoCapture
} from './promo-electron-capture'

const MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov'])

export interface CaptureFinalPromoAssetsInput {
  repoRoot: string
  bundle?: string | null
  captureBundleImages?: (input: { repoRoot: string; assetsDir: string; bundle?: string | null }) => Promise<Record<string, string[]>>
}

export interface CaptureFinalPromoAssetsResult {
  capturedBundles: string[]
  writtenFiles: string[]
}

export async function captureFinalPromoAssets(input: CaptureFinalPromoAssetsInput): Promise<CaptureFinalPromoAssetsResult> {
  const paths = await ensurePromoScaffold(input.repoRoot)
  const bundleNotes = await readBundleNotes(paths.assetsDir)
  const bundleImages = await (input.captureBundleImages ?? defaultCaptureBundleImages)({
    repoRoot: input.repoRoot,
    assetsDir: paths.assetsDir,
    bundle: input.bundle ?? null
  })

  if (!input.bundle) {
    const missing = [...bundleNotes.keys()].filter((bundleName) => !(bundleName in bundleImages))
    if (missing.length > 0) {
      throw new Error(`Missing capture implementation for bundle(s): ${missing.join(', ')}`)
    }
  }

  const captures: FinalBundleCapture[] = []
  for (const [bundleName, note] of bundleNotes.entries()) {
    if (input.bundle && bundleName !== input.bundle) {
      continue
    }

    const images = bundleImages[bundleName]
    if (!images || images.length === 0) {
      throw new Error(`Missing capture output for bundle: ${bundleName}`)
    }

    captures.push({
      bundleName,
      note,
      images
    })
  }

  return await materializeCapturedBundles({
    assetsDir: paths.assetsDir,
    captures,
    bundleFilter: input.bundle ?? null
  })
}

async function defaultCaptureBundleImages(input: {
  repoRoot: string
  assetsDir: string
  bundle?: string | null
}): Promise<Record<string, string[]>> {
  const tempOutputDir = join(input.repoRoot, '.tmp', 'promo-final-capture')
  await mkdir(tempOutputDir, { recursive: true })

  const canonicalOutputs = await runCanonicalPromoCapture({
    repoRoot: input.repoRoot,
    outputDir: tempOutputDir,
    scenes: createCanonicalPromoScenes()
  })

  const canonicalByBundle = new Map<string, string[]>(
    canonicalOutputs.reduce<Array<[string, string[]]>>((entries, output) => {
      const bundleName = output.asset.relativePath.split('/')[1] ?? basename(output.absolutePath, extname(output.absolutePath))
      const existing = entries.find(([candidate]) => candidate === bundleName)
      if (existing) {
        existing[1].push(output.absolutePath)
      } else {
        entries.push([bundleName, [output.absolutePath]])
      }
      return entries
    }, [])
  )

  const trustOutputs = await buildTrustBundleImages({
    repoRoot: input.repoRoot,
    outputDir: tempOutputDir
  })

  const bundleMap: Record<string, string[]> = {
    'overview-app-shell': canonicalByBundle.get('overview-app-shell') ?? [],
    'overview-solution-style': canonicalByBundle.get('overview-app-shell') ?? [],
    'overview-workspace-multi-session': canonicalByBundle.get('overview-workspace-multi-session') ?? [],
    'overview-provider-mix': canonicalByBundle.get('overview-provider-mix') ?? [],
    'overview-settings-surface': canonicalByBundle.get('overview-settings-surface') ?? [],
    'overview-update-status-surface': canonicalByBundle.get('overview-update-status-surface') ?? [],
    'overview-terminal-live-output': canonicalByBundle.get('overview-terminal-live-output') ?? [],
    'workflow-new-project': canonicalByBundle.get('workflow-new-project') ?? [],
    'workflow-project-create-to-visible': canonicalByBundle.get('workflow-project-create-to-visible') ?? [],
    'workflow-new-session': canonicalByBundle.get('workflow-new-session') ?? [],
    'workflow-new-session-floating-entry': canonicalByBundle.get('workflow-new-session-floating-entry') ?? [],
    'workflow-new-session-radial-entry': canonicalByBundle.get('workflow-new-session-radial-entry') ?? [],
    'workflow-session-switching': canonicalByBundle.get('workflow-session-switching') ?? [],
    'workflow-session-state-lifecycle': [
      ...(canonicalByBundle.get('closeup-session-status-running') ?? []),
      ...(canonicalByBundle.get('closeup-session-status-ready') ?? []),
      ...(canonicalByBundle.get('closeup-session-status-blocked') ?? []),
      ...(canonicalByBundle.get('closeup-session-status-complete') ?? [])
    ],
    'workflow-session-maintenance-menu': canonicalByBundle.get('workflow-session-maintenance-menu') ?? [],
    'workflow-archive-restore': canonicalByBundle.get('workflow-session-archive-to-restore') ?? [],
    'workflow-session-archive-to-restore': canonicalByBundle.get('workflow-session-archive-to-restore') ?? [],
    'workflow-restore-return': canonicalByBundle.get('workflow-session-archive-to-restore')?.slice(-1) ?? [],
    'workflow-project-delete': canonicalByBundle.get('workflow-project-delete') ?? [],
    'workflow-project-delete-entry': canonicalByBundle.get('workflow-project-delete-entry') ?? [],
    'workflow-meta-session-archive-restore': [
      ...(canonicalByBundle.get('meta-meta-session-archived-list') ?? []),
      ...(canonicalByBundle.get('meta-meta-session-restore-action') ?? [])
    ],
    'closeup-new-project-modal-filled': canonicalByBundle.get('closeup-new-project-modal-filled') ?? [],
    'closeup-new-project-path-picker': canonicalByBundle.get('closeup-new-project-path-picker') ?? [],
    'closeup-new-project-submit-ready': canonicalByBundle.get('closeup-new-project-submit-ready') ?? [],
    'closeup-provider-floating-card': canonicalByBundle.get('closeup-provider-floating-card') ?? [],
    'closeup-provider-radial-menu': canonicalByBundle.get('closeup-provider-radial-menu') ?? [],
    'closeup-session-context-menu-restart': canonicalByBundle.get('closeup-session-context-menu-restart') ?? [],
    'closeup-session-context-menu-regenerate-title': canonicalByBundle.get('closeup-session-context-menu-restart') ?? [],
    'closeup-session-status-running': canonicalByBundle.get('closeup-session-status-running') ?? [],
    'closeup-session-status-ready': canonicalByBundle.get('closeup-session-status-ready') ?? [],
    'closeup-session-status-blocked': canonicalByBundle.get('closeup-session-status-blocked') ?? [],
    'closeup-session-status-permission-block': canonicalByBundle.get('closeup-session-status-permission-block') ?? [],
    'closeup-session-status-complete': canonicalByBundle.get('closeup-session-status-complete') ?? [],
    'closeup-session-status-failure': canonicalByBundle.get('closeup-session-status-failure') ?? [],
    'closeup-terminal-meta-bar': canonicalByBundle.get('closeup-terminal-meta-bar') ?? [],
    'closeup-terminal-meta-explanation': canonicalByBundle.get('closeup-terminal-meta-explanation') ?? [],
    'closeup-workspace-archive-action': canonicalByBundle.get('closeup-workspace-archive-action') ?? [],
    'closeup-active-session-indicator': canonicalByBundle.get('closeup-active-session-indicator') ?? [],
    'closeup-project-delete-confirm': canonicalByBundle.get('closeup-project-delete-confirm') ?? [],
    'meta-meta-session-overview': canonicalByBundle.get('meta-meta-session-overview') ?? [],
    'meta-meta-session-create-flow': canonicalByBundle.get('meta-meta-session-create-flow') ?? [],
    'meta-meta-session-list-and-inspector': canonicalByBundle.get('meta-meta-session-list-and-inspector') ?? [],
    'meta-meta-session-action-panel': canonicalByBundle.get('meta-meta-session-action-panel') ?? [],
    'meta-meta-session-status-chip': canonicalByBundle.get('meta-meta-session-status-chip') ?? [],
    'meta-meta-session-archived-list': canonicalByBundle.get('meta-meta-session-archived-list') ?? [],
    'meta-meta-session-restore-action': canonicalByBundle.get('meta-meta-session-restore-action') ?? [],
    'trust-apache-open-source': trustOutputs['trust-apache-open-source'] ?? [],
    'trust-release-velocity': trustOutputs['trust-release-velocity'] ?? [],
    'trust-github-stars-surface': trustOutputs['trust-github-stars-surface'] ?? [],
    'trust-builder-led-shipping': trustOutputs['trust-builder-led-shipping'] ?? [],
    'trust-session-lifecycle-mental-model': trustOutputs['trust-session-lifecycle-mental-model'] ?? []
  }

  if (input.bundle) {
    return {
      [input.bundle]: bundleMap[input.bundle] ?? []
    }
  }

  return bundleMap
}

async function readBundleNotes(assetsDir: string): Promise<Map<string, string>> {
  const entries = await readdir(assetsDir, { withFileTypes: true })
  const notes = new Map<string, string>()

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'generated' || entry.name === 'manual') {
      continue
    }

    const notePath = join(assetsDir, entry.name, 'index.md')
    const note = existsSync(notePath)
      ? (await readFile(notePath, 'utf8')).trim()
      : entry.name
    notes.set(entry.name, note || entry.name)
  }

  return notes
}

async function buildTrustBundleImages(input: {
  repoRoot: string
  outputDir: string
}): Promise<Record<string, string[]>> {
  const readme = existsSync(join(input.repoRoot, 'README.md'))
    ? await readFile(join(input.repoRoot, 'README.md'), 'utf8')
    : ''
  const releaseNotes = (await readdir(input.repoRoot).catch(() => []))
    .filter((entry) => /^release-notes-.*\.md$/i.test(entry))
    .sort()
  const stableCaptureCount = listStableCaptureAssetInventory().length

  return {
    'trust-apache-open-source': [await renderSimpleTrustCard({
      outputDir: input.outputDir,
      fileStem: 'trust-apache-open-source',
      eyebrow: 'Trust',
      title: 'Apache-2.0',
      lines: ['Fully open source', 'Non-commercial project', 'Forkable and auditable']
    })],
    'trust-release-velocity': [await renderSimpleTrustCard({
      outputDir: input.outputDir,
      fileStem: 'trust-release-velocity',
      eyebrow: 'Shipping',
      title: 'Recent movement',
      lines: [
        `Release notes: ${releaseNotes.length}`,
        releaseNotes.at(-1) ?? 'No release-notes file yet',
        'Builder-led iteration'
      ]
    })],
    'trust-github-stars-surface': [await renderSimpleTrustCard({
      outputDir: input.outputDir,
      fileStem: 'trust-github-stars-surface',
      eyebrow: 'GitHub',
      title: 'Stoa repo',
      lines: [
        'github.com/bainianlaoyao/Stoa',
        'README + Stars + Releases',
        'Soft CTA: star if this direction clicks'
      ]
    })],
    'trust-builder-led-shipping': [await renderSimpleTrustCard({
      outputDir: input.outputDir,
      fileStem: 'trust-builder-led-shipping',
      eyebrow: 'Builder-led',
      title: 'From use to product',
      lines: [
        'Local-first AI CLI workspace',
        'Grounded in real session pain',
        readme.includes('open-source') ? 'README matches the product story' : 'Repo speaks plainly'
      ]
    })],
    'trust-session-lifecycle-mental-model': [await renderSimpleTrustCard({
      outputDir: input.outputDir,
      fileStem: 'trust-session-lifecycle-mental-model',
      eyebrow: 'Mental model',
      title: 'Session lifecycle',
      lines: [
        'Create -> Run -> Block -> Complete',
        'Archive -> Restore',
        `Captured states: ${stableCaptureCount}`
      ]
    })]
  }
}

async function renderSimpleTrustCard(input: {
  outputDir: string
  fileStem: string
  eyebrow: string
  title: string
  lines: string[]
}): Promise<string> {
  const outputPath = join(input.outputDir, 'trust', `${input.fileStem}.png`)
  await mkdir(join(outputPath, '..'), { recursive: true })

  const escapedLines = input.lines.map((line, index) =>
    `<text x="72" y="${230 + index * 86}" font-family="Segoe UI, Arial, sans-serif" font-size="48" fill="#18303a">${escapeXml(line)}</text>`
  ).join('')

  const svg = `
    <svg width="1200" height="675" viewBox="0 0 1200 675" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f7faf8"/>
          <stop offset="100%" stop-color="#e6eef1"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="675" rx="36" fill="url(#bg)"/>
      <rect x="36" y="36" width="1128" height="603" rx="28" fill="rgba(255,255,255,0.86)" stroke="rgba(20,32,43,0.08)"/>
      <text x="72" y="122" font-family="Segoe UI, Arial, sans-serif" font-size="28" letter-spacing="4" fill="#1c7c6d">${escapeXml(input.eyebrow)}</text>
      <text x="72" y="192" font-family="Segoe UI Semibold, Segoe UI, Arial, sans-serif" font-size="82" fill="#0f1f2a">${escapeXml(input.title)}</text>
      ${escapedLines}
    </svg>
  `

  await sharp(Buffer.from(svg)).png().toFile(outputPath)
  return outputPath
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
