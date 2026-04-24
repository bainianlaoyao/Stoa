import { describe, expect, test } from 'vitest'
import { createSecureWebPreferences, resolvePreloadEntryPath } from './preload-path'

describe('resolvePreloadEntryPath', () => {
  test('points BrowserWindow preload to the built cjs artifact', () => {
    expect(resolvePreloadEntryPath('D:/Data/DEV/ultra_simple_panel/out/main')).toBe(
      'D:\\Data\\DEV\\ultra_simple_panel\\out\\preload\\index.cjs'
    )
  })

  test('uses unsandboxed isolated web preferences so the preload bridge can execute', () => {
    expect(createSecureWebPreferences('D:/Data/DEV/ultra_simple_panel/out/main')).toEqual({
      preload: 'D:\\Data\\DEV\\ultra_simple_panel\\out\\preload\\index.cjs',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    })
  })
})
