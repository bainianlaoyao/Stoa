export interface SessionDimensions {
  cols: number
  rows: number
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
