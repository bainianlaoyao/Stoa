import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { getProvider } from '@extensions/providers'
import type { ProjectSessionManager } from '@core/project-session-manager'
import type { SessionType } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'

const MANAGED_PROVIDER_TYPES = ['claude-code', 'codex', 'opencode'] as const
const SIDE_CAR_MAINTENANCE_SECRET = 'stoa-managed-sidecar-maintenance'

const PROVIDER_MARKERS: Record<ManagedProviderType, string[]> = {
  'claude-code': [
    '.claude/.stoa-managed-sidecar.json',
    '.stoa-managed-sidecar.json',
    '.claude/hooks/stoa-evolver-hook-bridge.cjs',
    '.claude/hooks/stoa-evolver-hook-bridge.cmd',
    '.claude/hooks/stoa-evolver-hook-bridge.sh',
    '.claude/hooks/stoa-hook-user-prompt-submit.cjs',
    '.claude/hooks/node.cmd',
    '.claude/hooks/node',
    '.claude/hooks/evolver-session-start.cjs',
    '.claude/hooks/evolver-signal-detect.cjs',
    '.claude/hooks/evolver-session-end.cjs',
    '.claude/hooks/evolver-session-start.js',
    '.claude/hooks/evolver-signal-detect.js',
    '.claude/hooks/evolver-session-end.js'
  ],
  codex: [
    '.codex/.stoa-managed-sidecar.json',
    '.codex/hook-stoa.mjs'
  ],
  opencode: [
    '.opencode/.stoa-managed-sidecar.json',
    '.opencode/plugins/stoa-status.ts'
  ]
}

type ManagedProviderType = (typeof MANAGED_PROVIDER_TYPES)[number]

interface SnapshotSource {
  snapshot(): ReturnType<ProjectSessionManager['snapshot']>
}

interface ManagedSidecarMaintenanceOptions {
  snapshotSource: SnapshotSource
  webhookPort: number
  logger?: Pick<Console, 'warn'>
}

export async function syncManagedSidecars(options: ManagedSidecarMaintenanceOptions): Promise<void> {
  const snapshot = options.snapshotSource.snapshot()
  const installs: Array<Promise<void>> = []

  for (const project of snapshot.projects) {
    const projectSessionTypes = snapshot.sessions
      .filter((session) => session.projectId === project.id)
      .map((session) => session.type)

    const providerTypes = await collectManagedProviderTypes(
      project.path,
      project.defaultSessionType,
      projectSessionTypes
    )

    for (const providerType of providerTypes) {
      installs.push(
        installManagedProviderSidecar({
          projectId: project.id,
          projectPath: project.path,
          providerType,
          webhookPort: options.webhookPort,
          logger: options.logger
        })
      )
    }
  }

  await Promise.all(installs)
}

async function collectManagedProviderTypes(
  projectPath: string,
  defaultSessionType: SessionType | undefined,
  projectSessionTypes: SessionType[]
): Promise<ManagedProviderType[]> {
  const providerTypes = new Set<ManagedProviderType>()

  if (defaultSessionType && isManagedProviderType(defaultSessionType)) {
    providerTypes.add(defaultSessionType)
  }

  for (const sessionType of projectSessionTypes) {
    if (isManagedProviderType(sessionType)) {
      providerTypes.add(sessionType)
    }
  }

  await Promise.all(
    MANAGED_PROVIDER_TYPES.map(async (providerType) => {
      if (providerTypes.has(providerType)) {
        return
      }

      const markers = PROVIDER_MARKERS[providerType]
      const exists = await anyPathExists(projectPath, markers)
      if (exists) {
        providerTypes.add(providerType)
      }
    })
  )

  return [...providerTypes]
}

async function installManagedProviderSidecar(options: {
  projectId: string
  projectPath: string
  providerType: ManagedProviderType
  webhookPort: number
  logger?: Pick<Console, 'warn'>
}): Promise<void> {
  try {
    const providerId = getProviderDescriptorBySessionType(options.providerType).providerId
    const provider = getProvider(providerId)
    await provider.installSidecar({
      session_id: `sidecar-maintenance-${options.providerType}`,
      project_id: options.projectId,
      path: options.projectPath,
      title: `sidecar-maintenance-${options.providerType}`,
      type: options.providerType,
      external_session_id: `sidecar-maintenance-${options.providerType}`
    }, {
      webhookPort: options.webhookPort,
      sessionSecret: SIDE_CAR_MAINTENANCE_SECRET,
      providerPort: options.webhookPort + 1
    })
  } catch (error) {
    options.logger?.warn(
      `[managed-sidecar-maintenance] Failed to refresh ${options.providerType} sidecar for ${options.projectPath}:`,
      error
    )
  }
}

async function anyPathExists(rootDir: string, relativePaths: string[]): Promise<boolean> {
  const checks = await Promise.all(
    relativePaths.map(async (relativePath) => {
      try {
        await access(join(rootDir, relativePath))
        return true
      } catch {
        return false
      }
    })
  )

  return checks.some(Boolean)
}

function isManagedProviderType(type: SessionType | undefined): type is ManagedProviderType {
  return type !== undefined && MANAGED_PROVIDER_TYPES.includes(type as ManagedProviderType)
}
