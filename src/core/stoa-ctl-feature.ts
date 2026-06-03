import { EventEmitter } from 'node:events'
import type { AppSettings } from '@shared/project-session'

export function isStoaCtlEnabled(settings: AppSettings): boolean {
  return settings.stoaCtlEnabled === true
}

export interface StoaCtlGate {
  isEnabled(): boolean
  setEnabled(value: boolean): Promise<void>
  on(event: 'enabledChanged', listener: (enabled: boolean) => void): () => void
}

export function createStoaCtlGate(initial: boolean): StoaCtlGate {
  const emitter = new EventEmitter()
  let current = initial === true

  return {
    isEnabled: () => current,
    async setEnabled(value: boolean): Promise<void> {
      const next = value === true
      if (next === current) return
      current = next
      emitter.emit('enabledChanged', current)
    },
    on(event: 'enabledChanged', listener: (enabled: boolean) => void): () => void {
      emitter.on(event, listener)
      return () => emitter.off(event, listener)
    }
  }
}

let cachedGate: StoaCtlGate | null = null

export function getStoaCtlGate(): StoaCtlGate {
  if (!cachedGate) {
    cachedGate = createStoaCtlGate(false)
  }
  return cachedGate
}

export function setStoaCtlGate(gate: StoaCtlGate | null): void {
  cachedGate = gate
}
