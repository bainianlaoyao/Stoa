import type { ProviderCommand } from '@shared/project-session'

function classifyShellFamily(shellPath: string): 'powershell' | 'cmd' | 'posix' | 'unknown' {
  const normalized = shellPath.replaceAll('\\', '/').toLowerCase()
  if (normalized.includes('powershell') || normalized.endsWith('/pwsh') || normalized.endsWith('/pwsh.exe')) {
    return 'powershell'
  }
  if (normalized.endsWith('/cmd') || normalized.endsWith('/cmd.exe')) {
    return 'cmd'
  }
  if (
    normalized.endsWith('/bash')
    || normalized.endsWith('/bash.exe')
    || normalized.endsWith('/zsh')
    || normalized.endsWith('/zsh.exe')
    || normalized.endsWith('/sh')
    || normalized.endsWith('/sh.exe')
    || normalized.endsWith('/fish')
    || normalized.endsWith('/fish.exe')
  ) {
    return 'posix'
  }
  return 'unknown'
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`
}

function quoteCmd(value: string): string {
  if (value.length === 0) {
    return '""'
  }

  const needsQuotes = /[\s"&|<>^]/.test(value)
  if (!needsQuotes) {
    return value
  }

  return `"${value.replaceAll('"', '""')}"`
}

function isPowerShellScriptPath(path: string): boolean {
  return path.trim().toLowerCase().endsWith('.ps1')
}

export function wrapCommandForShell(shellPath: string, command: ProviderCommand): ProviderCommand {
  const family = classifyShellFamily(shellPath)
  const parts = [command.command, ...command.args]

  if (family === 'powershell') {
    const rendered = parts.map(quotePowerShell).join(' ')
    return {
      command: shellPath,
      args: ['-NoLogo', '-Command', `& ${rendered}`],
      cwd: command.cwd,
      env: command.env
    }
  }

  if (family === 'cmd') {
    if (isPowerShellScriptPath(command.command)) {
      const psRendered = parts.map(quotePowerShell).join(' ')
      const psCommand = `& ${psRendered}`
      const rendered = `powershell.exe -NoLogo -Command ${quoteCmd(psCommand)}`

      return {
        command: shellPath,
        args: ['/d', '/s', '/c', rendered],
        cwd: command.cwd,
        env: command.env
      }
    }

    const rendered = parts.map(quoteCmd).join(' ')
    return {
      command: shellPath,
      args: ['/d', '/s', '/c', rendered],
      cwd: command.cwd,
      env: command.env
    }
  }

  if (family === 'posix') {
    const rendered = parts.map(quotePosix).join(' ')
    return {
      command: shellPath,
      args: ['-lc', `exec ${rendered}`],
      cwd: command.cwd,
      env: command.env
    }
  }

  return command
}
