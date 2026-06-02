import { describe, expect, it } from 'vitest'
import { archiveTopology } from './archive.topology'

describe('archive topology', () => {
  it('declares stable archived-session restore controls inside the archive surface', () => {
    expect(archiveTopology.surface).toBe('archive')
    expect(archiveTopology.testIds.root).toBe('surface.archive')
    expect(archiveTopology.testIds.sessionRow).toBe('archive.session.row')
    expect(archiveTopology.testIds.restoreButton).toBe('archive.session.restore')
  })
})
