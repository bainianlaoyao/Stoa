import { describe, expect, test } from 'vitest'
import { adaptClaudeCodeHook } from './hook-event-adapter'

describe('hook event adapter', () => {
  test('adapts Claude Stop hook into turn completed state patch event', () => {
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
        intent: 'agent.turn_completed',
        agentState: 'idle',
        hasUnseenCompletion: true,
        summary: 'Stop',
        snippet: 'I completed the implementation.'
      }
    })
  })

  test('ignores Claude SessionStart hook because turn start is emitted by user prompts', () => {
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

    expect(event).toBeNull()
  })

  test('adapts Claude UserPromptSubmit hook into turn started state patch event', () => {
    const event = adaptClaudeCodeHook(
      {
        hook_event_name: 'UserPromptSubmit'
      },
      {
        sessionId: 'session_internal_running',
        projectId: 'project_internal_running'
      }
    )

    expect(event).toMatchObject({
      event_type: 'claude-code.UserPromptSubmit',
      session_id: 'session_internal_running',
      project_id: 'project_internal_running',
      payload: {
        intent: 'agent.turn_started',
        agentState: 'working',
        summary: 'UserPromptSubmit'
      }
    })
  })

  test('adapts Claude PreToolUse hook into tool started state patch event', () => {
    const event = adaptClaudeCodeHook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash'
      },
      {
        sessionId: 'session_internal_running',
        projectId: 'project_internal_running'
      }
    )

    expect(event).toMatchObject({
      event_type: 'claude-code.PreToolUse',
      session_id: 'session_internal_running',
      project_id: 'project_internal_running',
      payload: {
        intent: 'agent.tool_started',
        agentState: 'working',
        summary: 'PreToolUse',
        toolName: 'Bash'
      }
    })
  })

  test('adapts Claude PermissionRequest hook into permission requested state patch event', () => {
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
        intent: 'agent.permission_requested',
        agentState: 'blocked',
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
        intent: 'agent.turn_failed',
        agentState: 'error',
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
