import { spawnSync } from 'node:child_process'
import { chmod, mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { resolveBundledEvolverRepoRoot } from '@core/memory/bundled-evolver'
import { buildEvolverProjectEnv, resolveEvolverProjectPaths } from '@shared/evolver-project-paths'

interface ClaudeCommandHook {
  type: 'command'
  command: string
  timeout: number
}

type ClaudeHook = ClaudeCommandHook | StoaHttpHook

interface ClaudeHookMatcher {
  matcher?: string
  hooks: ClaudeHook[]
}

interface ClaudeHookSettings {
  hooks: Record<string, ClaudeHookMatcher[]>
}

interface StoaHttpHook {
  type: 'http'
  url: string
  headers: Record<string, string>
  allowedEnvVars: string[]
  timeout: number
}

interface StoaHttpHookMatcher {
  matcher?: string
  hooks: StoaHttpHook[]
}

interface InstallClaudeEvolverHooksOptions {
  projectRoot: string
  webhookPort: number
  repoRoot?: string
}

const require = createRequire(import.meta.url)
const STOA_HOOK_ALLOWED_ENV_VARS = [
  'STOA_SESSION_ID',
  'STOA_PROJECT_ID',
  'STOA_SESSION_SECRET'
] as const
const CLAUDE_HOOKS_DIR = join('.claude', 'hooks')
const STOA_CLAUDE_WRAPPER_SCRIPT = 'stoa-evolver-hook-bridge.cjs'
const STOA_CLAUDE_WRAPPER_WINDOWS_LAUNCHER = 'stoa-evolver-hook-bridge.cmd'
const STOA_CLAUDE_WRAPPER_UNIX_LAUNCHER = 'stoa-evolver-hook-bridge.sh'
const STOA_NODE_SHIM_WINDOWS = 'node.cmd'
const STOA_NODE_SHIM_UNIX = 'node'
const UPSTREAM_HOOK_SCRIPT_NAMES = [
  'evolver-session-start',
  'evolver-signal-detect',
  'evolver-session-end'
] as const

export async function installClaudeEvolverHooks(options: InstallClaudeEvolverHooksOptions): Promise<void> {
  const repoRoot = options.repoRoot ?? await resolveBundledEvolverRepoRoot(process.cwd())
  const windowsHookShell = resolveWindowsUpstreamHookShell()
  const projectEnv = createClaudeHookProjectEnv(options.projectRoot, repoRoot)
  const claudeDir = join(options.projectRoot, '.claude')
  const hooksDir = join(options.projectRoot, CLAUDE_HOOKS_DIR)
  await mkdir(claudeDir, { recursive: true })
  await mkdir(hooksDir, { recursive: true })

  const upstreamSettings = loadClaudeHookSettings(repoRoot)
  await copyClaudeHookScripts(hooksDir, repoRoot)
  await writeClaudeWrapperScripts(hooksDir)
  const wrappedHooks = wrapClaudeHookSettings(upstreamSettings, repoRoot, projectEnv, windowsHookShell)

  const settings: ClaudeHookSettings = {
    hooks: {
      ...wrappedHooks,
      UserPromptSubmit: [
        createStoaHttpHook(options.webhookPort)
      ],
      PermissionRequest: [
        createStoaHttpHook(options.webhookPort)
      ]
    }
  }

  await writeFile(
    join(claudeDir, 'settings.json'),
    `${JSON.stringify(settings, null, 2)}\n`,
    'utf-8'
  )
}

function loadClaudeHookSettings(repoRoot: string): ClaudeHookSettings {
  const adapterModule = require(join(repoRoot, 'src', 'adapters', 'claudeCode.js')) as unknown
  if (!isRecord(adapterModule) || typeof adapterModule.buildClaudeHooks !== 'function') {
    throw new Error('Bundled Evolver Claude adapter does not export buildClaudeHooks().')
  }

  const settings = adapterModule.buildClaudeHooks(repoRoot) as unknown
  if (!isClaudeHookSettings(settings)) {
    throw new Error('Bundled Evolver Claude hook config is invalid.')
  }

  return settings
}

async function copyClaudeHookScripts(hooksDir: string, repoRoot: string): Promise<void> {
  const hookAdapterModule = require(join(repoRoot, 'src', 'adapters', 'hookAdapter.js')) as unknown
  if (!isRecord(hookAdapterModule) || typeof hookAdapterModule.copyHookScripts !== 'function') {
    throw new Error('Bundled Evolver hook adapter does not export copyHookScripts().')
  }

  hookAdapterModule.copyHookScripts(hooksDir, join(repoRoot, 'src', 'adapters'))
  await rewriteUpstreamHookExtensions(hooksDir)
}

async function rewriteUpstreamHookExtensions(hooksDir: string): Promise<void> {
  const hookFiles = await readdir(hooksDir)
  await Promise.all(
    UPSTREAM_HOOK_SCRIPT_NAMES.map(async (basename) => {
      const jsName = `${basename}.js`
      const cjsName = `${basename}.cjs`
      if (!hookFiles.includes(jsName)) {
        return
      }
      await rename(join(hooksDir, jsName), join(hooksDir, cjsName))
    })
  )
}

function wrapClaudeHookSettings(
  settings: ClaudeHookSettings,
  repoRoot: string,
  projectEnv: Record<string, string>,
  windowsHookShell: string | null
): ClaudeHookSettings['hooks'] {
  return Object.fromEntries(
    Object.entries(settings.hooks).map(([eventName, matchers]) => {
      return [
        eventName,
        matchers.map((matcher) => {
          return {
            ...matcher,
            hooks: matcher.hooks.map((hook) => {
              if (hook.type !== 'command') {
                return hook
              }

              return {
                ...hook,
                command: buildClaudeWrapperCommand(eventName, hook.command, repoRoot, projectEnv, windowsHookShell)
              }
            })
          }
        })
      ]
    })
  )
}

function buildClaudeWrapperCommand(
  hookEventName: string,
  upstreamCommand: string,
  repoRoot: string,
  projectEnv: Record<string, string>,
  windowsHookShell: string | null
): string {
  const normalizedUpstreamCommand = normalizeUpstreamCommand(upstreamCommand)
  const encodedUpstreamCommand = Buffer.from(normalizedUpstreamCommand, 'utf8').toString('base64')
  const encodedRepoRoot = Buffer.from(repoRoot, 'utf8').toString('base64')
  const encodedProjectEnv = Buffer.from(JSON.stringify(projectEnv), 'utf8').toString('base64')
  const encodedHookShell = Buffer.from(windowsHookShell ?? '', 'utf8').toString('base64')
  const wrapperPath = '$CLAUDE_PROJECT_DIR/.claude/hooks/'
  if (process.platform === 'win32') {
    return `"${wrapperPath}${STOA_CLAUDE_WRAPPER_WINDOWS_LAUNCHER}" "${hookEventName}" "${encodedUpstreamCommand}" "${encodedRepoRoot}" "${encodedProjectEnv}" "${encodedHookShell}"`
  }

  return `"${wrapperPath}${STOA_CLAUDE_WRAPPER_UNIX_LAUNCHER}" "${hookEventName}" "${encodedUpstreamCommand}" "${encodedRepoRoot}" "${encodedProjectEnv}" "${encodedHookShell}"`
}

function normalizeUpstreamCommand(command: string): string {
  return UPSTREAM_HOOK_SCRIPT_NAMES.reduce((current, basename) => {
    return current.replaceAll(`${basename}.js`, `${basename}.cjs`)
  }, command)
}

function resolveWindowsUpstreamHookShell(): string | null {
  if (process.platform !== 'win32') {
    return null
  }

  const explicit = process.env.STOA_UPSTREAM_HOOK_SHELL?.trim() || process.env.STOA_GIT_BASH_PATH?.trim()
  if (explicit) {
    return explicit
  }

  const lookup = spawnSync('where.exe', ['bash'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true
  })
  if (lookup.status !== 0 || !lookup.stdout) {
    return null
  }

  const candidate = lookup.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  return candidate ?? null
}

function createClaudeHookProjectEnv(projectRoot: string, repoRoot: string): Record<string, string> {
  const projectPaths = resolveEvolverProjectPaths(projectRoot, repoRoot)
  const env = buildEvolverProjectEnv(projectPaths, {})

  return {
    EVOLVER_ROOT: env.EVOLVER_ROOT ?? repoRoot,
    EVOLVER_REPO_ROOT: env.EVOLVER_REPO_ROOT ?? projectRoot,
    MEMORY_DIR: env.MEMORY_DIR ?? projectPaths.memoryDir,
    EVOLUTION_DIR: env.EVOLUTION_DIR ?? projectPaths.evolutionDir,
    GEP_ASSETS_DIR: env.GEP_ASSETS_DIR ?? projectPaths.gepAssetsDir,
    MEMORY_GRAPH_PATH: env.MEMORY_GRAPH_PATH ?? projectPaths.memoryGraphPath,
    EVOLVER_QUIET_PARENT_GIT: env.EVOLVER_QUIET_PARENT_GIT ?? '1'
  }
}

function createStoaHttpHook(webhookPort: number, matcher?: string): StoaHttpHookMatcher {
  return {
    ...(matcher ? { matcher } : {}),
    hooks: [{
      type: 'http',
      url: `http://127.0.0.1:${webhookPort}/hooks/claude-code`,
      headers: {
        'x-stoa-session-id': '${STOA_SESSION_ID}',
        'x-stoa-project-id': '${STOA_PROJECT_ID}',
        'x-stoa-secret': '${STOA_SESSION_SECRET}'
      },
      allowedEnvVars: [...STOA_HOOK_ALLOWED_ENV_VARS],
      timeout: 5
    }]
  }
}

async function writeClaudeWrapperScripts(hooksDir: string): Promise<void> {
  await writeFile(
    join(hooksDir, STOA_CLAUDE_WRAPPER_SCRIPT),
    buildClaudeWrapperScriptSource(),
    'utf-8'
  )

  if (process.platform === 'win32') {
    await writeFile(
      join(hooksDir, STOA_CLAUDE_WRAPPER_WINDOWS_LAUNCHER),
      buildWindowsNodeLauncherSource(),
      'utf-8'
    )
    await writeFile(
      join(hooksDir, STOA_NODE_SHIM_WINDOWS),
      buildWindowsUpstreamNodeShimSource(),
      'utf-8'
    )
    return
  }

  const unixLauncherPath = join(hooksDir, STOA_CLAUDE_WRAPPER_UNIX_LAUNCHER)
  await writeFile(
    unixLauncherPath,
    buildUnixNodeLauncherSource(),
    'utf-8'
  )
  await chmod(unixLauncherPath, 0o755)

  const unixShimPath = join(hooksDir, STOA_NODE_SHIM_UNIX)
  await writeFile(
    unixShimPath,
    buildUnixUpstreamNodeShimSource(),
    'utf-8'
  )
  await chmod(unixShimPath, 0o755)
}

function buildClaudeWrapperScriptSource(): string {
  return [
    "const { spawn, spawnSync } = require('node:child_process')",
    "const path = require('node:path')",
    '',
    'async function readStdin() {',
    "  let input = ''",
    "  process.stdin.setEncoding('utf8')",
    '  for await (const chunk of process.stdin) {',
    '    input += chunk',
    '  }',
    '  return input',
    '}',
    '',
    'function normalizeHookPayload(hookEventName, rawInput) {',
    '  let parsed = {}',
    '  if (rawInput.trim()) {',
    '    try {',
    '      parsed = JSON.parse(rawInput)',
    '    } catch {',
    '      parsed = {}',
    '    }',
    '  }',
    '  return { hook_event_name: hookEventName, ...parsed }',
    '}',
    '',
    'function decodeUpstreamCommand(encodedCommand) {',
    "  return Buffer.from(encodedCommand, 'base64').toString('utf8')",
    '}',
    '',
    'function decodeRepoRoot(encodedRepoRoot) {',
    "  return Buffer.from(encodedRepoRoot, 'base64').toString('utf8')",
    '}',
    '',
    'function parseJson(text) {',
    '  if (!text) {',
    '    return null',
    '  }',
    '  try {',
    '    return JSON.parse(text)',
    '  } catch {',
    '    return null',
    '  }',
    '}',
    '',
    'function decodeProjectEnv(encodedProjectEnv) {',
    "  const decoded = Buffer.from(encodedProjectEnv || '', 'base64').toString('utf8')",
    '  const parsed = parseJson(decoded)',
    '  return parsed && typeof parsed === "object" ? parsed : {}',
    '}',
    '',
    'function decodeHookShell(encodedHookShell) {',
    "  return Buffer.from(encodedHookShell || '', 'base64').toString('utf8')",
    '}',
    '',
    'function prependPathEntry(entry, currentPath) {',
    "  return currentPath ? `${entry}${path.delimiter}${currentPath}` : entry",
    '}',
    '',
    'function resolveWindowsHookShell(encodedHookShell) {',
    "  if (process.platform !== 'win32') {",
    '    return null',
    '  }',
    '  const decodedHookShell = decodeHookShell(encodedHookShell)',
    '  if (decodedHookShell && decodedHookShell.trim()) {',
    '    return decodedHookShell.trim()',
    '  }',
    "  const explicit = process.env.STOA_UPSTREAM_HOOK_SHELL || process.env.STOA_GIT_BASH_PATH || ''",
    '  if (explicit && explicit.trim()) {',
    '    return explicit.trim()',
    '  }',
    "  const currentComSpec = process.env.ComSpec || process.env.COMSPEC || ''",
    '  if (currentComSpec && !/\\\\cmd(?:\\\\.exe)?$/i.test(currentComSpec)) {',
    '    return currentComSpec',
    '  }',
    "  const lookup = spawnSync('where.exe', ['bash'], {",
    "    encoding: 'utf8',",
    '    shell: false,',
    '    windowsHide: true',
    '  })',
    '  if (lookup.status !== 0 || !lookup.stdout) {',
    '    return null',
    '  }',
    '  const candidate = lookup.stdout',
    "    .split(/\\r?\\n/)",
    '    .map((line) => line.trim())',
    '    .find(Boolean)',
    '  return candidate || null',
    '}',
    '',
    'function buildUpstreamEnv(evolverRoot, encodedProjectEnv, encodedHookShell) {',
    '  const existingPath = process.env.PATH || process.env.Path || ""',
    '  const nextPath = prependPathEntry(__dirname, existingPath)',
    '  const projectEnv = decodeProjectEnv(encodedProjectEnv)',
    '  const windowsHookShell = resolveWindowsHookShell(encodedHookShell)',
    '  return {',
    '    ...projectEnv,',
    '    ...process.env,',
    '    EVOLVER_ROOT: evolverRoot,',
    '    PATH: nextPath,',
    '    Path: nextPath,',
    '    ...(windowsHookShell ? {',
    '      ComSpec: windowsHookShell,',
    '      COMSPEC: windowsHookShell,',
    '      SHELL: windowsHookShell',
    '    } : {})',
    '  }',
    '}',
    '',
    'function tokenizeCommand(command) {',
    "  return command.match(/\"[^\"]+\"|\\S+/g) || []",
    '}',
    '',
    'function stripWrappingQuotes(value) {',
    `  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value`,
    '}',
    '',
    'function getProjectRoot() {',
    '  return process.env.CLAUDE_PROJECT_DIR || process.cwd()',
    '}',
    '',
    'function resolveScriptPath(scriptPath, projectRoot) {',
    '  if (!scriptPath) {',
    '    return scriptPath',
    '  }',
    '  return path.isAbsolute(scriptPath) ? scriptPath : path.resolve(projectRoot, scriptPath)',
    '}',
    '',
    'function resolveUpstreamInvocation(command, projectRoot) {',
    '  const tokens = tokenizeCommand(command).map(stripWrappingQuotes)',
    "  if (tokens[0] === 'node') {",
    '    return {',
    '      command: process.execPath,',
    '      args: tokens.length > 1',
    '        ? [resolveScriptPath(tokens[1], projectRoot), ...tokens.slice(2)]',
    '        : [],',
    '      shell: false',
    '    }',
    '  }',
    '  return {',
    '    command,',
    '    args: [],',
    '    shell: true',
    '  }',
    '}',
    '',
    'function getUpstreamMessage(parsedOutput) {',
    '  if (!parsedOutput || typeof parsedOutput !== "object") {',
    '    return null',
    '  }',
    '  for (const key of ["agent_message", "additionalContext", "additional_context", "followup_message", "stopMessage"]) {',
    '    const value = parsedOutput[key]',
    '    if (typeof value === "string" && value.trim()) {',
    '      return value.trim()',
    '    }',
    '  }',
    '  return null',
    '}',
    '',
    'function buildMemoryNotification(hookEventName, parsedOutput) {',
    '  const message = getUpstreamMessage(parsedOutput)',
    '  if (hookEventName === "SessionStart" && message) {',
    '    return {',
    "      kind: 'recall',",
    "      status: 'success',",
    "      title: 'Memory recalled',",
    "      message: 'Evolver recalled recent memory for this session.'",
    '    }',
    '  }',
    '  return null',
    '}',
    '',
    'function buildClaudeHookOutput(hookEventName, parsedOutput, upstreamOutput) {',
    '  const message = getUpstreamMessage(parsedOutput)',
    '  if ((hookEventName === "SessionStart" || hookEventName === "PostToolUse") && message) {',
    '    return JSON.stringify({',
    '      hookSpecificOutput: {',
    '        hookEventName,',
    '        additionalContext: message',
    '      }',
    '    })',
    '  }',
    '  return upstreamOutput',
    '}',
    '',
    'async function runUpstreamHook(command, payloadText, evolverRoot, encodedProjectEnv, encodedHookShell) {',
    '  return await new Promise((resolve) => {',
    '    const projectRoot = getProjectRoot()',
    '    const invocation = resolveUpstreamInvocation(command, projectRoot)',
    '    const child = spawn(invocation.command, invocation.args, {',
    '      cwd: projectRoot,',
    '      env: buildUpstreamEnv(evolverRoot, encodedProjectEnv, encodedHookShell),',
    "      stdio: ['pipe', 'pipe', 'pipe'],",
    '      shell: invocation.shell,',
    '      windowsHide: true',
    '    })',
    "    let stdout = ''",
    "    child.stdout.setEncoding('utf8')",
    "    child.stdout.on('data', (chunk) => { stdout += chunk })",
    "    child.on('error', () => resolve(''))",
    "    child.on('close', () => resolve(stdout.trim()))",
    '    if (payloadText) {',
    '      child.stdin.write(payloadText)',
    '    }',
    '    child.stdin.end()',
    '  })',
    '}',
    '',
    'async function notifyStoa(payload) {',
    "  const sessionId = process.env.STOA_SESSION_ID",
    "  const projectId = process.env.STOA_PROJECT_ID",
    "  const sessionSecret = process.env.STOA_SESSION_SECRET",
    "  const webhookPort = process.env.STOA_WEBHOOK_PORT",
    '  if (!sessionId || !projectId || !sessionSecret || !webhookPort) {',
    '    return',
    '  }',
    "  await fetch(`http://127.0.0.1:${webhookPort}/hooks/claude-code`, {",
    "    method: 'POST',",
    '    headers: {',
    "      'content-type': 'application/json',",
    "      'x-stoa-session-id': sessionId,",
    "      'x-stoa-project-id': projectId,",
    "      'x-stoa-secret': sessionSecret",
    '    },',
    '    body: JSON.stringify(payload)',
    '  }).catch(() => undefined)',
    '}',
    '',
    'async function notifyMemoryRuntime(notification) {',
    "  const sessionId = process.env.STOA_SESSION_ID",
    "  const projectId = process.env.STOA_PROJECT_ID",
    "  const sessionSecret = process.env.STOA_SESSION_SECRET",
    "  const webhookPort = process.env.STOA_WEBHOOK_PORT",
    '  if (!sessionId || !projectId || !sessionSecret || !webhookPort || !notification) {',
    '    return',
    '  }',
    "  await fetch(`http://127.0.0.1:${webhookPort}/memory-notifications`, {",
    "    method: 'POST',",
    '    headers: {',
    "      'content-type': 'application/json',",
    "      'x-stoa-session-id': sessionId,",
    "      'x-stoa-project-id': projectId,",
    "      'x-stoa-secret': sessionSecret",
    '    },',
    '    body: JSON.stringify(notification)',
    '  }).catch(() => undefined)',
    '}',
    '',
    'async function main() {',
    '  const hookEventName = process.argv[2]',
    '  const encodedUpstreamCommand = process.argv[3]',
    '  const encodedRepoRoot = process.argv[4]',
    '  const encodedProjectEnv = process.argv[5] || ""',
    '  const encodedHookShell = process.argv[6] || ""',
    '  if (!hookEventName || !encodedUpstreamCommand || !encodedRepoRoot) {',
    '    return',
    '  }',
    '  const rawInput = await readStdin()',
    '  const payload = normalizeHookPayload(hookEventName, rawInput)',
    '  const payloadText = JSON.stringify(payload)',
    '  const upstreamCommand = decodeUpstreamCommand(encodedUpstreamCommand)',
    '  const evolverRoot = decodeRepoRoot(encodedRepoRoot)',
    '  const upstreamOutput = await runUpstreamHook(upstreamCommand, payloadText, evolverRoot, encodedProjectEnv, encodedHookShell)',
    '  const parsedOutput = parseJson(upstreamOutput)',
    '  const claudeOutput = buildClaudeHookOutput(hookEventName, parsedOutput, upstreamOutput)',
    '  await notifyStoa(payload)',
    '  await notifyMemoryRuntime(buildMemoryNotification(hookEventName, parsedOutput))',
    '  if (claudeOutput) {',
    '    process.stdout.write(claudeOutput)',
    '  }',
    '}',
    '',
    "main().catch(() => { process.exit(0) })",
    ''
  ].join('\n')
}

function buildWindowsNodeLauncherSource(): string {
  return [
    '@echo off',
    'setlocal',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"${process.execPath}" "%~dp0${STOA_CLAUDE_WRAPPER_SCRIPT}" %*`,
    ''
  ].join('\r\n')
}

function buildWindowsUpstreamNodeShimSource(): string {
  return [
    '@echo off',
    'setlocal',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"${process.execPath}" %*`,
    ''
  ].join('\r\n')
}

function buildUnixNodeLauncherSource(): string {
  return [
    '#!/usr/bin/env sh',
    'export ELECTRON_RUN_AS_NODE=1',
    `"${process.execPath}" "$(dirname "$0")/${STOA_CLAUDE_WRAPPER_SCRIPT}" "$@"`,
    ''
  ].join('\n')
}

function buildUnixUpstreamNodeShimSource(): string {
  return [
    '#!/usr/bin/env sh',
    'export ELECTRON_RUN_AS_NODE=1',
    `exec "${process.execPath}" "$@"`,
    ''
  ].join('\n')
}

function isClaudeHookSettings(value: unknown): value is ClaudeHookSettings {
  if (!isRecord(value) || !isRecord(value.hooks)) {
    return false
  }

  return Object.values(value.hooks).every((matchers) => {
    return Array.isArray(matchers) && matchers.every((matcher) => {
      return isRecord(matcher) && Array.isArray(matcher.hooks) && matcher.hooks.every((hook) => {
        return isRecord(hook) && hook.type === 'command' && typeof hook.command === 'string' && typeof hook.timeout === 'number'
      })
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
