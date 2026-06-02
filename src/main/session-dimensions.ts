export interface SessionDimensions {
  cols: number
  rows: number
}

export type PartialSessionDimensions = Partial<SessionDimensions>

export function mergeSessionDimensions(
  remembered: SessionDimensions | null | undefined,
  explicit: PartialSessionDimensions | null | undefined
): PartialSessionDimensions | undefined {
  if (!remembered && !explicit) {
    return undefined
  }

  const merged: PartialSessionDimensions = remembered ? { ...remembered } : {}
  if (explicit?.cols !== undefined) {
    merged.cols = explicit.cols
  }
  if (explicit?.rows !== undefined) {
    merged.rows = explicit.rows
  }
  return merged
}

export class SessionDimensionsRegistry {
  private readonly dimensions = new Map<string, SessionDimensions>()

  get(sessionId: string): SessionDimensions | null {
    const dimensions = this.dimensions.get(sessionId)
    return dimensions ? { ...dimensions } : null
  }

  set(sessionId: string, dimensions: SessionDimensions): void {
    this.dimensions.set(sessionId, { ...dimensions })
  }
}
