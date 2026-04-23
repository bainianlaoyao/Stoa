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

  await page.getByRole('button', { name: 'New Project' }).click()

  const dialog = page.getByRole('dialog', { name: '新建项目' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('项目名称').fill(options.name)
  await dialog.getByRole('button', { name: 'Browse' }).click()
  await expect(dialog.getByLabel('项目路径')).toHaveValue(options.path)
  await dialog.getByRole('button', { name: '创建' }).click()

  const projectRow = page.locator('.route-item--parent').filter({ hasText: options.name }).first()
  await expect(projectRow).toBeVisible()
  return projectRow
}

export async function createSession(
  page: Page,
  projectRow: Locator,
  options: { type: SessionType }
): Promise<{ row: Locator; title: string }> {
  const projectName = (await projectRow.locator('.route-name').textContent())?.trim()
  if (!projectName) {
    throw new Error('Unable to resolve project name before creating a session.')
  }

  const existingSessions = await page.locator('.route-item.child').count()
  const descriptor = getProviderDescriptorBySessionType(options.type)
  const sessionTitle = options.type === 'shell'
    ? `shell-${existingSessions + 1}`
    : `${descriptor.titlePrefix}-${projectName}`

  await page.getByRole('button', { name: `Add session to ${projectName}` }).click()

  const providerGroup = page.getByRole('group', { name: 'Session providers' })
  await expect(providerGroup).toBeVisible()
  await providerGroup.getByRole('button', { name: `Create ${descriptor.displayName} session` }).click()

  // Temporary structural fallback per rollout plan: session rows still rely on route-item markup.
  const sessionRow = page.locator('.route-item.child').filter({ hasText: sessionTitle }).first()
  await expect(sessionRow).toBeVisible()
  return {
    row: sessionRow,
    title: sessionTitle
  }
}

export async function focusTerminalInput(page: Page): Promise<Locator> {
  const terminalViewport = page.locator('.terminal-viewport').first()
  await expect(terminalViewport).toBeVisible({ timeout: 30_000 })
  await expect(terminalViewport.locator('.terminal-viewport__xterm')).toBeVisible({ timeout: 30_000 })
  await terminalViewport.click()

  // xterm renders a hidden helper textarea for keyboard input, so this is the documented structural fallback.
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
