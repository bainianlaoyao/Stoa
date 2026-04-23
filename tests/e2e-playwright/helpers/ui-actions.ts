import { mkdir } from 'node:fs/promises'
import { expect, type Locator, type Page } from '@playwright/test'
import type { SessionType } from '@shared/project-session'

export async function createProject(page: Page, options: { name: string; path: string }): Promise<Locator> {
  await mkdir(options.path, { recursive: true })

  await page.getByRole('button', { name: 'New Project' }).click()

  const dialog = page.getByRole('dialog', { name: '新建项目' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('项目名称').fill(options.name)
  await dialog.getByLabel('项目路径').fill(options.path)
  await dialog.getByRole('button', { name: '创建' }).click()

  const projectRow = page.locator('.route-project').filter({ hasText: options.name }).first()
  await expect(projectRow).toBeVisible()
  return projectRow
}

export async function createSession(
  page: Page,
  projectRow: Locator,
  options: { title: string; type: SessionType }
): Promise<Locator> {
  await projectRow.getByRole('button', { name: /Add session to / }).click()

  const dialog = page.getByRole('dialog', { name: '新建会话' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('会话标题').fill(options.title)
  await dialog.getByLabel('会话类型').selectOption(options.type)
  await dialog.getByRole('button', { name: '创建' }).click()

  // Temporary structural fallback per rollout plan: session rows still rely on route-item markup.
  const sessionRow = projectRow.locator('.route-item.child').filter({ hasText: options.title }).first()
  await expect(sessionRow).toBeVisible()
  return sessionRow
}

export async function focusTerminalInput(page: Page): Promise<Locator> {
  const terminalSurface = page.getByRole('region', { name: 'Terminal surface' })
  await page.waitForFunction(() => {
    return Boolean(window.__VIBECODING_TERMINAL_DEBUG__?.getActiveBufferText)
  })
  await expect(terminalSurface).toBeVisible({ timeout: 30_000 })
  await terminalSurface.click()

  // xterm renders a hidden helper textarea for keyboard input, so this is the documented structural fallback.
  const helperTextarea = terminalSurface.locator('.xterm-helper-textarea').first()
  await expect(helperTextarea).toBeAttached()
  await helperTextarea.focus()
  return helperTextarea
}

export async function runTerminalCommand(page: Page, command: string): Promise<void> {
  await focusTerminalInput(page)
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}
