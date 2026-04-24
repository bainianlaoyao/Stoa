import { mkdir } from 'node:fs/promises'
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { SessionType } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import { queueNextFolderPick } from '../fixtures/electron-app'

type ElectronPageTarget = {
  page: Page
  electronApp: ElectronApplication
}

function resolveElectronPageTarget(target: Page | ElectronPageTarget): ElectronPageTarget {
  if ('page' in target && 'electronApp' in target) {
    return target
  }

  throw new Error('createProject requires the launched Electron app so the folder picker can be controlled in E2E mode.')
}

export async function createProject(target: Page | ElectronPageTarget, options: { name: string; path: string }): Promise<Locator> {
  const { page, electronApp } = resolveElectronPageTarget(target)
  await mkdir(options.path, { recursive: true })
  await queueNextFolderPick(electronApp, options.path)

  await page.locator('[data-testid="workspace.new-project"]').click()

  const dialog = page.getByTestId('modal-panel')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('form-input').fill(options.name)
  await dialog.getByTestId('path-field').getByRole('button').click()
  await expect(dialog.getByTestId('path-field').locator('input')).toHaveValue(options.path)
  await dialog.getByTestId('new-project.submit').click()

  const projectRow = page.locator(`[data-testid="project-row"][data-project-name="${options.name}"]`).first()
  await expect(projectRow).toBeVisible()
  return projectRow
}

export async function createSession(
  page: Page,
  projectRow: Locator,
  options: { type: SessionType }
): Promise<{ row: Locator; title: string }> {
  const projectName = (await projectRow.getAttribute('data-project-name'))?.trim()
  if (!projectName) {
    throw new Error('Unable to resolve project name before creating a session.')
  }

  const existingSessions = await page.locator('[data-testid="session-row"]').count()
  const descriptor = getProviderDescriptorBySessionType(options.type)
  const sessionTitle = options.type === 'shell'
    ? `shell-${existingSessions + 1}`
    : `${descriptor.titlePrefix}-${projectName}`

  // Navigate from project-row button → parent div → sibling add-session button
  await projectRow.locator('..').locator('[data-testid="workspace.add-session"]').click()

  const providerGroup = page.getByTestId('provider-card')
  await expect(providerGroup).toBeVisible()
  await providerGroup.locator(`[data-provider-type="${options.type}"]`).click()

  const sessionRow = page.locator(`[data-testid="session-row"][data-session-title="${sessionTitle}"]`).first()
  await expect(sessionRow).toBeVisible()
  return {
    row: sessionRow,
    title: sessionTitle
  }
}

export async function focusTerminalInput(page: Page): Promise<Locator> {
  const terminalViewport = page.getByTestId('terminal-viewport')
  await expect(terminalViewport).toBeVisible({ timeout: 30_000 })
  await expect(terminalViewport.getByTestId('terminal-xterm')).toBeVisible({ timeout: 30_000 })
  await terminalViewport.click()

  // xterm renders a hidden helper textarea for keyboard input — third-party internal, no data-testid available.
  const helperTextarea = terminalViewport.locator('.xterm-helper-textarea').first()
  await expect(helperTextarea).toBeAttached()
  await helperTextarea.focus()
  return helperTextarea
}

export async function runTerminalCommand(page: Page, command: string): Promise<void> {
  await focusTerminalInput(page)
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}
