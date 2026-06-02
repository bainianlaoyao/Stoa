import { ref, readonly, watch, onMounted, onUnmounted, type Ref } from 'vue'
import { useGitStore } from '@renderer/stores/git'

const POLL_INTERVAL = 30_000

/**
 * Polls git status at a fixed interval, keeping the shared GitStore fresh.
 *
 * - Starts polling on mount, stops on unmount.
 * - Resets and re-fetches immediately when the project path changes.
 * - Pauses while the window is hidden and resumes on visibility regain.
 */
export function useGitStatusPolling(projectPath: Ref<string | null | undefined>): {
  refreshing: Readonly<Ref<boolean>>
  refreshGitStatus: () => Promise<void>
} {
  const gitStore = useGitStore()
  const refreshing = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  async function refresh(): Promise<void> {
    if (!projectPath.value) return
    refreshing.value = true
    try {
      await gitStore.refreshAll(projectPath.value)
    } catch {
      // Swallow — the store already nullifies its state on failure
    } finally {
      refreshing.value = false
    }
  }

  function startPolling(): void {
    stopPolling()
    void refresh()
    timer = setInterval(() => void refresh(), POLL_INTERVAL)
  }

  function stopPolling(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  // Re-fetch when the active project changes
  watch(projectPath, () => {
    startPolling()
  })

  // Pause while hidden, resume when visible
  function onVisibilityChange(): void {
    if (document.hidden) {
      stopPolling()
    } else {
      startPolling()
    }
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange)
    startPolling()
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    stopPolling()
  })

  return {
    refreshing: readonly(refreshing),
    refreshGitStatus: refresh,
  }
}
