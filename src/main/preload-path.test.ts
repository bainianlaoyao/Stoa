import { describe, expect, test } from 'vitest'
import { createSecureWebPreferences, resolvePreloadEntryPath } from './preload-path'

describe('resolvePreloadEntryPath', () => {
  test('points BrowserWindow preload to the built mjs artifact', () => {
    expect(resolvePreloadEntryPath('D:/Data/DEV/ultra_simple_panel/out/main')).toBe(
      'D:\\Data\\DEV\\ultra_simple_panel\\out\\preload\\index.mjs'
    )
  })

  test('uses unsandboxed isolated web preferences so the ESM preload can execute', () => {
    expect(createSecureWebPreferences('D:/Data/DEV/ultra_simple_panel/out/main')).toEqual({
      preload: 'D:\\Data\\DEV\\ultra_simple_panel\\out\\preload\\index.mjs',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    })
  })
})
