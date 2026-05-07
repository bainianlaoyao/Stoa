export interface CachedLink {
  path: string
  exists: boolean
}

export class LinkCache {
  private readonly _cache = new Map<string, CachedLink>()
  private _timeoutId: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly _ttlMs: number) {}

  set(key: string, value: CachedLink): void {
    this._cache.set(key, value)
    this._resetTtl()
  }

  get(key: string): CachedLink | undefined {
    return this._cache.get(key)
  }

  clear(): void {
    this._cache.clear()
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId)
      this._timeoutId = null
    }
  }

  dispose(): void {
    this.clear()
  }

  private _resetTtl(): void {
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId)
    }
    this._timeoutId = setTimeout(() => this._cache.clear(), this._ttlMs)
  }
}
