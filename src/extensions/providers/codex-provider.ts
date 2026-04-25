import { createReadStream } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'

const DISCOVERY_ATTEMPTS = 20
const DISCOVERY_DELAY_MS = 500
const DISCOVERY_WINDOW_MS = 60_000
const DISCOVERY_CLOCK_SKEW_MS = 2_000
const MAX_SESSION_FILES = 40
const FULL_RESCAN_INTERVAL = 4

function codexCommand(context: ProviderCommandContext): string {
  const configuredPath = context.providerPath?.trim()
  return configuredPath && configuredPath.length > 0 ? configuredPath : 'codex'
}

function createProviderEnv(target: ProviderRuntimeTarget, context: ProviderCommandContext): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    STOA_SESSION_ID: target.session_id,
    STOA_PROJECT_ID: target.project_id,
    STOA_SESSION_SECRET: context.sessionSecret,
    STOA_WEBHOOK_PORT: String(context.webhookPort),
    STOA_PROVIDER_PORT: String(context.providerPort)
  }
}

function createCommand(target: ProviderRuntimeTarget, context: ProviderCommandContext, args: string[]): ProviderCommand {
  return {
    command: codexCommand(context),
    args,
    cwd: target.path,
    env: createProviderEnv(target, context)
  }
}

async function writeSharedNotifySidecar(target: ProviderRuntimeTarget): Promise<void> {
  const codexDir = join(target.path, '.codex')
  await mkdir(codexDir, { recursive: true })

  await writeFile(
    join(codexDir, 'config.toml'),
    'notify = ["node", ".codex/notify-stoa.mjs"]\n\n[features]\ncodex_hooks = true\n',
    'utf-8'
  )

  await writeFile(
    join(codexDir, 'notify-stoa.mjs'),
    `const sessionId = process.env.STOA_SESSION_ID
const projectId = process.env.STOA_PROJECT_ID
const sessionSecret = process.env.STOA_SESSION_SECRET
const webhookPort = process.env.STOA_WEBHOOK_PORT

const payload = process.argv[2]
if (!sessionId || !projectId || !sessionSecret || !webhookPort || !payload) {
  process.exit(0)
}

const parsed = JSON.parse(payload)
if (!parsed || typeof parsed !== 'object' || parsed.type !== 'agent-turn-complete') {
  process.exit(0)
}

await fetch(\`http://127.0.0.1:\${webhookPort}/events\`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-stoa-secret': sessionSecret
  },
  body: JSON.stringify({
    event_version: 1,
    event_id: String(parsed['turn-id'] ?? parsed['turn_id'] ?? crypto.randomUUID()),
    event_type: String(parsed.type),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    project_id: projectId,
    source: 'provider-adapter',
    payload: {
      status: 'turn_complete',
      summary: String(parsed.type),
      externalSessionId: parsed['thread-id'] ?? undefined,
      snippet: parsed['last-assistant-message'] ?? undefined
    }
  })
})
`,
    'utf-8'
  )

  const hooksConfig = {
    hooks: {
      SessionStart: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs', timeout_sec: 5 }]
        }
      ],
      UserPromptSubmit: [
        {
          hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs', timeout_sec: 5 }]
        }
      ],
      PreToolUse: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs', timeout_sec: 5 }]
        }
      ],
      PostToolUse: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs', timeout_sec: 5 }]
        }
      ],
      Stop: [
        {
          hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs', timeout_sec: 5 }]
        }
      ]
    }
  }
  await writeFile(
    join(codexDir, 'hooks.json'),
    JSON.stringify(hooksConfig, null, 2) + '\n',
    'utf-8'
  )

  await writeFile(
    join(codexDir, 'hook-stoa.mjs'),
    `import { createInterface } from 'node:readline'

const sessionId = process.env.STOA_SESSION_ID
const projectId = process.env.STOA_PROJECT_ID
const sessionSecret = process.env.STOA_SESSION_SECRET
const webhookPort = process.env.STOA_WEBHOOK_PORT

if (!sessionId || !projectId || !sessionSecret || !webhookPort) {
  process.exit(0)
}

let input = ''
for await (const line of createInterface({ input: process.stdin })) {
  input += line
}

if (!input.trim()) process.exit(0)

await fetch(\`http://127.0.0.1:\${webhookPort}/hooks/codex\`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-stoa-session-id': sessionId,
    'x-stoa-project-id': projectId,
    'x-stoa-secret': sessionSecret
  },
  body: input
})
`,
    'utf-8'
  )
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
}

function codexHome(): string {
  const explicit = process.env.CODEX_HOME?.trim()
  if (explicit) return explicit
  return join(homedir(), '.codex')
}

function insertRecentFile(
  files: Array<{ file: string; modifiedAt: number }>,
  nextFile: { file: string; modifiedAt: number }
): void {
  files.push(nextFile)
  files.sort((left, right) => right.modifiedAt - left.modifiedAt)
  if (files.length > MAX_SESSION_FILES) {
    files.length = MAX_SESSION_FILES
  }
}

async function collectRecentSessionFiles(
  dir: string,
  files: Array<{ file: string; modifiedAt: number }> = []
): Promise<Array<{ file: string; modifiedAt: number }>> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectRecentSessionFiles(absolute, files)
      continue
    }
    if (entry.isFile() && absolute.endsWith('.jsonl')) {
      const modifiedAt = (await stat(absolute).catch(() => ({ mtimeMs: 0 } as { mtimeMs: number }))).mtimeMs
      insertRecentFile(files, { file: absolute, modifiedAt })
    }
  }
  return files
}

async function readCodexSessionMeta(path: string): Promise<{ id: string; cwd: string } | null> {
  const stream = createReadStream(path, { encoding: 'utf8' })
  const reader = createInterface({ input: stream, crlfDelay: Infinity })

  let firstLine = ''
  try {
    for await (const line of reader) {
      firstLine = line.trim()
      break
    }
  } catch {
    return null
  } finally {
    reader.close()
    stream.destroy()
  }

  if (!firstLine) {
    return null
  }

  try {
    const parsed = JSON.parse(firstLine) as {
      meta?: { id?: string; cwd?: string }
    }
    if (!parsed.meta?.id || !parsed.meta?.cwd) return null
    return { id: parsed.meta.id, cwd: parsed.meta.cwd }
  } catch {
    return null
  }
}

async function findMatchingCodexSession(
  target: ProviderRuntimeTarget,
  context: ProviderCommandContext,
  recentFiles: Array<{ file: string; modifiedAt: number }>
): Promise<string | null> {
  const startedAt = context.startedAt ?? Date.now()
  const normalizedTargetPath = normalizePath(target.path)

  for (const { file, modifiedAt } of recentFiles) {
    if (modifiedAt < startedAt - DISCOVERY_CLOCK_SKEW_MS) {
      continue
    }
    if (modifiedAt > startedAt + DISCOVERY_WINDOW_MS) {
      continue
    }

    const meta = await readCodexSessionMeta(file)
    if (!meta) continue
    if (normalizePath(resolve(meta.cwd)) !== normalizedTargetPath) continue
    return meta.id
  }

  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
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
      return createCommand(target, context, ['--no-alt-screen'])
    },
    async buildFallbackResumeCommand(target, context) {
      return createCommand(target, context, ['--no-alt-screen', 'resume', '--last'])
    },
    async buildResumeCommand(target, externalSessionId, context) {
      return createCommand(target, context, ['--no-alt-screen', 'resume', externalSessionId])
    },
    resolveSessionId(_event: CanonicalSessionEvent) {
      return null
    },
    async installSidecar(target) {
      await writeSharedNotifySidecar(target)
    },
    async discoverExternalSessionIdAfterStart(target, context) {
      const sessionRoot = join(codexHome(), 'sessions')
      let recentFiles: Array<{ file: string; modifiedAt: number }> = []

      for (let attempt = 0; attempt < DISCOVERY_ATTEMPTS; attempt += 1) {
        if (attempt === 0 || attempt % FULL_RESCAN_INTERVAL === 0) {
          recentFiles = await collectRecentSessionFiles(sessionRoot)
        }

        const sessionId = await findMatchingCodexSession(target, context, recentFiles)
        if (sessionId) {
          return sessionId
        }
        if (attempt < DISCOVERY_ATTEMPTS - 1) {
          await sleep(DISCOVERY_DELAY_MS)
        }
      }
      return null
    }
  }
}

export const codexProvider = createCodexProvider()
