import type { AppSettings, EvolverInferenceProvider } from '@shared/project-session'
import { getProviderDescriptorByProviderId } from '@shared/provider-descriptors'
import { resolveProviderExecutablePath } from '@core/provider-path-resolver'
import type { EvolverEngineAdapter } from './evolver-engine-adapter'
import { createEvolverEngineAdapter } from './evolver-engine-adapter'
import { InferenceRouter } from './inference-router'
import { createClaudeCodeInferenceCapability } from './runtime-capabilities'
import {
  TurnMaintenanceRunner,
  type TurnMaintenancePhaseEvent
} from './turn-maintenance-runner'
import { resolveBundledEvolverRepoRoot } from './bundled-evolver'

type RuntimeHostSettings = Pick<
  AppSettings,
  'evolverInferenceProvider' | 'evolverExecutionMode' | 'providers' | 'shellPath'
>

interface RuntimeHostSettingsReader {
  getSettings: () => RuntimeHostSettings
}

export interface MemoryRuntimeHost {
  availability: 'disabled' | 'recall-only' | 'full'
  diagnostics: string[]
  engineAdapter?: EvolverEngineAdapter
  turnMaintenanceRunner?: TurnMaintenanceRunner
}

export interface CreateMemoryRuntimeHostOptions {
  settings: RuntimeHostSettings | RuntimeHostSettingsReader
  cwd?: string
  resolveBundledEvolverRepoRoot?: typeof resolveBundledEvolverRepoRoot
  detectShell?: () => Promise<string | null>
  detectProvider?: (providerId: string, shellPath?: string | null) => Promise<string | null>
  onTurnPhaseEvent?: (event: TurnMaintenancePhaseEvent) => void
}

export async function createMemoryRuntimeHost(options: CreateMemoryRuntimeHostOptions): Promise<MemoryRuntimeHost> {
  const settingsReader = normalizeSettingsReader(options.settings)
  const diagnostics: string[] = []

  let engineAdapter: EvolverEngineAdapter
  try {
    engineAdapter = await createEvolverEngineAdapter({
      cwd: options.cwd,
      resolveBundledEvolverRepoRoot: options.resolveBundledEvolverRepoRoot
    })
  } catch (error) {
    return {
      availability: 'disabled',
      diagnostics: [
        `Bundled Evolver bridge is unavailable: ${error instanceof Error ? error.message : String(error)}`
      ]
    }
  }

  const hasStrictProviderResolution = typeof options.detectProvider === 'function' || typeof options.detectShell === 'function'

  const inferenceRouter = new InferenceRouter(
    {
      getInferenceProvider: () => settingsReader.getSettings().evolverInferenceProvider
    },
    {
      'claude-code': async () => {
        const providerPath = await resolveInferenceProviderPath('claude-code', settingsReader, {
          detectProvider: options.detectProvider,
          detectShell: options.detectShell,
          strict: hasStrictProviderResolution
        })
        return createClaudeCodeInferenceCapability(providerPath ?? undefined)
      }
    }
  )

  let availability: MemoryRuntimeHost['availability'] = 'full'
  try {
    await inferenceRouter.resolve()
  } catch (error) {
    availability = 'recall-only'
    diagnostics.push(buildRecallOnlyDiagnostic(settingsReader.getSettings().evolverInferenceProvider, error))
  }

  return {
    availability,
    diagnostics,
    engineAdapter,
    turnMaintenanceRunner: new TurnMaintenanceRunner(
      engineAdapter,
      inferenceRouter,
      {
        onPhaseEvent: options.onTurnPhaseEvent
      }
    )
  }
}

function normalizeSettingsReader(
  settings: CreateMemoryRuntimeHostOptions['settings']
): RuntimeHostSettingsReader {
  if ('getSettings' in settings) {
    return settings
  }

  return {
    getSettings: () => settings
  }
}

async function resolveInferenceProviderPath(
  providerId: Extract<EvolverInferenceProvider, 'claude-code'>,
  settingsReader: RuntimeHostSettingsReader,
  options: {
    detectProvider?: (providerId: string, shellPath?: string | null) => Promise<string | null>
    detectShell?: () => Promise<string | null>
    strict: boolean
  }
): Promise<string | null> {
  const settings = settingsReader.getSettings()
  const configuredPath = settings.providers[providerId]?.trim()
  if (configuredPath) {
    return configuredPath
  }

  if (options.detectProvider) {
    const resolved = await resolveProviderExecutablePath(providerId, {
      ...settings,
      locale: 'en',
      terminalFontSize: 14,
      terminalFontFamily: 'JetBrains Mono',
      workspaceIde: {
        id: 'vscode',
        executablePath: ''
      },
      claudeDangerouslySkipPermissions: false
    }, {
      detectShell: options.detectShell ?? (async () => null),
      detectProvider: options.detectProvider
    })

    if (resolved.providerPath) {
      return resolved.providerPath
    }
  }

  if (!options.strict) {
    return defaultProviderCommand(providerId)
  }

  throw new Error(`Provider executable for "${providerId}" could not be resolved.`)
}

function defaultProviderCommand(providerId: Extract<EvolverInferenceProvider, 'claude-code'>): string {
  const descriptor = getProviderDescriptorByProviderId(providerId)
  return descriptor?.executableName ?? providerId
}

function buildRecallOnlyDiagnostic(
  provider: EvolverInferenceProvider,
  error: unknown
): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `Inference provider "${provider}" is unavailable for distillation completion; Stoa will stay in recall-only mode. ${detail}`
}
