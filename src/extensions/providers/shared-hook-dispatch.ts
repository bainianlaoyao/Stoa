import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { dirname, join, normalize, resolve } from 'node:path'

export const HOOK_CONTRACT_VERSION = 1

type HookDispatchProvider = 'claude-code' | 'codex' | 'opencode'

interface SessionHookLease {
  version: 1
  sessionId: string
  projectId: string
  provider: HookDispatchProvider
  leaseState: 'active' | 'released'
  ownerInstanceId: string
  generation: number
  webhookBaseUrl: string
  sessionSecret: string
  commitLockNonce: string
  commitToken: string
  createdAt: string
  updatedAt: string
  heartbeatAt: string
  expiresAt: string
  releasedAt?: string
}

interface ManagedMarkerMetadata {
  sessionId: string | null
  projectId: string | null
  provider: HookDispatchProvider | null
  ownerInstanceId: string | null
  generation: number | null
  managed: boolean
  valid: boolean
}

interface HookDispatchFailureRecord {
  sessionId: string | null
  projectId: string | null
  ownerInstanceId: string | null
  generation: number | null
  provider: HookDispatchProvider | null
  failureClass: string
  metadataSource: 'lease' | 'managed-marker'
  recordedAt: string
}

interface SharedHookDispatchRunInput {
  provider: HookDispatchProvider
  hookEventName: string
  stdinText: string
  env: Record<string, string | undefined>
}

interface SharedHookDispatchResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface SharedArtifact {
  relativePath: string
  content: string
  mode?: number
}

export function buildSharedHookArtifacts(): SharedArtifact[] {
  return [
    {
      relativePath: '.stoa/hook-dispatch.mjs',
      content: dispatcherRuntimeSource()
    },
    {
      relativePath: '.stoa/hook-dispatch.cmd',
      content: [
        '@echo off',
        'setlocal',
        'node "%~dp0hook-dispatch.mjs" %*'
      ].join('\r\n') + '\r\n'
    },
    {
      relativePath: '.stoa/hook-dispatch',
      mode: 0o755,
      content: [
        '#!/usr/bin/env sh',
        'node "$(dirname "$0")/hook-dispatch.mjs" "$@"'
      ].join('\n') + '\n'
    },
    {
      relativePath: '.stoa/hook-contract.json',
      content: `${JSON.stringify({
        contractVersion: HOOK_CONTRACT_VERSION,
        artifactWriter: 'stoa',
        writtenAt: 'MANAGED_AT_WRITE_TIME'
      }, null, 2)}\n`
    }
  ]
}

export async function runSharedHookDispatch(input: SharedHookDispatchRunInput): Promise<SharedHookDispatchResult> {
  const managedMarker = readManagedMarkerMetadata(input.env)
  const leasePath = input.env.STOA_HOOK_LEASE_PATH?.trim()
  if (!leasePath) {
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  const runtimeRoot = deriveRuntimeRootFromLeasePath(leasePath)
  const canonicalLeasePath = resolve(leasePath)

  let lease: SessionHookLease | null
  try {
    lease = await readLease(canonicalLeasePath)
  } catch {
    lease = null
  }
  if (!lease) {
    if (managedMarker.managed && runtimeRoot) {
      await recordManagedFailure(runtimeRoot, {
        sessionId: managedMarker.sessionId,
        projectId: managedMarker.projectId,
        ownerInstanceId: managedMarker.ownerInstanceId,
        generation: managedMarker.generation,
        provider: managedMarker.provider ?? input.provider,
        failureClass: 'lease_invalid',
        metadataSource: 'managed-marker',
        recordedAt: new Date().toISOString()
      })
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  if (lease.leaseState !== 'active') {
    if (managedMarker.managed && runtimeRoot) {
      await recordManagedFailure(runtimeRoot, buildLeaseFailureRecord(lease, 'lease_released'))
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  if (isExpired(lease)) {
    if (managedMarker.managed && runtimeRoot) {
      await recordManagedFailure(runtimeRoot, buildLeaseFailureRecord(lease, 'lease_expired'))
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  if (lease.provider !== input.provider) {
    if (managedMarker.managed && runtimeRoot) {
      await recordManagedFailure(runtimeRoot, buildLeaseFailureRecord(lease, 'provider_mismatch'))
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  if (
    managedMarker.managed
    && (
      managedMarker.sessionId !== lease.sessionId
      || managedMarker.projectId !== lease.projectId
      || managedMarker.provider !== lease.provider
    )
    && runtimeRoot
  ) {
    await recordManagedFailure(runtimeRoot, buildLeaseFailureRecord(lease, 'marker_mismatch'))
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  if (
    managedMarker.managed
    && runtimeRoot
    && managedMarker.valid
    && (
      managedMarker.ownerInstanceId !== lease.ownerInstanceId
      || managedMarker.generation !== lease.generation
    )
  ) {
    await recordManagedFailure(runtimeRoot, buildLeaseFailureRecord(lease, 'stale_spawn_provenance'))
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  const requestBody = normalizeHookBody(input.stdinText, input.hookEventName)
  let response: { statusCode: number; body: string }
  try {
    response = await postJson(`${lease.webhookBaseUrl}${providerPath(input.provider)}`, {
      'content-type': 'application/json',
      'x-stoa-session-id': lease.sessionId,
      'x-stoa-project-id': lease.projectId,
      'x-stoa-secret': lease.sessionSecret
    }, requestBody)
  } catch {
    if (managedMarker.managed && runtimeRoot) {
      await recordManagedFailure(runtimeRoot, buildLeaseFailureRecord(lease, 'target_unreachable'))
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    if (managedMarker.managed && runtimeRoot) {
      await recordManagedFailure(
        runtimeRoot,
        buildLeaseFailureRecord(lease, response.statusCode === 401 ? 'unauthorized' : 'unexpected_status')
      )
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  const stdout = response.body.trim()
  return {
    exitCode: 0,
    stdout,
    stderr: ''
  }
}

function dispatcherRuntimeSource(): string {
  return [
    'import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"',
    'import { request as httpRequest } from "node:http"',
    'import { request as httpsRequest } from "node:https"',
    'import { dirname, resolve } from "node:path"',
    '',
    'const provider = process.argv[2]',
    'const hookEventName = process.argv[3]',
    'const stdinText = await readStdin()',
    'const result = await run({ provider, hookEventName, stdinText, env: process.env })',
    'if (result.stdout) process.stdout.write(result.stdout)',
    'if (result.stderr) process.stderr.write(result.stderr)',
    'process.exit(result.exitCode)',
    '',
    'async function readStdin() {',
    '  const chunks = []',
    '  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))',
    '  return Buffer.concat(chunks).toString("utf8")',
    '}',
    '',
    'async function run(input) {',
    '  const managedMarker = readManagedMarkerMetadata(input.env)',
    '  const leasePath = input.env.STOA_HOOK_LEASE_PATH?.trim()',
    '  if (!leasePath) return { exitCode: 0, stdout: "", stderr: "" }',
    '  const runtimeRoot = deriveRuntimeRootFromLeasePath(leasePath)',
    '  const canonicalLeasePath = resolve(leasePath)',
    '  const lease = await readLease(canonicalLeasePath)',
    '  if (!lease) {',
    '    if (managedMarker.managed && runtimeRoot) {',
    '      await recordManagedFailure(runtimeRoot, {',
    '        sessionId: managedMarker.sessionId,',
    '        projectId: managedMarker.projectId,',
    '        ownerInstanceId: managedMarker.ownerInstanceId,',
    '        generation: managedMarker.generation,',
    '        provider: managedMarker.provider ?? input.provider,',
    '        failureClass: "lease_invalid",',
    '        metadataSource: "managed-marker",',
    '        recordedAt: new Date().toISOString()',
    '      })',
    '    }',
    '    return { exitCode: 0, stdout: "", stderr: "" }',
    '  }',
    '  if (lease.leaseState !== "active") {',
    '    if (managedMarker.managed && runtimeRoot) await recordManagedFailure(runtimeRoot, buildLeaseFailureRecord(lease, "lease_released"))',
    '    return { exitCode: 0, stdout: "", stderr: "" }',
    '  }',
    '  if (isExpired(lease)) {',
    '    if (managedMarker.managed && runtimeRoot) await recordManagedFailure(runtimeRoot, buildLeaseFailureRecord(lease, "lease_expired"))',
    '    return { exitCode: 0, stdout: "", stderr: "" }',
    '  }',
    '  if (lease.provider !== input.provider) {',
    '    if (managedMarker.managed && runtimeRoot) await recordManagedFailure(runtimeRoot, buildLeaseFailureRecord(lease, "provider_mismatch"))',
    '    return { exitCode: 0, stdout: "", stderr: "" }',
    '  }',
    '  if (managedMarker.managed && runtimeRoot && (managedMarker.sessionId !== lease.sessionId || managedMarker.projectId !== lease.projectId || managedMarker.provider !== lease.provider)) {',
    '    await recordManagedFailure(runtimeRoot, buildLeaseFailureRecord(lease, "marker_mismatch"))',
    '    return { exitCode: 0, stdout: "", stderr: "" }',
    '  }',
    '  if (managedMarker.managed && runtimeRoot && managedMarker.valid && (managedMarker.ownerInstanceId !== lease.ownerInstanceId || managedMarker.generation !== lease.generation)) {',
    '    await recordManagedFailure(runtimeRoot, buildLeaseFailureRecord(lease, "stale_spawn_provenance"))',
    '    return { exitCode: 0, stdout: "", stderr: "" }',
    '  }',
    '  const requestBody = normalizeHookBody(input.stdinText, input.hookEventName)',
    '  let response',
    '  try {',
    '    response = await postJson(`${lease.webhookBaseUrl}${providerPath(input.provider)}`, {',
    '      "content-type": "application/json",',
    '      "x-stoa-session-id": lease.sessionId,',
    '      "x-stoa-project-id": lease.projectId,',
    '      "x-stoa-secret": lease.sessionSecret',
    '    }, requestBody)',
    '  } catch {',
    '    if (managedMarker.managed && runtimeRoot) await recordManagedFailure(runtimeRoot, buildLeaseFailureRecord(lease, "target_unreachable"))',
    '    return { exitCode: 0, stdout: "", stderr: "" }',
    '  }',
    '  if (response.statusCode < 200 || response.statusCode >= 300) {',
    '    if (managedMarker.managed && runtimeRoot) await recordManagedFailure(runtimeRoot, buildLeaseFailureRecord(lease, response.statusCode === 401 ? "unauthorized" : "unexpected_status"))',
    '    return { exitCode: 0, stdout: "", stderr: "" }',
    '  }',
    '  return { exitCode: 0, stdout: response.body.trim(), stderr: "" }',
    '}',
    '',
    'async function readLease(path) {',
    '  try {',
    '    const raw = await readFile(path, "utf8")',
    '    const parsed = JSON.parse(raw)',
    '    if (!isSessionHookLease(parsed)) return null',
    '    return parsed',
    '  } catch {',
    '    return null',
    '  }',
    '}',
    '',
    'function isExpired(lease) {',
    '  return new Date(lease.expiresAt).getTime() < Date.now()',
    '}',
    '',
    'function normalizeHookBody(stdinText, hookEventName) {',
    '  let parsed = {}',
    '  if (stdinText.trim().length > 0) {',
    '    try {',
    '      const json = JSON.parse(stdinText)',
    '      if (typeof json === "object" && json !== null && !Array.isArray(json)) parsed = json',
    '    } catch {',
    '      parsed = {}',
    '    }',
    '  }',
    '  if (!("hook_event_name" in parsed)) return { hook_event_name: hookEventName, ...parsed }',
    '  return parsed',
    '}',
    '',
    'function readManagedMarkerMetadata(env) {',
    '  const managed = env.STOA_HOOK_MANAGED === "1"',
    '  const provider = isHookDispatchProvider(env.STOA_HOOK_PROVIDER) ? env.STOA_HOOK_PROVIDER : null',
    '  const generationValue = env.STOA_HOOK_SPAWN_GENERATION?.trim()',
    '  const generation = generationValue && /^\\d+$/.test(generationValue) ? Number(generationValue) : null',
    '  return {',
    '    sessionId: env.STOA_HOOK_SESSION_ID?.trim() || null,',
    '    projectId: env.STOA_HOOK_PROJECT_ID?.trim() || null,',
    '    provider,',
    '    ownerInstanceId: env.STOA_HOOK_SPAWN_OWNER_INSTANCE_ID?.trim() || null,',
    '    generation,',
    '    managed,',
    '    valid: managed && !!env.STOA_HOOK_SESSION_ID && !!env.STOA_HOOK_PROJECT_ID && provider !== null && !!env.STOA_HOOK_SPAWN_OWNER_INSTANCE_ID && generation !== null',
    '  }',
    '}',
    '',
    'function deriveRuntimeRootFromLeasePath(leasePath) {',
    '  const canonicalPath = resolve(leasePath)',
    '  const leasesDir = dirname(canonicalPath)',
    '  const normalized = leasesDir.replaceAll("\\\\", "/")',
    '  return normalized.endsWith("/hook-leases") ? dirname(leasesDir) : null',
    '}',
    '',
    'function buildLeaseFailureRecord(lease, failureClass) {',
    '  return {',
    '    sessionId: lease.sessionId,',
    '    projectId: lease.projectId,',
    '    ownerInstanceId: lease.ownerInstanceId,',
    '    generation: lease.generation,',
    '    provider: lease.provider,',
    '    failureClass,',
    '    metadataSource: "lease",',
    '    recordedAt: new Date().toISOString()',
    '  }',
    '}',
    '',
    'async function recordManagedFailure(runtimeRoot, record) {',
    '  const journalPath = `${runtimeRoot.replaceAll("\\\\", "/")}/hook-delivery-failures.ndjson`',
    '  const lockPath = `${runtimeRoot.replaceAll("\\\\", "/")}/hook-delivery-failures.lock`',
    '  await mkdir(dirname(journalPath), { recursive: true })',
    '  await withExclusiveJournalLock(lockPath, async () => {',
    '    await appendFile(journalPath, `${JSON.stringify(record)}\\n`, "utf8")',
    '  })',
    '}',
    '',
    'async function withExclusiveJournalLock(lockPath, operation) {',
    '  for (;;) {',
    '    try {',
    '      await writeFile(lockPath, process.pid.toString(), { flag: "wx" })',
    '      break',
    '    } catch (error) {',
    '      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error',
    '      await new Promise((resolve) => setTimeout(resolve, 10))',
    '    }',
    '  }',
    '  try {',
    '    return await operation()',
    '  } finally {',
    '    await rm(lockPath, { force: true })',
    '  }',
    '}',
    '',
    'function isHookDispatchProvider(value) {',
    '  return value === "claude-code" || value === "codex" || value === "opencode"',
    '}',
    '',
    'function isSessionHookLease(value) {',
    '  if (!value || typeof value !== "object") return false',
    '  return value.version === 1',
    '    && typeof value.sessionId === "string"',
    '    && typeof value.projectId === "string"',
    '    && isHookDispatchProvider(value.provider)',
    '    && (value.leaseState === "active" || value.leaseState === "released")',
    '    && typeof value.ownerInstanceId === "string"',
    '    && typeof value.generation === "number"',
    '    && typeof value.webhookBaseUrl === "string"',
    '    && typeof value.sessionSecret === "string"',
    '    && typeof value.commitLockNonce === "string"',
    '    && typeof value.commitToken === "string"',
    '    && typeof value.createdAt === "string"',
    '    && typeof value.updatedAt === "string"',
    '    && typeof value.heartbeatAt === "string"',
    '    && typeof value.expiresAt === "string"',
    '    && (value.releasedAt === undefined || typeof value.releasedAt === "string")',
    '}',
    '',
    'function providerPath(provider) {',
    '  switch (provider) {',
    '    case "claude-code": return "/hooks/claude-code"',
    '    case "codex": return "/hooks/codex"',
    '    case "opencode": return "/hooks/opencode"',
    '    default: return "/hooks/opencode"',
    '  }',
    '}',
    '',
    'async function postJson(urlText, headers, body) {',
    '  const url = new URL(urlText)',
    '  const payload = JSON.stringify(body)',
    '  const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest',
    '  return await new Promise((resolve, reject) => {',
    '    const req = requestImpl({',
    '      protocol: url.protocol, hostname: url.hostname, port: url.port,',
    '      path: `${url.pathname}${url.search}`, method: "POST",',
    '      headers: { ...headers, "content-length": Buffer.byteLength(payload).toString() }',
    '    }, (response) => {',
    '      let responseBody = ""',
    '      response.setEncoding("utf8")',
    '      response.on("data", (chunk) => { responseBody += chunk })',
    '      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, body: responseBody }))',
    '    })',
    '    req.on("error", reject)',
    '    req.write(payload)',
    '    req.end()',
    '  })',
    '}'
  ].join('\n') + '\n'
}

async function readLease(path: string): Promise<SessionHookLease | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isSessionHookLease(parsed)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function isExpired(lease: SessionHookLease): boolean {
  return new Date(lease.expiresAt).getTime() < Date.now()
}

function normalizeHookBody(stdinText: string, hookEventName: string): Record<string, unknown> {
  let parsed: Record<string, unknown> = {}
  if (stdinText.trim().length > 0) {
    try {
      const json = JSON.parse(stdinText) as unknown
      if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
        parsed = json as Record<string, unknown>
      }
    } catch {
      parsed = {}
    }
  }

  if (!('hook_event_name' in parsed)) {
    return {
      hook_event_name: hookEventName,
      ...parsed
    }
  }

  return parsed
}

function readManagedMarkerMetadata(env: Record<string, string | undefined>): ManagedMarkerMetadata {
  const managed = env.STOA_HOOK_MANAGED === '1'
  const provider = isHookDispatchProvider(env.STOA_HOOK_PROVIDER) ? env.STOA_HOOK_PROVIDER : null
  const generationValue = env.STOA_HOOK_SPAWN_GENERATION?.trim()
  const generation = generationValue && /^\d+$/.test(generationValue) ? Number(generationValue) : null
  const valid = managed
    && typeof env.STOA_HOOK_SESSION_ID === 'string'
    && env.STOA_HOOK_SESSION_ID.trim().length > 0
    && typeof env.STOA_HOOK_PROJECT_ID === 'string'
    && env.STOA_HOOK_PROJECT_ID.trim().length > 0
    && provider !== null
    && typeof env.STOA_HOOK_SPAWN_OWNER_INSTANCE_ID === 'string'
    && env.STOA_HOOK_SPAWN_OWNER_INSTANCE_ID.trim().length > 0
    && generation !== null

  return {
    sessionId: env.STOA_HOOK_SESSION_ID?.trim() || null,
    projectId: env.STOA_HOOK_PROJECT_ID?.trim() || null,
    provider,
    ownerInstanceId: env.STOA_HOOK_SPAWN_OWNER_INSTANCE_ID?.trim() || null,
    generation,
    managed,
    valid
  }
}

function deriveRuntimeRootFromLeasePath(leasePath: string): string | null {
  const canonicalPath = resolve(leasePath)
  const leasesDir = dirname(canonicalPath)
  if (normalize(leasesDir).endsWith(normalize(join('hook-leases')))) {
    return dirname(leasesDir)
  }
  return null
}

function buildLeaseFailureRecord(lease: SessionHookLease, failureClass: string): HookDispatchFailureRecord {
  return {
    sessionId: lease.sessionId,
    projectId: lease.projectId,
    ownerInstanceId: lease.ownerInstanceId,
    generation: lease.generation,
    provider: lease.provider,
    failureClass,
    metadataSource: 'lease',
    recordedAt: new Date().toISOString()
  }
}

async function recordManagedFailure(runtimeRoot: string, record: HookDispatchFailureRecord): Promise<void> {
  const journalPath = join(runtimeRoot, 'hook-delivery-failures.ndjson')
  const lockPath = join(runtimeRoot, 'hook-delivery-failures.lock')
  await mkdir(dirname(journalPath), { recursive: true })
  await withExclusiveJournalLock(lockPath, async () => {
    await appendFile(journalPath, `${JSON.stringify(record)}\n`, 'utf8')
  })
}

async function withExclusiveJournalLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      await writeFile(lockPath, process.pid.toString(), { flag: 'wx' })
      break
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) {
        throw error
      }

      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  try {
    return await operation()
  } finally {
    await rm(lockPath, { force: true })
  }
}

function isHookDispatchProvider(value: string | undefined): value is HookDispatchProvider {
  return value === 'claude-code' || value === 'codex' || value === 'opencode'
}

function isSessionHookLease(value: unknown): value is SessionHookLease {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    candidate.version === 1
    && typeof candidate.sessionId === 'string'
    && typeof candidate.projectId === 'string'
    && isHookDispatchProvider(typeof candidate.provider === 'string' ? candidate.provider : undefined)
    && (candidate.leaseState === 'active' || candidate.leaseState === 'released')
    && typeof candidate.ownerInstanceId === 'string'
    && typeof candidate.generation === 'number'
    && typeof candidate.webhookBaseUrl === 'string'
    && typeof candidate.sessionSecret === 'string'
    && typeof candidate.commitLockNonce === 'string'
    && typeof candidate.commitToken === 'string'
    && typeof candidate.createdAt === 'string'
    && typeof candidate.updatedAt === 'string'
    && typeof candidate.heartbeatAt === 'string'
    && typeof candidate.expiresAt === 'string'
    && (candidate.releasedAt === undefined || typeof candidate.releasedAt === 'string')
  )
}

function providerPath(provider: HookDispatchProvider): string {
  switch (provider) {
    case 'claude-code':
      return '/hooks/claude-code'
    case 'codex':
      return '/hooks/codex'
    case 'opencode':
      return '/hooks/opencode'
  }
}

async function postJson(
  urlText: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
): Promise<{ statusCode: number; body: string }> {
  const url = new URL(urlText)
  const payload = JSON.stringify(body)
  const requestImpl = url.protocol === 'https:' ? httpsRequest : httpRequest

  return await new Promise((resolve, reject) => {
    const request = requestImpl(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          ...headers,
          'content-length': Buffer.byteLength(payload).toString()
        }
      },
      (response) => {
        let responseBody = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          responseBody += chunk
        })
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: responseBody
          })
        })
      }
    )

    request.on('error', reject)
    request.write(payload)
    request.end()
  })
}
