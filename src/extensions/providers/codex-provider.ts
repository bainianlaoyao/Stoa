import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { CanonicalSessionEvent, ProviderCommand, ProviderCommandContext } from '@shared/project-session'
import type { ProviderDefinition, ProviderRuntimeTarget } from './index'
import { installManagedSidecar, uninstallManagedSidecar } from './managed-sidecar-installer'

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

async function writeSharedHookSidecar(target: ProviderRuntimeTarget): Promise<void> {
  const hooksConfig = {
    hooks: {
      SessionStart: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs SessionStart', timeout_sec: 5 }]
        }
      ],
      UserPromptSubmit: [
        {
          hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs UserPromptSubmit', timeout_sec: 5 }]
        }
      ],
      PreToolUse: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs PreToolUse', timeout_sec: 5 }]
        }
      ],
      PostToolUse: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs PostToolUse', timeout_sec: 5 }]
        }
      ],
      Stop: [
        {
          hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs Stop', timeout_sec: 5 }]
        }
      ]
    }
  }
  const hookSidecarContent = `import { createInterface } from 'node:readline'

const sessionId = process.env.STOA_SESSION_ID
const projectId = process.env.STOA_PROJECT_ID
const sessionSecret = process.env.STOA_SESSION_SECRET
const webhookPort = process.env.STOA_WEBHOOK_PORT
const hookEventName = process.argv[2]

if (!sessionId || !projectId || !sessionSecret || !webhookPort || !hookEventName) {
  process.exit(0)
}

let input = ''
for await (const line of createInterface({ input: process.stdin })) {
  input += line
}

let body = {}
if (input.trim()) {
  try {
    body = JSON.parse(input)
  } catch {
    body = {}
  }
}
if (!('hook_event_name' in body)) {
  body = { hook_event_name: hookEventName, ...body }
}

const response = await fetch(\`http://127.0.0.1:\${webhookPort}/hooks/codex\`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-stoa-session-id': sessionId,
    'x-stoa-project-id': projectId,
    'x-stoa-secret': sessionSecret
  },
  body: JSON.stringify(body)
})

const text = await response.text()
if (response.ok && text.trim()) {
  process.stdout.write(text.trim())
}
`

  await installManagedSidecar({
    rootDir: target.path,
    manifestRelativePath: '.codex/.stoa-managed-sidecar.json',
    currentArtifacts: [
      '.codex/config.toml',
      '.codex/hooks.json',
      '.codex/hook-stoa.mjs'
    ],
    writes: [
      {
        relativePath: '.codex/config.toml',
        content: '[features]\ncodex_hooks = true\n'
      },
      {
        relativePath: '.codex/hooks.json',
        content: `${JSON.stringify(hooksConfig, null, 2)}\n`
      },
      {
        relativePath: '.codex/hook-stoa.mjs',
        content: hookSidecarContent
      }
    ]
  })
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
      return createCommand(target, context, [])
    },
    async buildFallbackResumeCommand(target, context) {
      return createCommand(target, context, ['resume', '--last'])
    },
    async buildResumeCommand(target, externalSessionId, context) {
      return createCommand(target, context, ['resume', externalSessionId])
    },
    resolveSessionId(_event: CanonicalSessionEvent) {
      return null
    },
    async installSidecar(target) {
      await writeSharedHookSidecar(target)
    },
    async uninstallSidecar(projectPath) {
      await uninstallManagedSidecar({
        rootDir: projectPath,
        manifestRelativePath: '.codex/.stoa-managed-sidecar.json'
      })
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
