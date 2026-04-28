import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import {
  GO_TOOLCHAIN_VERSION,
  ensureGoArchive,
  goArchiveForPlatform,
  managedGoBinaryPath,
  resolveGoBinary
} from './go-toolchain.mjs'

describe('Go toolchain resolver', () => {
  test('uses GO_BINARY when explicitly configured', () => {
    const spawnSync = vi.fn()

    expect(resolveGoBinary({
      env: { GO_BINARY: 'D:/go/bin/go.exe' },
      platform: 'win32',
      arch: 'x64',
      cacheRoot: 'D:/repo/.cache/go',
      existsSync: () => false,
      spawnSync
    })).toBe('D:/go/bin/go.exe')
    expect(spawnSync).not.toHaveBeenCalled()
  })

  test('uses go from PATH before managed cache', () => {
    expect(resolveGoBinary({
      env: {},
      platform: 'win32',
      arch: 'x64',
      cacheRoot: 'D:/repo/.cache/go',
      existsSync: () => true,
      spawnSync: vi.fn(() => ({ status: 0 }))
    })).toBe('go')
  })

  test('uses managed cached Go when PATH does not provide go', () => {
    const cacheRoot = 'D:/repo/.cache/go'
    const managed = managedGoBinaryPath({ cacheRoot, platform: 'win32', arch: 'x64' })

    expect(resolveGoBinary({
      env: {},
      platform: 'win32',
      arch: 'x64',
      cacheRoot,
      existsSync: (path) => path === managed,
      spawnSync: vi.fn(() => ({ status: 1, error: new Error('missing') }))
    })).toBe(managed)
  })

  test('returns null when no explicit, PATH, or managed Go exists', () => {
    expect(resolveGoBinary({
      env: {},
      platform: 'win32',
      arch: 'x64',
      cacheRoot: 'D:/repo/.cache/go',
      existsSync: () => false,
      spawnSync: vi.fn(() => ({ status: 1, error: new Error('missing') }))
    })).toBeNull()
  })

  test('builds official Go archive metadata for the managed toolchain version', () => {
    expect(goArchiveForPlatform('win32', 'x64')).toMatchObject({
      fileName: `go${GO_TOOLCHAIN_VERSION}.windows-amd64.zip`,
      checksum: '98eb3570bade15cb826b0909338df6cc6d2cf590bc39c471142002db3832b708'
    })
    expect(goArchiveForPlatform('linux', 'x64').fileName).toBe(`go${GO_TOOLCHAIN_VERSION}.linux-amd64.tar.gz`)
    expect(goArchiveForPlatform('darwin', 'arm64').fileName).toBe(`go${GO_TOOLCHAIN_VERSION}.darwin-arm64.tar.gz`)
  })

  test('places managed Go under the repository cache', () => {
    expect(managedGoBinaryPath({
      cacheRoot: 'D:/repo/.cache/go',
      platform: 'win32',
      arch: 'x64'
    })).toBe(join('D:/repo/.cache/go', `go${GO_TOOLCHAIN_VERSION}.windows-amd64`, 'go', 'bin', 'go.exe'))
  })

  test('reuses an existing verified archive without downloading again', async () => {
    const downloadFile = vi.fn()
    const verifySha256 = vi.fn().mockResolvedValue(undefined)

    await expect(ensureGoArchive({
      archive: {
        checksum: 'abc',
        fileName: 'go.zip',
        url: 'https://go.dev/dl/go.zip'
      },
      archivePath: 'D:/repo/.cache/go/go.zip',
      existsSync: () => true,
      verifySha256,
      downloadFile
    })).resolves.toBe('D:/repo/.cache/go/go.zip')

    expect(verifySha256).toHaveBeenCalledWith('D:/repo/.cache/go/go.zip', 'abc')
    expect(downloadFile).not.toHaveBeenCalled()
  })
})
