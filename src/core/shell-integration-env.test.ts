import { describe, it, expect } from 'vitest'
import {
  detectShellFamily,
  generateNonce,
  buildShellIntegrationEnv,
  type ShellFamily,
} from './shell-integration-env.js'

describe('detectShellFamily', () => {
  it('detects bash from Unix path', () => {
    expect(detectShellFamily('/usr/bin/bash')).toBe('bash')
  })

  it('detects bash.exe from Windows path with backslashes', () => {
    expect(detectShellFamily('C:\\Program Files\\Git\\bin\\bash.exe')).toBe('bash')
  })

  it('detects bash from basename only', () => {
    expect(detectShellFamily('bash')).toBe('bash')
  })

  it('detects zsh from Unix path', () => {
    expect(detectShellFamily('/bin/zsh')).toBe('zsh')
  })

  it('detects zsh.exe from Windows path', () => {
    expect(detectShellFamily('C:\\msys64\\usr\\bin\\zsh.exe')).toBe('zsh')
  })

  it('detects zsh from basename only', () => {
    expect(detectShellFamily('zsh')).toBe('zsh')
  })

  it('detects fish from Unix path', () => {
    expect(detectShellFamily('/usr/bin/fish')).toBe('fish')
  })

  it('detects fish.exe from Windows path', () => {
    expect(detectShellFamily('/usr/local/bin/fish.exe')).toBe('fish')
  })

  it('detects fish from basename only', () => {
    expect(detectShellFamily('fish')).toBe('fish')
  })

  it('detects pwsh from Unix path', () => {
    expect(detectShellFamily('/usr/bin/pwsh')).toBe('pwsh')
  })

  it('detects pwsh.exe from Windows path', () => {
    expect(detectShellFamily('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('pwsh')
  })

  it('detects pwsh from basename only', () => {
    expect(detectShellFamily('pwsh')).toBe('pwsh')
  })

  it('detects powershell as pwsh family', () => {
    expect(detectShellFamily('/usr/bin/powershell')).toBe('pwsh')
  })

  it('detects powershell.exe as pwsh family', () => {
    expect(detectShellFamily('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe('pwsh')
  })

  it('detects cmd from Unix-style path', () => {
    expect(detectShellFamily('/mnt/c/Windows/System32/cmd')).toBe('cmd')
  })

  it('detects cmd.exe from Windows path', () => {
    expect(detectShellFamily('C:\\Windows\\System32\\cmd.exe')).toBe('cmd')
  })

  it('detects cmd from basename only', () => {
    expect(detectShellFamily('cmd')).toBe('cmd')
  })

  it('detects sh as posix-sh', () => {
    expect(detectShellFamily('/bin/sh')).toBe('posix-sh')
  })

  it('detects sh.exe as posix-sh', () => {
    expect(detectShellFamily('/usr/bin/sh.exe')).toBe('posix-sh')
  })

  it('detects sh from basename only', () => {
    expect(detectShellFamily('sh')).toBe('posix-sh')
  })

  it('detects dash as posix-sh', () => {
    expect(detectShellFamily('/usr/bin/dash')).toBe('posix-sh')
  })

  it('detects dash.exe as posix-sh', () => {
    expect(detectShellFamily('/usr/bin/dash.exe')).toBe('posix-sh')
  })

  it('detects dash from basename only', () => {
    expect(detectShellFamily('dash')).toBe('posix-sh')
  })

  it('returns unknown for unrecognized shell', () => {
    expect(detectShellFamily('/usr/bin/python3')).toBe('unknown')
  })

  it('returns unknown for empty string', () => {
    expect(detectShellFamily('')).toBe('unknown')
  })

  it('handles mixed-case shell names', () => {
    expect(detectShellFamily('/usr/bin/Bash')).toBe('bash')
    expect(detectShellFamily('/usr/bin/ZSH')).toBe('zsh')
    expect(detectShellFamily('/usr/bin/FISH')).toBe('fish')
    expect(detectShellFamily('/usr/bin/PWSH')).toBe('pwsh')
    expect(detectShellFamily('/usr/bin/CMD.EXE')).toBe('cmd')
  })

  it('handles forward-slash Windows paths', () => {
    expect(detectShellFamily('C:/Program Files/Git/bin/bash.exe')).toBe('bash')
  })
})

describe('generateNonce', () => {
  it('returns a non-empty string', () => {
    const nonce = generateNonce()
    expect(nonce).toBeTruthy()
    expect(typeof nonce).toBe('string')
    expect(nonce.length).toBeGreaterThan(0)
  })

  it('returns unique values on successive calls', () => {
    const nonces = new Set<string>()
    for (let i = 0; i < 100; i++) {
      nonces.add(generateNonce())
    }
    expect(nonces.size).toBe(100)
  })
})

describe('buildShellIntegrationEnv', () => {
  const shellPath = '/usr/bin/bash'
  const nonce = 'test-nonce-1234'
  const scriptDir = '/opt/stoa/shell-integration'

  it('returns null for cmd', () => {
    expect(buildShellIntegrationEnv('cmd', shellPath, nonce, scriptDir)).toBeNull()
  })

  it('returns null for posix-sh', () => {
    expect(buildShellIntegrationEnv('posix-sh', shellPath, nonce, scriptDir)).toBeNull()
  })

  it('returns null for unknown', () => {
    expect(buildShellIntegrationEnv('unknown', shellPath, nonce, scriptDir)).toBeNull()
  })

  it('builds correct env for bash', () => {
    const result = buildShellIntegrationEnv('bash', shellPath, nonce, scriptDir)
    expect(result).not.toBeNull()
    expect(result!.env).toEqual({
      STOA_SHELL_INTEGRATION: '1',
      STOA_NONCE: nonce,
    })
    expect(result!.args).toEqual([
      '--init-file',
      `${scriptDir}/bash.sh`,
      '--login',
    ])
  })

  it('builds correct env for zsh', () => {
    const result = buildShellIntegrationEnv('zsh', '/bin/zsh', nonce, scriptDir)
    expect(result).not.toBeNull()
    expect(result!.env).toEqual({
      STOA_SHELL_INTEGRATION: '1',
      STOA_NONCE: nonce,
      ZDOTDIR: scriptDir,
    })
    expect(result!.args).toEqual(['-i'])
  })

  it('builds correct env for fish', () => {
    const result = buildShellIntegrationEnv('fish', '/usr/bin/fish', nonce, scriptDir)
    expect(result).not.toBeNull()
    expect(result!.env).toEqual({
      STOA_SHELL_INTEGRATION: '1',
      STOA_NONCE: nonce,
    })
    expect(result!.args).toEqual([
      '--init-command',
      `source ${scriptDir}/fish.fish`,
    ])
  })

  it('builds correct env for pwsh', () => {
    const result = buildShellIntegrationEnv('pwsh', '/usr/bin/pwsh', nonce, scriptDir)
    expect(result).not.toBeNull()
    expect(result!.env).toEqual({
      STOA_SHELL_INTEGRATION: '1',
      STOA_NONCE: nonce,
    })
    expect(result!.args).toEqual([
      '-NoLogo',
      '-NoExit',
      '-Command',
      `. "${scriptDir}/pwsh.ps1"`,
    ])
  })

  it('uses the provided nonce in env for all supported shells', () => {
    const customNonce = 'my-custom-nonce-999'
    const families: ShellFamily[] = ['bash', 'zsh', 'fish', 'pwsh']

    for (const family of families) {
      const result = buildShellIntegrationEnv(family, shellPath, customNonce, scriptDir)
      expect(result).not.toBeNull()
      expect(result!.env.STOA_NONCE).toBe(customNonce)
    }
  })

  it('always sets STOA_SHELL_INTEGRATION to "1" for supported shells', () => {
    const families: ShellFamily[] = ['bash', 'zsh', 'fish', 'pwsh']

    for (const family of families) {
      const result = buildShellIntegrationEnv(family, shellPath, nonce, scriptDir)
      expect(result).not.toBeNull()
      expect(result!.env.STOA_SHELL_INTEGRATION).toBe('1')
    }
  })

  it('handles Windows-style scriptDir paths', () => {
    const winScriptDir = 'C:\\Users\\test\\stoa\\shell-integration'
    const result = buildShellIntegrationEnv('pwsh', 'pwsh.exe', nonce, winScriptDir)
    expect(result).not.toBeNull()
    expect(result!.args[3]).toBe(`. "${winScriptDir}/pwsh.ps1"`)
  })
})
