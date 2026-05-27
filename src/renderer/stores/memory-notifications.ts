import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MemoryNotificationEvent } from '@shared/project-session'

export interface TitleGenerationToastNotification {
  id: string
  projectId: string
  sessionId: string
  status: 'pending' | 'success' | 'error'
  title: string
  message: string
  createdAt: string
}

export type ToastNotification = MemoryNotificationEvent | TitleGenerationToastNotification

const MAX_NOTIFICATIONS = 3
const SUCCESS_TIMEOUT_MS = 4200
const INFO_TIMEOUT_MS = 3600
const ERROR_TIMEOUT_MS = 6000

export const useMemoryNotificationsStore = defineStore('memory-notifications', () => {
  const notifications = ref<ToastNotification[]>([])
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function clearTimer(id: string): void {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
  }

  function dismiss(id: string): void {
    clearTimer(id)
    notifications.value = notifications.value.filter((item) => item.id !== id)
  }

  function enqueue(notification: ToastNotification): void {
    dismiss(notification.id)
    const nextNotifications = [...notifications.value, notification]
    const trimmedNotifications = nextNotifications.slice(-MAX_NOTIFICATIONS)

    for (const stale of nextNotifications.slice(0, Math.max(0, nextNotifications.length - MAX_NOTIFICATIONS))) {
      clearTimer(stale.id)
    }
    notifications.value = trimmedNotifications

    const timeoutMs =
      notification.status === 'error'
        ? ERROR_TIMEOUT_MS
        : notification.status === 'info' || notification.status === 'pending'
          ? INFO_TIMEOUT_MS
          : SUCCESS_TIMEOUT_MS

    timers.set(notification.id, setTimeout(() => {
      dismiss(notification.id)
    }, timeoutMs))
  }

  function enqueueTitleGeneration(notification: TitleGenerationToastNotification): void {
    enqueue(notification)
  }

  function reset(): void {
    for (const id of timers.keys()) {
      clearTimer(id)
    }
    notifications.value = []
  }

  return {
    notifications,
    enqueue,
    enqueueTitleGeneration,
    dismiss,
    reset
  }
})
