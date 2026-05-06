import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { resolveBundledEvolverRepoRoot } from './bundled-evolver'

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

  test('preserves source checkout resolution when packaged resources are unavailable', async () => {
    const appCwd = join(rootDir, 'app-cwd')
    const sourceRepoRoot = join(appCwd, 'research', 'upstreams', 'evolver')
    await mkdir(sourceRepoRoot, { recursive: true })
    await writeFile(join(sourceRepoRoot, 'package.json'), JSON.stringify({ name: 'evolver' }) + '\n', 'utf8')

    await expect(resolveBundledEvolverRepoRoot(appCwd)).resolves.toBe(sourceRepoRoot)
  })

  test('resolves source checkout from ancestor directories when running inside a git worktree', async () => {
    const repoRoot = join(rootDir, 'repo-root')
    const worktreeCwd = join(repoRoot, '.worktrees', 'feature-branch')
    const sourceRepoRoot = join(repoRoot, 'research', 'upstreams', 'evolver')
    await mkdir(worktreeCwd, { recursive: true })
    await mkdir(sourceRepoRoot, { recursive: true })
    await writeFile(join(sourceRepoRoot, 'package.json'), JSON.stringify({ name: 'evolver' }) + '\n', 'utf8')

    await expect(resolveBundledEvolverRepoRoot(worktreeCwd)).resolves.toBe(sourceRepoRoot)
  })

  test('does not escape the owning repo root when a parent workspace also vendors evolver', async () => {
    const outerRepoRoot = join(rootDir, 'outer-repo')
    const nestedRepoRoot = join(outerRepoRoot, 'nested-repo')
    const nestedWorktreeCwd = join(nestedRepoRoot, '.worktrees', 'feature-branch')
    const outerEvolverRepoRoot = join(outerRepoRoot, 'research', 'upstreams', 'evolver')
    await mkdir(join(nestedRepoRoot, '.git'), { recursive: true })
    await mkdir(nestedWorktreeCwd, { recursive: true })
    await mkdir(outerEvolverRepoRoot, { recursive: true })
    await writeFile(join(outerEvolverRepoRoot, 'package.json'), JSON.stringify({ name: 'evolver' }) + '\n', 'utf8')

    await expect(resolveBundledEvolverRepoRoot(nestedWorktreeCwd)).rejects.toThrow('Bundled Evolver repository is unavailable')
  })
})

describe('bundled Evolver clean upstream boundary', () => {
  test('resolved submodule tree must not contain src/stoa/ patched directory', async () => {
    const repoRoot = await resolveBundledEvolverRepoRoot()
    const stoaPath = join(repoRoot, 'src', 'stoa')

    let stoaExists: boolean
    try {
      await access(stoaPath, constants.F_OK)
      stoaExists = true
    } catch {
      stoaExists = false
    }

    expect(stoaExists).toBe(false)
  })

  test('resolved submodule tree must not contain test/stoa patched directory', async () => {
    const repoRoot = await resolveBundledEvolverRepoRoot()
    const stoaTestPath = join(repoRoot, 'test', 'stoa')

    let exists: boolean
    try {
      await access(stoaTestPath, constants.F_OK)
      exists = true
    } catch {
      exists = false
    }

    expect(exists).toBe(false)
  })
})
