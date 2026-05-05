import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
  legacyArtifacts?: string[]
  writes: Array<{
    relativePath: string
    content: string
  }>
}

export async function installManagedSidecar(plan: ManagedSidecarInstallPlan): Promise<void> {
  const manifestPath = join(plan.rootDir, plan.manifestRelativePath ?? MANIFEST_FILE_NAME)
  const previousArtifacts = await readManagedArtifacts(manifestPath)
  const currentArtifactSet = new Set(plan.currentArtifacts)
  const staleArtifacts = new Set<string>([
    ...previousArtifacts.filter(path => !currentArtifactSet.has(path)),
    ...(plan.legacyArtifacts ?? [])
  ])

  await Promise.all(
    [...staleArtifacts].map(async (relativePath) => {
      await rm(join(plan.rootDir, relativePath), { force: true, recursive: true })
    })
  )

  for (const file of plan.writes) {
    const absolutePath = join(plan.rootDir, file.relativePath)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, file.content, 'utf8')
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
