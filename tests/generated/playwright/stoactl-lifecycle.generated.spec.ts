// AUTO-GENERATED FILE. DO NOT EDIT.
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { defineGeneratedTestMeta } from '../../../testing/contracts/testing-contracts'
import {
  cleanupStateDir,
  getMainE2EDebugState,
  launchElectronApp
} from '../../e2e-playwright/fixtures/electron-app'
import { createProject, createSession } from '../../e2e-playwright/helpers/ui-actions'

export const meta = defineGeneratedTestMeta({
  id: 'journey.stoactl.disableCleanup',
  behaviorIds: ['stoactl.disableCleanup', 'stoactl.envStrippedWhenDisabled'],
  entities: ['settings', 'shim', 'path', 'http-control-plane', 'session-env'],
  statesCovered: ['shim.absent', 'path.binDirUnregistered', 'http.ctlReturns503', 'env.STOA_CTL_COMMAND.absent'],
  interruptionsCovered: [],
  observationLayers: ['main-debug-state'],
  riskBudget: 'high',
  regressionSources: ['stoa-ctl-feature-gate', 'session-control-server']
})

test('journey.stoactl.disableCleanup', async () => {
  const app = await launchElectronApp()

  try {
    const projectRow = await createProject(app, {
      name: 'generated-stoactl-lifecycle-project',
      path: join(app.stateDir, 'generated-stoactl-lifecycle-project')
    })

    await createSession(app.page, projectRow, {
      type: 'shell'
    })

    const debugState = await getMainE2EDebugState(app.electronApp)
    const webhookPort = debugState?.webhookPort
    expect(webhookPort).toBeTruthy()

    const settingsToggle = app.page.getByTestId('settings-stoactl-toggle')
    await app.page.getByTestId('settings-tab-advanced').click()
    await expect(settingsToggle).toBeVisible()
    await settingsToggle.click()

    const healthResponse = await fetch(`http://127.0.0.1:${webhookPort}/ctl/health`)
    expect(healthResponse.status).toBe(503)
    const body = await healthResponse.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('disabled')
  } finally {
    const { stateDir } = app
    await app.close()
    await cleanupStateDir(stateDir)
  }
})
