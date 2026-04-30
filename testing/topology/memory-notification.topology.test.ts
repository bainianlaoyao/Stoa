import { describe, expect, it } from 'vitest'
import { memoryNotificationTopology } from './memory-notification.topology'

describe('memory notification topology', () => {
  it('declares stable toast host test ids', () => {
    expect(memoryNotificationTopology.surface).toBe('memory-notification')
    expect(memoryNotificationTopology.testIds.root).toBe('memory-toast-host')
    expect(memoryNotificationTopology.testIds.toast).toBe('memory-toast')
  })
})
