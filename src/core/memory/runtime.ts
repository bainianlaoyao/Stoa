import type { CanonicalSessionEvent } from '@shared/project-session'
import type { EvolverMaintainer } from './evolver-maintainer'

interface RuntimeInput {
  projectPath: string
  event: CanonicalSessionEvent
}

interface MaintainerLike {
  processTurnCompletion: EvolverMaintainer['processTurnCompletion']
}

export class MemoryRuntime {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(private readonly maintainer: MaintainerLike) {}

  notifyTurnCompleted(input: RuntimeInput): void {
    if (input.event.payload.intent !== 'agent.turn_completed') {
      return
    }

    const sessionId = input.event.session_id
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const next = previous
      .catch(() => {
        // Preserve per-session ordering even if a prior run failed.
      })
      .then(async () => {
        try {
          await this.maintainer.processTurnCompletion(input)
        } catch (error) {
          console.error(
            `[memory-runtime] Failed to process turn completion for session ${sessionId}:`,
            error
          )
        }
      })

    this.queues.set(sessionId, next)
    next.finally(() => {
      if (this.queues.get(sessionId) === next) {
        this.queues.delete(sessionId)
      }
    })
  }
}
