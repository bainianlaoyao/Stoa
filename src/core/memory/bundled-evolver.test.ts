import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { resolveBundledEvolverCli, resolveBundledEvolverRepoRoot } from './bundled-evolver'

describe('bundled Evolver resolver', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'stoa-bundled-evolver-'))
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  test('resolves the bundled repo from packaged resources when the source checkout path is unavailable', async () => {
    const resourcesPath = join(rootDir, 'resources')
    const evolverRepoRoot = join(resourcesPath, 'evolver')
    await mkdir(evolverRepoRoot, { recursive: true })
    await writeFile(join(evolverRepoRoot, 'package.json'), JSON.stringify({ name: 'evolver' }) + '\n', 'utf8')

    await expect(resolveBundledEvolverRepoRoot(join(rootDir, 'app-cwd'), {
      resourcesPath
    })).resolves.toBe(evolverRepoRoot)
  })

  test('uses ELECTRON_RUN_AS_NODE when the bundled CLI is resolved inside packaged Electron', async () => {
    const resourcesPath = join(rootDir, 'resources')
    const evolverRepoRoot = join(resourcesPath, 'evolver')
    await mkdir(evolverRepoRoot, { recursive: true })
    await writeFile(join(evolverRepoRoot, 'package.json'), JSON.stringify({ name: 'evolver' }) + '\n', 'utf8')

    await expect(resolveBundledEvolverCli(join(rootDir, 'app-cwd'), {
      resourcesPath,
      execPath: 'C:/Program Files/Stoa/Stoa.exe',
      isElectronRuntime: true
    })).resolves.toEqual({
      command: 'C:/Program Files/Stoa/Stoa.exe',
      argsPrefix: [join(evolverRepoRoot, 'index.js')],
      repoRoot: evolverRepoRoot,
      env: {
        ELECTRON_RUN_AS_NODE: '1'
      }
    })
  })

  test('preserves source checkout resolution when packaged resources are unavailable', async () => {
    const appCwd = join(rootDir, 'app-cwd')
    const sourceRepoRoot = join(appCwd, 'research', 'upstreams', 'evolver')
    await mkdir(sourceRepoRoot, { recursive: true })
    await writeFile(join(sourceRepoRoot, 'package.json'), JSON.stringify({ name: 'evolver' }) + '\n', 'utf8')

    await expect(resolveBundledEvolverRepoRoot(appCwd)).resolves.toBe(sourceRepoRoot)
    await expect(resolveBundledEvolverCli(appCwd)).resolves.toEqual({
      command: process.execPath,
      argsPrefix: [join(sourceRepoRoot, 'index.js')],
      repoRoot: sourceRepoRoot,
      env: {}
    })
  })
})
