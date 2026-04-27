import { describe, expect, test } from 'vitest'
import { adaptClaudeCodeHook, adaptCodexHook } from './hook-event-adapter'

describe('hook event adapter', () => {
  test('adapts Claude Stop hook into turn completed state patch event', () => {
    const event = adaptClaudeCodeHook(
      {
        hook_event_name: 'Stop',
        session_id: 'claude-external-1',
        transcript_path: '/tmp/claude-transcript.jsonl',
        cwd: '/repo/app',
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
        summary: 'Stop'
      },
      evidence: {
        rawSource: {
          provider: 'claude-code',
          channel: 'hook',
          rawEventName: 'Stop'
        },
        hookEventName: 'Stop',
        providerSessionId: 'claude-external-1',
        transcriptPath: '/tmp/claude-transcript.jsonl',
        lastAssistantMessage: 'I completed the implementation.',
        cwd: '/repo/app'
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
        hook_event_name: 'UserPromptSubmit',
        session_id: 'claude-external-2',
        prompt: 'Investigate the runtime error.'
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
      },
      evidence: {
        rawSource: {
          provider: 'claude-code',
          channel: 'hook',
          rawEventName: 'UserPromptSubmit'
        },
        hookEventName: 'UserPromptSubmit',
        providerSessionId: 'claude-external-2',
        promptText: 'Investigate the runtime error.'
      }
    })
  })

  test('adapts Claude PreToolUse hook into tool started state patch event', () => {
    const event = adaptClaudeCodeHook(
      {
        hook_event_name: 'PreToolUse',
        session_id: 'claude-external-3',
        cwd: '/repo/app',
        tool_name: 'Bash',
        tool_use_id: 'toolu_123'
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
        summary: 'PreToolUse'
      },
      evidence: {
        rawSource: {
          provider: 'claude-code',
          channel: 'hook',
          rawEventName: 'PreToolUse'
        },
        hookEventName: 'PreToolUse',
        providerSessionId: 'claude-external-3',
        toolName: 'Bash',
        toolUseId: 'toolu_123',
        cwd: '/repo/app'
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
        blockingReason: 'permission'
      },
      evidence: {
        rawSource: {
          provider: 'claude-code',
          channel: 'hook',
          rawEventName: 'PermissionRequest'
        },
        hookEventName: 'PermissionRequest',
        toolName: 'Bash'
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

  test('adapts Codex SessionStart hook into turn started state patch event', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'SessionStart',
        session_id: 'codex-session-1',
        transcript_path: '/tmp/codex-transcript.jsonl',
        cwd: '/repo/codex',
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
        externalSessionId: 'codex-session-1'
      },
      evidence: {
        rawSource: {
          provider: 'codex',
          channel: 'hook',
          rawEventName: 'SessionStart'
        },
        hookEventName: 'SessionStart',
        providerSessionId: 'codex-session-1',
        turnId: 'turn_1',
        transcriptPath: '/tmp/codex-transcript.jsonl',
        cwd: '/repo/codex',
        model: 'gpt-4o'
      }
    })
  })

  test('adapts Codex UserPromptSubmit hook into turn started state patch event', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'codex-session-2',
        turn_id: 'turn_2',
        prompt: 'Add the missing state transition.'
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
      },
      evidence: {
        rawSource: {
          provider: 'codex',
          channel: 'hook',
          rawEventName: 'UserPromptSubmit'
        },
        hookEventName: 'UserPromptSubmit',
        providerSessionId: 'codex-session-2',
        turnId: 'turn_2',
        promptText: 'Add the missing state transition.'
      }
    })
  })

  test('adapts Codex PreToolUse hook into tool started state patch event with toolName and toolUseId', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'PreToolUse',
        session_id: 'codex-session-3',
        turn_id: 'turn_3',
        cwd: '/repo/codex',
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
        summary: 'PreToolUse'
      },
      evidence: {
        rawSource: {
          provider: 'codex',
          channel: 'hook',
          rawEventName: 'PreToolUse'
        },
        hookEventName: 'PreToolUse',
        providerSessionId: 'codex-session-3',
        turnId: 'turn_3',
        toolName: 'Write',
        toolUseId: 'tooluse_abc',
        cwd: '/repo/codex'
      }
    })
  })

  test('adapts Codex PostToolUse hook into tool started state patch event with toolName and toolUseId', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'PostToolUse',
        session_id: 'codex-session-4',
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
        summary: 'PostToolUse'
      },
      evidence: {
        rawSource: {
          provider: 'codex',
          channel: 'hook',
          rawEventName: 'PostToolUse'
        },
        hookEventName: 'PostToolUse',
        providerSessionId: 'codex-session-4',
        turnId: 'turn_4',
        toolName: 'Bash',
        toolUseId: 'tooluse_def',
        model: 'o3'
      }
    })
  })

  test('adapts Codex Stop hook into turn completed state patch event', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'Stop',
        session_id: 'codex-session-5',
        turn_id: 'turn_5',
        last_assistant_message: 'Implementation complete.'
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
      },
      evidence: {
        rawSource: {
          provider: 'codex',
          channel: 'hook',
          rawEventName: 'Stop'
        },
        hookEventName: 'Stop',
        providerSessionId: 'codex-session-5',
        turnId: 'turn_5',
        lastAssistantMessage: 'Implementation complete.'
      }
    })
  })

  test('normalizes documented nullable Codex hook fields to absence', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'Stop',
        session_id: 'codex-session-nullable',
        turn_id: 'turn-nullable',
        transcript_path: null,
        last_assistant_message: null
      },
      codexContext
    )

    expect(event).toMatchObject({
      event_type: 'codex.Stop',
      payload: {
        intent: 'agent.turn_completed',
        agentState: 'idle',
        hasUnseenCompletion: true,
        summary: 'Stop',
        externalSessionId: 'codex-session-nullable'
      },
      evidence: {
        rawSource: {
          provider: 'codex',
          channel: 'hook',
          rawEventName: 'Stop'
        },
        hookEventName: 'Stop',
        providerSessionId: 'codex-session-nullable',
        turnId: 'turn-nullable'
      }
    })
    expect(event?.evidence).not.toHaveProperty('transcriptPath')
    expect(event?.evidence).not.toHaveProperty('lastAssistantMessage')
  })

  test('throws when a recognized Codex hook contains malformed evidence fields', () => {
    expect(() => adaptCodexHook(
      {
        hook_event_name: 'PreToolUse',
        turn_id: 123,
        tool_name: 'Write'
      },
      codexContext
    )).toThrow('Invalid Codex hook evidence')
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
