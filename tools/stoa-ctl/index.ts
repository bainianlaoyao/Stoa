#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

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

interface ReadableLike {
  setEncoding?: (encoding: BufferEncoding) => void
  on: (event: string, listener: (...args: any[]) => void) => unknown
  resume?: () => void
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface RunDependencies {
  fetch?: FetchLike
  env?: NodeJS.ProcessEnv
  stdout?: WritableLike
  stderr?: WritableLike
  stdin?: ReadableLike
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_WAIT_TIMEOUT_MS = 30_000
const DEFAULT_WAIT_INTERVAL_MS = 1_000

export const USAGE_TEXT = [
  'Usage: stoa-ctl',
  '  health',
  '  whoami',
  '  capabilities',
  '  state brief',
  '  state attention-queue',
  '  state conflicts',
  '  work-sessions list',
  '  work-sessions get <id>',
  '  work-sessions events <id> [--limit <n>] [--cursor <token>] [--include-ephemeral]',
  '  work-sessions context <id> [--level <slim|status|bundle|full>] [--max-chars <n>] [--cursor <token>]',
  '  work-sessions prompt <id> --text "..."',
  '  work-sessions prompt <id> --file <path>',
  '  work-sessions prompt <id> --stdin',
  '  meta-sessions list',
  '  meta-sessions create --title "..." --backend <claude-code|codex|opencode> [--capability-level <0|1|2|3>]',
  '  meta-sessions get <id>',
  '  meta-sessions close <id>',
  '  meta-sessions activate <id>',
  '  proposals create prompt --target <sessionId> --text "..."',
  '  proposals list',
  '  proposals get <proposalId>',
  '  proposals wait <proposalId> [--timeout-ms <n>] [--interval-ms <n>]',
  '  dispatch preset <name> --target <sessionId>',
  '  dispatch proposal <proposalId>'
].join('\n')

class CliUsageError extends Error {}
class CliConfigError extends Error {}

function resolveBaseUrl(env: NodeJS.ProcessEnv): string {
  const baseUrl = env.STOA_CTL_BASE_URL?.trim()
  if (!baseUrl) {
    throw new CliConfigError('Missing STOA_CTL_BASE_URL')
  }
  return baseUrl.replace(/\/+$/, '')
}

function resolveHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const token = env.STOA_CTL_TOKEN?.trim()
  const sessionId = env.STOA_META_SESSION_ID?.trim() ?? env.STOA_SESSION_ID?.trim()
  if (!token || !sessionId) {
    throw new CliConfigError('Missing STOA_CTL_TOKEN or STOA_META_SESSION_ID')
  }

  return {
    'x-stoa-session-id': sessionId,
    'x-stoa-secret': token
  }
}

function parseIntegerFlag(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name)
  if (index < 0) {
    return fallback
  }

  const raw = args[index + 1]
  if (!raw || !/^\d+$/.test(raw)) {
    throw new CliUsageError(`Invalid value for ${name}`)
  }
  return Number(raw)
}

function parseFlagValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? null : null
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

function parseCapabilityLevel(args: string[], name: string, fallback: number): number {
  const value = parseIntegerFlag(args, name, fallback)
  if (value < 0 || value > 3) {
    throw new CliUsageError(`Invalid value for ${name}`)
  }
  return value
}

async function readStdin(stdin: RunDependencies['stdin']): Promise<string> {
  if (!stdin) {
    throw new CliUsageError('Missing stdin stream for --stdin')
  }

  return await new Promise<string>((resolve, reject) => {
    let buffer = ''
    stdin.setEncoding?.('utf8')
    stdin.on('data', (chunk) => {
      buffer += String(chunk)
    })
    stdin.on('end', () => resolve(buffer))
    stdin.on('error', reject)
    stdin.resume?.()
  })
}

function mapFailureExitCode(response: Response, bodyText: string): number {
  try {
    const parsed = JSON.parse(bodyText) as JsonEnvelope
    if (parsed.error?.code === 'approval_required') {
      return 4
    }
    if (parsed.error?.code === 'stale_proposal') {
      return 5
    }
    if (parsed.error?.code === 'unknown_proposal' || parsed.error?.code === 'unknown_session') {
      return 6
    }
  } catch {
    // fall through
  }

  if (response.status === 401) {
    return 3
  }
  return 7
}

async function request(
  deps: Required<RunDependencies>,
  path: string,
  init: RequestInit = {}
): Promise<{ response: Response; text: string }> {
  const response = await deps.fetch(`${resolveBaseUrl(deps.env)}${path}`, {
    ...init,
    headers: {
      ...resolveHeaders(deps.env),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {})
    }
  })
  const text = await response.text()
  return { response, text }
}

function writeUsage(stderr: WritableLike): void {
  stderr.write(`${USAGE_TEXT}\n`)
}

export async function run(argv: string[], deps: RunDependencies = {}): Promise<number> {
  const resolvedDeps: Required<RunDependencies> = {
    fetch: deps.fetch ?? fetch,
    env: deps.env ?? process.env,
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
    stdin: deps.stdin ?? process.stdin,
    sleep: deps.sleep ?? (async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms)))
  }

  try {
    const [group, action, ...rest] = argv
    if (!group) {
      throw new CliUsageError('Missing command')
    }

    if (group === 'health' && action === undefined) {
      const { response, text } = await request(resolvedDeps, '/ctl/health')
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'whoami' && action === undefined) {
      const { response, text } = await request(resolvedDeps, '/ctl/whoami')
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'capabilities' && action === undefined) {
      const { response, text } = await request(resolvedDeps, '/ctl/capabilities')
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (!action) {
      throw new CliUsageError('Missing action')
    }

    if (group === 'state' && action === 'brief') {
      const { response, text } = await request(resolvedDeps, '/ctl/state/brief')
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'state' && action === 'attention-queue') {
      const { response, text } = await request(resolvedDeps, '/ctl/state/attention-queue')
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'state' && action === 'conflicts') {
      const { response, text } = await request(resolvedDeps, '/ctl/state/conflicts')
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'work-sessions' && action === 'list') {
      const { response, text } = await request(resolvedDeps, '/ctl/work-sessions')
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'work-sessions' && action === 'get') {
      const sessionId = rest[0]
      if (!sessionId) {
        throw new CliUsageError('Missing session id')
      }

      const { response, text } = await request(resolvedDeps, `/ctl/work-sessions/${sessionId}`)
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'work-sessions' && action === 'events') {
      const sessionId = rest[0]
      if (!sessionId) {
        throw new CliUsageError('Missing session id')
      }

      const params = new URLSearchParams()
      params.set('limit', String(parseIntegerFlag(rest, '--limit', 50)))
      const cursor = parseFlagValue(rest, '--cursor')
      if (cursor) {
        params.set('cursor', cursor)
      }
      if (hasFlag(rest, '--include-ephemeral')) {
        params.set('includeEphemeral', '1')
      }

      const { response, text } = await request(resolvedDeps, `/ctl/work-sessions/${sessionId}/events?${params.toString()}`)
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'work-sessions' && action === 'context') {
      const sessionId = rest[0]
      if (!sessionId) {
        throw new CliUsageError('Missing session id')
      }

      const level = parseFlagValue(rest, '--level') ?? 'slim'
      const maxChars = parseFlagValue(rest, '--max-chars')
      const cursor = parseFlagValue(rest, '--cursor')
      const params = new URLSearchParams({ level })
      if (maxChars) {
        params.set('maxChars', maxChars)
      }
      if (cursor) {
        params.set('cursor', cursor)
      }

      const { response, text } = await request(resolvedDeps, `/ctl/work-sessions/${sessionId}/context?${params.toString()}`)
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'work-sessions' && action === 'prompt') {
      const sessionId = rest[0]
      if (!sessionId) {
        throw new CliUsageError('Missing session id')
      }

      let text = parseFlagValue(rest, '--text')
      if (!text) {
        const filePath = parseFlagValue(rest, '--file')
        if (filePath) {
          text = await readFile(filePath, 'utf8')
        } else if (rest.includes('--stdin')) {
          text = await readStdin(resolvedDeps.stdin)
        }
      }

      if (!text || text.trim().length === 0) {
        throw new CliUsageError('Missing prompt text')
      }

      const { response, text: responseText } = await request(resolvedDeps, `/ctl/work-sessions/${sessionId}/prompt`, {
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

    if (group === 'meta-sessions' && action === 'list') {
      const { response, text } = await request(resolvedDeps, '/ctl/meta-sessions')
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'meta-sessions' && action === 'create') {
      const title = parseFlagValue(rest, '--title')
      const backendSessionType = parseFlagValue(rest, '--backend')
      if (!title || title.trim().length === 0) {
          throw new CliUsageError('Missing meta session title')
      }
      if (!backendSessionType || !['claude-code', 'codex', 'opencode'].includes(backendSessionType)) {
        throw new CliUsageError('Missing meta session backend session type')
      }

      const capabilityLevel = parseCapabilityLevel(rest, '--capability-level', 3)
      const { response, text } = await request(resolvedDeps, '/ctl/meta-sessions', {
        method: 'POST',
        body: JSON.stringify({
          title,
          backendSessionType,
          capabilityLevel
        })
      })
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'meta-sessions' && action === 'get') {
        const metaSessionId = rest[0]
        if (!metaSessionId) {
          throw new CliUsageError('Missing meta session id')
        }

      const { response, text } = await request(resolvedDeps, `/ctl/meta-sessions/${metaSessionId}`)
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'meta-sessions' && action === 'close') {
        const metaSessionId = rest[0]
        if (!metaSessionId) {
          throw new CliUsageError('Missing meta session id')
        }

      const { response, text } = await request(resolvedDeps, `/ctl/meta-sessions/${metaSessionId}/close`, {
        method: 'POST'
      })
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'meta-sessions' && action === 'activate') {
        const metaSessionId = rest[0]
        if (!metaSessionId) {
          throw new CliUsageError('Missing meta session id')
        }

      const { response, text } = await request(resolvedDeps, `/ctl/meta-sessions/${metaSessionId}/activate`, {
        method: 'POST'
      })
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'proposals' && action === 'list') {
      const { response, text } = await request(resolvedDeps, '/ctl/proposals')
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'proposals' && action === 'create') {
      const kind = rest[0]
      if (kind !== 'prompt') {
        throw new CliUsageError('Unsupported proposal kind')
      }

      const targetSessionId = parseFlagValue(rest, '--target')
      const text = parseFlagValue(rest, '--text')
      if (!targetSessionId || !text || text.trim().length === 0) {
        throw new CliUsageError('Missing proposal target or text')
      }

      const { response, text: responseText } = await request(resolvedDeps, '/ctl/proposals', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'prompt',
          targetSessionId,
          text
        })
      })
      if (!response.ok) {
        resolvedDeps.stderr.write(`${responseText}\n`)
        return mapFailureExitCode(response, responseText)
      }
      resolvedDeps.stdout.write(responseText)
      return 0
    }

    if (group === 'proposals' && action === 'get') {
      const proposalId = rest[0]
      if (!proposalId) {
        throw new CliUsageError('Missing proposal id')
      }
      const { response, text } = await request(resolvedDeps, `/ctl/proposals/${proposalId}`)
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'proposals' && action === 'wait') {
      const proposalId = rest[0]
      if (!proposalId) {
        throw new CliUsageError('Missing proposal id')
      }

      const timeoutMs = parseIntegerFlag(rest, '--timeout-ms', DEFAULT_WAIT_TIMEOUT_MS)
      const intervalMs = parseIntegerFlag(rest, '--interval-ms', DEFAULT_WAIT_INTERVAL_MS)
      const deadline = Date.now() + timeoutMs

      while (true) {
        const { response, text } = await request(resolvedDeps, `/ctl/proposals/${proposalId}`)
        if (!response.ok) {
          resolvedDeps.stderr.write(`${text}\n`)
          return mapFailureExitCode(response, text)
        }

        const parsed = JSON.parse(text) as JsonEnvelope
        const proposal = parsed.data as { status?: string } | null
        if (!proposal || !proposal.status) {
          resolvedDeps.stderr.write(`${text}\n`)
          return 7
        }

        if (proposal.status !== 'pending_approval' && proposal.status !== 'executing') {
          resolvedDeps.stdout.write(text)
          return 0
        }

        if (Date.now() >= deadline) {
          resolvedDeps.stderr.write(`Timed out waiting for proposal ${proposalId}\n`)
          return 7
        }

        await resolvedDeps.sleep(intervalMs)
      }
    }

    if (group === 'dispatch' && action === 'proposal') {
      const proposalId = rest[0]
      if (!proposalId) {
        throw new CliUsageError('Missing proposal id')
      }
      const { response, text } = await request(resolvedDeps, `/ctl/dispatch/proposal/${proposalId}`, {
        method: 'POST'
      })
      if (!response.ok) {
        resolvedDeps.stderr.write(`${text}\n`)
        return mapFailureExitCode(response, text)
      }
      resolvedDeps.stdout.write(text)
      return 0
    }

    if (group === 'dispatch' && action === 'preset') {
      const presetName = rest[0]
      const targetSessionId = parseFlagValue(rest, '--target')
      if (!presetName || !targetSessionId) {
        throw new CliUsageError('Missing preset name or target session id')
      }

      const { response, text } = await request(resolvedDeps, `/ctl/dispatch/preset/${presetName}`, {
        method: 'POST',
        body: JSON.stringify({
          targetSessionId
        })
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

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const exitCode = await run(process.argv.slice(2))
  process.exit(exitCode)
}
