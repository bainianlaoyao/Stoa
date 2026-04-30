// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MemoryToastHost from './MemoryToastHost.vue'
import type { MemoryNotificationEvent } from '@shared/project-session'

function createNotification(overrides: Partial<MemoryNotificationEvent> = {}): MemoryNotificationEvent {
  return {
    id: 'memory-toast-1',
    projectId: 'project_1',
    sessionId: 'session_1',
    kind: 'recall',
    status: 'success',
    title: 'Memory recalled',
    message: 'Relevant Evolver context was injected for this turn.',
    createdAt: '2026-04-29T02:00:00.000Z',
    ...overrides
  }
}

describe('MemoryToastHost', () => {
  it('renders toast title and message for each memory notification', () => {
    const wrapper = mount(MemoryToastHost, {
      props: {
        notifications: [
          createNotification(),
          createNotification({
            id: 'memory-toast-2',
            kind: 'distill',
            status: 'info',
            title: 'Memory distilled',
            message: 'Turn lessons were distilled into Evolver memory.'
          })
        ]
      }
    })

    expect(wrapper.get('[data-testid="memory-toast-host"]').text()).toContain('Memory recalled')
    expect(wrapper.get('[data-testid="memory-toast-host"]').text()).toContain('Memory distilled')
    expect(wrapper.findAll('[data-testid="memory-toast"]')).toHaveLength(2)
  })

  it('exposes kind and status as stable data attributes', () => {
    const wrapper = mount(MemoryToastHost, {
      props: {
        notifications: [
          createNotification({
            kind: 'solidify',
            status: 'error',
            title: 'Solidify failed',
            message: 'Evolver solidify phase failed.'
          })
        ]
      }
    })

    const toast = wrapper.get('[data-testid="memory-toast"]')
    expect(toast.attributes('data-kind')).toBe('solidify')
    expect(toast.attributes('data-status')).toBe('error')
  })
})
