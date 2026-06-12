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
  readFileUtf8?: (path: string) => Promise<string>
  readStdin?: () => Promise<string>
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
  '',
  '  session list [--include-archived]',
  '  session create --type <shell|opencode|codex|claude-code> [--title "..."] [--project <projectId>] [--parent <sessionId>] [--external-session-id <id>] [--cols <n>] [--rows <n>]',
  '  session inspect <sessionId>',
  '  session status <sessionId>',
  '  session output <sessionId>',
  '  session wait <sessionId> [--timeout <seconds>]',
  '  session report <sessionId>',
  '  session input <sessionId> --text <text>|--file <path>|--stdin',
  '  session destroy <sessionId>',
  '',
  '  subagent list',
  '  subagent dispatch --type <shell|opencode|codex|claude-code> --text <text>|--file <path>|--stdin [--title <title>] [--name <shortName>] [--parent <sessionId>] [--cols <n>] [--rows <n>]',
  '  subagent wait <subagent...> [--mode all|any] [--timeout <seconds>]',
  '  subagent input <subagent> --text <text>|--file <path>|--stdin',
  '  subagent stop <subagent...> [--mode interrupt|destroy]',
  '  subagent result --status <completed|failed|blocked|cancelled> --text <text>|--file <path>|--stdin [--title <title>]',
  '',
  'Notes:',
  '  Input sources --text, --file, and --stdin are mutually exclusive. Exactly one is required where shown.',
  '  <subagent> accepts either a short name or a formal session ID.',
  '  subagent wait exits 0 iff conditionMet is true.',
  '  subagent stop exits 0 iff overallStatus is complete.',
  '  subagent result is only available to child/subagent sessions.',
  '  session wait returns JSON with session, status, output, and report.',
  '  output.text is the captured terminal replay from normal stdout/stderr.'
].join('\n')

const SESSION_TYPES = new Set(['shell', 'opencode', 'codex', 'claude-code'])

const SUBAGENT_RESULT_STATUSES = new Set(['completed', 'failed', 'blocked', 'cancelled'])

const SUBAGENT_STOP_MODES = new Set(['interrupt', 'destroy'])

const SUBAGENT_WAIT_MODES = new Set(['all', 'any'])

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

function hasFlagOrAssignment(args: string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`))
}

/**
 * Parse mutually-exclusive input source: --text, --file, or --stdin.
 * Returns the resolved text content, or throws CliUsageError.
 */
async function parseInputSource(
  args: string[],
  deps: Required<Pick<RunDependencies, 'readFileUtf8' | 'readStdin'>>
): Promise<string> {
  const text = parseFlagValue(args, '--text')
  const file = parseFlagValue(args, '--file')
  const useStdin = hasFlag(args, '--stdin')

  const provided: string[] = []
  if (text !== null) provided.push('--text')
  if (file !== null) provided.push('--file')
  if (useStdin) provided.push('--stdin')

  if (provided.length === 0) {
    throw new CliUsageError('Missing input source. Provide exactly one of --text, --file, or --stdin.')
  }
  if (provided.length > 1) {
    throw new CliUsageError(`Multiple input sources provided (${provided.join(', ')}). Provide exactly one of --text, --file, or --stdin.`)
  }

  let content: string
  if (text !== null) {
    content = text
  } else if (file !== null) {
    content = await deps.readFileUtf8(file)
  } else {
    content = await deps.readStdin()
  }

  if (content.trim().length === 0) {
    throw new CliUsageError('Input content must not be blank (whitespace only).')
  }

  return content
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

function parsePositiveIntegerFlag(value: string | null, name: string): number | null {
  if (value === null) {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new CliUsageError(`Invalid ${name}`)
  }
  return parsed
}

function isDirectCliEntry(importMetaUrl: string, argvEntry: string | undefined): boolean {
  const entryPath = argvEntry?.replace(/\\/g, '/')
  const metaPath = importMetaUrl.replace(/^file:\/\//, '')
  return !!entryPath && (entryPath.endsWith(metaPath) || metaPath.endsWith(entryPath))
}

export { isDirectCliEntry, parseInputSource }

function formatSubagentListItem(item: { name: string; id: string; type: string; title: string; phase: string; resultStatus: string | null }): string {
  const resultPart = item.resultStatus ? ` [${item.resultStatus}]` : ''
  return `${item.name} (${item.id})  type=${item.type}  phase=${item.phase}${resultPart}\n  ${item.title}`
}

function formatSubagentWaitOutput(data: {
  mode: string
  conditionMet: boolean
  overallStatus: string
  timeoutMs: number | null
  elapsedMs: number
  targets: Array<{
    target: string
    name?: string
    id?: string
    state: string
    status?: string
    source?: string
    title?: string | null
    body?: string
    phase?: string
    updatedAt?: string
    error?: { code?: string; message?: string } | null
  }>
}): string {
  const lines: string[] = []
  lines.push(`Wait completed.`)
  lines.push(`Mode: ${data.mode}`)
  lines.push(`Condition met: ${data.conditionMet}`)
  lines.push(`Overall status: ${data.overallStatus}`)
  if (data.timeoutMs !== null) {
    lines.push(`Timeout: ${data.timeoutMs}ms`)
  }
  lines.push(`Elapsed: ${data.elapsedMs}ms`)
  lines.push('')

  for (const target of data.targets) {
    if (target.state === 'completed') {
      lines.push(`${target.name ?? target.target} (${target.id ?? target.target}): ${target.status}`)
      lines.push(`Result source: ${target.source}`)
      if (target.title) {
        lines.push(`Title: ${target.title}`)
      }
      lines.push('')
      if (target.body) {
        if (target.source === 'terminal') {
          lines.push('No explicit subagent result was submitted. The following output is terminal replay:')
          lines.push('')
        }
        lines.push(target.body)
      }
    } else if (target.state === 'pending') {
      lines.push(`${target.name ?? target.target} (${target.id ?? target.target}): pending (phase: ${target.phase ?? 'unknown'})`)
    } else if (target.state === 'error') {
      const errCode = target.error?.code ?? 'unknown'
      const errMsg = target.error?.message ?? 'unknown error'
      lines.push(`${target.target}: error (${errCode}) ${errMsg}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

function formatSubagentStopOutput(data: {
  mode: string
  overallStatus: string
  targets: Array<{
    target: string
    name?: string
    id?: string
    state: string
    updatedAt?: string
    error?: { code?: string; message?: string } | null
  }>
}): string {
  const lines: string[] = []
  lines.push(`Stop completed.`)
  lines.push(`Mode: ${data.mode}`)
  lines.push(`Overall status: ${data.overallStatus}`)
  lines.push('')

  for (const target of data.targets) {
    if (target.state === 'error') {
      const errCode = target.error?.code ?? 'unknown'
      const errMsg = target.error?.message ?? 'unknown error'
      lines.push(`${target.target}: error (${errCode}) ${errMsg}`)
    } else {
      lines.push(`${target.name ?? target.target} (${target.id ?? target.target}): ${target.state}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

function formatSubagentResultOutput(data: {
  status: string
  title: string | null
  createdAt: string
  updatedAt: string
  hasBody: boolean
}): string {
  const lines: string[] = []
  lines.push('Subagent result recorded.')
  lines.push(`Status: ${data.status}`)
  if (data.title) {
    lines.push(`Title: ${data.title}`)
  }
  lines.push(`Content: ${data.hasBody ? 'included' : 'empty'}`)
  lines.push(`Updated: ${data.updatedAt}`)
  return lines.join('\n')
}

export async function run(argv: string[], deps: RunDependencies = {}): Promise<number> {
  const resolvedDeps: Required<RunDependencies> = {
    fetch: deps.fetch ?? fetch,
    env: deps.env ?? process.env,
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
    sleep: deps.sleep ?? (async (_ms: number) => {}),
    readPortFile: deps.readPortFile ?? defaultReadPortFile,
    readFileUtf8: deps.readFileUtf8 ?? ((path: string) => import('fs').then(fs => fs.promises.readFile(path, 'utf-8'))),
    readStdin: deps.readStdin ?? (async () => {
      return new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk))
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
        process.stdin.on('error', reject)
      })
    })
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

    // ── session command group ──

    if (group === 'session' && action) {
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
        const externalSessionId = parseFlagValue(rest, '--external-session-id')
        const initialCols = parsePositiveIntegerFlag(parseFlagValue(rest, '--cols'), '--cols')
        const initialRows = parsePositiveIntegerFlag(parseFlagValue(rest, '--rows'), '--rows')

        const body: Record<string, string | number> = { type }
        if (title) {
          body.title = title
        }
        if (externalSessionId) {
          body.externalSessionId = externalSessionId
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

        if (initialCols !== null) {
          body.initialCols = initialCols
        }
        if (initialRows !== null) {
          body.initialRows = initialRows
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

      if (action === 'status') {
        const sessionId = rest[0]
        if (!sessionId) {
          throw new CliUsageError('Missing session id')
        }
        const { response, text } = await ctlRequest(`/ctl/session/${sessionId}/status`)
        if (!response.ok) {
          resolvedDeps.stderr.write(`${text}\n`)
          return mapFailureExitCode(response, text)
        }
        resolvedDeps.stdout.write(text)
        return 0
      }

      if (action === 'output') {
        const sessionId = rest[0]
        if (!sessionId) {
          throw new CliUsageError('Missing session id')
        }
        const { response, text } = await ctlRequest(`/ctl/session/${sessionId}/output`)
        if (!response.ok) {
          resolvedDeps.stderr.write(`${text}\n`)
          return mapFailureExitCode(response, text)
        }
        resolvedDeps.stdout.write(text)
        return 0
      }

      if (action === 'wait') {
        const sessionId = rest[0]
        if (!sessionId) {
          throw new CliUsageError('Missing session id')
        }
        if (hasFlagOrAssignment(rest, '--timeout-ms')) {
          throw new CliUsageError('Use --timeout <seconds> for session wait')
        }
        const timeoutSeconds = parsePositiveIntegerFlag(parseFlagValue(rest, '--timeout'), '--timeout')
        const timeoutMs = timeoutSeconds !== null ? timeoutSeconds * 1000 : null
        const query = timeoutMs !== null ? `?timeoutMs=${encodeURIComponent(String(timeoutMs))}` : ''
        const { response, text } = await ctlRequest(`/ctl/session/${sessionId}/wait${query}`)
        if (!response.ok) {
          resolvedDeps.stderr.write(`${text}\n`)
          return mapFailureExitCode(response, text)
        }
        resolvedDeps.stdout.write(text)
        return 0
      }

      if (action === 'report') {
        const sessionId = rest[0]
        if (!sessionId) {
          throw new CliUsageError('Missing session id')
        }
        const { response, text } = await ctlRequest(`/ctl/session/${sessionId}/completion-report`)
        if (!response.ok) {
          resolvedDeps.stderr.write(`${text}\n`)
          return mapFailureExitCode(response, text)
        }
        resolvedDeps.stdout.write(text)
        return 0
      }

      if (action === 'input') {
        const sessionId = rest[0]
        if (!sessionId) {
          throw new CliUsageError('Missing session id')
        }
        const inputText = await parseInputSource(rest, resolvedDeps)
        const { response, text } = await ctlRequest(`/ctl/session/${sessionId}/input`, {
          method: 'POST',
          body: JSON.stringify({ text: inputText })
        })
        if (!response.ok) {
          resolvedDeps.stderr.write(`${text}\n`)
          return mapFailureExitCode(response, text)
        }
        resolvedDeps.stdout.write(text)
        return 0
      }

      if (action === 'prompt') {
        throw new CliUsageError('`session prompt` has been replaced by `session input`. Use: stoa-ctl session input <sessionId> --text "..."|--file <path>|--stdin')
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
    }

    // ── subagent command group ──

    if (group === 'subagent' && action) {
      if (action === 'list') {
        const { response, text } = await ctlRequest('/ctl/subagent/list')
        if (!response.ok) {
          resolvedDeps.stderr.write(`${text}\n`)
          return mapFailureExitCode(response, text)
        }
        const parsed = JSON.parse(text) as { ok: boolean; data: { subagents: Array<{ name: string; id: string; type: string; title: string; phase: string; resultStatus: string | null }> } }
        const subagents = parsed.data.subagents
        if (subagents.length === 0) {
          resolvedDeps.stdout.write('No visible subagents.\n')
        } else {
          resolvedDeps.stdout.write(subagents.map(s => formatSubagentListItem(s)).join('\n\n') + '\n')
        }
        return 0
      }

      if (action === 'dispatch') {
        const type = ensureSessionType(parseFlagValue(rest, '--type'))
        const inputText = await parseInputSource(rest, resolvedDeps)
        const title = parseFlagValue(rest, '--title')
        const name = parseFlagValue(rest, '--name')
        const parentId = parseFlagValue(rest, '--parent')
        const initialCols = parsePositiveIntegerFlag(parseFlagValue(rest, '--cols'), '--cols')
        const initialRows = parsePositiveIntegerFlag(parseFlagValue(rest, '--rows'), '--rows')

        const body: Record<string, string | number> = { type, text: inputText }
        if (title) {
          body.title = title
        }
        if (name) {
          body.name = name
        }
        if (initialCols !== null) {
          body.initialCols = initialCols
        }
        if (initialRows !== null) {
          body.initialRows = initialRows
        }

        if (ctx.caller.kind === 'session') {
          if (parentId) {
            throw new CliUsageError('Session callers cannot pass --parent to subagent dispatch')
          }
        } else {
          if (!parentId) {
            throw new CliUsageError('Local-user subagent dispatch requires --parent')
          }
          body.parentId = parentId
        }

        const { response, text } = await ctlRequest('/ctl/subagent/dispatch', {
          method: 'POST',
          body: JSON.stringify(body)
        })
        if (!response.ok) {
          resolvedDeps.stderr.write(`${text}\n`)
          return mapFailureExitCode(response, text)
        }
        const parsed = JSON.parse(text) as { ok: boolean; data: { subagent: { name: string; id: string; title: string; phase: string } } }
        const sub = parsed.data.subagent
        resolvedDeps.stdout.write(`Subagent dispatched.\nName: ${sub.name}\nID: ${sub.id}\nStatus: running\n`)
        return 0
      }

      if (action === 'wait') {
        if (hasFlagOrAssignment(rest, '--timeout-ms')) {
          throw new CliUsageError('Use --timeout <seconds> for subagent wait')
        }

        const modeValue = parseFlagValue(rest, '--mode') ?? 'all'
        if (!SUBAGENT_WAIT_MODES.has(modeValue)) {
          throw new CliUsageError('Invalid --mode. Use "all" or "any".')
        }

        const timeoutSeconds = parsePositiveIntegerFlag(parseFlagValue(rest, '--timeout'), '--timeout')
        const timeoutMs = timeoutSeconds !== null ? timeoutSeconds * 1000 : null

        // Collect targets: everything that is not a flag or flag value
        const targets = collectPositionalTargets(rest)
        if (targets.length === 0) {
          throw new CliUsageError('Missing subagent target(s). Provide at least one name or ID.')
        }

        const reqBody: Record<string, unknown> = { targets, mode: modeValue }
        if (timeoutMs !== null) {
          reqBody.timeoutMs = timeoutMs
        }

        const { response, text } = await ctlRequest('/ctl/subagent/wait', {
          method: 'POST',
          body: JSON.stringify(reqBody)
        })
        if (!response.ok) {
          resolvedDeps.stderr.write(`${text}\n`)
          return mapFailureExitCode(response, text)
        }
        const parsed = JSON.parse(text) as { ok: boolean; data: { result: { mode: string; conditionMet: boolean; overallStatus: string; timeoutMs: number | null; elapsedMs: number; targets: Array<Record<string, unknown>> } } }
        const aggregate = parsed.data.result
        resolvedDeps.stdout.write(formatSubagentWaitOutput(aggregate as Parameters<typeof formatSubagentWaitOutput>[0]) + '\n')
        return aggregate.conditionMet ? 0 : 7
      }

      if (action === 'input') {
        const target = rest[0]
        if (!target) {
          throw new CliUsageError('Missing subagent target. Provide a name or ID.')
        }
        const inputText = await parseInputSource(rest.slice(1), resolvedDeps)
        const { response, text } = await ctlRequest('/ctl/subagent/input', {
          method: 'POST',
          body: JSON.stringify({ target, text: inputText })
        })
        if (!response.ok) {
          resolvedDeps.stderr.write(`${text}\n`)
          return mapFailureExitCode(response, text)
        }
        const parsed = JSON.parse(text) as { ok: boolean; data: { delivered: boolean; subagent: { name: string; id: string }; updatedAt: string } }
        const data = parsed.data
        resolvedDeps.stdout.write(`Input delivered.\nTarget: ${data.subagent.name} (${data.subagent.id})\nUpdated: ${data.updatedAt}\n`)
        return 0
      }

      if (action === 'stop') {
        const modeValue = parseFlagValue(rest, '--mode') ?? 'interrupt'
        if (!SUBAGENT_STOP_MODES.has(modeValue)) {
          throw new CliUsageError('Invalid --mode. Use "interrupt" or "destroy".')
        }

        const targets = collectPositionalTargets(rest)
        if (targets.length === 0) {
          throw new CliUsageError('Missing subagent target(s). Provide at least one name or ID.')
        }

        const { response, text } = await ctlRequest('/ctl/subagent/stop', {
          method: 'POST',
          body: JSON.stringify({ targets, mode: modeValue })
        })
        if (!response.ok) {
          resolvedDeps.stderr.write(`${text}\n`)
          return mapFailureExitCode(response, text)
        }
        const parsed = JSON.parse(text) as { ok: boolean; data: { result: { mode: string; overallStatus: string; targets: Array<Record<string, unknown>> } } }
        const aggregate = parsed.data.result
        resolvedDeps.stdout.write(formatSubagentStopOutput(aggregate as Parameters<typeof formatSubagentStopOutput>[0]) + '\n')
        return aggregate.overallStatus === 'complete' ? 0 : 7
      }

      if (action === 'result') {
        const statusValue = parseFlagValue(rest, '--status')
        if (!statusValue || !SUBAGENT_RESULT_STATUSES.has(statusValue)) {
          throw new CliUsageError('Missing or invalid --status. Use: completed, failed, blocked, or cancelled.')
        }
        const inputText = await parseInputSource(rest, resolvedDeps)
        const title = parseFlagValue(rest, '--title')

        const body: Record<string, string> = { status: statusValue, text: inputText }
        if (title) {
          body.title = title
        }

        const { response, text } = await ctlRequest('/ctl/subagent/result', {
          method: 'POST',
          body: JSON.stringify(body)
        })
        if (!response.ok) {
          resolvedDeps.stderr.write(`${text}\n`)
          return mapFailureExitCode(response, text)
        }
        const parsed = JSON.parse(text) as {
          ok: boolean
          data: {
            result: {
              status: string
              title: string | null
              createdAt: string
              updatedAt: string
              hasBody: boolean
            }
          }
        }
        resolvedDeps.stdout.write(`${formatSubagentResultOutput(parsed.data.result)}\n`)
        return 0
      }

      throw new CliUsageError('Unknown subagent command')
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

/**
 * Collect positional (non-flag) arguments from a rest array.
 * Skips anything starting with '--' and the value immediately following a '--xxx' flag.
 */
function collectPositionalTargets(args: string[]): string[] {
  const targets: string[] = []
  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      // Skip the flag and its value (if it has one, i.e. next item doesn't start with --)
      i++
      if (i < args.length && !args[i].startsWith('--')) {
        i++
      }
      continue
    }
    targets.push(arg)
    i++
  }
  return targets
}

if (isDirectCliEntry(import.meta.url, process.argv[1])) {
  const exitCode = await run(process.argv.slice(2))
  process.exit(exitCode)
}
