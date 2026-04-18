import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AppBootstrapState, WorkspaceEvent, WorkspaceSummary } from '@shared/workspace'

export const useWorkspaceStore = defineStore('workspaces', () => {
  const workspaces = ref<WorkspaceSummary[]>([])
  const activeWorkspaceId = ref<string | null>(null)
  const terminalWebhookPort = ref<number | null>(null)

  const activeWorkspace = computed(() => {
    return workspaces.value.find((workspace) => workspace.workspaceId === activeWorkspaceId.value) ?? null
  })

  function hydrate(state: AppBootstrapState): void {
    workspaces.value = state.workspaces
    activeWorkspaceId.value = state.activeWorkspaceId
    terminalWebhookPort.value = state.terminalWebhookPort
  }

  function setActiveWorkspace(workspaceId: string): void {
    activeWorkspaceId.value = workspaceId
  }

  function addWorkspace(workspace: WorkspaceSummary): void {
    workspaces.value.push(workspace)
  }

  function applyEvent(event: WorkspaceEvent): void {
    const target = workspaces.value.find((workspace) => workspace.workspaceId === event.workspace_id)
    if (!target) {
      return
    }

    target.status = event.payload.status ?? target.status
    target.summary = event.payload.summary ?? target.summary
    target.isProvisional = event.payload.is_provisional ?? target.isProvisional
    target.cliSessionId = event.session_id ?? target.cliSessionId
    target.providerId = event.provider_id
  }

  return {
    workspaces,
    activeWorkspaceId,
    terminalWebhookPort,
    activeWorkspace,
    hydrate,
    addWorkspace,
    setActiveWorkspace,
    applyEvent
  }
})
