import { describe, expect, it } from 'vitest'
import { stoactlDisableCleanupJourney, stoactlEnvStrippedJourney } from './stoactl-lifecycle.journey'
import { stoactlTopology } from '../topology/stoactl-topology'

describe('stoactl-lifecycle journeys', () => {
  it('disableCleanup journey has all required fields', () => {
    expect(stoactlDisableCleanupJourney.id).toBe('stoactl.disableCleanup')
    expect(stoactlDisableCleanupJourney.behavior).toBe('stoactl.disableCleanup')
    expect(stoactlDisableCleanupJourney.usageMode).toBe('deactivation')
    expect(stoactlDisableCleanupJourney.setup.length).toBeGreaterThan(0)
    expect(stoactlDisableCleanupJourney.act.length).toBeGreaterThan(0)
    expect(stoactlDisableCleanupJourney.assert.length).toBeGreaterThan(0)
    expect(stoactlDisableCleanupJourney.variants.length).toBeGreaterThan(0)
  })

  it('disableCleanup journey references setup with enabled precondition', () => {
    expect(stoactlDisableCleanupJourney.setup).toContain('settings.stoaCtlEnabled=true')
    expect(stoactlDisableCleanupJourney.setup).toContain('shim.present')
    expect(stoactlDisableCleanupJourney.assert).toContain('shim.absent')
    expect(stoactlDisableCleanupJourney.assert).toContain('http.ctlReturns503')
  })

  it('envStripped journey has all required fields', () => {
    expect(stoactlEnvStrippedJourney.id).toBe('stoactl.envStrippedWhenDisabled')
    expect(stoactlEnvStrippedJourney.behavior).toBe('stoactl.envStrippedWhenDisabled')
    expect(stoactlEnvStrippedJourney.usageMode).toBe('session-startup')
    expect(stoactlEnvStrippedJourney.setup.length).toBeGreaterThan(0)
    expect(stoactlEnvStrippedJourney.act.length).toBeGreaterThan(0)
    expect(stoactlEnvStrippedJourney.assert.length).toBeGreaterThan(0)
    expect(stoactlEnvStrippedJourney.variants.length).toBeGreaterThan(0)
  })

  it('envStripped journey references the same topology surface', () => {
    expect(stoactlTopology.surface).toBe('stoactl-lifecycle')
    expect(stoactlTopology.testIds.settingsStoactlToggle).toContain('settings-stoactl-toggle')
    expect(stoactlTopology.testIds.settingsAdvancedTab).toContain('advanced')
  })
})
