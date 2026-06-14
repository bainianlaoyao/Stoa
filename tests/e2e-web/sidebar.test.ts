import { test, expect } from '@playwright/test'
import { cleanupStateDir, launchWebApp } from './fixtures/web-app'
import { createSidebarTestProject } from '../e2e-playwright/fixtures/sidebar-test-project'
import { createProjectViaApi, createSessionViaApi } from './helpers/web-ui-actions'
import {
  openSidebar,
  closeSidebar,
  switchTab,
  assertSidebarVisible,
  assertSidebarHidden,
} from '../e2e-playwright/helpers/sidebar-actions'

test.describe('Sidebar Interaction Web E2E', () => {
  let testProject: Awaited<ReturnType<typeof createSidebarTestProject>>

  test.beforeEach(async () => {
    testProject = await createSidebarTestProject()
  })

  test.afterEach(async () => {
    await testProject.cleanup()
  })

  test('toggle opens and closes the sidebar', async ({ page }) => {
    const app = await launchWebApp(page, {
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

    try {
      await closeSidebar(app.page)
      await assertSidebarHidden(app.page)

      await openSidebar(app.page)
      await assertSidebarVisible(app.page)

      await closeSidebar(app.page)
      await assertSidebarHidden(app.page)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('tab switching shows correct panel', async ({ page }) => {
    const app = await launchWebApp(page, {
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

    try {
      await openSidebar(app.page)
      await switchTab(app.page, 'explorer')

      const explorer = app.page.getByTestId('file-explorer')
      await expect(explorer).toBeAttached()
      expect(await explorer.evaluate((el) => (el as HTMLElement).style.display)).not.toBe('none')

      await switchTab(app.page, 'search')
      await expect(app.page.getByTestId('search-panel')).toBeAttached()

      await switchTab(app.page, 'git')
      await expect(app.page.getByTestId('source-control-panel')).toBeAttached()

      await switchTab(app.page, 'explorer')
      await expect(app.page.getByTestId('file-explorer')).toBeAttached()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('grid layout changes when sidebar opens and closes', async ({ page }) => {
    const app = await launchWebApp(page, {
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

    try {
      await closeSidebar(app.page)

      const colsBefore = await app.page.evaluate(() => {
        const main = document.querySelector('main')
        return main ? getComputedStyle(main).gridTemplateColumns : ''
      })
      const partsBefore = colsBefore.split(' ')
      expect(partsBefore).toHaveLength(3)
      expect(parseFloat(partsBefore[2]!)).toBe(0)

      await openSidebar(app.page)

      const colsAfter = await app.page.evaluate(() => {
        const main = document.querySelector('main')
        return main ? getComputedStyle(main).gridTemplateColumns : ''
      })
      const partsAfter = colsAfter.split(' ')
      expect(partsAfter).toHaveLength(3)
      expect(parseFloat(partsAfter[2]!)).toBeGreaterThan(0)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('resize handle exists and width is reactive', async ({ page }) => {
    const app = await launchWebApp(page, {
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

    try {
      await openSidebar(app.page)

      const handle = app.page.getByTestId('sidebar-resize-handle')
      await expect(handle).toBeVisible()
      const cursor = await handle.evaluate((el) => getComputedStyle(el).cursor)
      expect(cursor).toContain('col-resize')

      const widthBefore = await app.page.evaluate(() => {
        const sidebar = document.querySelector('[data-testid="right-sidebar"]') as HTMLElement | null
        return sidebar?.style.width ?? ''
      })

      expect(widthBefore).toMatch(/^\d+px$/)
      expect(parseInt(widthBefore, 10)).toBeGreaterThanOrEqual(220)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('width persists after closing and reopening', async ({ page }) => {
    const app = await launchWebApp(page, {
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

    try {
      await openSidebar(app.page)

      const targetWidth = 350
      await app.page.evaluate((w) => {
        const sidebar = document.querySelector('[data-testid="right-sidebar"]') as HTMLElement | null
        if (sidebar) sidebar.style.width = `${w}px`
      }, targetWidth)

      await closeSidebar(app.page)
      await app.page.waitForTimeout(300)
      await openSidebar(app.page)
      await app.page.waitForTimeout(500)

      const sidebar = app.page.getByTestId('right-sidebar')
      await expect(sidebar).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('tab switching keeps sidebar open', async ({ page }) => {
    const app = await launchWebApp(page, {
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

    try {
      await openSidebar(app.page)

      await switchTab(app.page, 'search')
      await assertSidebarVisible(app.page)

      await switchTab(app.page, 'git')
      await assertSidebarVisible(app.page)

      await switchTab(app.page, 'explorer')
      await assertSidebarVisible(app.page)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
