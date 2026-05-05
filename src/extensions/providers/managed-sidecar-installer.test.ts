import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { installManagedSidecar } from './managed-sidecar-installer'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.allSettled(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('managed-sidecar-installer', () => {
  test('writes a provider-scoped manifest instead of sharing the project-root manifest', async () => {
    const rootDir = await createTempDir('stoa-managed-sidecar-')

    await installManagedSidecar({
      rootDir,
      manifestRelativePath: '.claude/.stoa-managed-sidecar.json',
      currentArtifacts: ['.claude/settings.json'],
      writes: [{
        relativePath: '.claude/settings.json',
        content: '{\"hooks\":{}}\n'
      }]
    })

    await expect(stat(join(rootDir, '.claude', '.stoa-managed-sidecar.json'))).resolves.toMatchObject({
      isFile: expect.any(Function)
    })
    await expect(stat(join(rootDir, '.stoa-managed-sidecar.json'))).rejects.toThrow()

    const manifest = JSON.parse(await readFile(join(rootDir, '.claude', '.stoa-managed-sidecar.json'), 'utf8')) as {
      artifactPaths: string[]
    }
    expect(manifest.artifactPaths).toEqual(['.claude/settings.json'])
  })

  test('cleanup-only mode removes the previously managed artifact and deletes the scoped manifest', async () => {
    const rootDir = await createTempDir('stoa-managed-sidecar-cleanup-')

    await installManagedSidecar({
      rootDir,
      manifestRelativePath: '.codex/.stoa-managed-sidecar.json',
      currentArtifacts: ['.codex/hook-stoa.mjs'],
      writes: [{
        relativePath: '.codex/hook-stoa.mjs',
        content: 'console.log("managed")\n'
      }]
    })

    await installManagedSidecar({
      rootDir,
      manifestRelativePath: '.codex/.stoa-managed-sidecar.json',
      currentArtifacts: [],
      writes: []
    })

    await expect(stat(join(rootDir, '.codex', 'hook-stoa.mjs'))).rejects.toThrow()
    await expect(stat(join(rootDir, '.codex', '.stoa-managed-sidecar.json'))).rejects.toThrow()
  })
})
