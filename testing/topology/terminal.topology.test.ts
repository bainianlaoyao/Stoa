import { describe, expect, it } from 'vitest'
import { terminalTopology } from './terminal.topology'

describe('terminal topology', () => {
  it('declares stable workspace quick access hooks', () => {
    expect(terminalTopology.testIds.workspaceQuickActions).toBe('workspace.quick-actions')
    expect(terminalTopology.testIds.openIde).toBe('workspace.open-ide')
    expect(terminalTopology.testIds.openFileManager).toBe('workspace.open-file-manager')
  })
})
