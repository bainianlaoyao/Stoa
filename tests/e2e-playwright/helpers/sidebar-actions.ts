/// <reference lib="dom" />

import { expect, type Locator, type Page } from '@playwright/test'

// ── Generic sidebar helpers ──

export async function openSidebar(page: Page): Promise<void> {
  await page.locator('[data-activity-item="command"]').click()
  const toggle = page.getByTestId('workspace.sidebar-toggle')
  await expect(toggle).toBeVisible({ timeout: 5000 })
  const pressed = await toggle.getAttribute('aria-pressed')
  if (pressed !== 'true') {
    await toggle.click()
    await expect(page.getByTestId('right-sidebar')).toBeVisible({ timeout: 5000 })
  }
}

export async function closeSidebar(page: Page): Promise<void> {
  await page.locator('[data-activity-item="command"]').click()
  const toggle = page.getByTestId('workspace.sidebar-toggle')
  await expect(toggle).toBeVisible({ timeout: 5000 })
  const pressed = await toggle.getAttribute('aria-pressed')
  if (pressed === 'true') {
    await toggle.click()
    await expect(page.getByTestId('right-sidebar')).toBeHidden({ timeout: 5000 })
  }
}

export async function switchTab(page: Page, tab: 'explorer' | 'search' | 'git'): Promise<void> {
  await page.getByTestId(`sidebar-tab-${tab}`).click()
}

export async function assertSidebarVisible(page: Page): Promise<void> {
  await expect(page.getByTestId('right-sidebar')).toBeVisible()
}

export async function assertSidebarHidden(page: Page): Promise<void> {
  await expect(page.getByTestId('right-sidebar')).toBeHidden()
}

// ── FileExplorer helpers ──

export function getFileRow(page: Page, relativePath: string): Locator {
  return page.locator(`[data-testid="file-row-${relativePath}"]`)
}

async function findVisibleFolderRow(page: Page, folderName: string): Promise<Locator> {
  const rows = page.locator('[data-testid^="file-row-"]')
  const count = await rows.count()
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i)
    const text = await row.textContent()
    if (text?.trim() === folderName) {
      return row
    }
  }
  throw new Error(`Folder "${folderName}" not found in file explorer`)
}

export async function expandFolder(page: Page, folderName: string): Promise<void> {
  const rows = page.locator('[data-testid^="file-row-"]')
  const beforeCount = await rows.count()
  const row = await findVisibleFolderRow(page, folderName)

  await row.click()
  await expect.poll(() => rows.count(), { timeout: 5000 }).toBeGreaterThan(beforeCount)
}

export async function collapseFolder(page: Page, folderName: string): Promise<void> {
  const rows = page.locator('[data-testid^="file-row-"]')
  const beforeCount = await rows.count()
  const row = await findVisibleFolderRow(page, folderName)

  await row.click()
  await expect.poll(() => rows.count(), { timeout: 5000 }).toBeLessThan(beforeCount)
}

export async function createFileViaToolbar(page: Page, name: string): Promise<void> {
  await page.getByTestId('toolbar-new-file').click()
  // Wait for inline input to appear
  const input = page.locator('[data-testid="file-explorer"] input[type="text"]')
  await expect(input).toBeVisible({ timeout: 3000 })
  await input.fill(name)
  await input.press('Enter')
  // Wait for IPC to complete and tree to update
  await page.waitForTimeout(500)
}

export async function createFolderViaToolbar(page: Page, name: string): Promise<void> {
  await page.getByTestId('toolbar-new-folder').click()
  const input = page.locator('[data-testid="file-explorer"] input[type="text"]')
  await expect(input).toBeVisible({ timeout: 3000 })
  await input.fill(name)
  await input.press('Enter')
  await page.waitForTimeout(500)
}

export async function renameViaContextMenu(page: Page, oldName: string, newName: string): Promise<void> {
  // Right-click the file row
  const rows = page.locator('[data-testid^="file-row-"]')
  const count = await rows.count()
  for (let i = 0; i < count; i++) {
    const text = await rows.nth(i).textContent()
    if (text?.trim() === oldName) {
      await rows.nth(i).click({ button: 'right' })
      break
    }
  }
  // Click "Rename" in context menu
  const renameBtn = page.locator('button:has-text("Rename")')
  await expect(renameBtn).toBeVisible({ timeout: 3000 })
  await renameBtn.click()

  // Fill the inline input
  const input = page.locator('[data-testid="file-explorer"] input[type="text"]')
  await expect(input).toBeVisible({ timeout: 3000 })
  await input.clear()
  await input.fill(newName)
  await input.press('Enter')
  await page.waitForTimeout(500)
}

export async function deleteViaContextMenu(page: Page, name: string): Promise<void> {
  const rows = page.locator('[data-testid^="file-row-"]')
  const count = await rows.count()
  for (let i = 0; i < count; i++) {
    const text = await rows.nth(i).textContent()
    if (text?.trim() === name) {
      await rows.nth(i).click({ button: 'right' })
      break
    }
  }
  const deleteBtn = page.locator('button:has-text("Delete")')
  await expect(deleteBtn).toBeVisible({ timeout: 3000 })
  await deleteBtn.click()
  await page.waitForTimeout(500)
}

export async function collapseAll(page: Page): Promise<void> {
  await page.getByTestId('toolbar-collapse').click()
}

export async function refreshFileTree(page: Page): Promise<void> {
  await page.getByTestId('toolbar-refresh').click()
  await page.waitForTimeout(1000)
}

export async function assertExplorerEntries(page: Page, expectedNames: string[]): Promise<void> {
  // Get all root-level file rows (depth 0, paddingLeft = 8px)
  const rows = page.locator('[data-testid^="file-row-"]')
  await expect(rows.first()).toBeVisible({ timeout: 5000 })

  const entries: string[] = []
  const count = await rows.count()
  for (let i = 0; i < count; i++) {
    const style = await rows.nth(i).getAttribute('style') ?? ''
    // Root rows have paddingLeft: 8px (depth 0)
    if (style.includes('8px')) {
      const text = await rows.nth(i).textContent()
      if (text?.trim()) entries.push(text.trim())
    }
  }
  expect(entries).toEqual(expectedNames)
}

export async function getVisibleExplorerEntryNames(page: Page): Promise<string[]> {
  const rows = page.locator('[data-testid^="file-row-"]')
  const count = await rows.count()
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const text = await rows.nth(i).textContent()
    if (text?.trim()) names.push(text.trim())
  }
  return names
}

// ── SearchPanel helpers ──

export async function searchFor(page: Page, query: string): Promise<void> {
  await switchTab(page, 'search')
  const input = page.getByTestId('search-input')
  await expect(input).toBeVisible({ timeout: 3000 })
  await input.clear()
  await input.fill(query)
  await input.press('Enter')
  await page.waitForTimeout(1000)
}

export async function toggleSearchFilter(page: Page, filter: 'case' | 'wholeWord' | 'regex'): Promise<void> {
  const testId = filter === 'case' ? 'toggle-case'
    : filter === 'wholeWord' ? 'toggle-whole-word'
    : 'toggle-regex'
  await page.getByTestId(testId).click()
}

export async function assertSearchResultCount(page: Page, minCount: number): Promise<void> {
  const results = page.locator('[data-testid^="search-file-"]')
  await expect(results.first()).toBeVisible({ timeout: 5000 })
  const count = await results.count()
  expect(count).toBeGreaterThanOrEqual(minCount)
}

export async function assertNoSearchResults(page: Page): Promise<void> {
  const panel = page.getByTestId('search-panel')
  await expect(panel).toContainText('No results')
}

// ── SourceControlPanel helpers ──

export async function assertGitSectionVisible(page: Page, section: 'staged' | 'changes' | 'untracked'): Promise<void> {
  const testId = section === 'staged' ? 'git-staged-section'
    : section === 'changes' ? 'git-changes-section'
    : 'git-untracked-section'
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 5000 })
}

export async function assertGitSectionCount(page: Page, section: 'staged' | 'changes' | 'untracked', expectedCount: number): Promise<void> {
  const testId = section === 'staged' ? 'git-staged-section'
    : section === 'changes' ? 'git-changes-section'
    : 'git-untracked-section'

  if (expectedCount === 0) {
    await expect(page.getByTestId(testId)).toBeHidden({ timeout: 5000 })
    return
  }

  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 5000 })
  const sectionEl = page.getByTestId(testId)
  const text = await sectionEl.textContent() ?? ''
  expect(text).toContain(`(${expectedCount})`)
}

export async function stageFileByName(page: Page, fileName: string): Promise<void> {
  // The file row has a Stage button (plus icon) — find the row and click its stage button
  const fileRow = page.locator(`[data-testid="git-file-${fileName}"]`)
  await expect(fileRow).toBeVisible({ timeout: 5000 })
  // The stage button is inside the row — click the button with title="Stage"
  const stageBtn = fileRow.locator('button[title="Stage"]')
  await expect(stageBtn).toBeVisible()
  await stageBtn.click()
  await page.waitForTimeout(500)
}

export async function unstageFileByName(page: Page, fileName: string): Promise<void> {
  const fileRow = page.locator(`[data-testid="git-file-${fileName}"]`)
  await expect(fileRow).toBeVisible({ timeout: 5000 })
  const unstageBtn = fileRow.locator('button[title="Unstage"]')
  await expect(unstageBtn).toBeVisible()
  await unstageBtn.click()
  await page.waitForTimeout(500)
}

export async function writeCommitMessage(page: Page, message: string): Promise<void> {
  const input = page.getByTestId('git-commit-input')
  await expect(input).toBeVisible({ timeout: 3000 })
  await input.clear()
  await input.fill(message)
}

export async function commitStaged(page: Page): Promise<void> {
  await page.getByTestId('git-commit-button').click()
  await page.waitForTimeout(1000)
}

export async function assertGitBranchName(page: Page, expectedBranch: string): Promise<void> {
  const selector = page.getByTestId('git-branch-selector')
  await expect(selector).toBeVisible({ timeout: 5000 })
  await expect(selector).toContainText(expectedBranch)
}
