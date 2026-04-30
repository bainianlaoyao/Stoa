import { join } from 'node:path'
import type { AppSettings, EvolverInferenceProvider } from '@shared/project-session'
import { getProviderDescriptorByProviderId } from '@shared/provider-descriptors'
import { resolveProviderExecutablePath } from '@core/provider-path-resolver'
import { resolveBundledEvolverRepoRoot } from './bundled-evolver'
import type { EvolverClientOptions } from './evolver-client'
import { EvolverClient } from './evolver-client'
import { ExecutionRouter } from './execution-router'
import { InferenceRouter } from './inference-router'
import { StoaEvolverBridge } from './stoa-evolver-bridge'
import {
  createClaudeCodeInferenceCapability,
  createWorkspaceShellExecutionCapability
} from './runtime-capabilities'
import { TurnMaintenanceRunner, type TurnMaintenancePhaseEvent } from './turn-maintenance-runner'

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
  evolverBridge?: StoaEvolverBridge
  turnMaintenanceRunner?: TurnMaintenanceRunner
}

export interface CreateMemoryRuntimeHostOptions {
  settings: RuntimeHostSettings | RuntimeHostSettingsReader
  cwd?: string
  resolveBundledEvolverRepoRoot?: typeof resolveBundledEvolverRepoRoot
  runJsonCommand?: EvolverClientOptions['runJsonCommand']
  detectShell?: () => Promise<string | null>
  detectProvider?: (providerId: string, shellPath?: string | null) => Promise<string | null>
  onTurnPhaseEvent?: (event: TurnMaintenancePhaseEvent) => void
}

export async function createMemoryRuntimeHost(options: CreateMemoryRuntimeHostOptions): Promise<MemoryRuntimeHost> {
  const settingsReader = normalizeSettingsReader(options.settings)
  const diagnostics: string[] = []

  let repoRoot: string
  try {
    repoRoot = await (options.resolveBundledEvolverRepoRoot ?? resolveBundledEvolverRepoRoot)(options.cwd ?? process.cwd())
  } catch (error) {
    return {
      availability: 'disabled',
      diagnostics: [
        `Bundled Evolver bridge is unavailable: ${error instanceof Error ? error.message : String(error)}`
      ]
    }
  }

  const evolverClient = new EvolverClient({
    command: process.execPath,
    cwd: repoRoot,
    argsPrefix: [join(repoRoot, 'index.js')],
    env: {},
    runJsonCommand: options.runJsonCommand
  })
  const evolverBridge = new StoaEvolverBridge({
    repoRoot,
    delegate: evolverClient
  })

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
      },
      codex: async () => {
        throw new Error('Codex headless inference is not implemented.')
      },
      api: async () => {
        throw new Error('API-based inference is not implemented.')
      }
    }
  )

  const executionRouter = new ExecutionRouter(
    {
      getExecutionMode: () => settingsReader.getSettings().evolverExecutionMode
    },
    {
      'workspace-shell': async () => {
        const settings = settingsReader.getSettings()
        const configuredShell = settings.shellPath.trim()
        const shellPath = configuredShell.length > 0
          ? configuredShell
          : await options.detectShell?.() ?? null
        return createWorkspaceShellExecutionCapability({ shellPath })
      }
    }
  )

  let availability: MemoryRuntimeHost['availability'] = 'full'
  try {
    await inferenceRouter.resolve()
    await executionRouter.resolve()
  } catch (error) {
    availability = 'recall-only'
    diagnostics.push(buildRecallOnlyDiagnostic(settingsReader.getSettings().evolverInferenceProvider, error))
  }

  return {
    availability,
    diagnostics,
    evolverBridge,
    turnMaintenanceRunner: new TurnMaintenanceRunner(
      evolverBridge,
      inferenceRouter,
      executionRouter,
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
  providerId: Extract<EvolverInferenceProvider, 'claude-code' | 'codex'>,
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

function defaultProviderCommand(providerId: Extract<EvolverInferenceProvider, 'claude-code' | 'codex'>): string {
  const descriptor = getProviderDescriptorByProviderId(providerId)
  return descriptor?.executableName ?? providerId
}

function buildRecallOnlyDiagnostic(
  provider: EvolverInferenceProvider,
  error: unknown
): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `Inference provider "${provider}" is unavailable for turn maintenance; Stoa will stay in recall-only mode. ${detail}`
}
