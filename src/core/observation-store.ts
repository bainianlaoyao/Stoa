import type { ObservationCategory, ObservationEvent } from '../shared/observability'

export interface ListObservationEventsOptions {
  limit: number
  cursor?: string
  categories?: ObservationCategory[]
  includeEphemeral?: boolean
}

export interface ListObservationEventsResult {
  events: ObservationEvent[]
  nextCursor: string | null
}

export interface ObservationStore {
  append(event: ObservationEvent): boolean
  listSessionEvents(sessionId: string, options: ListObservationEventsOptions): ListObservationEventsResult
  listProjectEvents(projectId: string, options: ListObservationEventsOptions): ListObservationEventsResult
}

export class InMemoryObservationStore implements ObservationStore {
  private readonly eventIds = new Set<string>()
  private readonly dedupeKeys = new Set<string>()
  private readonly events: ObservationEvent[] = []
  private nextSequence = 1

  append(event: ObservationEvent): boolean {
    if (this.eventIds.has(event.eventId)) {
      return false
    }

    if (event.dedupeKey && this.dedupeKeys.has(event.dedupeKey)) {
      return false
    }

    event.sequence = event.sequence > 0 ? event.sequence : this.nextSequence
    this.nextSequence = Math.max(this.nextSequence, event.sequence + 1)
    this.eventIds.add(event.eventId)
    if (event.dedupeKey) {
      this.dedupeKeys.add(event.dedupeKey)
    }
    this.events.push(event)

    return true
  }

  listSessionEvents(sessionId: string, options: ListObservationEventsOptions): ListObservationEventsResult {
    return paginateEvents(
      this.events.filter((event) => event.sessionId === sessionId),
      options
    )
  }

  listProjectEvents(projectId: string, options: ListObservationEventsOptions): ListObservationEventsResult {
    return paginateEvents(
      this.events.filter((event) => event.projectId === projectId),
      options
    )
  }
}

function paginateEvents(events: ObservationEvent[], options: ListObservationEventsOptions): ListObservationEventsResult {
  const cursorSequence = parseCursor(options.cursor)
  const filteredEvents = events.filter((event) => {
    if (event.sequence <= cursorSequence) {
      return false
    }

    if (!options.includeEphemeral && event.retention === 'ephemeral') {
      return false
    }

    return !options.categories?.length || options.categories.includes(event.category)
  })
  const limit = Math.max(0, options.limit)
  const page = filteredEvents.slice(0, limit)
  const nextEvent = page[page.length - 1]

  return {
    events: page,
    nextCursor: page.length < filteredEvents.length && nextEvent ? String(nextEvent.sequence) : null
  }
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0
  }

  const parsed = Number.parseInt(cursor, 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
