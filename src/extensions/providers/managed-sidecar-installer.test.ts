import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.allSettled(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
import { installManagedSidecar, uninstallManagedSidecar } from './managed-sidecar-installer'

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

  test('applies explicit executable modes after writing managed artifacts', async () => {
    const rootDir = await createTempDir('stoa-managed-sidecar-mode-')

    await installManagedSidecar({
      rootDir,
      manifestRelativePath: '.codex/.stoa-managed-sidecar.json',
      currentArtifacts: ['.stoa/hook-dispatch'],
      writes: [{
        relativePath: '.stoa/hook-dispatch',
        content: '#!/usr/bin/env sh\nexit 0\n',
        mode: 0o755
      }]
    })

    const dispatcher = await stat(join(rootDir, '.stoa', 'hook-dispatch'))
    expect(dispatcher.isFile()).toBe(true)
    if (process.platform !== 'win32') {
      expect(dispatcher.mode & 0o777).toBe(0o755)
    }
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

  test('preserveArtifacts protects user-owned files during cleanup and uninstall', async () => {
    const rootDir = await createTempDir('stoa-managed-sidecar-preserve-')
    await mkdir(join(rootDir, '.codex'), { recursive: true })
    await writeFile(join(rootDir, '.codex', 'config.toml'), 'model = "gpt-5"\n', 'utf8')

    await installManagedSidecar({
      rootDir,
      manifestRelativePath: '.codex/.stoa-managed-sidecar.json',
      currentArtifacts: ['.codex/config.toml', '.codex/hook-stoa.mjs'],
      preserveArtifacts: ['.codex/config.toml'],
      writes: [
        { relativePath: '.codex/hook-stoa.mjs', content: 'hook' }
      ]
    })

    await installManagedSidecar({
      rootDir,
      manifestRelativePath: '.codex/.stoa-managed-sidecar.json',
      currentArtifacts: [],
      preserveArtifacts: ['.codex/config.toml'],
      writes: []
    })

    await expect(readFile(join(rootDir, '.codex', 'config.toml'), 'utf8')).resolves.toBe('model = "gpt-5"\n')
    await expect(stat(join(rootDir, '.codex', 'hook-stoa.mjs'))).rejects.toThrow()

    await uninstallManagedSidecar({
      rootDir,
      manifestRelativePath: '.codex/.stoa-managed-sidecar.json',
      preserveArtifacts: ['.codex/config.toml']
    })

    await expect(readFile(join(rootDir, '.codex', 'config.toml'), 'utf8')).resolves.toBe('model = "gpt-5"\n')
  })

  test('uninstallManagedSidecar removes all managed artifacts and the manifest', async () => {
    const rootDir = await createTempDir('stoa-uninstall-')

    await installManagedSidecar({
      rootDir,
      manifestRelativePath: '.codex/.stoa-managed-sidecar.json',
      currentArtifacts: ['.codex/hooks.json', '.codex/hook-stoa.mjs', '.codex/config.toml'],
      writes: [
        { relativePath: '.codex/hooks.json', content: '{}' },
        { relativePath: '.codex/hook-stoa.mjs', content: 'hook' },
        { relativePath: '.codex/config.toml', content: 'config' }
      ]
    })

    await uninstallManagedSidecar({
      rootDir,
      manifestRelativePath: '.codex/.stoa-managed-sidecar.json'
    })

    await expect(stat(join(rootDir, '.codex', 'hooks.json'))).rejects.toThrow()
    await expect(stat(join(rootDir, '.codex', 'hook-stoa.mjs'))).rejects.toThrow()
    await expect(stat(join(rootDir, '.codex', 'config.toml'))).rejects.toThrow()
    await expect(stat(join(rootDir, '.codex', '.stoa-managed-sidecar.json'))).rejects.toThrow()
  })

  test('uninstallManagedSidecar removes legacy artifacts', async () => {
    const rootDir = await createTempDir('stoa-uninstall-legacy-')
    await mkdir(join(rootDir, '.claude', 'hooks'), { recursive: true })
    await writeFile(join(rootDir, '.claude', 'hooks', 'legacy-file.cjs'), 'legacy', 'utf8')
    await installManagedSidecar({
      rootDir,
      manifestRelativePath: '.claude/.stoa-managed-sidecar.json',
      currentArtifacts: ['.claude/settings.json'],
      writes: [{ relativePath: '.claude/settings.json', content: '{}' }]
    })

    await uninstallManagedSidecar({
      rootDir,
      manifestRelativePath: '.claude/.stoa-managed-sidecar.json',
      legacyArtifacts: ['.claude/hooks/legacy-file.cjs']
    })

    await expect(stat(join(rootDir, '.claude', 'settings.json'))).rejects.toThrow()
    await expect(stat(join(rootDir, '.claude', 'hooks', 'legacy-file.cjs'))).rejects.toThrow()
    await expect(stat(join(rootDir, '.claude', '.stoa-managed-sidecar.json'))).rejects.toThrow()
  })

  test('uninstallManagedSidecar cleans up empty directories', async () => {
    const rootDir = await createTempDir('stoa-uninstall-empty-dir-')

    await installManagedSidecar({
      rootDir,
      manifestRelativePath: '.codex/.stoa-managed-sidecar.json',
      currentArtifacts: ['.codex/hooks.json'],
      writes: [{ relativePath: '.codex/hooks.json', content: '{}' }]
    })

    await uninstallManagedSidecar({
      rootDir,
      manifestRelativePath: '.codex/.stoa-managed-sidecar.json'
    })

    await expect(stat(join(rootDir, '.codex'))).rejects.toThrow()
  })

  test('uninstallManagedSidecar is a no-op when no manifest exists', async () => {
    const rootDir = await createTempDir('stoa-uninstall-noop-')

    await uninstallManagedSidecar({
      rootDir,
      manifestRelativePath: '.codex/.stoa-managed-sidecar.json'
    })
  })
})
