#!/usr/bin/env node

import { readPortFile as defaultReadPortFile, isPidAlive, type PortFileData } from '@core/stoa-ctl-port-file'

type JsonEnvelope = {
  ok: boolean
  data: unknown
  error: {
    code?: string
    message?: string
  } | null
}

interface WritableLike {
  write: (chunk: string) => unknown
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface RunDependencies {
  fetch?: FetchLike
  env?: NodeJS.ProcessEnv
  stdout?: WritableLike
  stderr?: WritableLike
  sleep?: (ms: number) => Promise<void>
  readPortFile?: () => Promise<PortFileData | null>
}

type CallerMode =
  | {
      kind: 'session'
      sessionId: string
      sessionToken: string
    }
  | {
      kind: 'local-user'
      secret: string
    }

interface RunContext {
  portFileData: PortFileData | null
  baseUrl: string
  caller: CallerMode
}

export const USAGE_TEXT = [
  'Usage: stoa-ctl <command>',
  '',
  'Commands:',
  '  health',
  '  whoami',
  '  capabilities',
  '  session list [--include-archived]',
  '  session create --type <shell|opencode|codex|claude-code> [--title "..."] [--project <projectId>] [--parent <sessionId>]',
  '  session inspect <sessionId>',
  '  session prompt <sessionId> --text "..."',
  '  session destroy <sessionId>'
].join('\n')

const SESSION_TYPES = new Set(['shell', 'opencode', 'codex', 'claude-code'])

class CliUsageError extends Error {}
class CliConfigError extends Error {}

function resolveBaseUrl(env: NodeJS.ProcessEnv, portFileData: PortFileData | null): string {
  const baseUrl = env.STOA_CTL_BASE_URL?.trim()
  if (baseUrl) {
    return baseUrl.replace(/\/+$/, '')
  }
  if (portFileData) {
    return `http://127.0.0.1:${portFileData.port}`
  }
  throw new CliConfigError('Stoa is not running. Start Stoa or set STOA_CTL_BASE_URL.')
}

function resolveCaller(env: NodeJS.ProcessEnv, portFileData: PortFileData | null): CallerMode {
  const sessionId = env.STOA_SESSION_ID?.trim()
  const sessionToken = env.STOA_CTL_SESSION_TOKEN?.trim()

  if (sessionId || sessionToken) {
    if (!sessionId || !sessionToken) {
      throw new CliConfigError('Incomplete session control identity. Set both STOA_SESSION_ID and STOA_CTL_SESSION_TOKEN.')
    }
    return {
      kind: 'session',
      sessionId,
      sessionToken
    }
  }

  if (portFileData?.secret) {
    return {
      kind: 'local-user',
      secret: portFileData.secret
    }
  }

  throw new CliConfigError('No session identity available. Run inside a Stoa session or use a live Stoa local control port file.')
}

function parseFlagValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? null : null
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

function mapFailureExitCode(response: Response, bodyText: string): number {
  try {
    const parsed = JSON.parse(bodyText) as JsonEnvelope
    if (parsed.error?.code === 'unknown_session') {
      return 6
    }
  } catch {
    // ignore
  }

  if (response.status === 401) {
    return 3
  }
  return 7
}

function writeUsage(stderr: WritableLike): void {
  stderr.write(`${USAGE_TEXT}\n`)
}

function buildHeaders(caller: CallerMode, initHeaders: HeadersInit | undefined, hasBody: boolean): HeadersInit {
  const headers: Record<string, string> = {}
  if (caller.kind === 'session') {
    headers['x-stoa-session-id'] = caller.sessionId
    headers['x-stoa-session-token'] = caller.sessionToken
  } else {
    headers['x-stoa-secret'] = caller.secret
  }
  if (hasBody) {
    headers['content-type'] = 'application/json'
  }
  return {
    ...headers,
    ...(initHeaders ?? {})
  }
}

async function request(
  deps: Required<RunDependencies>,
  ctx: RunContext,
  path: string,
  init: RequestInit = {}
): Promise<{ response: Response; text: string }> {
  const response = await deps.fetch(`${ctx.baseUrl}${path}`, {
    ...init,
    headers: buildHeaders(ctx.caller, init.headers, init.body !== undefined)
  })
  const text = await response.text()
  return { response, text }
}

function ensureSessionType(type: string | null): string {
  if (!type || !SESSION_TYPES.has(type)) {
    throw new CliUsageError('Missing or invalid --type')
  }
  return type
}

function ensureSessionCaller(caller: CallerMode): asserts caller is Extract<CallerMode, { kind: 'session' }> {
  if (caller.kind !== 'session') {
    return
  }
}

function isDirectCliEntry(importMetaUrl: string, argvEntry: string | undefined): boolean {
  const entryPath = argvEntry?.replace(/\\/g, '/')
  const metaPath = importMetaUrl.replace(/^file:\/\//, '')
  return !!entryPath && (entryPath.endsWith(metaPath) || metaPath.endsWith(entryPath))
}

export { isDirectCliEntry }

export async function run(argv: string[], deps: RunDependencies = {}): Promise<number> {
  const resolvedDeps: Required<RunDependencies> = {
    fetch: deps.fetch ?? fetch,
    env: deps.env ?? process.env,
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
    sleep: deps.sleep ?? (async (_ms: number) => {}),
    readPortFile: deps.readPortFile ?? defaultReadPortFile
  }

  try {
    let portFileData: PortFileData | null = null
    if (!resolvedDeps.env.STOA_CTL_BASE_URL) {
      portFileData = await resolvedDeps.readPortFile()
      if (portFileData && !isPidAlive(portFileData.pid)) {
        portFileData = null
      }
    }

    const ctx: RunContext = {
      portFileData,
      baseUrl: resolveBaseUrl(resolvedDeps.env, portFileData),
      caller: resolveCaller(resolvedDeps.env, portFileData)
    }

    async function ctlRequest(path: string, init: RequestInit = {}): Promise<{ response: Response; text: string }> {
      return request(resolvedDeps, ctx, path, init)
    }

    const [group, action, ...rest] = argv
    if (!group) {
      throw new CliUsageError('Missing command')
    }

    if (group === 'health' && action === undefined) {
      const { response, text } = await ctlRequest('/ctl/health')
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'whoami' && action === undefined) {
      const { response, text } = await ctlRequest('/ctl/whoami')
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'capabilities' && action === undefined) {
      const { response, text } = await ctlRequest('/ctl/capabilities')
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group !== 'session' || !action) {
      throw new CliUsageError('Unknown command')
    }

    if (action === 'list') {
      const query = hasFlag(rest, '--include-archived') ? '?includeArchived=1' : ''
      const { response, text } = await ctlRequest(`/ctl/session/list${query}`)
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (action === 'create') {
      const type = ensureSessionType(parseFlagValue(rest, '--type'))
      const title = parseFlagValue(rest, '--title')
      const projectId = parseFlagValue(rest, '--project')
      const parentId = parseFlagValue(rest, '--parent')

      const body: Record<string, string> = { type }
      if (title) {
        body.title = title
      }

      if (ctx.caller.kind === 'session') {
        if (projectId || parentId) {
          throw new CliUsageError('Session callers cannot pass --project or --parent')
        }
      } else {
        if (!projectId) {
          throw new CliUsageError('Local-user create requires --project')
        }
        body.projectId = projectId
        if (parentId) {
          body.parentId = parentId
        }
      }

      const { response, text } = await ctlRequest('/ctl/session/create', {
        method: 'POST',
        body: JSON.stringify(body)
      })
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (action === 'inspect') {
      const sessionId = rest[0]
      if (!sessionId) {
        throw new CliUsageError('Missing session id')
      }
      const { response, text } = await ctlRequest(`/ctl/session/${sessionId}/inspect`)
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (action === 'prompt') {
      const sessionId = rest[0]
      const text = parseFlagValue(rest, '--text')
      if (!sessionId || !text || text.trim().length === 0) {
        throw new CliUsageError('Missing session id or prompt text')
      }
      const { response, text: responseText } = await ctlRequest(`/ctl/session/${sessionId}/prompt`, {
        method: 'POST',
        body: JSON.stringify({ text })
      })
      if (!response.ok) {
        resolvedDeps.stderr.write(`${responseText}\n`)
        return mapFailureExitCode(response, responseText)
      }
      resolvedDeps.stdout.write(responseText)
      return 0
    }

    if (action === 'destroy') {
      const sessionId = rest[0]
      if (!sessionId) {
        throw new CliUsageError('Missing session id')
      }
      const { response, text } = await ctlRequest(`/ctl/session/${sessionId}/destroy`, {
        method: 'POST'
      })
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    throw new CliUsageError('Unknown command')
  } catch (error) {
    if (error instanceof CliUsageError) {
      writeUsage(resolvedDeps.stderr)
      return 2
    }

    if (error instanceof CliConfigError) {
      resolvedDeps.stderr.write(`${error.message}\n`)
      return 3
    }

    resolvedDeps.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 7
  }
}

if (isDirectCliEntry(import.meta.url, process.argv[1])) {
  const exitCode = await run(process.argv.slice(2))
  process.exit(exitCode)
}
