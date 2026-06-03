import { describe, expect, it } from 'vitest'
import {
  stoactlDisabledAtStartup,
  stoactlDisableCleanup,
  stoactlEnableThenRestart,
  stoactlEnvStrippedWhenDisabled,
  stoactlHttp503WhenDisabled
} from './stoactl-lifecycle'

describe('stoactl-lifecycle behaviors', () => {
  it('declares 5 distinct behavior ids under the stoactl namespace', () => {
    const ids = [
      stoactlDisabledAtStartup.id,
      stoactlEnableThenRestart.id,
      stoactlDisableCleanup.id,
      stoactlHttp503WhenDisabled.id,
      stoactlEnvStrippedWhenDisabled.id
    ]
    expect(new Set(ids).size).toBe(5)
    expect(ids.every((id) => id.startsWith('stoactl.'))).toBe(true)
  })

  it('every behavior has non-empty risk, coverageBudget, preconditions, and expects', () => {
    const all = [
      stoactlDisabledAtStartup,
      stoactlEnableThenRestart,
      stoactlDisableCleanup,
      stoactlHttp503WhenDisabled,
      stoactlEnvStrippedWhenDisabled
    ]
    for (const b of all) {
      expect(b.risk).toBeDefined()
      expect(['low', 'medium', 'high']).toContain(b.risk)
      expect(b.coverageBudget).toBeDefined()
      expect(['minimal', 'standard', 'high', 'critical']).toContain(b.coverageBudget)
      expect(b.preconditions.length).toBeGreaterThan(0)
      expect(b.expects.length).toBeGreaterThan(0)
      expect(b.observationLayers.length).toBeGreaterThan(0)
    }
  })

  it('observationLayers are restricted to the contract enum', () => {
    const all = [
      stoactlDisabledAtStartup,
      stoactlEnableThenRestart,
      stoactlDisableCleanup,
      stoactlHttp503WhenDisabled,
      stoactlEnvStrippedWhenDisabled
    ]
    const allowed = new Set(['ui', 'renderer-store', 'main-debug-state', 'persisted-state'])
    for (const b of all) {
      for (const layer of b.observationLayers) {
        expect(allowed.has(layer)).toBe(true)
      }
    }
  })

  it('actor is restricted to user or system', () => {
    const all = [
      stoactlDisabledAtStartup,
      stoactlEnableThenRestart,
      stoactlDisableCleanup,
      stoactlHttp503WhenDisabled,
      stoactlEnvStrippedWhenDisabled
    ]
    for (const b of all) {
      expect(['user', 'system']).toContain(b.actor)
    }
  })

  it('boot-time behaviors declare system as the actor', () => {
    expect(stoactlDisabledAtStartup.actor).toBe('system')
    expect(stoactlHttp503WhenDisabled.actor).toBe('system')
    expect(stoactlEnvStrippedWhenDisabled.actor).toBe('system')
  })
})
