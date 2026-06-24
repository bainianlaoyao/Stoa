import type { AppSettings, BootstrapState } from '@shared/project-session'
import { fetchStoaServerSettings } from './sr-settings-client'

interface ApiEnvelope<T> {
  ok: boolean
  data: T
}

type FetchLike = typeof fetch

export interface ShadowStateManager {
  replaceShadowState(state: BootstrapState, settings?: AppSettings): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readBootstrapState(value: unknown): BootstrapState | null {
  if (!isRecord(value)) {
    return null
  }

  if (!Array.isArray(value.projects) || !Array.isArray(value.sessions)) {
    return null
  }

  return value as unknown as BootstrapState
}

export async function fetchStoaServerBootstrapState(input: {
  port: number
  authToken: string
  fetchImpl?: FetchLike
}): Promise<BootstrapState | null> {
  const fetchFn = input.fetchImpl ?? fetch
  const response = await fetchFn(`http://127.0.0.1:${input.port}/api/v1/bootstrap`, {
    headers: {
      Authorization: `Bearer ${input.authToken}`
    }
  })

  if (!response.ok) {
    return null
  }

  const body = await response.json().catch(() => null) as ApiEnvelope<unknown> | null
  if (body?.ok !== true) {
    return null
  }

  return readBootstrapState(body.data)
}

export async function syncProjectSessionShadowFromStoaServer(input: {
  port: number
  authToken: string
  manager: ShadowStateManager
  fetchImpl?: FetchLike
  logger?: Pick<Console, 'warn'>
}): Promise<boolean> {
  const state = await fetchStoaServerBootstrapState(input)
  if (!state) {
    return false
  }

  let settings: AppSettings | null = null
  try {
    settings = await fetchStoaServerSettings(input)
  } catch (error) {
    input.logger?.warn('[main] Failed to read Stoa Server settings while syncing shadow state:', error)
  }

  await input.manager.replaceShadowState(state, settings ?? undefined)
  return true
}
