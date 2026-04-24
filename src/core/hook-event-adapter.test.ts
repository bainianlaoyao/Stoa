import { describe, expect, test } from 'vitest'
import { adaptClaudeCodeHook } from './hook-event-adapter'

describe('hook event adapter', () => {
  test('adapts Claude Stop hook into turn_complete canonical event', () => {
    const event = adaptClaudeCodeHook(
      {
        hook_event_name: 'Stop',
        session_id: 'claude-external-1',
        last_assistant_message: 'I completed the implementation.'
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
        summary: 'Stop',
        snippet: 'I completed the implementation.'
      }
    })
  })

  test('adapts Claude SessionStart hook into running canonical event with model evidence', () => {
    const event = adaptClaudeCodeHook(
      {
        hook_event_name: 'SessionStart',
        session_id: 'claude-external-1',
        model: 'claude-sonnet-4-5'
      },
      {
        sessionId: 'session_internal_1',
        projectId: 'project_internal_1'
      }
    )

    expect(event).toMatchObject({
      event_version: 1,
      event_type: 'claude-code.SessionStart',
      session_id: 'session_internal_1',
      project_id: 'project_internal_1',
      source: 'provider-adapter',
      payload: {
        status: 'running',
        summary: 'SessionStart',
        model: 'claude-sonnet-4-5'
      }
    })
  })

  test.each(['UserPromptSubmit', 'PreToolUse'] as const)(
    'adapts Claude %s hook into running canonical event',
    (hookEventName) => {
      const event = adaptClaudeCodeHook(
        {
          hook_event_name: hookEventName,
          tool_name: hookEventName === 'PreToolUse' ? 'Bash' : undefined
        },
        {
          sessionId: 'session_internal_running',
          projectId: 'project_internal_running'
        }
      )

      expect(event).toMatchObject({
        event_type: `claude-code.${hookEventName}`,
        session_id: 'session_internal_running',
        project_id: 'project_internal_running',
        payload: {
          status: 'running',
          summary: hookEventName
        }
      })
    }
  )

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
        summary: 'PermissionRequest',
        toolName: 'Bash',
        blockingReason: 'permission'
      }
    })
  })

  test('adapts Claude StopFailure hook into error canonical event with error detail', () => {
    const event = adaptClaudeCodeHook(
      {
        hook_event_name: 'StopFailure',
        error_details: 'Provider failed to stop cleanly.'
      },
      {
        sessionId: 'session_internal_4',
        projectId: 'project_internal_4'
      }
    )

    expect(event).toMatchObject({
      event_type: 'claude-code.StopFailure',
      session_id: 'session_internal_4',
      project_id: 'project_internal_4',
      source: 'provider-adapter',
      payload: {
        status: 'error',
        summary: 'StopFailure',
        error: 'Provider failed to stop cleanly.'
      }
    })
  })

  test('returns null for unsupported Claude hook events', () => {
    const event = adaptClaudeCodeHook(
      { hook_event_name: 'PostToolUse' },
      {
        sessionId: 'session_internal_3',
        projectId: 'project_internal_3'
      }
    )

    expect(event).toBeNull()
  })
})
