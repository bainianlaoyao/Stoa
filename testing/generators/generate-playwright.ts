import type { BehaviorSpec, JourneySpec, TopologySpec } from '../contracts/testing-contracts'

export interface PlaywrightSkeletonInput {
  behavior: BehaviorSpec
  topology: TopologySpec
  journey: JourneySpec
}

export function generatePlaywrightSkeleton(input: PlaywrightSkeletonInput): string {
  const { behavior, topology, journey } = input
  const rootTestId = topology.testIds.root
  const restoreButtonTestId = topology.testIds.restoreButton
  const sessionRowTestId = topology.testIds.sessionRow

  return `// AUTO-GENERATED FILE. DO NOT EDIT.
import { expect, test } from '@playwright/test'
import { defineGeneratedTestMeta } from '../../../testing/contracts/testing-contracts'

export const meta = defineGeneratedTestMeta({
  id: '${journey.id}',
  behaviorIds: ['${behavior.id}'],
  entities: ['${behavior.entities.join("', '")}'],
  statesCovered: ['session.archived', 'session.running'],
  interruptionsCovered: [],
  observationLayers: ['${behavior.observationLayers.join("', '")}'],
  riskBudget: '${behavior.coverageBudget}',
  regressionSources: []
})

test('${journey.id}', async ({ page }) => {
  const root = page.getByTestId('${rootTestId}')
  const restoreButton = page.getByTestId('${restoreButtonTestId}')
  const sessionRow = page.getByTestId('${sessionRowTestId}')

  await expect(root).toBeVisible()
  await expect(restoreButton).toBeVisible()
  await expect(sessionRow).toHaveCount(0)
})
`
}
