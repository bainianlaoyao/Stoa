import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  useMemoryNotificationsStore,
  type TitleGenerationToastNotification
} from './memory-notifications'
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

function createTitleGenerationNotification(
  overrides: Partial<TitleGenerationToastNotification> = {}
): TitleGenerationToastNotification {
  return {
    id: 'title-toast-1',
    projectId: 'project_1',
    sessionId: 'session_1',
    status: 'pending',
    title: 'Generating session title',
    message: 'Summarizing the latest turn before updating the sidebar title.',
    createdAt: '2026-04-29T02:00:00.000Z',
    ...overrides
  }
}

describe('useMemoryNotificationsStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enqueues notifications in arrival order', () => {
    const store = useMemoryNotificationsStore()

    store.enqueue(createNotification({ id: 'toast-1', kind: 'recall' }))
    store.enqueue(createNotification({ id: 'toast-2', kind: 'distill', title: 'Memory distilled' }))

    expect(store.notifications.map((item) => item.id)).toEqual(['toast-1', 'toast-2'])
  })

  it('auto dismisses success notifications after their timeout', () => {
    const store = useMemoryNotificationsStore()

    store.enqueue(createNotification())
    expect(store.notifications).toHaveLength(1)

    vi.advanceTimersByTime(5000)

    expect(store.notifications).toEqual([])
  })

  it('auto dismisses pending title-generation notifications after the info timeout', () => {
    const store = useMemoryNotificationsStore()

    store.enqueueTitleGeneration(createTitleGenerationNotification())
    expect(store.notifications).toHaveLength(1)

    vi.advanceTimersByTime(3600)

    expect(store.notifications).toEqual([])
  })

  it('reset clears queued notifications and pending timers', () => {
    const store = useMemoryNotificationsStore()

    store.enqueue(createNotification())
    store.reset()
    vi.advanceTimersByTime(5000)

    expect(store.notifications).toEqual([])
  })
})
