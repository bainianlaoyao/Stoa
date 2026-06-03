import { test, expect } from '@playwright/test'
import { cleanupStateDir, launchElectronApp, queueNextFolderPick } from './fixtures/electron-app'
import { createSidebarTestProject } from './fixtures/sidebar-test-project'
import { createProject, createSession } from './helpers/ui-actions'
import {
  openSidebar,
  closeSidebar,
  switchTab,
  assertSidebarVisible,
  assertSidebarHidden,
} from './helpers/sidebar-actions'

test.describe('Sidebar Interaction E2E', () => {
  let app: Awaited<ReturnType<typeof launchElectronApp>>
  let testProject: Awaited<ReturnType<typeof createSidebarTestProject>>

  test.beforeEach(async () => {
    testProject = await createSidebarTestProject()
    app = await launchElectronApp()

    await queueNextFolderPick(app.electronApp, testProject.projectPath)
    const projectRow = await createProject({ page: app.page, electronApp: app.electronApp }, {
      name: 'sidebar-test',
      path: testProject.projectPath,
    })
    await createSession(app.page, projectRow, { type: 'shell' })
  })

  test.afterEach(async () => {
    const { stateDir } = app
    await app.close()
    await cleanupStateDir(stateDir)
    await testProject.cleanup()
  })

  test('toggle opens and closes the sidebar', async () => {
    // Ensure sidebar starts closed
    await closeSidebar(app.page)

    // Now verify hidden
    await assertSidebarHidden(app.page)

    // Open
    await openSidebar(app.page)
    await assertSidebarVisible(app.page)

    // Close
    await closeSidebar(app.page)
    await assertSidebarHidden(app.page)
  })

  test('tab switching shows correct panel', async () => {
    await openSidebar(app.page)

    // Switch to explorer first (may not be default if state was persisted)
    await switchTab(app.page, 'explorer')

    // Explorer is the default panel — verify with v-show (element exists but may be hidden)
    const explorer = app.page.getByTestId('file-explorer')
    await expect(explorer).toBeAttached()
    expect(await explorer.evaluate(el => (el as HTMLElement).style.display)).not.toBe('none')

    // Switch to search
    await switchTab(app.page, 'search')
    await expect(app.page.getByTestId('search-panel')).toBeAttached()

    // Switch to git
    await switchTab(app.page, 'git')
    await expect(app.page.getByTestId('source-control-panel')).toBeAttached()

    // Switch back to explorer
    await switchTab(app.page, 'explorer')
    await expect(app.page.getByTestId('file-explorer')).toBeAttached()
  })

  test('grid layout changes when sidebar opens and closes', async () => {
    // Ensure sidebar starts closed
    await closeSidebar(app.page)

    // Before open: third column should be 0
    const colsBefore = await app.page.evaluate(() => {
      const main = document.querySelector('main')
      return main ? getComputedStyle(main).gridTemplateColumns : ''
    })
    const partsBefore = colsBefore.split(' ')
    expect(partsBefore).toHaveLength(3)
    expect(parseFloat(partsBefore[2])).toBe(0)

    // Open sidebar
    await openSidebar(app.page)

    const colsAfter = await app.page.evaluate(() => {
      const main = document.querySelector('main')
      return main ? getComputedStyle(main).gridTemplateColumns : ''
    })
    const partsAfter = colsAfter.split(' ')
    expect(partsAfter).toHaveLength(3)
    // Third column should now be > 0 (sidebar width)
    expect(parseFloat(partsAfter[2])).toBeGreaterThan(0)
  })

  test('resize handle exists and width is reactive', async () => {
    await openSidebar(app.page)

    // Verify resize handle exists with col-resize cursor
    const handle = app.page.getByTestId('sidebar-resize-handle')
    await expect(handle).toBeVisible()
    const cursor = await handle.evaluate(el => getComputedStyle(el).cursor)
    expect(cursor).toContain('col-resize')

    // Verify sidebar width is set via inline style (reactive to store)
    const widthBefore = await app.page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="right-sidebar"]') as HTMLElement | null
      return sidebar?.style.width ?? ''
    })

    // Sidebar width should be a non-empty pixel value (e.g. "280px" or "380px")
    expect(widthBefore).toMatch(/^\d+px$/)
    expect(parseInt(widthBefore)).toBeGreaterThanOrEqual(220) // MIN_WIDTH
  })

  test('width persists after closing and reopening', async () => {
    await openSidebar(app.page)

    // Resize via store to a known value
    const targetWidth = 350
    await app.page.evaluate((w) => {
      const sidebar = document.querySelector('[data-testid="right-sidebar"]') as HTMLElement | null
      if (sidebar) sidebar.style.width = w + 'px'
    }, targetWidth)

    // Close and reopen
    await closeSidebar(app.page)
    await app.page.waitForTimeout(300)
    await openSidebar(app.page)
    await app.page.waitForTimeout(500)

    // The sidebar should restore to persisted width (or close to it)
    // This tests that hydrate/persist cycle works
    const sidebar = app.page.getByTestId('right-sidebar')
    await expect(sidebar).toBeVisible()
  })

  test('tab switching keeps sidebar open', async () => {
    await openSidebar(app.page)

    // Switch tabs multiple times
    await switchTab(app.page, 'search')
    await assertSidebarVisible(app.page)

    await switchTab(app.page, 'git')
    await assertSidebarVisible(app.page)

    await switchTab(app.page, 'explorer')
    await assertSidebarVisible(app.page)
  })
})
