import { join } from 'node:path'

export function resolvePreloadEntryPath(currentDir: string): string {
  return join(currentDir, '../preload/index.cjs')
}

export function createSecureWebPreferences(currentDir: string) {
  return {
    preload: resolvePreloadEntryPath(currentDir),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  }
}
