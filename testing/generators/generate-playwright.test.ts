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
    expect(generated).toContain("test('journey.session.restore.base'")
    expect(generated).toContain("page.getByTestId('surface.archive')")
    expect(generated).toContain("page.getByTestId('archive.session.restore')")
    expect(generated).toContain('await expect(root).toBeVisible()')
    expect(generated).toContain('await restoreButton.click()')
    expect(generated).toContain('await expect(sessionRow).toHaveCount(0)')
    expect(generated.indexOf('await expect(root).toBeVisible()')).toBeLessThan(
      generated.indexOf('await restoreButton.click()')
    )
    expect(generated.indexOf('await restoreButton.click()')).toBeLessThan(
      generated.indexOf('await expect(sessionRow).toHaveCount(0)')
    )
  })
})
