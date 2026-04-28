import { execFile as nodeExecFile } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AppSettings, MemoryAiProvider } from '@shared/project-session'
import type {
  DistillationDecision,
  ReviewDecision,
  SemanticSessionSummary
} from '@shared/memory-runtime'
import { resolveProviderExecutablePath as defaultResolveProviderExecutablePath } from '../provider-path-resolver'
import { detectProvider, detectShell } from '../settings-detector'
import type {
  CliAiBaseRequest,
  DistillationDecisionRequest,
  ReviewDecisionRequest,
  SemanticSessionSummaryRequest,
  StructuredResponseContract
} from './cli-ai-schemas'
import {
  distillationDecisionResponseContract,
  reviewDecisionResponseContract,
  semanticSessionSummaryResponseContract
} from './cli-ai-schemas'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_BUFFER_BYTES = 10 * 1024 * 1024

type ExecFileLike = (
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    windowsHide: boolean
    timeout: number
    maxBuffer: number
  },
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => void

type ResolveProviderExecutablePath = typeof defaultResolveProviderExecutablePath

export interface CliAiProviderOptions {
  settings: AppSettings
  execFile?: ExecFileLike
  resolveProviderExecutablePath?: ResolveProviderExecutablePath
  platform?: NodeJS.Platform
  pathExists?: (candidatePath: string) => Promise<boolean>
}

export class CliAiProvider {
  private readonly settings: AppSettings
  private readonly execFile: ExecFileLike
  private readonly resolveProviderExecutablePath: ResolveProviderExecutablePath
  private readonly platform: NodeJS.Platform
  private readonly pathExists: (candidatePath: string) => Promise<boolean>

  constructor(options: CliAiProviderOptions) {
    this.settings = options.settings
    this.execFile = options.execFile ?? nodeExecFile
    this.resolveProviderExecutablePath =
      options.resolveProviderExecutablePath ?? defaultResolveProviderExecutablePath
    this.platform = options.platform ?? process.platform
    this.pathExists = options.pathExists ?? defaultPathExists
  }

  async summarizeSession(request: SemanticSessionSummaryRequest): Promise<SemanticSessionSummary> {
    return await this.runStructuredRequest(
      request,
      semanticSessionSummaryResponseContract
    )
  }

  async review(request: ReviewDecisionRequest): Promise<ReviewDecision> {
    return await this.runStructuredRequest(
      request,
      reviewDecisionResponseContract
    )
  }

  async distill(request: DistillationDecisionRequest): Promise<DistillationDecision> {
    return await this.runStructuredRequest(
      request,
      distillationDecisionResponseContract
    )
  }

  private async runStructuredRequest<TResponse>(
    request: CliAiBaseRequest,
    contract: StructuredResponseContract<TResponse>
  ): Promise<TResponse> {
    const providerId = this.settings.memoryAiProvider
    if (providerId === 'claude-code') {
      return await this.runClaudeRequest(request, contract)
    }

    return await this.runCodexRequest(request, contract)
  }

  private async runClaudeRequest<TResponse>(
    request: CliAiBaseRequest,
    contract: StructuredResponseContract<TResponse>
  ): Promise<TResponse> {
    const invocation = await this.resolveInvocation(providerIdFromSettings(this.settings), [
      '-p',
      request.prompt,
      '--bare',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(contract.schema),
      '--permission-mode',
      'bypassPermissions',
      '--tools',
      '',
      '--no-session-persistence'
    ])
    const stdout = await this.execCommand(invocation.command, invocation.args, request)

    let parsed: unknown
    try {
      parsed = JSON.parse(stdout)
    } catch {
      throw new Error('Claude CLI returned invalid JSON')
    }

    const structuredOutput = readStructuredOutput(parsed)
    return contract.parse(structuredOutput)
  }

  private async runCodexRequest<TResponse>(
    request: CliAiBaseRequest,
    contract: StructuredResponseContract<TResponse>
  ): Promise<TResponse> {
    const schemaDir = await mkdtemp(join(tmpdir(), 'stoa-codex-schema-'))
    const schemaPath = join(schemaDir, 'output-schema.json')

    try {
      await writeFile(schemaPath, JSON.stringify(contract.schema), 'utf8')
      const invocation = await this.resolveInvocation(providerIdFromSettings(this.settings), [
        'exec',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--output-schema',
        schemaPath,
        '--color',
        'never',
        '--json',
        '--cd',
        request.cwd,
        request.prompt
      ])
      const stdout = await this.execCommand(invocation.command, invocation.args, request)

      const parsedPayload = parseCodexStructuredPayload(stdout)
      return contract.parse(parsedPayload)
    } finally {
      await rm(schemaDir, { recursive: true, force: true })
    }
  }

  private async resolveInvocation(
    providerId: MemoryAiProvider,
    providerArgs: string[]
  ): Promise<{ command: string; args: string[] }> {
    const resolved = await this.resolveProviderExecutablePath(providerId, this.settings, {
      detectShell,
      detectProvider
    })

    if (resolved.providerPath) {
      return await this.toInvocation(resolved.providerPath, resolved.shellPath, providerArgs)
    }

    return {
      command: providerId === 'claude-code' ? 'claude' : 'codex',
      args: providerArgs
    }
  }

  private async execCommand(
    command: string,
    args: string[],
    request: CliAiBaseRequest
  ): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      this.execFile(
        command,
        args,
        {
          cwd: request.cwd,
          env: process.env,
          windowsHide: true,
          timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER_BYTES
        },
        (error, stdout) => {
          if (error) {
            reject(error)
            return
          }

          resolve(stdout)
        }
      )
    })
  }

  private async toInvocation(
    providerPath: string,
    shellPath: string | null,
    providerArgs: string[]
  ): Promise<{ command: string; args: string[] }> {
    if (this.platform !== 'win32') {
      return {
        command: providerPath,
        args: providerArgs
      }
    }

    const canonicalProviderPath = await this.normalizeWindowsProviderPath(providerPath)

    if (!isWindowsScriptPath(canonicalProviderPath)) {
      return {
        command: canonicalProviderPath,
        args: providerArgs
      }
    }

    if (hasPowerShellExtension(canonicalProviderPath)) {
      const powerShellPath = isPowerShellShell(shellPath) ? shellPath : 'powershell.exe'
      return {
        command: powerShellPath,
        args: ['-NoLogo', '-NoProfile', '-File', canonicalProviderPath, ...providerArgs]
      }
    }

    if (isCmdShell(shellPath)) {
      return {
        command: shellPath,
        args: ['/d', '/s', '/c', buildCmdInvocation(canonicalProviderPath, providerArgs)]
      }
    }

    if (isPowerShellShell(shellPath)) {
      return {
        command: shellPath,
        args: ['-NoLogo', '-NoProfile', '-Command', buildPowerShellInvocation(canonicalProviderPath, providerArgs)]
      }
    }

    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', buildCmdInvocation(canonicalProviderPath, providerArgs)]
    }
  }

  private async normalizeWindowsProviderPath(providerPath: string): Promise<string> {
    const extension = extname(providerPath).toLowerCase()
    const basePath = extension.length > 0
      ? providerPath.slice(0, -extension.length)
      : providerPath

    const preferredCandidates = [
      `${basePath}.exe`,
      `${basePath}.ps1`,
      `${basePath}.cmd`,
      `${basePath}.bat`
    ]

    for (const candidatePath of preferredCandidates) {
      if (candidatePath === providerPath) {
        return providerPath
      }

      if (await this.pathExists(candidatePath)) {
        return candidatePath
      }
    }

    return providerPath
  }
}

function providerIdFromSettings(settings: AppSettings): MemoryAiProvider {
  return settings.memoryAiProvider
}

function readStructuredOutput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Claude CLI did not return a valid structured_output payload')
  }

  const structuredOutput = (value as Record<string, unknown>).structured_output
  if (!structuredOutput || typeof structuredOutput !== 'object' || Array.isArray(structuredOutput)) {
    throw new Error('Claude CLI did not return a valid structured_output payload')
  }

  return structuredOutput
}

function parseCodexStructuredPayload(stdout: string): unknown {
  let lastStructuredText: string | null = null

  for (const line of stdout.split(/\r?\n/)) {
    const trimmedLine = line.trim()
    if (trimmedLine.length === 0) {
      continue
    }

    let parsedLine: unknown
    try {
      parsedLine = JSON.parse(trimmedLine)
    } catch {
      continue
    }

    if (!parsedLine || typeof parsedLine !== 'object' || Array.isArray(parsedLine)) {
      continue
    }

    const record = parsedLine as Record<string, unknown>
    if (record.type !== 'item.completed') {
      continue
    }

    const item = record.item
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }

    const itemRecord = item as Record<string, unknown>
    if (itemRecord.type !== 'agent_message' || typeof itemRecord.text !== 'string') {
      continue
    }

    lastStructuredText = itemRecord.text
  }

  if (!lastStructuredText) {
    throw new Error('Codex CLI returned invalid structured JSON')
  }

  try {
    return JSON.parse(lastStructuredText)
  } catch {
    throw new Error('Codex CLI returned invalid structured JSON')
  }
}

function isWindowsScriptPath(providerPath: string): boolean {
  const extension = extname(providerPath).toLowerCase()
  return extension === '.ps1' || extension === '.cmd' || extension === '.bat'
}

function hasPowerShellExtension(providerPath: string): boolean {
  return extname(providerPath).toLowerCase() === '.ps1'
}

function isPowerShellShell(shellPath: string | null): shellPath is string {
  if (!shellPath) {
    return false
  }

  const normalized = shellPath.replaceAll('\\', '/').toLowerCase()
  return normalized.includes('powershell') || normalized.endsWith('/pwsh') || normalized.endsWith('/pwsh.exe')
}

function isCmdShell(shellPath: string | null): shellPath is string {
  if (!shellPath) {
    return false
  }

  const normalized = shellPath.replaceAll('\\', '/').toLowerCase()
  return normalized.endsWith('/cmd.exe') || normalized.endsWith('/cmd')
}

function buildCmdInvocation(providerPath: string, providerArgs: string[]): string {
  return `"${escapeCmdValue(providerPath)}"${providerArgs.map(arg => ` ${quoteCmdValue(arg)}`).join('')}`
}

function quoteCmdValue(value: string): string {
  return `"${escapeCmdValue(value)}"`
}

function escapeCmdValue(value: string): string {
  return value.replaceAll('"', '""')
}

function buildPowerShellInvocation(providerPath: string, providerArgs: string[]): string {
  return ['&', quotePowerShellValue(providerPath), ...providerArgs.map(quotePowerShellValue)].join(' ')
}

function quotePowerShellValue(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

async function defaultPathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}
