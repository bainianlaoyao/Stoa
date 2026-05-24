import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestTempDir } from '../../../testing/test-temp'
import { ensurePromoScaffold } from './promo-paths'
import { materializeCapturedBundles, type FinalBundleCapture } from './final-asset-capture'

const tempDirs: string[] = []

describe('final-asset-capture', () => {
  afterEach(async () => {
    await Promise.allSettled(
      tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true })))
    )
  })

  test('writes directly into author-facing bundle folders and preserves bundle notes', async () => {
    const repoRoot = await createTestTempDir('stoa-final-capture-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await mkdir(join(paths.assetsDir, 'overview-app-shell'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'overview-app-shell', 'index.md'), 'Existing bundle note.\n', 'utf8')

    const sourceDir = join(repoRoot, '.tmp', 'capture-source')
    await mkdir(sourceDir, { recursive: true })
    const sourceImage = join(sourceDir, 'overview-app-shell.png')
    await writeFile(sourceImage, 'fake-png', 'utf8')

    const result = await materializeCapturedBundles({
      assetsDir: paths.assetsDir,
      captures: [{
        bundleName: 'overview-app-shell',
        note: 'Overview note should stay natural language.',
        images: [sourceImage]
      }]
    })

    expect(result.capturedBundles).toEqual(['overview-app-shell'])
    expect(result.writtenFiles).toContain('automation/promo/assets/overview-app-shell/01.png')
    expect(existsSync(join(paths.assetsDir, 'overview-app-shell', '01.png'))).toBe(true)
    expect(existsSync(join(paths.assetsDir, 'overview-app-shell', 'index.md'))).toBe(true)
  })

  test('can target a single bundle without touching unrelated folders', async () => {
    const repoRoot = await createTestTempDir('stoa-final-capture-filter-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)
    await mkdir(join(paths.assetsDir, 'overview-app-shell'), { recursive: true })
    await mkdir(join(paths.assetsDir, 'overview-settings-surface'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'overview-app-shell', 'index.md'), 'Existing app shell note.\n', 'utf8')
    await writeFile(join(paths.assetsDir, 'overview-settings-surface', 'index.md'), 'Existing settings note.\n', 'utf8')

    const sourceDir = join(repoRoot, '.tmp', 'capture-source')
    await mkdir(sourceDir, { recursive: true })
    const firstImage = join(sourceDir, 'overview-app-shell.png')
    const secondImage = join(sourceDir, 'overview-settings-surface.png')
    await writeFile(firstImage, 'fake-png', 'utf8')
    await writeFile(secondImage, 'fake-png', 'utf8')

    const captures: FinalBundleCapture[] = [
      {
        bundleName: 'overview-app-shell',
        note: 'App shell overview.',
        images: [firstImage]
      },
      {
        bundleName: 'overview-settings-surface',
        note: 'Settings overview.',
        images: [secondImage]
      }
    ]

    const result = await materializeCapturedBundles({
      assetsDir: paths.assetsDir,
      captures,
      bundleFilter: 'overview-settings-surface'
    })

    expect(result.capturedBundles).toEqual(['overview-settings-surface'])
    expect(existsSync(join(paths.assetsDir, 'overview-settings-surface', '01.png'))).toBe(true)
    expect(existsSync(join(paths.assetsDir, 'overview-app-shell', '01.png'))).toBe(false)
  })

  test('refuses to materialize bundles that are not part of the promo bundle registry', async () => {
    const repoRoot = await createTestTempDir('stoa-final-capture-unavailable-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)

    const sourceDir = join(repoRoot, '.tmp', 'capture-source')
    await mkdir(sourceDir, { recursive: true })
    const sourceImage = join(sourceDir, 'terminal-meta-bar.png')
    await writeFile(sourceImage, 'fake-png', 'utf8')

    await expect(materializeCapturedBundles({
      assetsDir: paths.assetsDir,
      captures: [{
        bundleName: 'closeup-not-a-real-bundle',
        note: 'Unknown bundle.',
        images: [sourceImage]
      }]
    })).rejects.toThrow(/unknown bundle/i)
  })
})
