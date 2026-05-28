import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GitStatusResult, GitStatusEntry, GitBranchInfo, GitLogEntry } from '@shared/sidebar-types'

export const useGitStore = defineStore('git', () => {
  const status = ref<GitStatusResult | null>(null)
  const branches = ref<GitBranchInfo | null>(null)
  const log = ref<GitLogEntry[]>([])
  const loading = ref(false)
  const commitMessage = ref('')
  const operationInProgress = ref(false)
  const operationError = ref<string | null>(null)

  const staged = computed<GitStatusEntry[]>(() =>
    status.value?.entries.filter(e => e.staging === 'staged') ?? []
  )

  const unstaged = computed<GitStatusEntry[]>(() =>
    status.value?.entries.filter(e => e.staging === 'unstaged') ?? []
  )

  const untracked = computed<GitStatusEntry[]>(() =>
    status.value?.entries.filter(e => e.staging === 'untracked') ?? []
  )

  const hasChanges = computed(() => (status.value?.entries.length ?? 0) > 0)

  const currentBranch = computed(() =>
    status.value?.branch ?? branches.value?.current ?? ''
  )

  function clearError(): void {
    operationError.value = null
  }

  async function refreshStatus(projectPath: string): Promise<void> {
    try {
      status.value = await window.stoa.gitStatus(projectPath)
    } catch {
      status.value = null
    }
  }

  async function refreshBranches(projectPath: string): Promise<void> {
    try {
      branches.value = await window.stoa.gitBranches(projectPath)
    } catch {
      branches.value = null
    }
  }

  async function refreshLog(projectPath: string): Promise<void> {
    try {
      log.value = await window.stoa.gitLog(projectPath, 50)
    } catch {
      log.value = []
    }
  }

  async function refreshAll(projectPath: string): Promise<void> {
    loading.value = true
    await Promise.all([
      refreshStatus(projectPath),
      refreshBranches(projectPath),
      refreshLog(projectPath),
    ])
    loading.value = false
  }

  async function stageFile(projectPath: string, relativePath: string): Promise<void> {
    operationInProgress.value = true
    operationError.value = null
    try {
      await window.stoa.gitStage(projectPath, [relativePath])
      await refreshStatus(projectPath)
    } catch (e) {
      operationError.value = e instanceof Error ? e.message : String(e)
    } finally {
      operationInProgress.value = false
    }
  }

  async function unstageFile(projectPath: string, relativePath: string): Promise<void> {
    operationInProgress.value = true
    operationError.value = null
    try {
      await window.stoa.gitUnstage(projectPath, [relativePath])
      await refreshStatus(projectPath)
    } catch (e) {
      operationError.value = e instanceof Error ? e.message : String(e)
    } finally {
      operationInProgress.value = false
    }
  }

  async function discardFile(projectPath: string, relativePath: string): Promise<void> {
    operationInProgress.value = true
    operationError.value = null
    try {
      await window.stoa.gitDiscard(projectPath, [relativePath])
      await refreshStatus(projectPath)
    } catch (e) {
      operationError.value = e instanceof Error ? e.message : String(e)
    } finally {
      operationInProgress.value = false
    }
  }

  async function commit(projectPath: string, message: string): Promise<void> {
    operationInProgress.value = true
    operationError.value = null
    try {
      await window.stoa.gitCommit({ projectPath, message })
      commitMessage.value = ''
      await Promise.all([refreshStatus(projectPath), refreshLog(projectPath)])
    } catch (e) {
      operationError.value = e instanceof Error ? e.message : String(e)
    } finally {
      operationInProgress.value = false
    }
  }

  async function push(projectPath: string, setUpstream?: boolean): Promise<void> {
    operationInProgress.value = true
    operationError.value = null
    try {
      await window.stoa.gitPush({ projectPath, setUpstream })
      await refreshStatus(projectPath)
    } catch (e) {
      operationError.value = e instanceof Error ? e.message : String(e)
    } finally {
      operationInProgress.value = false
    }
  }

  async function pull(projectPath: string): Promise<void> {
    operationInProgress.value = true
    operationError.value = null
    try {
      await window.stoa.gitPull(projectPath)
      await Promise.all([refreshStatus(projectPath), refreshLog(projectPath)])
    } catch (e) {
      operationError.value = e instanceof Error ? e.message : String(e)
    } finally {
      operationInProgress.value = false
    }
  }

  async function fetch(projectPath: string): Promise<void> {
    operationInProgress.value = true
    operationError.value = null
    try {
      await window.stoa.gitFetch(projectPath)
      await refreshStatus(projectPath)
    } catch (e) {
      operationError.value = e instanceof Error ? e.message : String(e)
    } finally {
      operationInProgress.value = false
    }
  }

  async function checkoutBranch(projectPath: string, branch: string): Promise<void> {
    operationInProgress.value = true
    operationError.value = null
    try {
      await window.stoa.gitCheckout(projectPath, branch)
      await Promise.all([refreshStatus(projectPath), refreshBranches(projectPath)])
    } catch (e) {
      operationError.value = e instanceof Error ? e.message : String(e)
    } finally {
      operationInProgress.value = false
    }
  }

  async function createBranch(projectPath: string, branch: string): Promise<void> {
    operationInProgress.value = true
    operationError.value = null
    try {
      await window.stoa.gitCreateBranch(projectPath, branch)
      await refreshBranches(projectPath)
    } catch (e) {
      operationError.value = e instanceof Error ? e.message : String(e)
    } finally {
      operationInProgress.value = false
    }
  }

  async function rebase(projectPath: string, onto: string): Promise<void> {
    operationInProgress.value = true
    operationError.value = null
    try {
      await window.stoa.gitRebase({ projectPath, onto })
      await Promise.all([refreshStatus(projectPath), refreshLog(projectPath)])
    } catch (e) {
      operationError.value = e instanceof Error ? e.message : String(e)
    } finally {
      operationInProgress.value = false
    }
  }

  async function merge(projectPath: string, branch: string): Promise<void> {
    operationInProgress.value = true
    operationError.value = null
    try {
      await window.stoa.gitMerge({ projectPath, branch })
      await Promise.all([refreshStatus(projectPath), refreshLog(projectPath)])
    } catch (e) {
      operationError.value = e instanceof Error ? e.message : String(e)
    } finally {
      operationInProgress.value = false
    }
  }

  return {
    status,
    branches,
    log,
    loading,
    commitMessage,
    operationInProgress,
    operationError,
    staged,
    unstaged,
    untracked,
    hasChanges,
    currentBranch,
    clearError,
    refreshStatus,
    refreshBranches,
    refreshLog,
    refreshAll,
    stageFile,
    unstageFile,
    discardFile,
    commit,
    push,
    pull,
    fetch,
    checkoutBranch,
    createBranch,
    rebase,
    merge,
  }
})
