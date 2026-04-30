import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

export interface BundledEvolverResolverOptions {
  resourcesPath?: string
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function trimNonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function readProcessResourcesPath(): string | undefined {
  return 'resourcesPath' in process && typeof process.resourcesPath === 'string'
    ? process.resourcesPath
    : undefined
}

function resolvePackagedResourcesPath(options: BundledEvolverResolverOptions): string | null {
  return trimNonEmpty(options.resourcesPath)
    ?? trimNonEmpty(readProcessResourcesPath())
}

function buildRepoRootCandidates(cwd: string, options: BundledEvolverResolverOptions): string[] {
  const candidates = [
    trimNonEmpty(process.env.STOA_EVOLVER_REPO_ROOT)
  ]
  const resourcesPath = resolvePackagedResourcesPath(options)
  if (resourcesPath !== null) {
    candidates.push(join(resourcesPath, 'evolver'))
  }
  candidates.push(join(cwd, 'research', 'upstreams', 'evolver'))

  return candidates.filter((candidate): candidate is string => candidate !== null)
}

export async function resolveBundledEvolverRepoRoot(
  cwd: string = process.cwd(),
  options: BundledEvolverResolverOptions = {}
): Promise<string> {
  const candidates = buildRepoRootCandidates(cwd, options)

  for (const candidate of candidates) {
    if (await pathExists(join(candidate, 'package.json'))) {
      return candidate
    }
  }

  throw new Error('Bundled Evolver repository is unavailable')
}
