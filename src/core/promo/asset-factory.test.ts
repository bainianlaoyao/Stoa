import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTestTempDir } from '../../../testing/test-temp'
import { buildPromoAssets, listStableCaptureAssetInventory } from './asset-factory'
import { ensurePromoScaffold } from './promo-paths'
import type { PromoAssetCategory, PromoAssetKind, PromoAssetSource } from './types'

const tempDirs: string[] = []
type CaptureGeneratedAssets = NonNullable<Parameters<typeof buildPromoAssets>[0]['captureGeneratedAssets']>

function createCaptureAsset(input: {
  relativePath: string
  note: string
  alt: string
  category: PromoAssetCategory
  scene: string
  kind: PromoAssetKind
  tags: string[]
  source: PromoAssetSource
  derivesFrom: string[]
}) {
  return input
}

describe('asset-factory', () => {
  afterEach(async () => {
    await Promise.allSettled(
      tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true })))
    )
  })

  test('seeds repo screenshots, writes bundle metadata, and produces an asset manifest', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-assets-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)

    await mkdir(join(repoRoot, 'docs', 'assets', 'readme'), { recursive: true })
    await writeFile(join(repoRoot, 'docs', 'assets', 'readme', 'stoa-claude-code-session.png'), 'fake-png', 'utf8')
    await writeFile(join(repoRoot, 'docs', 'assets', 'readme', 'stoa-opencode-session.png'), 'fake-png', 'utf8')

    const captureGeneratedAssets: CaptureGeneratedAssets = async ({ generatedAssetsDir }) => {
      await mkdir(join(generatedAssetsDir, 'workflow-workspace-overview'), { recursive: true })
      await writeFile(join(generatedAssetsDir, 'workflow-workspace-overview', '01.png'), 'fake-png', 'utf8')
      return [createCaptureAsset({
        relativePath: 'generated/workflow-workspace-overview/01.png',
        note: 'Shows the workspace overview with multiple CLI sessions.',
        alt: 'Stoa workspace overview with multiple CLI sessions visible.',
        category: 'workflow',
        scene: 'workspace-overview',
        kind: 'screenshot',
        tags: ['workspace', 'session', 'workflow'],
        source: 'electron-capture',
        derivesFrom: []
      })]
    }

    const result = await buildPromoAssets({
      repoRoot,
      now: () => '2026-05-17T10:00:00.000Z',
      captureGeneratedAssets
    })

    expect(result.assets.some((asset) => asset.relativePath === 'generated/overview-readme-stoa-claude-code-session/01.png')).toBe(true)
    expect(result.assets.some((asset) => asset.relativePath === 'generated/workflow-workspace-overview/01.png')).toBe(true)
    expect(existsSync(join(paths.generatedAssetsDir, 'overview-readme-stoa-claude-code-session', '01.png'))).toBe(true)
    expect(existsSync(join(paths.generatedAssetsDir, 'overview-readme-stoa-claude-code-session', 'index.md'))).toBe(true)
    expect(existsSync(paths.assetManifestPath)).toBe(true)

    const manifest = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(paths.assetManifestPath, 'utf8'))) as {
      generatedAt?: string
      packs?: Array<{
        id: string
        pointIds: string[]
      }>
      assets?: Array<{
        pointId: string
        relativePath: string
        category: string
        scene: string
        kind: string
        tags: string[]
        alt: string | null
        source: string
        derivesFrom: string[]
      }>
    }
    expect(manifest.generatedAt).toBe('2026-05-17T10:00:00.000Z')
    expect(manifest.packs?.some((pack) => pack.id === 'pack-first-impression' && pack.pointIds.length > 0)).toBe(true)
    expect(manifest.assets?.some((asset) => (
      asset.relativePath === 'generated/workflow-workspace-overview/01.png' &&
      asset.pointId === 'workflow-workspace-overview' &&
      asset.category === 'workflow' &&
      asset.scene === 'workspace-overview' &&
      asset.kind === 'screenshot' &&
      asset.source === 'electron-capture' &&
      asset.alt === 'Stoa workspace overview with multiple CLI sessions visible.' &&
      asset.tags.includes('session') &&
      asset.derivesFrom.length === 0
    ))).toBe(true)
  })

  test('default auto capture inventory aligns with flattened promo bundle names', () => {
    const relativePaths = listStableCaptureAssetInventory().map((asset) => asset.relativePath)

    expect(relativePaths).toEqual(expect.arrayContaining([
      'generated/overview-app-shell/01.png',
      'generated/overview-workspace-multi-session/01.png',
      'generated/overview-provider-mix/01.png',
      'generated/overview-settings-surface/01.png',
      'generated/overview-update-status-surface/01.png',
      'generated/overview-terminal-live-output/01.png',
      'generated/workflow-new-session-floating-entry/01.png',
      'generated/workflow-new-session-radial-entry/01.png',
      'generated/workflow-session-maintenance-menu/01.png',
      'generated/workflow-session-archive-to-restore/01.png',
      'generated/workflow-session-archive-to-restore/02.png',
      'generated/closeup-provider-floating-card/01.png',
      'generated/closeup-provider-radial-menu/01.png',
      'generated/closeup-session-context-menu-restart/01.png',
      'generated/closeup-session-status-ready/01.png',
      'generated/closeup-session-status-running/01.png',
      'generated/closeup-session-status-blocked/01.png',
      'generated/closeup-session-status-complete/01.png',
      'generated/closeup-session-status-failure/01.png',
      'generated/meta-meta-session-overview/01.png',
      'generated/meta-meta-session-archived-list/01.png',
      'generated/meta-meta-session-restore-action/01.png'
    ]))

    expect(relativePaths).not.toContain('generated/overview-app-shell-overview/01.png')
    expect(relativePaths).not.toContain('generated/workflow-workspace-multi-session/01.png')
    expect(relativePaths).not.toContain('generated/workflow-restore-returned-session/01.png')
  })

  test('writes metadata-rich assets and derives trust and pack outputs', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-assets-rich-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)

    await mkdir(join(repoRoot, 'docs', 'assets', 'readme'), { recursive: true })
    await writeFile(join(repoRoot, 'docs', 'assets', 'readme', 'stoa-claude-code-session.png'), 'fake-png', 'utf8')
    await writeFile(join(repoRoot, 'README.md'), '# Stoa\n', 'utf8')
    await writeFile(join(repoRoot, 'release-notes-0.3.0.md'), 'released\n', 'utf8')
    await mkdir(join(paths.assetsDir, 'closeup-provider-floating-card'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'closeup-provider-floating-card', '01.png'), 'fake-png', 'utf8')
    await writeFile(join(paths.assetsDir, 'closeup-provider-floating-card', 'index.md'), 'Shows the quick new-session provider card.', 'utf8')

    const captureGeneratedAssets: CaptureGeneratedAssets = async ({ generatedAssetsDir }) => {
      await mkdir(join(generatedAssetsDir, 'overview-app-shell-overview'), { recursive: true })
      await mkdir(join(generatedAssetsDir, 'workflow-archive-restore'), { recursive: true })
      await writeFile(join(generatedAssetsDir, 'overview-app-shell-overview', '01.png'), 'fake-png', 'utf8')
      await writeFile(join(generatedAssetsDir, 'workflow-archive-restore', '01.png'), 'fake-png', 'utf8')
      return [
        createCaptureAsset({
          relativePath: 'generated/overview-app-shell-overview/01.png',
          note: 'Shows the app shell and workspace hierarchy.',
          alt: 'Stoa app shell with workspace hierarchy and command surface.',
          category: 'overview',
          scene: 'app-shell-overview',
          kind: 'screenshot',
          tags: ['overview', 'workspace', 'shell'],
          source: 'electron-capture',
          derivesFrom: []
        }),
        createCaptureAsset({
          relativePath: 'generated/workflow-archive-restore/01.png',
          note: 'Shows restoring an archived session.',
          alt: 'Archive surface in Stoa with a restore action for a session.',
          category: 'workflow',
          scene: 'archive-restore',
          kind: 'screenshot',
          tags: ['archive', 'restore', 'workflow'],
          source: 'electron-capture',
          derivesFrom: []
        })
      ]
    }

    const result = await buildPromoAssets({
      repoRoot,
      now: () => '2026-05-18T02:00:00.000Z',
      captureGeneratedAssets
    })

    expect(result.assets.some((asset) => asset.category === 'overview')).toBe(true)
    expect(result.assets.some((asset) => asset.category === 'workflow')).toBe(true)
    expect(result.assets.every((asset) => asset.pointId.length > 0)).toBe(true)
    expect(result.assets.some((asset) => asset.relativePath === 'closeup-provider-floating-card/01.png' && asset.source === 'manual-capture')).toBe(true)
    expect(result.assets.some((asset) => asset.category === 'trust' && asset.kind === 'fact-card')).toBe(true)
    expect(result.assets.some((asset) => asset.category === 'pack' && asset.kind === 'social-preview')).toBe(true)
    expect(result.assets.some((asset) => asset.category === 'pack' && asset.scene === 'workflow-core-carousel-1')).toBe(true)

    const carouselAsset = result.assets.find((asset) => asset.scene === 'workflow-core-carousel-1')
    expect(carouselAsset).toBeTruthy()
    expect(carouselAsset?.source).toBe('derived-pack')
    expect(carouselAsset?.derivesFrom.length).toBeGreaterThan(0)
    expect(existsSync(join(paths.generatedAssetsDir, 'pack-workflow-core-carousel', '01.png'))).toBe(true)
    expect(existsSync(join(paths.generatedAssetsDir, 'pack-social-preview', '01.png'))).toBe(true)
    expect(existsSync(join(paths.generatedAssetsDir, 'trust-apache-open-source-card', '01.png'))).toBe(true)
    expect(result.packs.some((pack) => pack.id === 'pack-first-impression')).toBe(true)
  })

  test('keeps successful generated assets even when one capture scene fails', async () => {
    const repoRoot = await createTestTempDir('stoa-promo-assets-partial-')
    tempDirs.push(repoRoot)
    await mkdir(join(repoRoot, 'docs', 'assets', 'readme'), { recursive: true })
    await writeFile(join(repoRoot, 'docs', 'assets', 'readme', 'stoa-icon.png'), 'fake-png', 'utf8')

    const captureGeneratedAssets: CaptureGeneratedAssets = async ({ generatedAssetsDir }) => {
      await mkdir(join(generatedAssetsDir, 'overview-app-shell-overview'), { recursive: true })
      await writeFile(join(generatedAssetsDir, 'overview-app-shell-overview', '01.png'), 'fake-png', 'utf8')
      return [createCaptureAsset({
        relativePath: 'generated/overview-app-shell-overview/01.png',
        note: 'Shows the app shell.',
        alt: 'Stoa app shell.',
        category: 'overview',
        scene: 'app-shell-overview',
        kind: 'screenshot',
        tags: ['overview'],
        source: 'electron-capture',
        derivesFrom: []
      })]
    }

    const result = await buildPromoAssets({
      repoRoot,
      captureGeneratedAssets
    })

    expect(result.assets.some((asset) => asset.scene === 'app-shell-overview')).toBe(true)
    expect(result.assets.some((asset) => asset.category === 'trust')).toBe(true)
    expect(result.assets.some((asset) => asset.category === 'pack')).toBe(true)
  })
})
