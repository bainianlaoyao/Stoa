import { describe, expect, test } from 'vitest'
import { resolveStoaRuntimeRoot } from './stoa-runtime-root'

describe('resolveStoaRuntimeRoot', () => {
  test('uses LOCALAPPDATA on Windows', () => {
    expect(resolveStoaRuntimeRoot({
      platform: 'win32',
      env: {
        LOCALAPPDATA: 'C:/Users/test/AppData/Local'
      }
    })).toBe('C:/Users/test/AppData/Local/Stoa/runtime')
  })

  test('uses Application Support on macOS', () => {
    expect(resolveStoaRuntimeRoot({
      platform: 'darwin',
      env: {
        HOME: '/Users/test'
      }
    })).toBe('/Users/test/Library/Application Support/Stoa/runtime')
  })

  test('uses XDG_STATE_HOME on Linux when present', () => {
    expect(resolveStoaRuntimeRoot({
      platform: 'linux',
      env: {
        XDG_STATE_HOME: '/home/test/.state',
        HOME: '/home/test'
      }
    })).toBe('/home/test/.state/stoa/runtime')
  })

  test('falls back to HOME state directory on Linux when XDG_STATE_HOME is absent', () => {
    expect(resolveStoaRuntimeRoot({
      platform: 'linux',
      env: {
        HOME: '/home/test'
      }
    })).toBe('/home/test/.local/state/stoa/runtime')
  })
})
