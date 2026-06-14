import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GitStatusResult, GitStatusEntry, GitBranchInfo, GitLogEntry } from '@shared/sidebar-types'
import { getStoaClient, isStoaClientMode, requireRendererApi } from '@renderer/stores/stoa-store-plugin'

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

  async function fetchStatus(projectPath: string): Promise<GitStatusResult> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        const res = await client.get<GitStatusResult>(
          `/api/v1/git/status?projectPath=${encodeURIComponent(projectPath)}`
        )
        return res.data!
      }
    }

    return requireRendererApi().gitStatus(projectPath)
  }

  async function fetchBranches(projectPath: string): Promise<GitBranchInfo> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        const res = await client.get<GitBranchInfo>(
          `/api/v1/git/branches?projectPath=${encodeURIComponent(projectPath)}`
        )
        return res.data!
      }
    }

    return requireRendererApi().gitBranches(projectPath)
  }

  async function fetchLogEntries(projectPath: string): Promise<GitLogEntry[]> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        const params = new URLSearchParams()
        params.set('projectPath', projectPath)
        params.set('limit', '50')
        const res = await client.get<GitLogEntry[]>(`/api/v1/git/log?${params.toString()}`)
        return res.data!
      }
    }

    return requireRendererApi().gitLog(projectPath, 50)
  }

  async function stagePaths(projectPath: string, paths: string[]): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.post('/api/v1/git/stage', { projectPath, paths })
        return
      }
    }

    await requireRendererApi().gitStage(projectPath, paths)
  }

  async function unstagePaths(projectPath: string, paths: string[]): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.post('/api/v1/git/unstage', { projectPath, paths })
        return
      }
    }

    await requireRendererApi().gitUnstage(projectPath, paths)
  }

  async function discardPaths(projectPath: string, paths: string[]): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.post('/api/v1/git/discard', { projectPath, paths })
        return
      }
    }

    await requireRendererApi().gitDiscard(projectPath, paths)
  }

  async function commitChanges(projectPath: string, message: string): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.post('/api/v1/git/commit', { projectPath, message })
        return
      }
    }

    await requireRendererApi().gitCommit({ projectPath, message })
  }

  async function pushChanges(projectPath: string, setUpstream?: boolean): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.post('/api/v1/git/push', { projectPath, setUpstream })
        return
      }
    }

    await requireRendererApi().gitPush({ projectPath, setUpstream })
  }

  async function pullChanges(projectPath: string): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.post('/api/v1/git/pull', { projectPath })
        return
      }
    }

    await requireRendererApi().gitPull(projectPath)
  }

  async function fetchRemote(projectPath: string): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.post('/api/v1/git/fetch', { projectPath })
        return
      }
    }

    await requireRendererApi().gitFetch(projectPath)
  }

  async function checkout(projectPath: string, branch: string): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.post('/api/v1/git/checkout', { projectPath, branch })
        return
      }
    }

    await requireRendererApi().gitCheckout(projectPath, branch)
  }

  async function createBranchRequest(projectPath: string, branch: string): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.post('/api/v1/git/branches', { projectPath, name: branch })
        return
      }
    }

    await requireRendererApi().gitCreateBranch(projectPath, branch)
  }

  async function rebaseOnto(projectPath: string, onto: string): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.post('/api/v1/git/rebase', { projectPath, onto })
        return
      }
    }

    await requireRendererApi().gitRebase({ projectPath, onto })
  }

  async function mergeBranch(projectPath: string, branch: string): Promise<void> {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        await client.post('/api/v1/git/merge', { projectPath, branch })
        return
      }
    }

    await requireRendererApi().gitMerge({ projectPath, branch })
  }

  async function refreshStatus(projectPath: string): Promise<void> {
    try {
      status.value = await fetchStatus(projectPath)
    } catch {
      status.value = null
    }
  }

  async function refreshBranches(projectPath: string): Promise<void> {
    try {
      branches.value = await fetchBranches(projectPath)
    } catch {
      branches.value = null
    }
  }

  async function refreshLog(projectPath: string): Promise<void> {
    try {
      log.value = await fetchLogEntries(projectPath)
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
      await stagePaths(projectPath, [relativePath])
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
      await unstagePaths(projectPath, [relativePath])
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
      await discardPaths(projectPath, [relativePath])
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
      await commitChanges(projectPath, message)
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
      await pushChanges(projectPath, setUpstream)
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
      await pullChanges(projectPath)
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
      await fetchRemote(projectPath)
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
      await checkout(projectPath, branch)
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
      await createBranchRequest(projectPath, branch)
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
      await rebaseOnto(projectPath, onto)
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
      await mergeBranch(projectPath, branch)
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
