import { describe, expect, test, vi } from 'vitest'
import { MemoryRuntime } from './runtime'

describe('MemoryRuntime', () => {
  test('schedules maintainer work only for completed turns', async () => {
    const processTurnCompletion = vi.fn(async () => {})
    const runtime = new MemoryRuntime({ processTurnCompletion })

    runtime.notifyTurnCompleted({
      projectPath: 'C:/repo',
      event: {
        event_version: 1,
        event_id: 'evt-1',
        event_type: 'codex.Stop',
        timestamp: '2026-04-28T00:00:00.000Z',
        session_id: 'session-1',
        project_id: 'project-1',
        source: 'provider-adapter',
        payload: {
          intent: 'agent.tool_started',
          agentState: 'working',
          summary: 'tool'
        }
      }
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(processTurnCompletion).not.toHaveBeenCalled()

    runtime.notifyTurnCompleted({
      projectPath: 'C:/repo',
      event: {
        event_version: 1,
        event_id: 'evt-2',
        event_type: 'codex.Stop',
        timestamp: '2026-04-28T00:00:01.000Z',
        session_id: 'session-1',
        project_id: 'project-1',
        source: 'provider-adapter',
        payload: {
          intent: 'agent.turn_completed',
          agentState: 'idle',
          hasUnseenCompletion: true,
          summary: 'done'
        }
      }
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(processTurnCompletion).toHaveBeenCalledTimes(1)
  })

  test('preserves per-session ordering and continues after failures', async () => {
    const callOrder: string[] = []
    let releaseFirst!: () => void
    const firstStarted = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const processTurnCompletion = vi.fn(async (input: { event: { event_id: string } }) => {
      callOrder.push(input.event.event_id)
      if (input.event.event_id === 'evt-1') {
        await firstStarted
        throw new Error('boom')
      }
    })
    const runtime = new MemoryRuntime({ processTurnCompletion })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      runtime.notifyTurnCompleted({
        projectPath: 'C:/repo',
        event: completedEvent('evt-1')
      })
      runtime.notifyTurnCompleted({
        projectPath: 'C:/repo',
        event: completedEvent('evt-2')
      })

      await new Promise(resolve => setTimeout(resolve, 0))
      expect(callOrder).toEqual(['evt-1'])

      releaseFirst()
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(callOrder).toEqual(['evt-1', 'evt-2'])
      expect(consoleError).toHaveBeenCalledWith(
        '[memory-runtime] Failed to process turn completion for session session-1:',
        expect.any(Error)
      )
    } finally {
      consoleError.mockRestore()
    }
  })
})

function completedEvent(eventId: string) {
  return {
    event_version: 1 as const,
    event_id: eventId,
    event_type: 'codex.Stop',
    timestamp: '2026-04-28T00:00:00.000Z',
    session_id: 'session-1',
    project_id: 'project-1',
    source: 'provider-adapter' as const,
    payload: {
      intent: 'agent.turn_completed' as const,
      agentState: 'idle' as const,
      hasUnseenCompletion: true,
      summary: 'done'
    }
  }
}
