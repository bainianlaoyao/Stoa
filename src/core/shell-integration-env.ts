import { randomUUID } from 'node:crypto'

export type ShellFamily =
  | 'bash'
  | 'zsh'
  | 'fish'
  | 'pwsh'
  | 'cmd'
  | 'posix-sh'
  | 'unknown'

export interface ShellIntegrationEnv {
  env: Record<string, string>
  args: string[]
}

export function detectShellFamily(shellPath: string): ShellFamily {
  const normalized = shellPath.replaceAll('\\', '/').toLowerCase()
  const segments = normalized.split('/')
  const basename = segments[segments.length - 1]
  const name = basename.replace(/\.exe$/, '')

  if (name === 'bash') return 'bash'
  if (name === 'zsh') return 'zsh'
  if (name === 'fish') return 'fish'
  if (name === 'pwsh' || name === 'powershell') return 'pwsh'
  if (name === 'cmd') return 'cmd'
  if (name === 'sh' || name === 'dash') return 'posix-sh'

  return 'unknown'
}

export function generateNonce(): string {
  return randomUUID()
}

export function buildShellIntegrationEnv(
  shellFamily: ShellFamily,
  shellPath: string,
  nonce: string,
  scriptDir: string,
): ShellIntegrationEnv | null {
  if (shellFamily === 'cmd' || shellFamily === 'posix-sh' || shellFamily === 'unknown') {
    return null
  }

  const baseEnv: Record<string, string> = {
    STOA_SHELL_INTEGRATION: '1',
    STOA_NONCE: nonce,
  }

  if (shellFamily === 'bash') {
    return {
      env: baseEnv,
      args: ['--init-file', `${scriptDir}/bash.sh`, '--login'],
    }
  }

  if (shellFamily === 'zsh') {
    return {
      env: { ...baseEnv, ZDOTDIR: scriptDir },
      args: ['-i'],
    }
  }

  if (shellFamily === 'fish') {
    return {
      env: baseEnv,
      args: ['--init-command', `source ${scriptDir}/fish.fish`],
    }
  }

  if (shellFamily === 'pwsh') {
    return {
      env: baseEnv,
      args: ['-NoLogo', '-NoExit', '-Command', `. "${scriptDir}/pwsh.ps1"`],
    }
  }

  return null
}
