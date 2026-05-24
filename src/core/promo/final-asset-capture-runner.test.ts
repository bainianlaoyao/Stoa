import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestTempDir } from '../../../testing/test-temp'
import { ensurePromoScaffold } from './promo-paths'
import { captureFinalPromoAssets } from './final-asset-capture-runner'

const tempDirs: string[] = []

describe('final-asset-capture-runner', () => {
  afterEach(async () => {
    await Promise.allSettled(
      tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true })))
    )
  })

  test('materializes only the requested bundle when a bundle filter is provided', async () => {
    const repoRoot = await createTestTempDir('stoa-final-capture-runner-filter-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)

    await mkdir(join(paths.assetsDir, 'overview-app-shell'), { recursive: true })
    await mkdir(join(paths.assetsDir, 'overview-solution-style'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'overview-app-shell', 'index.md'), 'App shell note.\n', 'utf8')
    await writeFile(join(paths.assetsDir, 'overview-solution-style', 'index.md'), 'Solution style note.\n', 'utf8')

    const sourceDir = join(repoRoot, '.tmp', 'runner-captures')
    await mkdir(sourceDir, { recursive: true })
    const shellImage = join(sourceDir, 'app-shell.png')
    const solutionImage = join(sourceDir, 'solution-style.png')
    await writeFile(shellImage, 'fake-png', 'utf8')
    await writeFile(solutionImage, 'fake-png', 'utf8')

    const result = await captureFinalPromoAssets({
      repoRoot,
      bundle: 'overview-solution-style',
      captureBundleImages: async () => ({
        'overview-app-shell': [shellImage],
        'overview-solution-style': [solutionImage]
      })
    })

    expect(result.capturedBundles).toEqual(['overview-solution-style'])
    expect(existsSync(join(paths.assetsDir, 'overview-solution-style', '01.png'))).toBe(true)
    expect(existsSync(join(paths.assetsDir, 'overview-app-shell', '01.png'))).toBe(false)
  })

  test('requires a capture mapping for every authored bundle when no filter is provided', async () => {
    const repoRoot = await createTestTempDir('stoa-final-capture-runner-coverage-')
    tempDirs.push(repoRoot)
    const paths = await ensurePromoScaffold(repoRoot)

    await mkdir(join(paths.assetsDir, 'overview-app-shell'), { recursive: true })
    await mkdir(join(paths.assetsDir, 'workflow-new-session'), { recursive: true })
    await writeFile(join(paths.assetsDir, 'overview-app-shell', 'index.md'), 'App shell note.\n', 'utf8')
    await writeFile(join(paths.assetsDir, 'workflow-new-session', 'index.md'), 'New session note.\n', 'utf8')

    const sourceDir = join(repoRoot, '.tmp', 'runner-captures')
    await mkdir(sourceDir, { recursive: true })
    const shellImage = join(sourceDir, 'app-shell.png')
    await writeFile(shellImage, 'fake-png', 'utf8')

    await expect(captureFinalPromoAssets({
      repoRoot,
      captureBundleImages: async () => ({
        'overview-app-shell': [shellImage]
      })
    })).rejects.toThrow(/missing capture implementation/i)
  })
})
