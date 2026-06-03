import { test, expect } from '@playwright/test'
import { cleanupStateDir, launchElectronApp, queueNextFolderPick } from './fixtures/electron-app'
import { createSidebarTestProject } from './fixtures/sidebar-test-project'
import { createProject, createSession } from './helpers/ui-actions'
import {
  openSidebar,
  switchTab,
  assertGitSectionVisible,
  assertGitSectionCount,
  stageFileByName,
  unstageFileByName,
  writeCommitMessage,
  commitStaged,
  assertGitBranchName,
} from './helpers/sidebar-actions'

// TODO: These tests require `rg` (ripgrep) or `git grep` to be available on PATH.
// On Windows CI without ripgrep installed, all git operations fail with "系统找不到指定的文件".
// Re-enable when ripgrep is available in the test environment.
test.describe('SourceControlPanel E2E', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip() // Skip entire describe block — requires rg/git grep
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

  async function openGitPanel(): Promise<void> {
    await openSidebar(app.page)
    await switchTab(app.page, 'git')
    await expect(app.page.getByTestId('source-control-panel')).toBeVisible({ timeout: 5000 })
    // Wait for git data to load
    await app.page.waitForTimeout(1500)
  }

  test('loads git status and displays sections', async () => {
    await openGitPanel()

    // The fixture creates: 1 staged (staged-new.ts), 1 modified (README.md), 1 untracked (untracked.txt)
    await assertGitSectionVisible(app.page, 'staged')
    await assertGitSectionVisible(app.page, 'changes')
    await assertGitSectionVisible(app.page, 'untracked')
  })

  test('shows staged file in staged section', async () => {
    await openGitPanel()

    await assertGitSectionCount(app.page, 'staged', 1)
    const sectionText = await app.page.getByTestId('git-staged-section').textContent() ?? ''
    expect(sectionText).toContain('staged-new.ts')
  })

  test('shows modified file in changes section', async () => {
    await openGitPanel()

    await assertGitSectionCount(app.page, 'changes', 1)
    const sectionText = await app.page.getByTestId('git-changes-section').textContent() ?? ''
    expect(sectionText).toContain('README.md')
  })

  test('shows untracked file in untracked section', async () => {
    await openGitPanel()

    await assertGitSectionCount(app.page, 'untracked', 1)
    const sectionText = await app.page.getByTestId('git-untracked-section').textContent() ?? ''
    expect(sectionText).toContain('untracked.txt')
  })

  test('stages an untracked file', async () => {
    await openGitPanel()

    // Stage the untracked file
    await stageFileByName(app.page, 'untracked.txt')
    await app.page.waitForTimeout(1500)

    // Untracked section should be gone (only 1 untracked file)
    await assertGitSectionCount(app.page, 'untracked', 0)

    // Staged should now have 2 files
    await assertGitSectionCount(app.page, 'staged', 2)
  })

  test('unstages a staged file', async () => {
    await openGitPanel()

    // Unstage the staged file
    await unstageFileByName(app.page, 'staged-new.ts')
    await app.page.waitForTimeout(1500)

    // Staged section should be gone
    await assertGitSectionCount(app.page, 'staged', 0)

    // Changes should now have 2 files (modified README.md + unstaged staged-new.ts)
    await assertGitSectionCount(app.page, 'changes', 2)
  })

  test('commits staged changes', async () => {
    await openGitPanel()

    // Stage the untracked file first so we have something to commit alongside the staged file
    await stageFileByName(app.page, 'untracked.txt')
    await app.page.waitForTimeout(1000)

    await writeCommitMessage(app.page, 'test commit')
    await commitStaged(app.page)

    // After commit, staged section should be empty
    await assertGitSectionCount(app.page, 'staged', 0)
  })

  test('displays current branch name', async () => {
    await openGitPanel()

    await assertGitBranchName(app.page, 'main')
  })

  test('collapses and expands sections', async () => {
    await openGitPanel()

    // Click staged section header to collapse
    await app.page.getByTestId('git-staged-section').click()
    await app.page.waitForTimeout(300)

    // The file rows inside staged should be hidden
    const stagedFile = app.page.locator('[data-testid="git-file-staged-new.ts"]')
    await expect(stagedFile).toBeHidden({ timeout: 3000 })

    // Click again to expand
    await app.page.getByTestId('git-staged-section').click()
    await app.page.waitForTimeout(300)
    await expect(stagedFile).toBeVisible({ timeout: 3000 })
  })
})
