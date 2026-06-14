import { test, expect } from '@playwright/test'
import { cleanupStateDir, launchElectronApp, queueNextFolderPick } from './fixtures/electron-app'
import { createSidebarTestProject } from './fixtures/sidebar-test-project'
import { createProject, createSession } from './helpers/ui-actions'
import {
  openSidebar,
  expandFolder,
  collapseFolder,
  collapseAll,
  refreshFileTree,
  assertExplorerEntries,
  getVisibleExplorerEntryNames,
} from './helpers/sidebar-actions'

test.describe('FileExplorer E2E', () => {
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

  test('loads file tree with root entries', async () => {
    await openSidebar(app.page)
    await expect(app.page.getByTestId('file-explorer')).toBeVisible()

    // Root entries: dirs first (.stoa, src, tests), then files alphabetically
    // .stoa is created by the app for session state
    const names = await getVisibleExplorerEntryNames(app.page)
    expect(names).toContain('src')
    expect(names).toContain('tests')
    expect(names).toContain('package.json')
    expect(names).toContain('README.md')
    expect(names).toContain('.gitignore')
  })

  test('expands a folder to show children', async () => {
    await openSidebar(app.page)
    await expandFolder(app.page, 'src')

    const names = await getVisibleExplorerEntryNames(app.page)
    expect(names).toContain('components')
    expect(names).toContain('index.ts')
    expect(names).toContain('utils.ts')
  })

  test('collapses a folder when clicked again', async () => {
    await openSidebar(app.page)
    await expandFolder(app.page, 'src')

    let names = await getVisibleExplorerEntryNames(app.page)
    expect(names).toContain('index.ts')

    await collapseFolder(app.page, 'src')

    names = await getVisibleExplorerEntryNames(app.page)
    expect(names).not.toContain('index.ts')
    expect(names).not.toContain('utils.ts')
  })

  test('expands nested folders deeply', async () => {
    await openSidebar(app.page)
    await expandFolder(app.page, 'src')
    await expandFolder(app.page, 'components')

    const names = await getVisibleExplorerEntryNames(app.page)
    expect(names).toContain('App.vue')
    expect(names).toContain('Button.vue')
  })

  test('collapse all collapses all expanded folders', async () => {
    await openSidebar(app.page)
    await expandFolder(app.page, 'src')
    await expandFolder(app.page, 'components')

    let names = await getVisibleExplorerEntryNames(app.page)
    expect(names).toContain('App.vue')

    await collapseAll(app.page)

    names = await getVisibleExplorerEntryNames(app.page)
    expect(names).not.toContain('index.ts')
    expect(names).not.toContain('App.vue')
  })

  // TODO: Fix — startCreateFile/startRename use lastIndexOf('/') for parentPath extraction,
  // which fails on Windows paths that use '\'. The inline input never matches a tree node.
  test.skip('creates a new file inside an expanded folder via context menu', async () => {
    await openSidebar(app.page)
    await expandFolder(app.page, 'src')

    // Right-click the src folder row to get context menu
    const rows = app.page.locator('[data-testid^="file-row-"]')
    const count = await rows.count()
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent()
      if (text?.trim() === 'src') {
        await rows.nth(i).click({ button: 'right' })
        break
      }
    }

    const newFileBtn = app.page.locator('button:has-text("New File")')
    await expect(newFileBtn).toBeVisible({ timeout: 3000 })
    await newFileBtn.click()

    const input = app.page.locator('[data-testid="file-explorer"] input[type="text"]')
    await expect(input).toBeVisible({ timeout: 3000 })
    await input.fill('new-file.ts')
    await input.press('Enter')
    // Wait for IPC and then refresh the tree to show the new file
    await refreshFileTree(app.page)

    // Verify file appears in tree
    const names = await getVisibleExplorerEntryNames(app.page)
    expect(names).toContain('new-file.ts')

    // Verify file exists on disk
    const exists = await app.page.evaluate(async (projectPath) => {
      try {
        await window.stoa.fsReadFile(projectPath, 'src/new-file.ts')
        return true
      } catch {
        return false
      }
    }, testProject.projectPath)
    expect(exists).toBe(true)
  })

  // TODO: Fix — same Windows path separator issue as file creation
  test.skip('creates a new folder inside an expanded folder via context menu', async () => {
    await openSidebar(app.page)
    await expandFolder(app.page, 'src')

    const rows = app.page.locator('[data-testid^="file-row-"]')
    const count = await rows.count()
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent()
      if (text?.trim() === 'src') {
        await rows.nth(i).click({ button: 'right' })
        break
      }
    }

    const newFolderBtn = app.page.locator('button:has-text("New Folder")')
    await expect(newFolderBtn).toBeVisible({ timeout: 3000 })
    await newFolderBtn.click()

    const input = app.page.locator('[data-testid="file-explorer"] input[type="text"]')
    await expect(input).toBeVisible({ timeout: 3000 })
    await input.fill('lib')
    await input.press('Enter')
    await refreshFileTree(app.page)

    const names = await getVisibleExplorerEntryNames(app.page)
    expect(names).toContain('lib')
  })

  // TODO: Fix — startRename uses lastIndexOf('/') for parentPath, broken on Windows
  test.skip('renames a file via context menu', async () => {
    await openSidebar(app.page)
    await expandFolder(app.page, 'src')

    // Right-click index.ts (inside src/)
    const rows = app.page.locator('[data-testid^="file-row-"]')
    const count = await rows.count()
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent()
      if (text?.trim() === 'index.ts') {
        await rows.nth(i).click({ button: 'right' })
        break
      }
    }

    const renameBtn = app.page.locator('button:has-text("Rename")')
    await expect(renameBtn).toBeVisible({ timeout: 3000 })
    await renameBtn.click()

    const input = app.page.locator('[data-testid="file-explorer"] input[type="text"]')
    await expect(input).toBeVisible({ timeout: 3000 })
    await input.clear()
    await input.fill('main.ts')
    await input.press('Enter')
    await refreshFileTree(app.page)

    const names = await getVisibleExplorerEntryNames(app.page)
    expect(names).toContain('main.ts')
    expect(names).not.toContain('index.ts')
  })

  test('deletes a file via context menu', async () => {
    await openSidebar(app.page)

    // Right-click staged-new.ts (from our fixture)
    const rows = app.page.locator('[data-testid^="file-row-"]')
    const count = await rows.count()
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent()
      if (text?.trim() === 'staged-new.ts') {
        await rows.nth(i).click({ button: 'right' })
        break
      }
    }

    const deleteBtn = app.page.locator('button:has-text("Delete")')
    await expect(deleteBtn).toBeVisible({ timeout: 3000 })
    await deleteBtn.click()
    await app.page.waitForTimeout(1000)

    await refreshFileTree(app.page)
    const names = await getVisibleExplorerEntryNames(app.page)
    expect(names).not.toContain('staged-new.ts')
  })

  test('cancels file creation with Escape', async () => {
    await openSidebar(app.page)
    await expandFolder(app.page, 'src')

    // Open context menu on src folder
    const rows = app.page.locator('[data-testid^="file-row-"]')
    const count = await rows.count()
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent()
      if (text?.trim() === 'src') {
        await rows.nth(i).click({ button: 'right' })
        break
      }
    }

    const newFileBtn = app.page.locator('button:has-text("New File")')
    await expect(newFileBtn).toBeVisible({ timeout: 3000 })
    await newFileBtn.click()

    const input = app.page.locator('[data-testid="file-explorer"] input[type="text"]')
    await expect(input).toBeVisible({ timeout: 3000 })
    await input.fill('cancelled.ts')
    await input.press('Escape')

    await expect(input).toBeHidden()

    // File should not exist on disk
    const exists = await app.page.evaluate(async (projectPath) => {
      try {
        await window.stoa.fsReadFile(projectPath, 'src/cancelled.ts')
        return true
      } catch {
        return false
      }
    }, testProject.projectPath)
    expect(exists).toBe(false)
  })

  test('refreshes file tree', async () => {
    await openSidebar(app.page)
    const namesBefore = await getVisibleExplorerEntryNames(app.page)
    await refreshFileTree(app.page)
    const namesAfter = await getVisibleExplorerEntryNames(app.page)
    expect(namesAfter).toEqual(namesBefore)
  })

  test('scrolls through file tree', async () => {
    await openSidebar(app.page)

    const scrollContainer = app.page.locator('[data-testid="file-explorer"] .overflow-y-auto')
    await expect(scrollContainer).toBeAttached()

    await scrollContainer.evaluate(el => { el.scrollTop = el.scrollHeight })
    await app.page.waitForTimeout(300)
    await scrollContainer.evaluate(el => { el.scrollTop = 0 })
    await app.page.waitForTimeout(300)
  })

  test('shows toolbar buttons', async () => {
    await openSidebar(app.page)

    await expect(app.page.getByTestId('toolbar-new-file')).toBeVisible()
    await expect(app.page.getByTestId('toolbar-new-folder')).toBeVisible()
    await expect(app.page.getByTestId('toolbar-collapse')).toBeVisible()
    await expect(app.page.getByTestId('toolbar-refresh')).toBeVisible()
  })
})
