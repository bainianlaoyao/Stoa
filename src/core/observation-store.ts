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
  private readonly events: ObservationEvent[] = []

  append(event: ObservationEvent): boolean {
    if (this.eventIds.has(event.eventId)) {
      return false
    }

    this.eventIds.add(event.eventId)
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
  const filteredEvents = events.filter((event) => {
    if (!options.includeEphemeral && event.retention === 'ephemeral') {
      return false
    }

    return !options.categories?.length || options.categories.includes(event.category)
  })
  const startIndex = parseCursor(options.cursor)
  const limit = Math.max(0, options.limit)
  const page = filteredEvents.slice(startIndex, startIndex + limit)
  const nextIndex = startIndex + page.length

  return {
    events: page,
    nextCursor: nextIndex < filteredEvents.length ? String(nextIndex) : null
  }
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0
  }

  const parsed = Number.parseInt(cursor, 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
