// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { mount } from '@vue/test-utils'
import { useBackendHealth } from './useBackendHealth'
import type { BackendHealthCheckResult } from '@shared/project-session'

function healthyResult(): BackendHealthCheckResult {
  return {
    healthy: true,
    checkedAt: '2026-06-19T00:00:00.000Z',
    backend: { available: true, status: 'healthy' },
    coreSessionService: { available: true }
  }
}

function unhealthyResult(message = 'offline'): BackendHealthCheckResult {
  return {
    healthy: false,
    checkedAt: '2026-06-19T00:00:00.000Z',
    backend: { available: false },
    coreSessionService: { available: false },
    reason: 'backend_unavailable',
    message
  }
}

function mountHarness(options: {
  enabled?: boolean
  check: () => Promise<BackendHealthCheckResult>
  now: () => number
}) {
  const enabled = shallowRef(options.enabled ?? true)
  let api!: ReturnType<typeof useBackendHealth>

  const wrapper = mount(defineComponent({
    setup() {
      api = useBackendHealth({
        enabled,
        check: options.check,
        now: options.now
      })
      return () => h('div', { 'data-status': api.status.value })
    }
  }))

  return { wrapper, api, enabled }
}

async function flush(): Promise<void> {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('useBackendHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with an immediate check and stays connected after a healthy result', async () => {
    const check = vi.fn().mockResolvedValue(healthyResult())
    const { api } = mountHarness({ check, now: () => 0 })

    await flush()

    expect(check).toHaveBeenCalledTimes(1)
    expect(api.status.value).toBe('connected')
  })

  it('moves from reconnecting to offline after continuous failures exceed the threshold', async () => {
    let time = 0
    const check = vi.fn().mockResolvedValue(unhealthyResult())
    const { api } = mountHarness({ check, now: () => time })

    await flush()
    expect(api.status.value).toBe('reconnecting')

    time = 16_001
    api.retry()
    await flush()

    expect(api.status.value).toBe('offline')
  })

  it('retry triggers a health check only', async () => {
    const check = vi.fn()
      .mockResolvedValueOnce(unhealthyResult())
      .mockResolvedValueOnce(healthyResult())
    const { api } = mountHarness({ check, now: () => 0 })

    await flush()
    expect(api.status.value).toBe('reconnecting')

    api.retry()
    await flush()

    expect(check).toHaveBeenCalledTimes(2)
    expect(api.status.value).toBe('connected')
  })

  it('checks immediately when the document becomes visible', async () => {
    const check = vi.fn().mockResolvedValue(healthyResult())
    mountHarness({ check, now: () => 0 })
    await flush()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()

    expect(check).toHaveBeenCalledTimes(2)
  })
})
