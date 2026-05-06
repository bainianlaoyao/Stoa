import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, parse } from 'node:path'

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

async function resolveSearchCeiling(cwd: string): Promise<string> {
  let current = cwd
  const root = parse(cwd).root

  while (current !== root) {
    const parent = dirname(current)
    if (basename(parent) === '.worktrees') {
      return dirname(parent)
    }
    current = parent
  }

  current = cwd
  while (true) {
    if (await pathExists(join(current, '.git'))) {
      return current
    }
    if (current === root) {
      return root
    }
    current = dirname(current)
  }
}

async function buildRepoRootCandidates(cwd: string, options: BundledEvolverResolverOptions): Promise<string[]> {
  const candidates = [
    trimNonEmpty(process.env.STOA_EVOLVER_REPO_ROOT)
  ]
  const resourcesPath = resolvePackagedResourcesPath(options)
  if (resourcesPath !== null) {
    candidates.push(join(resourcesPath, 'evolver'))
  }
  const ceiling = await resolveSearchCeiling(cwd)
  let current = cwd
  while (true) {
    candidates.push(join(current, 'research', 'upstreams', 'evolver'))
    if (current === ceiling) {
      break
    }
    current = dirname(current)
  }

  return candidates.filter((candidate): candidate is string => candidate !== null)
}

export async function resolveBundledEvolverRepoRoot(
  cwd: string = process.cwd(),
  options: BundledEvolverResolverOptions = {}
): Promise<string> {
  const candidates = await buildRepoRootCandidates(cwd, options)

  for (const candidate of candidates) {
    if (await pathExists(join(candidate, 'package.json'))) {
      return candidate
    }
  }

  throw new Error('Bundled Evolver repository is unavailable')
}
