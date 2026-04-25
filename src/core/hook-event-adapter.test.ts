import { describe, expect, test } from 'vitest'
import { adaptClaudeCodeHook, adaptCodexHook } from './hook-event-adapter'

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

  test('adapts Claude SessionStart hook into running canonical event', () => {
    const event = adaptClaudeCodeHook(
      {
        hook_event_name: 'SessionStart',
        session_id: 'claude-external-1'
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
        summary: 'SessionStart'
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
        hook_event_name: 'StopFailure'
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
        error: 'api_error'
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

describe('codex hook adapter', () => {
  const codexContext = { sessionId: 'codex_session_1', projectId: 'codex_project_1' }

  test('adapts Codex SessionStart hook into running canonical event', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'SessionStart',
        turn_id: 'turn_1',
        model: 'gpt-4o'
      },
      codexContext
    )

    expect(event).toMatchObject({
      event_version: 1,
      event_id: 'turn_1',
      event_type: 'codex.SessionStart',
      session_id: 'codex_session_1',
      project_id: 'codex_project_1',
      source: 'provider-adapter',
      payload: {
        status: 'running',
        summary: 'SessionStart',
        model: 'gpt-4o'
      }
    })
  })

  test('adapts Codex UserPromptSubmit hook into running canonical event', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'UserPromptSubmit',
        turn_id: 'turn_2'
      },
      codexContext
    )

    expect(event).toMatchObject({
      event_version: 1,
      event_id: 'turn_2',
      event_type: 'codex.UserPromptSubmit',
      session_id: 'codex_session_1',
      project_id: 'codex_project_1',
      source: 'provider-adapter',
      payload: {
        status: 'running',
        summary: 'UserPromptSubmit'
      }
    })
  })

  test('adapts Codex PreToolUse hook with toolName and toolUseId', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'PreToolUse',
        turn_id: 'turn_3',
        tool_name: 'Write',
        tool_use_id: 'tooluse_abc'
      },
      codexContext
    )

    expect(event).toMatchObject({
      event_version: 1,
      event_id: 'turn_3',
      event_type: 'codex.PreToolUse',
      session_id: 'codex_session_1',
      project_id: 'codex_project_1',
      source: 'provider-adapter',
      payload: {
        status: 'running',
        summary: 'PreToolUse',
        toolName: 'Write',
        toolUseId: 'tooluse_abc'
      }
    })
  })

  test('adapts Codex PostToolUse hook with toolName and toolUseId', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'PostToolUse',
        turn_id: 'turn_4',
        tool_name: 'Bash',
        tool_use_id: 'tooluse_def',
        model: 'o3'
      },
      codexContext
    )

    expect(event).toMatchObject({
      event_version: 1,
      event_id: 'turn_4',
      event_type: 'codex.PostToolUse',
      session_id: 'codex_session_1',
      project_id: 'codex_project_1',
      source: 'provider-adapter',
      payload: {
        status: 'running',
        summary: 'PostToolUse',
        model: 'o3',
        toolName: 'Bash',
        toolUseId: 'tooluse_def'
      }
    })
  })

  test('adapts Codex Stop hook into turn_complete canonical event', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'Stop',
        turn_id: 'turn_5'
      },
      codexContext
    )

    expect(event).toMatchObject({
      event_version: 1,
      event_id: 'turn_5',
      event_type: 'codex.Stop',
      session_id: 'codex_session_1',
      project_id: 'codex_project_1',
      source: 'provider-adapter',
      payload: {
        status: 'turn_complete',
        summary: 'Stop'
      }
    })
  })

  test('returns null for unknown Codex hook events', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'PostToolResult',
        turn_id: 'turn_99'
      },
      codexContext
    )

    expect(event).toBeNull()
  })

  test('generates UUID event_id when turn_id is absent', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'SessionStart'
      },
      codexContext
    )

    expect(event).not.toBeNull()
    expect(event!.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(event!.event_type).toBe('codex.SessionStart')
  })
})
