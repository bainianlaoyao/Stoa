import { join } from 'node:path'

export function resolvePreloadEntryPath(currentDir: string): string {
  return join(currentDir, '../preload/index.mjs')
}

export function createSecureWebPreferences(currentDir: string) {
  return {
    preload: resolvePreloadEntryPath(currentDir),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  }
}
