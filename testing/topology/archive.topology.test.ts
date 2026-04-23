import { describe, expect, it } from 'vitest'
import { archiveTopology } from './archive.topology'

describe('archive topology', () => {
  it('declares stable archive restore test ids', () => {
    expect(archiveTopology.surface).toBe('archive')
    expect(archiveTopology.testIds.root).toBe('surface.archive')
    expect(archiveTopology.testIds.sessionRow).toBe('archive.session.row')
    expect(archiveTopology.testIds.restoreButton).toBe('archive.session.restore')
  })
})
