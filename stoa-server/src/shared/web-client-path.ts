import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

function candidateWebRoots(): string[] {
  return [
    resolve(process.cwd(), 'stoa-server/dist/web'),
    resolve(process.cwd(), 'dist/web'),
  ]
}

export function resolveWebClientRoot(): string {
  return candidateWebRoots().find((root) => existsSync(resolve(root, 'index.html'))) ?? candidateWebRoots()[0]
}

export function isWebClientAvailable(): boolean {
  return candidateWebRoots().some((root) => existsSync(resolve(root, 'index.html')))
}
