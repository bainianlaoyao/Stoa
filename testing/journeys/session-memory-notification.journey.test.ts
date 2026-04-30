import { describe, expect, it } from 'vitest'
import { sessionMemoryNotificationJourney } from './session-memory-notification.journey'

describe('session memory notification journey', () => {
  it('captures recall and maintenance notification flow for the active session', () => {
    expect(sessionMemoryNotificationJourney.behavior).toBe('session.memory-notification')
    expect(sessionMemoryNotificationJourney.setup).toEqual([
      'project.withClaudeSession',
      'session.runtimeAlive',
      'session.selectedInCommandSurface'
    ])
    expect(sessionMemoryNotificationJourney.act).toContain('post.claude.userPromptSubmitHook')
    expect(sessionMemoryNotificationJourney.assert).toContain('memory.toast.recallVisible')
    expect(sessionMemoryNotificationJourney.assert).toContain('memory.toast.distillVisible')
  })
})
