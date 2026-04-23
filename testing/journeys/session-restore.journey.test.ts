import { describe, expect, it } from 'vitest'
import { sessionRestoreJourney } from './session-restore.journey'

describe('session restore journey', () => {
  it('links the restore journey to session.restore behavior', () => {
    expect(sessionRestoreJourney.id).toBe('journey.session.restore.base')
    expect(sessionRestoreJourney.behavior).toBe('session.restore')
    expect(sessionRestoreJourney.usageMode).toBe('recovery_workflow')
    expect(sessionRestoreJourney.act).toEqual(['open.archive.surface', 'click.archive.restore'])
    expect(sessionRestoreJourney.assert).toContain('persisted.sessionRestored')
    expect(sessionRestoreJourney.variants).toContain('base')
  })
})
