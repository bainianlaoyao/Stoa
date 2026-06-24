import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

function candidateWebRoots(): string[] {
  const roots: string[] = []
  if (process.env.STOA_SERVER_ROOT) {
    roots.push(resolve(process.env.STOA_SERVER_ROOT, 'web'))
  }

  roots.push(
    resolve(process.cwd(), 'stoa-server/dist/web'),
    resolve(process.cwd(), 'dist/web'),
  )
  return roots
}

export function resolveWebClientRoot(): string {
  return candidateWebRoots().find((root) => existsSync(resolve(root, 'index.html'))) ?? candidateWebRoots()[0]
}

export function isWebClientAvailable(): boolean {
  return candidateWebRoots().some((root) => existsSync(resolve(root, 'index.html')))
}
