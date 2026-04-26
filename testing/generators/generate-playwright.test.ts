import { describe, expect, it } from 'vitest'
import { sessionRestoreBehavior } from '../behavior/session.behavior'
import { sessionRestoreJourney } from '../journeys/session-restore.journey'
import { archiveTopology } from '../topology/archive.topology'
import {
  generateClaudeLifecyclePlaywrightSkeleton,
  generatePlaywrightSkeleton,
  generateWorkspaceQuickAccessPlaywrightSkeleton
} from './generate-playwright'

describe('playwright skeleton generator', () => {
  it('generates a deterministic session restore skeleton', () => {
    const generated = generatePlaywrightSkeleton({
      behavior: sessionRestoreBehavior,
      topology: archiveTopology,
      journey: sessionRestoreJourney
    })

    expect(generated).toContain('AUTO-GENERATED FILE. DO NOT EDIT.')
    expect(generated).toContain("behaviorIds: ['session.restore']")
    expect(generated).toContain("observationLayers: ['ui']")
    expect(generated).not.toContain("'main-debug-state'")
    expect(generated).not.toContain("'persisted-state'")
    expect(generated).toContain("import { join } from 'node:path'")
    expect(generated).toContain("import { cleanupStateDir, launchElectronApp } from '../../e2e-playwright/fixtures/electron-app'")
    expect(generated).toContain("import { createProject, createSession } from '../../e2e-playwright/helpers/ui-actions'")
    expect(generated).toContain("test('journey.session.restore.base'")
    expect(generated).toContain('const app = await launchElectronApp()')
    expect(generated).toContain('const projectRow = await createProject(app,')
    expect(generated).toContain('const session = await createSession(app.page, projectRow')
    expect(generated).toContain("app.page.getByRole('button', { name: `Archive ${session.title}` }).click()")
    expect(generated).not.toContain("app.page.getByRole('button', { name: 'Archive' }).click()")
    expect(generated).toContain("app.page.locator('[data-activity-item=\"archive\"]').click()")
    expect(generated).toContain("app.page.getByTestId('surface.archive')")
    expect(generated).toContain("app.page.getByTestId('archive.session.restore')")
    expect(generated).toContain('await expect(root).toBeVisible()')
    expect(generated).toContain('await expect(sessionRow).toHaveCount(1)')
    expect(generated).toContain('await restoreButton.click()')
    expect(generated).toContain('await expect(sessionRow).toHaveCount(0)')
    expect(generated.indexOf('await expect(root).toBeVisible()')).toBeLessThan(
      generated.indexOf('await expect(sessionRow).toHaveCount(1)')
    )
    expect(generated.indexOf('await expect(sessionRow).toHaveCount(1)')).toBeLessThan(
      generated.indexOf('await restoreButton.click()')
    )
    expect(generated.indexOf('await restoreButton.click()')).toBeLessThan(
      generated.indexOf('await expect(sessionRow).toHaveCount(0)')
    )
    expect(generated).toContain('await app.close()')
    expect(generated).toContain('await cleanupStateDir(stateDir)')
  })

  it('generates a deterministic Claude lifecycle skeleton', () => {
    const generated = generateClaudeLifecyclePlaywrightSkeleton()

    expect(generated).toContain('AUTO-GENERATED FILE. DO NOT EDIT.')
    expect(generated).toContain("id: 'journey.session.telemetry.claude-lifecycle'")
    expect(generated).toContain("'session.presence.ready'")
    expect(generated).toContain("'session.presence.running'")
    expect(generated).toContain("'session.presence.blocked'")
    expect(generated).toContain("'session.presence.complete'")
    expect(generated).toContain("'session.presence.failed'")
    expect(generated).toContain('installFakeClaude(app)')
    expect(generated).toContain("data-session-status-testid', 'session-status-ready'")
    expect(generated).toContain("data-session-status-testid', 'session-status-running'")
    expect(generated).toContain("data-session-status-testid', 'session-status-blocked'")
    expect(generated).toContain("data-session-status-testid', 'session-status-complete'")
    expect(generated).toContain("data-session-status-testid', 'session-status-failed'")
    expect(generated).toContain("body: { hook_event_name: 'PreToolUse' }")
    expect(generated).toContain("event_type: 'runtime.exited_failed'")
  })

  it('generates a deterministic workspace quick access skeleton', () => {
    const generated = generateWorkspaceQuickAccessPlaywrightSkeleton()

    expect(generated).toContain('AUTO-GENERATED FILE. DO NOT EDIT.')
    expect(generated).toContain("id: 'journey.workspace.quick-access.actions'")
    expect(generated).toContain("behaviorIds: ['workspace.quickAccess']")
    expect(generated).toContain("statesCovered: ['workspace.open.ide', 'workspace.open.file-manager']")
    expect(generated).toContain('clearWorkspaceOpenRequests')
    expect(generated).toContain('getWorkspaceOpenRequests')
    expect(generated).toContain("app.page.getByTestId('workspace.quick-actions')")
    expect(generated).toContain("app.page.getByTestId('workspace.open-ide').click()")
    expect(generated).toContain("app.page.getByTestId('workspace.open-file-manager').click()")
    expect(generated).toContain("{ sessionId, target: 'ide' }")
    expect(generated).toContain("{ sessionId, target: 'file-manager' }")
  })
})
