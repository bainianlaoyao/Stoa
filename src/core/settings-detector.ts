import { access, constants } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'

const COMMON_BIN_UNIX = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']
const COMMON_BIN_WIN = [
  process.env.LOCALAPPDATA ?? '',
  process.env.PROGRAMFILES ?? '',
  process.env['PROGRAMFILES(X86)'] ?? '',
].filter(Boolean)

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

export async function detectProvider(providerId: string): Promise<string | null> {
  const binaryName = process.platform === 'win32' ? `${providerId}.cmd` : providerId
  const searchPaths = process.platform === 'win32' ? COMMON_BIN_WIN : COMMON_BIN_UNIX

  for (const dir of searchPaths) {
    const candidate = resolve(dir, binaryName)
    try { await access(candidate, constants.X_OK); return candidate } catch { /* continue */ }
  }

  return new Promise<string | null>((res) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    execFile(cmd, [providerId], (err, stdout) => {
      if (err) { res(null); return }
      const firstLine = stdout.trim().split('\n')[0]?.trim()
      res(firstLine || null)
    })
  })
}
