import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestTempDir } from '../../testing/test-temp'
import { ensureStoaCtlShim, resolveStoaCtlInvocationPlan } from './stoa-ctl-shim'

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
      appRootPath: 'D:/Data/DEV/ultra_simple_panel',
      appExecutablePath: 'C:/Program Files/Electron/electron.exe',
      isPackaged: false,
      platform: 'win32'
    })

    expect(shim.commandPath).toBe(join(shimDir, 'stoa-ctl.cmd'))

    const content = await readFile(shim.commandPath, 'utf8')
    expect(content).toContain('set "ELECTRON_RUN_AS_NODE=1"')
    expect(content).toContain('"C:/Program Files/Electron/electron.exe"')
    expect(normalizePathSlashes(content)).toContain('D:/Data/DEV/ultra_simple_panel/node_modules/tsx/dist/cli.mjs')
    expect(content).toContain('%*')
  })
})
