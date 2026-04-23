import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { ensureElectronMainEntrypoint, resolveElectronMainEntrypoint } from './electron-app'
import { createTestTempDir } from '../../../testing/test-temp'

const tempDirs: string[] = []

async function createTempWorkspace(): Promise<string> {
  const dir = await createTestTempDir('stoa-electron-entry-')
  tempDirs.push(dir)
  return dir
}

describe('electron Playwright fixture entrypoint resolution', () => {
  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })))
  })

  test('resolves the built Electron main entry when it exists', async () => {
    const workspace = await createTempWorkspace()
    const entryPath = join(workspace, 'out', 'main', 'index.js')

    await mkdir(join(workspace, 'out', 'main'), { recursive: true })
    await writeFile(entryPath, 'export {}\n', 'utf-8')

    expect(resolveElectronMainEntrypoint(workspace)).toBe(entryPath)
    await expect(access(ensureElectronMainEntrypoint(workspace), constants.F_OK)).resolves.toBeUndefined()
  })

  test('throws a clear error when the Electron main build output is missing', async () => {
    const workspace = await createTempWorkspace()

    expect(() => ensureElectronMainEntrypoint(workspace)).toThrowError(
      /Electron main entry not found.*npm run build.*npm run test:e2e/
    )
  })
})
