/**
 * Lightweight platform-aware path utilities for the renderer process.
 * No Node.js built-ins — safe for browser / Electron sandbox usage.
 */

export function isAbsolute(p: string, os: string): boolean {
  if (os === 'win32') {
    return /^[A-Za-z]:/.test(p) || p.startsWith('\\\\')
  }
  return p.startsWith('/')
}

export function join(base: string, relative: string, os: string): string {
  const sep = os === 'win32' ? '\\' : '/'
  const cleanBase = base.replace(/[\\/]+$/g, '')
  const cleanRel = relative.replace(/^[\\/]+/g, '')
  return `${cleanBase}${sep}${cleanRel}`
}

export function normalize(p: string, os: string): string {
  if (os === 'win32') {
    return p.replace(/\//g, '\\')
  }
  return p
}
