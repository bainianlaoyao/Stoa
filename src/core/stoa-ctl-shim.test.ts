import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestTempDir } from '../../testing/test-temp'
import { ensureStoaCtlShim, resolveStoaCtlInvocationPlan, unregisterPosixPath, unregisterStoaCtlShim, unregisterStoaCtlSystemShim } from './stoa-ctl-shim'

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await createTestTempDir(prefix)
  tempDirs.push(dir)
  return dir
}

function normalizePathSlashes(value: string): string {
  return value.replaceAll('\\', '/')
}

describe('stoa-ctl shim', () => {
  afterEach(async () => {
    await Promise.allSettled(
      tempDirs.splice(0).map(async (dir) =>
        import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))
      )
    )
  })

  test('resolves a dev invocation plan through tsx under Electron run-as-node', () => {
    const plan = resolveStoaCtlInvocationPlan({
      appRootPath: 'D:/Data/DEV/ultra_simple_panel',
      appExecutablePath: 'C:/Program Files/Electron/electron.exe',
      isPackaged: false
    })

    expect(plan.executablePath).toBe('C:/Program Files/Electron/electron.exe')
    expect(plan.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1'
    })
    expect(plan.args.map(normalizePathSlashes)).toEqual([
      'D:/Data/DEV/ultra_simple_panel/node_modules/tsx/dist/cli.mjs',
      '--tsconfig',
      'D:/Data/DEV/ultra_simple_panel/tsconfig.node.json',
      'D:/Data/DEV/ultra_simple_panel/tools/stoa-ctl/index.ts'
    ])
  })

  test('resolves a dev invocation plan from an out/main app root back to the repository root', () => {
    const plan = resolveStoaCtlInvocationPlan({
      appRootPath: 'D:/Data/DEV/ultra_simple_panel/out/main',
      appExecutablePath: 'C:/Program Files/Electron/electron.exe',
      isPackaged: false
    })

    expect(plan.args.map(normalizePathSlashes)).toEqual([
      'D:/Data/DEV/ultra_simple_panel/node_modules/tsx/dist/cli.mjs',
      '--tsconfig',
      'D:/Data/DEV/ultra_simple_panel/tsconfig.node.json',
      'D:/Data/DEV/ultra_simple_panel/tools/stoa-ctl/index.ts'
    ])
  })

  test('resolves a packaged invocation plan against the unpacked CLI artifact', () => {
    const plan = resolveStoaCtlInvocationPlan({
      appRootPath: 'C:/Program Files/Stoa/resources/app.asar',
      appExecutablePath: 'C:/Program Files/Stoa/Stoa.exe',
      isPackaged: true
    })

    expect(plan.executablePath).toBe('C:/Program Files/Stoa/Stoa.exe')
    expect(plan.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1'
    })
    expect(plan.args.map(normalizePathSlashes)).toEqual([
      'C:/Program Files/Stoa/resources/app.asar.unpacked/out/tools/stoa-ctl/index.mjs'
    ])
  })

  test('writes a Windows shim that forwards to the resolved stoa-ctl invocation', async () => {
    const shimDir = await createTempDir('stoa-ctl-shim-')

    const shim = await ensureStoaCtlShim({
      binDir: shimDir,
      appRootPath: 'D:/Data/DEV/ultra_simple_panel/out/main',
      appExecutablePath: 'C:/Program Files/Electron/electron.exe',
      isPackaged: false,
      platform: 'win32'
    })

    expect(shim.commandPath).toBe(join(shimDir, 'stoa-ctl.cmd'))

    const cmdContent = await readFile(shim.commandPath, 'utf8')
    expect(cmdContent).toContain('set "ELECTRON_RUN_AS_NODE=1"')
    expect(cmdContent).toContain('"C:/Program Files/Electron/electron.exe"')
    expect(normalizePathSlashes(cmdContent)).toContain('D:/Data/DEV/ultra_simple_panel/node_modules/tsx/dist/cli.mjs')
    expect(cmdContent).toContain('%*')

    const bashShimPath = join(shimDir, 'stoa-ctl')
    const bashContent = await readFile(bashShimPath, 'utf8')
    expect(bashContent).toContain('#!/usr/bin/env bash')
    expect(bashContent).toContain('export ELECTRON_RUN_AS_NODE=')
    expect(normalizePathSlashes(bashContent)).toContain('D:/Data/DEV/ultra_simple_panel/node_modules/tsx/dist/cli.mjs')
    expect(bashContent).toContain('"$@"')
  })
})

describe('stoa-ctl unregister', () => {
  test('unregisterStoaCtlShim removes both shim files and is idempotent', async () => {
    const shimDir = await createTempDir('stoa-ctl-unregister-')
    await ensureStoaCtlShim({
      binDir: shimDir,
      appRootPath: 'D:/Data/DEV/ultra_simple_panel/out/main',
      appExecutablePath: 'D:/Data/DEV/ultra_simple_panel/node_modules/.bin/electron.cmd',
      isPackaged: false
    })
    expect(existsSync(join(shimDir, 'stoa-ctl.cmd'))).toBe(true)
    expect(existsSync(join(shimDir, 'stoa-ctl'))).toBe(true)
    await unregisterStoaCtlShim(shimDir)
    expect(existsSync(join(shimDir, 'stoa-ctl.cmd'))).toBe(false)
    expect(existsSync(join(shimDir, 'stoa-ctl'))).toBe(false)
    // idempotent
    await expect(unregisterStoaCtlShim(shimDir)).resolves.toBeUndefined()
  })

  test('unregisterStoaCtlSystemShim does not throw when no files exist', async () => {
    await expect(unregisterStoaCtlSystemShim()).resolves.toBeUndefined()
  })

  test('unregisterPosixPath removes the stoa-ctl export line from rc file', async () => {
    if (process.platform === 'win32') return

    const tmpHome = mkdtempSync(join(tmpdir(), 'stoactl-unregister-'))
    const rcFile = join(tmpHome, '.bashrc')
    const original = 'export PATH="$HOME/.local/bin:$PATH"\nexport PATH="$HOME/.stoa/bin:$PATH" # stoa-ctl\nexport FOO=bar\n'
    writeFileSync(rcFile, original, 'utf8')

    const previousHome = process.env.HOME
    process.env.HOME = tmpHome
    try {
      await unregisterPosixPath(join(tmpHome, '.stoa', 'bin'))
      const after = readFileSync(rcFile, 'utf8')
      expect(after).not.toContain('# stoa-ctl')
      expect(after).toContain('export FOO=bar')
    } finally {
      process.env.HOME = previousHome
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })
})
