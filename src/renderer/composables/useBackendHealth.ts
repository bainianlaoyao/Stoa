import { computed, onBeforeUnmount, onMounted, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { BackendHealthCheckResult } from '@shared/project-session'
import { requireRendererApi } from '@renderer/stores/stoa-store-plugin'

export type BackendHealthStatus = 'connected' | 'reconnecting' | 'offline'

export interface UseBackendHealthOptions {
  enabled?: MaybeRefOrGetter<boolean>
  check?: () => Promise<BackendHealthCheckResult>
  now?: () => number
}

const CONNECTED_POLL_MS = 5_000
const RETRY_POLL_MS = 2_000
const HIDDEN_POLL_MS = 30_000
const OFFLINE_THRESHOLD_MS = 15_000

export function useBackendHealth(options: UseBackendHealthOptions = {}) {
  const status = shallowRef<BackendHealthStatus>('connected')
  const checking = shallowRef(false)
  const lastResult = shallowRef<BackendHealthCheckResult | null>(null)
  const lastErrorMessage = shallowRef<string | null>(null)
  const failureStartedAt = shallowRef<number | null>(null)
  const mounted = shallowRef(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let checkEpoch = 0

  const isEnabled = computed(() => toValue(options.enabled ?? true))
  const now = () => options.now?.() ?? Date.now()
  const check = () => options.check?.() ?? requireRendererApi().checkBackendHealth()

  const message = computed(() => {
    if (status.value === 'connected') {
      return null
    }

    return lastErrorMessage.value ?? lastResult.value?.message ?? 'Backend connection is not healthy.'
  })

  function clearTimer(): void {
    if (timer === null) {
      return
    }

    clearTimeout(timer)
    timer = null
  }

  function nextDelay(): number {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return HIDDEN_POLL_MS
    }

    return status.value === 'connected' ? CONNECTED_POLL_MS : RETRY_POLL_MS
  }

  function scheduleNextCheck(): void {
    clearTimer()
    if (!mounted.value || !isEnabled.value) {
      return
    }

    timer = setTimeout(() => {
      void runCheck()
    }, nextDelay())
  }

  function applySuccess(result: BackendHealthCheckResult): void {
    lastResult.value = result
    lastErrorMessage.value = null
    failureStartedAt.value = null
    status.value = 'connected'
  }

  function applyFailure(result: BackendHealthCheckResult): void {
    const currentTime = now()
    lastResult.value = result
    lastErrorMessage.value = result.message ?? null

    if (failureStartedAt.value === null) {
      failureStartedAt.value = currentTime
    }

    status.value = currentTime - failureStartedAt.value > OFFLINE_THRESHOLD_MS
      ? 'offline'
      : 'reconnecting'
  }

  async function runCheck(): Promise<void> {
    if (!mounted.value || !isEnabled.value) {
      return
    }

    const localEpoch = ++checkEpoch
    checking.value = true

    try {
      const result = await check()
      if (localEpoch !== checkEpoch) {
        return
      }

      if (result.healthy) {
        applySuccess(result)
      } else {
        applyFailure(result)
      }
    } catch (error) {
      if (localEpoch !== checkEpoch) {
        return
      }

      applyFailure({
        healthy: false,
        checkedAt: new Date(now()).toISOString(),
        backend: { available: false },
        coreSessionService: { available: false },
        reason: 'backend_unavailable',
        message: error instanceof Error ? error.message : 'Backend health check failed.'
      })
    } finally {
      if (localEpoch === checkEpoch) {
        checking.value = false
        scheduleNextCheck()
      }
    }
  }

  function retry(): void {
    clearTimer()
    void runCheck()
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      retry()
      return
    }

    scheduleNextCheck()
  }

  watch(isEnabled, (enabled) => {
    if (!mounted.value) {
      return
    }

    if (enabled) {
      retry()
      return
    }

    clearTimer()
    checking.value = false
    status.value = 'connected'
    failureStartedAt.value = null
  })

  onMounted(() => {
    mounted.value = true
    document.addEventListener('visibilitychange', handleVisibilityChange)
    if (isEnabled.value) {
      retry()
    }
  })

  onBeforeUnmount(() => {
    mounted.value = false
    checkEpoch += 1
    clearTimer()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  return {
    status,
    checking,
    message,
    lastResult,
    retry
  }
}
