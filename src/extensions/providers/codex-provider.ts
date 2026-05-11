import type { ProviderCommandContext } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'
import { buildCodexProjectConfigToml, buildCodexTrustConfigOverrides } from './codex-project-config'
import { installManagedSidecar, uninstallManagedSidecar } from './managed-sidecar-installer'
import { buildSharedHookArtifacts } from './shared-hook-dispatch'

function codexCommand(context: ProviderCommandContext): string {
  const configuredPath = context.providerPath?.trim()
  return configuredPath && configuredPath.length > 0 ? configuredPath : 'codex'
}

function createProviderEnv(_target: ProviderRuntimeTarget, context: ProviderCommandContext): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    STOA_PROVIDER_PORT: String(context.providerPort)
  }

  delete env.STOA_SESSION_ID
  delete env.STOA_PROJECT_ID
  delete env.STOA_SESSION_SECRET
  delete env.STOA_WEBHOOK_PORT

  if (context.hookLeasePath) {
    env.STOA_HOOK_LEASE_PATH = context.hookLeasePath
  }
  if (context.hookManaged) {
    env.STOA_HOOK_MANAGED = '1'
  }
  if (context.hookSessionId) {
    env.STOA_HOOK_SESSION_ID = context.hookSessionId
  }
  if (context.hookProjectId) {
    env.STOA_HOOK_PROJECT_ID = context.hookProjectId
  }
  if (context.hookProvider) {
    env.STOA_HOOK_PROVIDER = context.hookProvider
  }
  if (context.hookSpawnOwnerInstanceId) {
    env.STOA_HOOK_SPAWN_OWNER_INSTANCE_ID = context.hookSpawnOwnerInstanceId
  }
  if (context.hookSpawnGeneration !== null && context.hookSpawnGeneration !== undefined) {
    env.STOA_HOOK_SPAWN_GENERATION = String(context.hookSpawnGeneration)
  }

  return env
}

async function createCommand(target: ProviderRuntimeTarget, context: ProviderCommandContext, args: string[]) {
  const configOverrides = await buildCodexTrustConfigOverrides(target.path)
  const configArgs = configOverrides.flatMap((override) => ['--config', override])
  const commandArgs = args[0] === 'resume'
    ? [args[0], args[1] ?? '', ...configArgs, ...args.slice(2)]
    : [...configArgs, ...args]
  return {
    command: codexCommand(context),
    args: commandArgs,
    cwd: target.path,
    env: createProviderEnv(target, context)
  }
}

async function writeCodexHookSidecar(target: ProviderRuntimeTarget): Promise<void> {
  const sharedArtifacts = buildSharedHookArtifacts()

  await installManagedSidecar({
    rootDir: target.path,
    manifestRelativePath: '.codex/.stoa-managed-sidecar.json',
    currentArtifacts: [
      '.codex/config.toml',
      ...sharedArtifacts.map(artifact => artifact.relativePath)
    ],
    legacyArtifacts: [
      '.codex/hooks.json',
      '.codex/hook-stoa.mjs'
    ],
    writes: [
      {
        relativePath: '.codex/config.toml',
        content: buildCodexProjectConfigToml(target.path)
      },
      ...sharedArtifacts
    ]
  })
}

export function createCodexProvider(): ProviderDefinition {
  return {
    providerId: 'codex',
    supportsResume() {
      return true
    },
    supportsStructuredEvents() {
      return true
    },
    async buildStartCommand(target, context) {
      return createCommand(target, context, [])
    },
    async buildResumeCommand(target, externalSessionId, context) {
      return createCommand(target, context, ['resume', externalSessionId])
    },
    resolveSessionId(_event) {
      return null
    },
    async installSidecar(target) {
      await writeCodexHookSidecar(target)
    },
    async uninstallSidecar(projectPath) {
      await uninstallManagedSidecar({
        rootDir: projectPath,
        manifestRelativePath: '.codex/.stoa-managed-sidecar.json',
        legacyArtifacts: [
          '.codex/hook-stoa.mjs'
        ]
      })
    }
  }
}

export const codexProvider = createCodexProvider()
