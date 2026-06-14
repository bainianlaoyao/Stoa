import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { UpdateState } from '@shared/update-state'
import { getStoaClient, isStoaClientMode, requireRendererApi } from '@renderer/stores/stoa-store-plugin'

function createDefaultState(): UpdateState {
  return {
    phase: 'idle',
    currentVersion: '0.1.0',
    availableVersion: null,
    downloadedVersion: null,
    downloadProgressPercent: null,
    lastCheckedAt: null,
    message: null,
    requiresSessionWarning: false
  }
}

function createPromptKey(state: UpdateState): string | null {
  if (state.phase === 'available') {
    return `available:${state.availableVersion ?? state.currentVersion}`
  }

  if (state.phase === 'downloaded') {
    return `downloaded:${state.downloadedVersion ?? state.availableVersion ?? state.currentVersion}`
  }

  return null
}

export const useUpdateStore = defineStore('update', () => {
  const state = ref<UpdateState>(createDefaultState())
  const dismissedPromptKey = ref<string | null>(null)

  const promptKey = computed(() => createPromptKey(state.value))
  const shouldShowPrompt = computed(() => {
    return promptKey.value !== null && promptKey.value !== dismissedPromptKey.value
  })

  function applyState(nextState: UpdateState): void {
    state.value = nextState
  }

  function dismissPrompt(): void {
    dismissedPromptKey.value = promptKey.value
  }

  function getUpdateBridge() {
    if (isStoaClientMode()) {
      const client = getStoaClient()
      if (client) {
        // Reuse the existing RendererApi adapter/stub behavior in web mode.
        return requireRendererApi()
      }
    }

    return requireRendererApi()
  }

  async function refresh(): Promise<UpdateState> {
    const nextState = await getUpdateBridge().getUpdateState()
    applyState(nextState)
    return nextState
  }

  async function checkForUpdates(): Promise<UpdateState> {
    const nextState = await getUpdateBridge().checkForUpdates()
    applyState(nextState)
    return nextState
  }

  async function downloadUpdate(): Promise<UpdateState> {
    const nextState = await getUpdateBridge().downloadUpdate()
    applyState(nextState)
    return nextState
  }

  async function quitAndInstallUpdate(): Promise<void> {
    await getUpdateBridge().quitAndInstallUpdate()
  }

  async function dismissUpdate(): Promise<void> {
    await getUpdateBridge().dismissUpdate()
    dismissPrompt()
  }

  return {
    state,
    shouldShowPrompt,
    applyState,
    dismissPrompt,
    refresh,
    checkForUpdates,
    downloadUpdate,
    quitAndInstallUpdate,
    dismissUpdate
  }
})
