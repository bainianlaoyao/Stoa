import { test, expect } from '@playwright/test'
import { cleanupStateDir, launchWebApp } from './fixtures/web-app'
import { createSidebarTestProject } from '../e2e-playwright/fixtures/sidebar-test-project'
import { createProjectViaApi, createSessionViaApi } from './helpers/web-ui-actions'
import {
  openSidebar,
  expandFolder,
  collapseFolder,
  collapseAll,
  refreshFileTree,
  getVisibleExplorerEntryNames,
} from '../e2e-playwright/helpers/sidebar-actions'

test.describe('FileExplorer Web E2E', () => {
  let testProject: Awaited<ReturnType<typeof createSidebarTestProject>>

  test.beforeEach(async () => {
    testProject = await createSidebarTestProject()
  })

  test.afterEach(async () => {
    await testProject.cleanup()
  })

  async function launchProjectExplorer(page: Parameters<typeof launchWebApp>[0]) {
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

  test('loads file tree with root entries', async ({ page }) => {
    const app = await launchProjectExplorer(page)

    try {
      await openSidebar(app.page)
      await expect(app.page.getByTestId('file-explorer')).toBeVisible()

      const names = await getVisibleExplorerEntryNames(app.page)
      expect(names).toContain('src')
      expect(names).toContain('tests')
      expect(names).toContain('package.json')
      expect(names).toContain('README.md')
      expect(names).toContain('.gitignore')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('expands a folder to show children', async ({ page }) => {
    const app = await launchProjectExplorer(page)

    try {
      await openSidebar(app.page)
      await expandFolder(app.page, 'src')
      await expect.poll(async () => await getVisibleExplorerEntryNames(app.page)).toContain('components')

      const names = await getVisibleExplorerEntryNames(app.page)
      expect(names).toContain('components')
      expect(names).toContain('index.ts')
      expect(names).toContain('utils.ts')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('collapses a folder when clicked again', async ({ page }) => {
    const app = await launchProjectExplorer(page)

    try {
      await openSidebar(app.page)
      await expandFolder(app.page, 'src')
      await expect.poll(async () => await getVisibleExplorerEntryNames(app.page)).toContain('index.ts')

      let names = await getVisibleExplorerEntryNames(app.page)
      expect(names).toContain('index.ts')

      await collapseFolder(app.page, 'src')
      await expect.poll(async () => await getVisibleExplorerEntryNames(app.page)).not.toContain('index.ts')

      names = await getVisibleExplorerEntryNames(app.page)
      expect(names).not.toContain('index.ts')
      expect(names).not.toContain('utils.ts')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('expands nested folders deeply', async ({ page }) => {
    const app = await launchProjectExplorer(page)

    try {
      await openSidebar(app.page)
      await expandFolder(app.page, 'src')
      await expect.poll(async () => await getVisibleExplorerEntryNames(app.page)).toContain('components')
      await expandFolder(app.page, 'components')
      await expect.poll(async () => await getVisibleExplorerEntryNames(app.page)).toContain('App.vue')

      const names = await getVisibleExplorerEntryNames(app.page)
      expect(names).toContain('App.vue')
      expect(names).toContain('Button.vue')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('collapse all collapses all expanded folders', async ({ page }) => {
    const app = await launchProjectExplorer(page)

    try {
      await openSidebar(app.page)
      await expandFolder(app.page, 'src')
      await expect.poll(async () => await getVisibleExplorerEntryNames(app.page)).toContain('components')
      await expandFolder(app.page, 'components')
      await expect.poll(async () => await getVisibleExplorerEntryNames(app.page)).toContain('App.vue')

      let names = await getVisibleExplorerEntryNames(app.page)
      expect(names).toContain('App.vue')

      await collapseAll(app.page)
      await expect.poll(async () => await getVisibleExplorerEntryNames(app.page)).not.toContain('App.vue')

      names = await getVisibleExplorerEntryNames(app.page)
      expect(names).not.toContain('index.ts')
      expect(names).not.toContain('App.vue')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('refreshes file tree', async ({ page }) => {
    const app = await launchProjectExplorer(page)

    try {
      await openSidebar(app.page)
      const namesBefore = await getVisibleExplorerEntryNames(app.page)
      await refreshFileTree(app.page)
      const namesAfter = await getVisibleExplorerEntryNames(app.page)
      expect(namesAfter).toEqual(namesBefore)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('scrolls through file tree', async ({ page }) => {
    const app = await launchProjectExplorer(page)

    try {
      await openSidebar(app.page)

      const scrollContainer = app.page.locator('[data-testid="file-explorer"] .overflow-y-auto')
      await expect(scrollContainer).toBeAttached()

      await scrollContainer.evaluate((el) => { el.scrollTop = el.scrollHeight })
      await app.page.waitForTimeout(300)
      await scrollContainer.evaluate((el) => { el.scrollTop = 0 })
      await app.page.waitForTimeout(300)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('shows toolbar buttons', async ({ page }) => {
    const app = await launchProjectExplorer(page)

    try {
      await openSidebar(app.page)

      await expect(app.page.getByTestId('toolbar-new-file')).toBeVisible()
      await expect(app.page.getByTestId('toolbar-new-folder')).toBeVisible()
      await expect(app.page.getByTestId('toolbar-collapse')).toBeVisible()
      await expect(app.page.getByTestId('toolbar-refresh')).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
