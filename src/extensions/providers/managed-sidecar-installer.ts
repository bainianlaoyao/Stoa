import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const MANIFEST_FILE_NAME = '.stoa-managed-sidecar.json'

interface ManagedSidecarManifest {
  version: 1
  artifactPaths: string[]
}

export interface ManagedSidecarInstallPlan {
  rootDir: string
  manifestRelativePath?: string
  currentArtifacts: string[]
  preserveArtifacts?: string[]
  legacyArtifacts?: string[]
  writes: Array<{
    relativePath: string
    content: string
    mode?: number
  }>
}

export async function installManagedSidecar(plan: ManagedSidecarInstallPlan): Promise<void> {
  const manifestPath = join(plan.rootDir, plan.manifestRelativePath ?? MANIFEST_FILE_NAME)
  const previousArtifacts = await readManagedArtifacts(manifestPath)
  const currentArtifactSet = new Set(plan.currentArtifacts)
  const preservedArtifacts = new Set(plan.preserveArtifacts ?? [])
  const staleArtifacts = new Set<string>([
    ...previousArtifacts.filter(path => !currentArtifactSet.has(path)),
    ...(plan.legacyArtifacts ?? [])
  ])

  await Promise.all(
    [...staleArtifacts]
      .filter(relativePath => !preservedArtifacts.has(relativePath))
      .map(async (relativePath) => {
      await rm(join(plan.rootDir, relativePath), { force: true, recursive: true })
      })
  )

  for (const file of plan.writes) {
    const absolutePath = join(plan.rootDir, file.relativePath)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, file.content, 'utf8')
    if (file.mode !== undefined) {
      await chmod(absolutePath, file.mode)
    }
  }

  if (plan.currentArtifacts.length === 0 && plan.writes.length === 0) {
    await rm(manifestPath, { force: true })
    return
  }

  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      version: 1,
      artifactPaths: [...plan.currentArtifacts].sort()
    } satisfies ManagedSidecarManifest, null, 2)}\n`,
    'utf8'
  )
}

export async function uninstallManagedSidecar(options: {
  rootDir: string
  manifestRelativePath?: string
  preserveArtifacts?: string[]
  legacyArtifacts?: string[]
}): Promise<void> {
  const manifestPath = join(options.rootDir, options.manifestRelativePath ?? MANIFEST_FILE_NAME)
  const previousArtifacts = await readManagedArtifacts(manifestPath)
  const preservedArtifacts = new Set(options.preserveArtifacts ?? [])
  const allArtifacts = new Set<string>([
    ...previousArtifacts,
    ...(options.legacyArtifacts ?? [])
  ])

  await Promise.all(
    [...allArtifacts]
      .filter(relativePath => !preservedArtifacts.has(relativePath))
      .map(async (relativePath) => {
      await rm(join(options.rootDir, relativePath), { force: true, recursive: true })
      })
  )

  await rm(manifestPath, { force: true })

  // Clean up empty parent directories left after artifact removal
  const manifestRelativeDir = dirname(options.manifestRelativePath ?? MANIFEST_FILE_NAME)
  const dirPaths = new Set<string>()
  for (const relativePath of [...allArtifacts].filter(path => !preservedArtifacts.has(path))) {
    const parent = dirname(relativePath)
    if (parent !== '.' && parent !== '..') {
      dirPaths.add(parent)
    }
    // Also collect grandparent dirs (e.g. '.claude/hooks' → '.claude')
    const grandparent = dirname(parent)
    if (grandparent !== '.' && grandparent !== '..' && grandparent !== manifestRelativeDir) {
      dirPaths.add(grandparent)
    }
  }
  // Also clean manifest parent dir
  dirPaths.add(manifestRelativeDir)

  for (const dirPath of [...dirPaths].sort().reverse()) {
    const absoluteDir = join(options.rootDir, dirPath)
    try {
      const entries = await readdir(absoluteDir)
      if (entries.length === 0) {
        await rm(absoluteDir, { force: true, recursive: true })
      }
    } catch {
      // Directory doesn't exist, ignore
    }
  }
}

async function readManagedArtifacts(manifestPath: string): Promise<string[]> {
  try {
    const raw = await readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ManagedSidecarManifest>
    if (parsed.version !== 1 || !Array.isArray(parsed.artifactPaths)) {
      return []
    }

    return parsed.artifactPaths.filter((value): value is string => typeof value === 'string' && value.length > 0)
  } catch {
    return []
  }
}
