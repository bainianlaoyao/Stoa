import { describe, expect, it } from 'vitest'
import {
  mobileHealthJourney,
  mobileSearchJourney,
  mobileSessionCreationJourney,
  mobileTerminalControlsJourney,
  mobileUiV1Journey
} from './mobile-ui-v1.journey'

describe('mobile UI V1 journey', () => {
  it('maps the approved mobile drill-down path to executable assertions', () => {
    expect(mobileUiV1Journey.id).toBe('journey.mobile.ui-v1')
    expect(mobileUiV1Journey.behavior).toBe('mobile.drilldown')
    expect(mobileUiV1Journey.setup).toContain('viewport.mobile390x844')
    expect(mobileUiV1Journey.assert).toContain('desktop.rightSidebarAbsent')
    expect(mobileUiV1Journey.variants).toContain('844x390')
  })

  it('declares reachable journeys for search, creation, controls, and health', () => {
    expect(mobileSearchJourney.behavior).toBe('mobile.search')
    expect(mobileSessionCreationJourney.behavior).toBe('mobile.session.create')
    expect(mobileTerminalControlsJourney.behavior).toBe('mobile.terminal.controls')
    expect(mobileHealthJourney.behavior).toBe('mobile.health')
  })
})
