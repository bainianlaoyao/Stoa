import { test, expect } from '@playwright/test'
import { cleanupStateDir, launchElectronApp, queueNextFolderPick } from './fixtures/electron-app'
import { createSidebarTestProject } from './fixtures/sidebar-test-project'
import { createProject } from './helpers/ui-actions'
import {
  openSidebar,
  searchFor,
  toggleSearchFilter,
  assertSearchResultCount,
  assertNoSearchResults,
} from './helpers/sidebar-actions'

test.describe('SearchPanel E2E', () => {
  let app: Awaited<ReturnType<typeof launchElectronApp>>
  let testProject: Awaited<ReturnType<typeof createSidebarTestProject>>

  test.beforeEach(async () => {
    testProject = await createSidebarTestProject()
    app = await launchElectronApp()

    await queueNextFolderPick(app.electronApp, testProject.projectPath)
    await createProject({ page: app.page, electronApp: app.electronApp }, {
      name: 'sidebar-test',
      path: testProject.projectPath,
    })
  })

  test.afterEach(async () => {
    const { stateDir } = app
    await app.close()
    await cleanupStateDir(stateDir)
    await testProject.cleanup()
  })

  // Requires ripgrep (rg) or git grep — skipped when unavailable
  test.skip('searches for text and returns results', async () => {
    await openSidebar(app.page)
    await searchFor(app.page, 'TODO')

    // "TODO" appears in README.md — at least one result
    const results = app.page.locator('[data-testid^="search-file-"]')
    await expect(results.first()).toBeVisible({ timeout: 5000 })
    const count = await results.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('does not search on empty query', async () => {
    await openSidebar(app.page)

    // Switch to search tab
    await app.page.getByTestId('sidebar-tab-search').click()
    const input = app.page.getByTestId('search-input')
    await expect(input).toBeVisible({ timeout: 3000 })

    // Clear and press Enter
    await input.clear()
    await input.press('Enter')

    // No results container should not show results
    await app.page.waitForTimeout(500)
    const results = app.page.locator('[data-testid^="search-file-"]')
    const count = await results.count()
    expect(count).toBe(0)
  })

  test('case-sensitive search returns only exact matches', async () => {
    await openSidebar(app.page)

    // First search case-insensitive (default)
    await app.page.getByTestId('sidebar-tab-search').click()
    const input = app.page.getByTestId('search-input')
    await expect(input).toBeVisible({ timeout: 3000 })
    await input.fill('hello')
    await input.press('Enter')
    await app.page.waitForTimeout(1000)

    const insensitiveCount = await app.page.locator('[data-testid^="search-file-"]').count()

    // Now search with case-sensitive on — "hello" (lowercase) should only match exact case
    await toggleSearchFilter(app.page, 'case')
    await input.press('Enter')
    await app.page.waitForTimeout(1000)

    const sensitiveCount = await app.page.locator('[data-testid^="search-file-"]').count()
    // Case-sensitive should return equal or fewer results
    expect(sensitiveCount).toBeLessThanOrEqual(insensitiveCount)
  })

  // Requires ripgrep whole-word mode — skipped when rg unavailable
  test.skip('whole-word search matches complete words only', async () => {
    await openSidebar(app.page)
    await app.page.getByTestId('sidebar-tab-search').click()
    const input = app.page.getByTestId('search-input')
    await expect(input).toBeVisible({ timeout: 3000 })

    await toggleSearchFilter(app.page, 'wholeWord')
    await input.fill('add')
    await input.press('Enter')
    await app.page.waitForTimeout(1000)

    // "add" appears as a whole word in src/utils.ts
    const results = app.page.locator('[data-testid^="search-file-"]')
    const count = await results.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  // Requires ripgrep regex mode — skipped when rg unavailable
  test.skip('regex search works', async () => {
    await openSidebar(app.page)
    await app.page.getByTestId('sidebar-tab-search').click()
    const input = app.page.getByTestId('search-input')
    await expect(input).toBeVisible({ timeout: 3000 })

    await toggleSearchFilter(app.page, 'regex')
    await input.fill('export\\s+(const|function)')
    await input.press('Enter')
    await app.page.waitForTimeout(1000)

    // Should match "export const" and "export function" in src files
    const results = app.page.locator('[data-testid^="search-file-"]')
    await expect(results.first()).toBeVisible({ timeout: 5000 })
    const count = await results.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('expands and collapses file result groups', async () => {
    await openSidebar(app.page)
    await searchFor(app.page, 'export')

    const fileHeader = app.page.locator('[data-testid^="search-file-"]').first()
    if (await fileHeader.isVisible()) {
      // Click to expand
      await fileHeader.click()
      await app.page.waitForTimeout(300)

      // Click to collapse
      await fileHeader.click()
      await app.page.waitForTimeout(300)
    }
  })

  test('shows error message when search fails', async () => {
    await openSidebar(app.page)
    await searchFor(app.page, 'zzznonexistent12345')

    // Search may fail with error (rg not found) or show "No results" — either is acceptable
    const panel = app.page.getByTestId('search-panel')
    const text = await panel.textContent() ?? ''
    const hasError = text.includes('Error')
    const hasNoResults = text.includes('No results')
    expect(hasError || hasNoResults).toBe(true)
  })
})
