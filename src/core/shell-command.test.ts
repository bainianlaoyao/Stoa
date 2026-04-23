import { describe, expect, test } from 'vitest'
import type { ProviderCommand } from '@shared/project-session'
import { wrapCommandForShell } from './shell-command'

function createCommand(overrides: Partial<ProviderCommand> = {}): ProviderCommand {
  return {
    command: 'opencode',
    args: ['--pure'],
    cwd: 'D:/demo',
    env: { PATH: 'x' },
    ...overrides
  }
}

describe('shell command wrapper', () => {
  test('wraps command for PowerShell using command mode', () => {
    const shellPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const wrapped = wrapCommandForShell(shellPath, createCommand())

    expect(wrapped.command).toBe(shellPath)
    expect(wrapped.args[0]).toBe('-NoLogo')
    expect(wrapped.args).not.toContain('-NoProfile')
    expect(wrapped.args).toContain('-Command')
    expect(wrapped.args.at(-1)).toContain('opencode')
    expect(wrapped.args.at(-1)).toContain('--pure')
  })

  test('wraps command for POSIX shells with -lc exec', () => {
    const wrapped = wrapCommandForShell(
      '/bin/bash',
      createCommand({ args: ['--pure', '--session', 'ext-123'], cwd: '/tmp/demo' })
    )

    expect(wrapped.command).toBe('/bin/bash')
    expect(wrapped.args[0]).toBe('-lc')
    expect(wrapped.args[1]).toContain('exec')
    expect(wrapped.args[1]).toContain('opencode')
    expect(wrapped.args[1]).toContain('--session')
    expect(wrapped.args[1]).toContain('ext-123')
  })

  test('wraps command for cmd shells with /d /s /c', () => {
    const wrapped = wrapCommandForShell(
      'C:\\Windows\\System32\\cmd.exe',
      createCommand({ command: 'opencode', args: ['--pure', '--session', 'ext-123'] })
    )

    expect(wrapped.command).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(wrapped.args[0]).toBe('/d')
    expect(wrapped.args[1]).toBe('/s')
    expect(wrapped.args[2]).toBe('/c')
    expect(wrapped.args[3]).toContain('opencode')
    expect(wrapped.args[3]).toContain('--session')
    expect(wrapped.args[3]).toContain('ext-123')
  })

  test('escapes single quotes for PowerShell command rendering', () => {
    const wrapped = wrapCommandForShell(
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      createCommand({
        command: `C:\\Tools\\O'Brien\\opencode.ps1`,
        args: [`--title=O'Brien`]
      })
    )

    expect(wrapped.args.at(-1)).toContain(`O''Brien`)
  })

  test('bridges cmd + .ps1 command via powershell for deterministic launch', () => {
    const wrapped = wrapCommandForShell(
      'C:\\Windows\\System32\\cmd.exe',
      createCommand({
        command: 'C:\\Users\\test\\AppData\\Roaming\\npm\\opencode.ps1',
        args: ['--pure']
      })
    )

    expect(wrapped.command).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(wrapped.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(wrapped.args[3]).toContain('powershell.exe')
    expect(wrapped.args[3]).toContain('-NoLogo')
    expect(wrapped.args[3]).toContain('-Command')
    expect(wrapped.args[3]).toContain('opencode.ps1')
  })
})
