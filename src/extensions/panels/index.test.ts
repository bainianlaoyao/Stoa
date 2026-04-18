import { describe, expect, test } from 'vitest'
import { listPanels } from './index'

describe('panel registry', () => {
  test('exposes white-box panels through a controlled registry surface', () => {
    const panels = listPanels()

    expect(panels).toHaveLength(1)
    expect(panels[0]?.panelId).toBe('workspace-debug-summary')
    expect(panels[0]?.renderSummary({ activeWorkspaceId: 'ws_demo_001', workspaceCount: 2 })).toContain('active=ws_demo_001')
  })
})
