import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockAccess = vi.hoisted(() => vi.fn())
const mockExecFile = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    access: mockAccess
  }
})

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    default: {
      ...(actual as unknown as { default?: Record<string, unknown> }).default,
      execFile: mockExecFile
    },
    execFile: mockExecFile
  }
})

describe('settings detector', () => {
  beforeEach(() => {
    vi.resetModules()
    mockAccess.mockReset()
    mockExecFile.mockReset()
    mockAccess.mockRejectedValue(new Error('not found'))
  })

  test('uses powershell Get-Command resolution when shell path is powershell', async () => {
    const { detectProvider } = await import('./settings-detector')
    mockExecFile.mockImplementation((_file: string, _args: string[], callback: (err: Error | null, stdout: string) => void) => {
      callback(null, 'C:\\tools\\opencode.cmd\n')
    })

    const detectProviderWithShell = detectProvider as unknown as (providerId: string, shellPath?: string | null) => Promise<string | null>
    const shellPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const result = await detectProviderWithShell('opencode', shellPath)

    expect(mockExecFile).toHaveBeenCalledWith(
      shellPath,
      [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        "(Get-Command 'opencode' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)"
      ],
      expect.any(Function)
    )
    expect(result).toBe('C:\\tools\\opencode.cmd')
  })

  test('uses shell command -v resolution when shell path is posix', async () => {
    const { detectProvider } = await import('./settings-detector')
    mockExecFile.mockImplementation((_file: string, _args: string[], callback: (err: Error | null, stdout: string) => void) => {
      callback(null, '/usr/local/bin/opencode\n')
    })

    const detectProviderWithShell = detectProvider as unknown as (providerId: string, shellPath?: string | null) => Promise<string | null>
    const shellPath = '/bin/zsh'
    const result = await detectProviderWithShell('opencode', shellPath)

    expect(mockExecFile).toHaveBeenCalledWith(
      shellPath,
      ['-lc', "command -v 'opencode'"],
      expect.any(Function)
    )
    expect(result).toBe('/usr/local/bin/opencode')
  })

  test('falls back to platform lookup when powershell lookup returns null', async () => {
    const { detectProvider } = await import('./settings-detector')
    mockExecFile
      .mockImplementationOnce((_file: string, _args: string[], callback: (err: Error | null, stdout: string) => void) => {
        callback(new Error('not found'), '')
      })
      .mockImplementationOnce((_file: string, _args: string[], callback: (err: Error | null, stdout: string) => void) => {
        callback(null, 'C:\\tools\\opencode.cmd\n')
      })

    const detectProviderWithShell = detectProvider as unknown as (providerId: string, shellPath?: string | null) => Promise<string | null>
    const shellPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const result = await detectProviderWithShell('opencode', shellPath)

    expect(mockExecFile).toHaveBeenNthCalledWith(
      1,
      shellPath,
      [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        "(Get-Command 'opencode' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)"
      ],
      expect.any(Function)
    )
    expect(mockExecFile).toHaveBeenNthCalledWith(
      2,
      process.platform === 'win32' ? 'where' : 'which',
      ['opencode'],
      expect.any(Function)
    )
    expect(result).toBe('C:\\tools\\opencode.cmd')
  })

  test('treats windows bash path as posix shell', async () => {
    const { detectProvider } = await import('./settings-detector')
    mockExecFile.mockImplementation((_file: string, _args: string[], callback: (err: Error | null, stdout: string) => void) => {
      callback(null, 'C:\\Program Files\\Git\\usr\\bin\\opencode\n')
    })

    const detectProviderWithShell = detectProvider as unknown as (providerId: string, shellPath?: string | null) => Promise<string | null>
    const shellPath = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const result = await detectProviderWithShell('opencode', shellPath)

    expect(mockExecFile).toHaveBeenCalledWith(
      shellPath,
      ['-lc', "command -v 'opencode'"],
      expect.any(Function)
    )
    expect(result).toBe('C:\\Program Files\\Git\\usr\\bin\\opencode')
  })

  test('quotes provider ids passed to posix shell lookup', async () => {
    const { detectProvider } = await import('./settings-detector')
    mockExecFile.mockImplementation((_file: string, _args: string[], callback: (err: Error | null, stdout: string) => void) => {
      callback(null, "/usr/local/bin/open'code\n")
    })

    const detectProviderWithShell = detectProvider as unknown as (providerId: string, shellPath?: string | null) => Promise<string | null>
    const shellPath = '/bin/bash'
    const result = await detectProviderWithShell("open'code", shellPath)

    expect(mockExecFile).toHaveBeenCalledWith(
      shellPath,
      ['-lc', `command -v 'open'"'"'code'`],
      expect.any(Function)
    )
    expect(result).toBe("/usr/local/bin/open'code")
  })

  test('detects claude executable names without rewriting them to provider ids', async () => {
    const { detectProvider } = await import('./settings-detector')
    mockExecFile.mockImplementation((_file: string, _args: string[], callback: (err: Error | null, stdout: string) => void) => {
      callback(null, '/usr/local/bin/claude\n')
    })

    const detectProviderWithShell = detectProvider as unknown as (providerId: string, shellPath?: string | null) => Promise<string | null>
    const result = await detectProviderWithShell('claude', '/bin/zsh')

    expect(mockExecFile).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-lc', "command -v 'claude'"],
      expect.any(Function)
    )
    expect(result).toBe('/usr/local/bin/claude')
  })

  test('detectVscode uses where code on windows as first fallback', async () => {
    const { detectVscode } = await import('./settings-detector')
    mockExecFile.mockImplementation((_file: string, _args: string[], callback: (err: Error | null, stdout: string) => void) => {
      callback(null, 'D:\\ProgramFiles\\Microsoft VS Code\\Code.exe\n')
    })

    const result = await detectVscode()

    if (process.platform === 'win32') {
      expect(mockExecFile).toHaveBeenCalledWith('where', ['code'], expect.any(Function))
    }
    expect(result).toBeTruthy()
  })

  test('detectVscode falls back to where lookup when no candidate exists', async () => {
    const { detectVscode } = await import('./settings-detector')
    mockAccess.mockRejectedValue(new Error('not found'))
    mockExecFile.mockImplementation((_file: string, _args: string[], callback: (err: Error | null, stdout: string) => void) => {
      callback(null, 'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd\n')
    })

    const result = await detectVscode()
    expect(mockExecFile).toHaveBeenCalled()
    expect(result).toBeTruthy()
  })

  test('detectVscode returns null when nothing is found', async () => {
    const { detectVscode } = await import('./settings-detector')
    mockAccess.mockRejectedValue(new Error('not found'))
    mockExecFile.mockImplementation((_file: string, _args: string[], callback: (err: Error | null, stdout: string) => void) => {
      callback(new Error('not found'), '')
    })

    const result = await detectVscode()
    expect(result).toBeNull()
  })
})
