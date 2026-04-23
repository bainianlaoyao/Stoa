import { describe, expect, it } from 'vitest'
import { sessionRestoreBehavior } from '../behavior/session.behavior'
import { sessionRestoreJourney } from '../journeys/session-restore.journey'
import { archiveTopology } from '../topology/archive.topology'
import { generatePlaywrightSkeleton } from './generate-playwright'

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
    expect(generated).toContain("app.page.getByRole('button', { name: 'Archive' }).click()")
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
})
