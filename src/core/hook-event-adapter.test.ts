import { describe, expect, test } from 'vitest'
import { adaptClaudeCodeHook } from './hook-event-adapter'

describe('hook event adapter', () => {
  test('adapts Claude Stop hook into turn_complete canonical event', () => {
    const event = adaptClaudeCodeHook(
      {
        hook_event_name: 'Stop',
        session_id: 'claude-external-1'
      },
      {
        sessionId: 'session_internal_1',
        projectId: 'project_internal_1'
      }
    )

    expect(event).toMatchObject({
      event_version: 1,
      event_type: 'claude-code.Stop',
      session_id: 'session_internal_1',
      project_id: 'project_internal_1',
      source: 'provider-adapter',
      payload: {
        status: 'turn_complete',
        summary: 'Stop'
      }
    })
  })

  test('adapts Claude PermissionRequest hook into needs_confirmation canonical event', () => {
    const event = adaptClaudeCodeHook(
      {
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash'
      },
      {
        sessionId: 'session_internal_2',
        projectId: 'project_internal_2'
      }
    )

    expect(event).toMatchObject({
      event_version: 1,
      event_type: 'claude-code.PermissionRequest',
      session_id: 'session_internal_2',
      project_id: 'project_internal_2',
      source: 'provider-adapter',
      payload: {
        status: 'needs_confirmation',
        summary: 'PermissionRequest'
      }
    })
  })

  test('returns null for unsupported Claude hook events', () => {
    const event = adaptClaudeCodeHook(
      { hook_event_name: 'SessionStart' },
      {
        sessionId: 'session_internal_3',
        projectId: 'project_internal_3'
      }
    )

    expect(event).toBeNull()
  })
})
