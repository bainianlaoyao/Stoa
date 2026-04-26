import { access, constants } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'

const COMMON_BIN_UNIX = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']
const COMMON_BIN_WIN = [
  process.env.LOCALAPPDATA ?? '',
  process.env.PROGRAMFILES ?? '',
  process.env['PROGRAMFILES(X86)'] ?? '',
].filter(Boolean)

const VSCODE_CANDIDATES_WIN = [
  resolve(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
  resolve(process.env.PROGRAMFILES ?? '', 'Microsoft VS Code', 'Code.exe'),
  resolve(process.env['PROGRAMFILES(X86)'] ?? '', 'Microsoft VS Code', 'Code.exe'),
  resolve(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
]

const VSCODE_CANDIDATES_MAC = [
  '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
  resolve(process.env.HOME ?? '', 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
]

const VSCODE_CANDIDATES_LINUX = [
  '/usr/bin/code',
  '/usr/local/bin/code',
  '/snap/bin/code',
  resolve(process.env.HOME ?? '', '.local', 'bin', 'code'),
]

export async function detectShell(): Promise<string | null> {
  if (process.platform === 'win32') {
    const comspec = process.env.COMSPEC
    if (comspec) {
      try { await access(comspec, constants.X_OK); return comspec } catch { /* fall through */ }
    }
    const psPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    try { await access(psPath, constants.X_OK); return psPath } catch { /* fall through */ }
    return null
  }

  const envShell = process.env.SHELL
  if (envShell) {
    try { await access(envShell, constants.X_OK); return envShell } catch { /* fall through */ }
  }

  for (const candidate of ['/bin/bash', '/bin/zsh', '/bin/sh']) {
    try { await access(candidate, constants.X_OK); return candidate } catch { /* continue */ }
  }

  return null
}

export async function detectProvider(providerId: string, shellPath?: string | null): Promise<string | null> {
  const binaryName = process.platform === 'win32' ? `${providerId}.cmd` : providerId
  const searchPaths = process.platform === 'win32' ? COMMON_BIN_WIN : COMMON_BIN_UNIX

  for (const dir of searchPaths) {
    const candidate = resolve(dir, binaryName)
    try { await access(candidate, constants.X_OK); return candidate } catch { /* continue */ }
  }

  const shellFamily = classifyShellFamily(shellPath)
  if (shellPath && shellFamily === 'powershell') {
    const shellResult = await execLookup(shellPath, [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      `(Get-Command ${quotePowerShell(providerId)} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)`
    ])
    if (shellResult) return shellResult
  }

  if (shellPath && shellFamily === 'posix') {
    const shellResult = await execLookup(shellPath, ['-lc', `command -v ${quotePosix(providerId)}`])
    if (shellResult) return shellResult
  }

  const cmd = process.platform === 'win32' ? 'where' : 'which'
  return execLookup(cmd, [providerId])
}

export async function detectVscode(): Promise<string | null> {
  const candidates =
    process.platform === 'win32' ? VSCODE_CANDIDATES_WIN
    : process.platform === 'darwin' ? VSCODE_CANDIDATES_MAC
    : VSCODE_CANDIDATES_LINUX

  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate } catch { /* continue */ }
  }

  if (process.platform === 'win32') {
    const fromWhere = await execLookup('where', ['code'])
    if (fromWhere) return fromWhere
    return execLookup('where', ['code.cmd'])
  }

  return execLookup('which', ['code'])
}

function classifyShellFamily(shellPath?: string | null): 'powershell' | 'posix' | 'unknown' {
  if (!shellPath) return 'unknown'
  const normalized = shellPath.replaceAll('\\', '/').toLowerCase()
  if (normalized.includes('powershell') || normalized.endsWith('/pwsh') || normalized.endsWith('/pwsh.exe')) {
    return 'powershell'
  }
  if (normalized.endsWith('/bash') || normalized.endsWith('/bash.exe') || normalized.endsWith('/zsh') || normalized.endsWith('/zsh.exe') || normalized.endsWith('/sh') || normalized.endsWith('/sh.exe') || normalized.endsWith('/fish') || normalized.endsWith('/fish.exe')) {
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

function execLookup(command: string, args: string[]): Promise<string | null> {
  return new Promise<string | null>((res) => {
    execFile(command, args, (err, stdout) => {
      if (err) { res(null); return }
      const firstLine = stdout.trim().split(/\r?\n/)[0]?.trim()
      res(firstLine || null)
    })
  })
}
