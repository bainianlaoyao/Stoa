import type { ListObservationEventsOptions, ListObservationEventsResult } from './observation-store'
import { appendSection, stripAnsi, trimTextToMaxChars } from './context/full-text-context'
import type { SessionPresenceSnapshot } from '@shared/observability'
import type { BootstrapState, SessionSummary } from '@shared/project-session'

interface SnapshotSource {
  snapshot(): BootstrapState
}

interface HermesContextAssemblerOptions {
  snapshotSource: SnapshotSource
  getSessionPresence: (sessionId: string) => SessionPresenceSnapshot | null
  listSessionEvents: (sessionId: string, options?: ListObservationEventsOptions) => ListObservationEventsResult
  getTerminalReplay: (sessionId: string) => Promise<string>
}

type FullContextResult = {
  text: string
  truncated: boolean
  nextCursor: string | null
}

function readableTextFromPayload(payload: Record<string, unknown>): Array<{ label: string; text: string }> {
  const evidence = (payload.evidence && typeof payload.evidence === 'object')
    ? payload.evidence as Record<string, unknown>
    : null
  const entries: Array<{ label: string; text: string }> = []

  if (evidence && typeof evidence.promptText === 'string' && evidence.promptText.trim()) {
    entries.push({ label: 'User', text: evidence.promptText })
  }

  if (evidence && typeof evidence.lastAssistantMessage === 'string' && evidence.lastAssistantMessage.trim()) {
    entries.push({ label: 'Assistant', text: evidence.lastAssistantMessage })
  }

  if (typeof payload.summary === 'string' && payload.summary.trim()) {
    entries.push({ label: 'Event', text: payload.summary })
  }

  if (typeof payload.snippet === 'string' && payload.snippet.trim()) {
    entries.push({ label: 'Assistant', text: payload.snippet })
  }

  return entries
}

export class HermesContextAssembler {
  constructor(private readonly options: HermesContextAssemblerOptions) {}

  getEvents(
    sessionId: string,
    options: Partial<ListObservationEventsOptions> = {}
  ): ListObservationEventsResult {
    this.requireSession(sessionId)
    return this.options.listSessionEvents(sessionId, {
      limit: options.limit ?? 50,
      cursor: options.cursor,
      categories: options.categories,
      includeEphemeral: options.includeEphemeral ?? false
    })
  }

  getStatus(sessionId: string): { level: 'status'; session: SessionSummary; presence: SessionPresenceSnapshot | null } {
    const session = this.requireSession(sessionId)
    return {
      level: 'status',
      session,
      presence: this.options.getSessionPresence(sessionId)
    }
  }

  getBundle(sessionId: string): {
    level: 'bundle'
    session: SessionSummary
    presence: SessionPresenceSnapshot | null
    events: ListObservationEventsResult['events']
  } {
    const session = this.requireSession(sessionId)
    return {
      level: 'bundle',
      session,
      presence: this.options.getSessionPresence(sessionId),
      events: this.getEvents(sessionId, {
        limit: 100,
        includeEphemeral: true
      }).events
    }
  }

  async getFullContext(
    sessionId: string,
    input: { maxChars?: number; cursor?: string | null } = {}
  ): Promise<FullContextResult> {
    const lines: string[] = []
    this.requireSession(sessionId)

    for (const event of this.getEvents(sessionId, {
      limit: 100,
      includeEphemeral: true
    }).events) {
      for (const entry of readableTextFromPayload(event.payload)) {
        appendSection(lines, entry.label, entry.text)
      }
    }

    appendSection(lines, 'Terminal', stripAnsi(await this.options.getTerminalReplay(sessionId)))

    const rawText = lines.join('\n').trim()
    const { text, truncated } = trimTextToMaxChars(rawText, input.maxChars ?? 100_000)
    return {
      text,
      truncated,
      nextCursor: truncated ? 'tail-truncated' : null
    }
  }

  async getSlimContext(
    sessionId: string,
    input: { maxChars?: number; cursor?: string | null } = {}
  ): Promise<FullContextResult> {
    this.requireSession(sessionId)
    const lines: string[] = []

    for (const event of this.getEvents(sessionId, {
      limit: 100,
      includeEphemeral: true
    }).events) {
      const payload = event.payload as Record<string, unknown>
      const evidence = (payload.evidence && typeof payload.evidence === 'object')
        ? payload.evidence as Record<string, unknown>
        : null

      if (evidence && typeof evidence.promptText === 'string' && evidence.promptText.trim()) {
        appendSection(lines, 'User', evidence.promptText)
      }

      const assistantText = (evidence && typeof evidence.lastAssistantMessage === 'string' && evidence.lastAssistantMessage.trim())
        ? evidence.lastAssistantMessage
        : (typeof payload.snippet === 'string' && payload.snippet.trim() ? payload.snippet : null)

      if (assistantText) {
        appendSection(lines, 'Assistant', assistantText)
      }
    }

    const rawText = lines.join('\n').trim()
    const { text, truncated } = trimTextToMaxChars(rawText, input.maxChars ?? 100_000)
    return {
      text,
      truncated,
      nextCursor: truncated ? 'tail-truncated' : null
    }
  }

  private requireSession(sessionId: string): SessionSummary {
    const session = this.options.snapshotSource.snapshot().sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`)
    }
    return session
  }
}
