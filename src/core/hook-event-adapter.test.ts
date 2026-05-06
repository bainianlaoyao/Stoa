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

  test('adapts Claude SessionStart hook into runtime alive canonical event', () => {
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
      event_type: 'claude-code.SessionStart',
      session_id: 'session_internal_1',
      project_id: 'project_internal_1',
      source: 'provider-adapter',
      payload: {
        intent: 'runtime.alive',
        summary: 'SessionStart',
        externalSessionId: 'claude-external-1'
      },
      evidence: {
        rawSource: {
          provider: 'claude-code',
          channel: 'hook',
          rawEventName: 'SessionStart'
        },
        hookEventName: 'SessionStart',
        providerSessionId: 'claude-external-1'
      }
    })
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

  test('adapts Claude PostToolUse hook into tool completed canonical event', () => {
    const event = adaptClaudeCodeHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_use_id: 'tool-1'
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
        summary: 'PostToolUse'
      },
      evidence: {
        hookEventName: 'PostToolUse',
        toolName: 'Write',
        toolUseId: 'tool-1'
      }
    })
  })

  test('adapts Claude PreToolUse with AskUserQuestion tool as permission_requested with elicitation blocking reason', () => {
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
        summary: 'PreToolUse',
        blockingReason: 'elicitation',
        toolName: 'AskUserQuestion'
      },
      evidence: {
        toolName: 'AskUserQuestion'
      }
    })
  })
})

describe('codex hook adapter', () => {
  const codexContext = { sessionId: 'codex_session_1', projectId: 'codex_project_1' }

  test('adapts Codex SessionStart hook into runtime alive state patch event', () => {
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
      event_type: 'codex.SessionStart',
      session_id: 'codex_session_1',
      project_id: 'codex_project_1',
      source: 'provider-adapter',
      payload: {
        intent: 'runtime.alive',
        sourceTurnId: 'turn_1',
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
    expect(event?.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
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
      event_type: 'codex.UserPromptSubmit',
      session_id: 'codex_session_1',
      project_id: 'codex_project_1',
      source: 'provider-adapter',
      payload: {
        intent: 'agent.turn_started',
        sourceTurnId: 'turn_2',
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
    expect(event?.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
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
      event_type: 'codex.PreToolUse',
      session_id: 'codex_session_1',
      project_id: 'codex_project_1',
      source: 'provider-adapter',
      payload: {
        intent: 'agent.tool_started',
        sourceTurnId: 'turn_3',
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
    expect(event?.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
  })

  test('adapts Codex PostToolUse hook into tool completed state patch event with toolName and toolUseId', () => {
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
      event_type: 'codex.PostToolUse',
      session_id: 'codex_session_1',
      project_id: 'codex_project_1',
      source: 'provider-adapter',
      payload: {
        intent: 'agent.tool_completed',
        sourceTurnId: 'turn_4',
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
    expect(event?.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
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
      event_type: 'codex.Stop',
      session_id: 'codex_session_1',
      project_id: 'codex_project_1',
      source: 'provider-adapter',
      payload: {
        intent: 'agent.turn_completed',
        sourceTurnId: 'turn_5',
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
    expect(event?.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
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
        sourceTurnId: 'turn-nullable',
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

  test('does not treat legacy thread_id as external session id', () => {
    const event = adaptCodexHook(
      {
        hook_event_name: 'SessionStart',
        thread_id: 'legacy-thread-1'
      },
      codexContext
    )

    expect(event).toMatchObject({
      event_type: 'codex.SessionStart',
      payload: {
        intent: 'runtime.alive',
        summary: 'SessionStart'
      }
    })
    expect(event?.payload).not.toHaveProperty('externalSessionId')
    expect(event?.evidence).not.toHaveProperty('providerSessionId')
  })
})
