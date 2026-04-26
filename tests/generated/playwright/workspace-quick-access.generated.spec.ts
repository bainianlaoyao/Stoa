// AUTO-GENERATED FILE. DO NOT EDIT.
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { defineGeneratedTestMeta } from '../../../testing/contracts/testing-contracts'
import {
  cleanupStateDir,
  clearWorkspaceOpenRequests,
  getMainE2EDebugState,
  getWorkspaceOpenRequests,
  launchElectronApp
} from '../../e2e-playwright/fixtures/electron-app'
import { createProject, createSession } from '../../e2e-playwright/helpers/ui-actions'

export const meta = defineGeneratedTestMeta({
  id: 'journey.workspace.quick-access.actions',
  behaviorIds: ['workspace.quickAccess'],
  entities: ['project', 'session', 'workspace-path', 'ide-settings'],
  statesCovered: ['workspace.open.ide', 'workspace.open.file-manager'],
  interruptionsCovered: [],
  observationLayers: ['ui', 'renderer-store', 'main-debug-state'],
  riskBudget: 'high',
  regressionSources: ['workspace-open-ipc', 'terminal-quick-actions']
})

test('journey.workspace.quick-access.actions', async () => {
  const app = await launchElectronApp()

  try {
    const projectRow = await createProject(app, {
      name: 'generated-workspace-quick-access-project',
      path: join(app.stateDir, 'generated-workspace-quick-access-project')
    })

    await createSession(app.page, projectRow, {
      type: 'shell'
    })

    const debugState = await getMainE2EDebugState(app.electronApp)
    const sessionId = debugState?.snapshot?.activeSessionId
    expect(sessionId).toBeTruthy()

    await clearWorkspaceOpenRequests(app.electronApp)

    await expect(app.page.getByTestId('workspace.quick-actions')).toBeVisible()
    await app.page.getByTestId('workspace.open-ide').click()
    await app.page.getByTestId('workspace.open-file-manager').click()

    await expect.poll(async () => {
      return await getWorkspaceOpenRequests(app.electronApp)
    }).toEqual([
      { sessionId, target: 'ide' },
      { sessionId, target: 'file-manager' }
    ])
  } finally {
    const { stateDir } = app
    await app.close()
    await cleanupStateDir(stateDir)
  }
})
