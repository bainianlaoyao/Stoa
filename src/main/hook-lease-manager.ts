import type { SessionType } from '@shared/project-session'
import {
  createHookLeaseRegistry,
  type HookLeaseProvider,
  type SessionHookLease
} from './hook-lease-registry'

interface HookLeaseManagerOptions {
  runtimeRoot: string
  instanceId: string
  heartbeatIntervalMs?: number
  leaseDurationMs?: number
  nowIso?: () => string
}

interface HookLeaseBinding {
  path: string
  lease: SessionHookLease
}

interface HookRequestAuthorizationInput {
  sessionId: string
  projectId: string
  provider: HookLeaseProvider
  secret: string | null
}

type HookRequestAuthorizationResult =
  | { ok: true; lease: SessionHookLease }
  | { ok: false; reason: 'invalid_secret' | 'invalid_hook_context' }

type HeartbeatTimer = ReturnType<typeof setInterval>

function toHookLeaseProvider(sessionType: SessionType): HookLeaseProvider | null {
  switch (sessionType) {
    case 'claude-code':
    case 'codex':
    case 'opencode':
      return sessionType
    default:
      return null
  }
}

export function createHookLeaseManager(options: HookLeaseManagerOptions) {
  const registry = createHookLeaseRegistry({
    runtimeRoot: options.runtimeRoot,
    instanceId: options.instanceId,
    nowIso: options.nowIso,
    leaseDurationMs: options.leaseDurationMs
  })

  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5_000
  const trackedLeases = new Map<string, HookLeaseBinding>()
  const heartbeatTimers = new Map<string, HeartbeatTimer>()

  async function ensureLease(input: {
    sessionId: string
    projectId: string
    sessionType: SessionType
    webhookBaseUrl: string
  }): Promise<HookLeaseBinding | null> {
    const provider = toHookLeaseProvider(input.sessionType)
    if (!provider) {
      return null
    }

    const tracked = trackedLeases.get(input.sessionId)
    if (tracked && !registry.isExpired(tracked.lease)) {
      return tracked
    }

    const existing = await registry.read(input.sessionId)
    let binding: HookLeaseBinding

    if (!existing.lease) {
      binding = await registry.acquire({
        sessionId: input.sessionId,
        projectId: input.projectId,
        provider,
        webhookBaseUrl: input.webhookBaseUrl
      })
    } else if (
      existing.lease.leaseState === 'active'
      && existing.lease.ownerInstanceId === options.instanceId
      && !registry.isExpired(existing.lease)
    ) {
      binding = {
        path: existing.path,
        lease: existing.lease
      }
    } else if (existing.lease.leaseState === 'released' || registry.isExpired(existing.lease)) {
      const reclaimed = await registry.reclaim({
        sessionId: input.sessionId,
        webhookBaseUrl: input.webhookBaseUrl
      })
      if (!reclaimed) {
        throw new Error(`Failed to reclaim hook lease for session ${input.sessionId}`)
      }
      binding = {
        path: existing.path,
        lease: reclaimed
      }
    } else {
      throw new Error(`Session ${input.sessionId} is owned by another STOA instance`)
    }

    trackedLeases.set(input.sessionId, binding)
    startHeartbeat(input.sessionId)
    return binding
  }

  function startHeartbeat(sessionId: string): void {
    const existing = heartbeatTimers.get(sessionId)
    if (existing) {
      clearInterval(existing)
    }

    const timer = setInterval(() => {
      void heartbeat(sessionId)
    }, heartbeatIntervalMs)
    heartbeatTimers.set(sessionId, timer)
  }

  async function heartbeat(sessionId: string): Promise<void> {
    const tracked = trackedLeases.get(sessionId)
    if (!tracked) {
      return
    }

    const nextLease = await registry.heartbeat({
      sessionId,
      ownerInstanceId: tracked.lease.ownerInstanceId,
      generation: tracked.lease.generation
    })

    if (!nextLease) {
      stopHeartbeat(sessionId)
      trackedLeases.delete(sessionId)
      return
    }

    trackedLeases.set(sessionId, {
      path: tracked.path,
      lease: nextLease
    })
  }

  function stopHeartbeat(sessionId: string): void {
    const existing = heartbeatTimers.get(sessionId)
    if (existing) {
      clearInterval(existing)
      heartbeatTimers.delete(sessionId)
    }
  }

  async function releaseLease(sessionId: string): Promise<void> {
    const tracked = trackedLeases.get(sessionId)
    stopHeartbeat(sessionId)

    if (!tracked) {
      return
    }

    await registry.release({
      sessionId,
      ownerInstanceId: tracked.lease.ownerInstanceId,
      generation: tracked.lease.generation
    })
    trackedLeases.delete(sessionId)
  }

  async function authorizeHookRequest(input: HookRequestAuthorizationInput): Promise<HookRequestAuthorizationResult> {
    const current = trackedLeases.get(input.sessionId) ?? await registry.read(input.sessionId).then((result) => {
      return result.lease ? { path: result.path, lease: result.lease } : null
    })

    if (!current || current.lease.leaseState !== 'active' || registry.isExpired(current.lease)) {
      return { ok: false, reason: 'invalid_secret' }
    }

    if (
      current.lease.projectId !== input.projectId
      || current.lease.provider !== input.provider
      || current.lease.sessionSecret !== input.secret
    ) {
      return { ok: false, reason: 'invalid_secret' }
    }

    return { ok: true, lease: current.lease }
  }

  function debugSnapshotSessionSecrets(): Record<string, string> {
    return Object.fromEntries(
      [...trackedLeases.entries()].map(([sessionId, binding]) => [sessionId, binding.lease.sessionSecret])
    )
  }

  function getTrackedLease(sessionId: string): HookLeaseBinding | null {
    return trackedLeases.get(sessionId) ?? null
  }

  async function stop(): Promise<void> {
    const sessionIds = [...trackedLeases.keys()]
    await Promise.allSettled(sessionIds.map(async (sessionId) => releaseLease(sessionId)))
  }

  return {
    instanceId: options.instanceId,
    registry,
    ensureLease,
    releaseLease,
    authorizeHookRequest,
    debugSnapshotSessionSecrets,
    getTrackedLease,
    stop
  }
}
