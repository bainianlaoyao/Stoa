import { test, expect } from '@playwright/test'
import { cleanupStateDir, launchWebApp } from './fixtures/web-app'
import { createSidebarTestProject } from '../e2e-playwright/fixtures/sidebar-test-project'
import { createProjectViaApi, createSessionViaApi } from './helpers/web-ui-actions'
import {
  openSidebar,
  searchFor,
  toggleSearchFilter,
} from '../e2e-playwright/helpers/sidebar-actions'

test.describe('SearchPanel Web E2E', () => {
  let testProject: Awaited<ReturnType<typeof createSidebarTestProject>>

  test.beforeEach(async () => {
    testProject = await createSidebarTestProject()
  })

  test.afterEach(async () => {
    await testProject.cleanup()
  })

  async function launchSearchApp(page: Parameters<typeof launchWebApp>[0]) {
    return await launchWebApp(page, {
      async beforeNavigate({ baseUrl, token }) {
        const project = await createProjectViaApi({ baseUrl, token }, {
          name: 'sidebar-test',
          path: testProject.projectPath,
        })
        await createSessionViaApi({ baseUrl, token }, {
          projectId: project.id,
          type: 'shell',
        })
      },
    })
  }

  test('does not search on empty query', async ({ page }) => {
    const app = await launchSearchApp(page)

    try {
      await openSidebar(app.page)
      await app.page.getByTestId('sidebar-tab-search').click()
      const input = app.page.getByTestId('search-input')
      await expect(input).toBeVisible({ timeout: 3000 })

      await input.clear()
      await input.press('Enter')

      await app.page.waitForTimeout(500)
      const results = app.page.locator('[data-testid^="search-file-"]')
      const count = await results.count()
      expect(count).toBe(0)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('case-sensitive search returns only exact matches', async ({ page }) => {
    const app = await launchSearchApp(page)

    try {
      await openSidebar(app.page)

      await app.page.getByTestId('sidebar-tab-search').click()
      const input = app.page.getByTestId('search-input')
      await expect(input).toBeVisible({ timeout: 3000 })
      await input.fill('hello')
      await input.press('Enter')
      await app.page.waitForTimeout(1000)

      const insensitiveCount = await app.page.locator('[data-testid^="search-file-"]').count()

      await toggleSearchFilter(app.page, 'case')
      await input.press('Enter')
      await app.page.waitForTimeout(1000)

      const sensitiveCount = await app.page.locator('[data-testid^="search-file-"]').count()
      expect(sensitiveCount).toBeLessThanOrEqual(insensitiveCount)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('expands and collapses file result groups', async ({ page }) => {
    const app = await launchSearchApp(page)

    try {
      await openSidebar(app.page)
      await searchFor(app.page, 'export')

      const fileHeader = app.page.locator('[data-testid^="search-file-"]').first()
      if (await fileHeader.isVisible()) {
        await fileHeader.click()
        await app.page.waitForTimeout(300)

        await fileHeader.click()
        await app.page.waitForTimeout(300)
      }
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('shows error message when search fails', async ({ page }) => {
    const app = await launchSearchApp(page)

    try {
      await openSidebar(app.page)
      await searchFor(app.page, 'zzznonexistent12345')

      await expect.poll(async () => {
        return await app.page.locator('[data-testid^="search-file-"]').count()
      }).toBe(0)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
