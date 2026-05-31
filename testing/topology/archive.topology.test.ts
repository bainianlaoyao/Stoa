import { describe, expect, it } from 'vitest'
import { archiveTopology } from './archive.topology'

describe('archive topology', () => {
  it('declares stable archived-session restore controls inside the command surface', () => {
    expect(archiveTopology.surface).toBe('command')
    expect(archiveTopology.testIds.root).toBe('command-panel')
    expect(archiveTopology.testIds.sessionRow).toBe('archive.session.row')
    expect(archiveTopology.testIds.restoreButton).toBe('archive.session.restore')
  })
})
