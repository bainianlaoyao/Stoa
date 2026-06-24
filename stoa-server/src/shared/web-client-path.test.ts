import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

const mockedExistsSync = vi.mocked(existsSync)
const originalServerRoot = process.env.STOA_SERVER_ROOT

function normalizePath(value: unknown): string {
  return String(value).replace(/\\/g, '/')
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  if (originalServerRoot === undefined) {
    delete process.env.STOA_SERVER_ROOT
  } else {
    process.env.STOA_SERVER_ROOT = originalServerRoot
  }
})

describe('web client path resolution', () => {
  it('prefers STOA_SERVER_ROOT/web for packaged server static assets', async () => {
    process.env.STOA_SERVER_ROOT = 'C:/app/resources/stoa-server'
    mockedExistsSync.mockImplementation((path) => normalizePath(path).endsWith('resources/stoa-server/web/index.html'))

    const { resolveWebClientRoot, isWebClientAvailable } = await import('./web-client-path')

    expect(resolveWebClientRoot()).toBe(resolve('C:/app/resources/stoa-server', 'web'))
    expect(isWebClientAvailable()).toBe(true)
  })

  it('falls back to cwd-based dist paths in development', async () => {
    delete process.env.STOA_SERVER_ROOT
    mockedExistsSync.mockImplementation((path) => normalizePath(path).endsWith('stoa-server/dist/web/index.html'))

    const { resolveWebClientRoot, isWebClientAvailable } = await import('./web-client-path')

    expect(resolveWebClientRoot()).toBe(resolve(process.cwd(), 'stoa-server/dist/web'))
    expect(isWebClientAvailable()).toBe(true)
  })
})
