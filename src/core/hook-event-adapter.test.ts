import { describe, expect, test } from 'vitest'
import { adaptClaudeCodeHook, adaptCodexHook } from './hook-event-adapter'

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
        session_id: 'claude-external-1'
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
        intent: 'agent.turn_failed',
        agentState: 'error',
        summary: 'StopFailure',
        error: 'api_error'
      }
    })
  })

  test('adapts Claude PostToolUse hook into tool completed state patch event', () => {
    const event = adaptClaudeCodeHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash'
      },
      {
        sessionId: 'session_internal_3',
        projectId: 'project_internal_3'
      }
    )

    expect(event).toMatchObject({
      event_type: 'claude-code.PostToolUse',
      session_id: 'session_internal_3',
      project_id: 'project_internal_3',
      source: 'provider-adapter',
      payload: {
        intent: 'agent.tool_completed',
        agentState: 'working',
        summary: 'PostToolUse',
        toolName: 'Bash'
      }
    })
  })

  test('adapts Claude PreToolUse with AskUserQuestion tool into permission requested with elicitation blocking reason', () => {
    const event = adaptClaudeCodeHook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'AskUserQuestion'
      },
      {
        sessionId: 'session_elicitation_1',
        projectId: 'project_elicitation_1'
      }
    )

    expect(event).toMatchObject({
      event_type: 'claude-code.PreToolUse',
      session_id: 'session_elicitation_1',
      project_id: 'project_elicitation_1',
      source: 'provider-adapter',
      payload: {
        intent: 'agent.permission_requested',
        agentState: 'blocked',
        summary: 'PreToolUse',
        toolName: 'AskUserQuestion',
        blockingReason: 'elicitation'
      }
    })
  })
})

describe('codex hook adapter', () => {
  const codexContext = { sessionId: 'codex_session_1', projectId: 'codex_project_1' }

  test('adapts Codex SessionStart hook into turn started state patch event', () => {
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
        intent: 'agent.turn_started',
        agentState: 'working',
        summary: 'SessionStart',
        model: 'gpt-4o'
      }
    })
  })

  test('adapts Codex UserPromptSubmit hook into turn started state patch event', () => {
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
        intent: 'agent.turn_started',
        agentState: 'working',
        summary: 'UserPromptSubmit'
      }
    })
  })

  test('adapts Codex PreToolUse hook into tool started state patch event with toolName and toolUseId', () => {
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
        intent: 'agent.tool_started',
        agentState: 'working',
        summary: 'PreToolUse',
        toolName: 'Write',
        toolUseId: 'tooluse_abc'
      }
    })
  })

  test('adapts Codex PostToolUse hook into tool started state patch event with toolName and toolUseId', () => {
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
        intent: 'agent.tool_started',
        agentState: 'working',
        summary: 'PostToolUse',
        model: 'o3',
        toolName: 'Bash',
        toolUseId: 'tooluse_def'
      }
    })
  })

  test('adapts Codex Stop hook into turn completed state patch event', () => {
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
        intent: 'agent.turn_completed',
        agentState: 'idle',
        hasUnseenCompletion: true,
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
