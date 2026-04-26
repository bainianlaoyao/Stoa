<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import type { OpenWorkspaceRequest, SessionType, SessionSummaryEvent } from '@shared/project-session'
import AppShell from '@renderer/components/AppShell.vue'
import UpdatePrompt from '@renderer/components/update/UpdatePrompt.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { useSettingsStore } from '@renderer/stores/settings'
import { useUpdateStore } from '@renderer/stores/update'

const workspaceStore = useWorkspaceStore()
const settingsStore = useSettingsStore()
const updateStore = useUpdateStore()
const {
  projectHierarchy,
  activeProjectId,
  activeSessionId,
  activeProject,
  activeSession
} = storeToRefs(workspaceStore)
const {
  state: updateState,
  shouldShowPrompt
} = storeToRefs(updateStore)

function handleProjectSelect(projectId: string): void {
  workspaceStore.setActiveProject(projectId)
  void window.stoa.setActiveProject(projectId)
}

function handleSessionSelect(sessionId: string): void {
  workspaceStore.setActiveSession(sessionId)
  void window.stoa.setActiveSession(sessionId)
}

async function handleProjectCreate(payload: { name: string; path: string }): Promise<void> {
  workspaceStore.clearError()
  try {
    const created = await window.stoa.createProject({ name: payload.name, path: payload.path })
    if (!created) {
      workspaceStore.lastError = 'Failed to create project: no response from main process'
      return
    }
    workspaceStore.addProject(created)
    workspaceStore.setActiveProject(created.id)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

async function handleSessionCreate(payload: { projectId: string; type: string; title: string }): Promise<void> {
  workspaceStore.clearError()
  try {
    const created = await window.stoa.createSession({
      projectId: payload.projectId,
      type: payload.type as SessionType,
      title: payload.title
    })
    if (!created) {
      workspaceStore.lastError = 'Failed to create session: no response from main process'
      return
    }
    workspaceStore.addSession(created)
    workspaceStore.setActiveSession(created.id)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

async function handleArchiveSession(sessionId: string): Promise<void> {
  workspaceStore.archiveSession(sessionId)
  try {
    await window.stoa.archiveSession(sessionId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
    workspaceStore.restoreSession(sessionId)
  }
}

async function handleRestoreSession(sessionId: string): Promise<void> {
  workspaceStore.restoreSession(sessionId)
  workspaceStore.setActiveSession(sessionId)
  try {
    await window.stoa.restoreSession(sessionId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
    workspaceStore.archiveSession(sessionId)
  }
}

async function handleOpenWorkspace(request: OpenWorkspaceRequest): Promise<void> {
  workspaceStore.clearError()
  try {
    await window.stoa.openWorkspace(request)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

let unsubscribeSessionEvent: (() => void) | null = null
let unsubscribeUpdateState: (() => void) | null = null

onMounted(async () => {
  unsubscribeUpdateState = window.stoa.onUpdateState((state) => {
    updateStore.applyState(state)
  })

  const bootstrapState = await window.stoa.getBootstrapState()
  workspaceStore.hydrate(bootstrapState)
  await workspaceStore.hydrateObservability()
  await Promise.all([
    settingsStore.loadSettings(),
    updateStore.refresh()
  ])

  unsubscribeSessionEvent = window.stoa?.onSessionEvent?.((event: SessionSummaryEvent) => {
    workspaceStore.updateSession(event.session.id, event.session)
  })
})

onBeforeUnmount(() => {
  unsubscribeSessionEvent?.()
  unsubscribeUpdateState?.()
  workspaceStore.unsubscribeObservability()
})
</script>

<template>
  <div class="app-root h-full flex flex-col overflow-hidden">
    <AppShell
      class="flex-1 min-h-0"
      :hierarchy="projectHierarchy"
      :active-project-id="activeProjectId"
      :active-session-id="activeSessionId"
      :active-project="activeProject"
      :active-session="activeSession"
      @select-project="handleProjectSelect"
      @select-session="handleSessionSelect"
      @create-project="handleProjectCreate"
      @create-session="handleSessionCreate"
      @archive-session="handleArchiveSession"
      @restore-session="handleRestoreSession"
      @open-workspace="handleOpenWorkspace"
    />
    <UpdatePrompt
      :visible="shouldShowPrompt"
      :state="updateState"
      @dismiss="void updateStore.dismissUpdate()"
      @download="void updateStore.downloadUpdate()"
      @install="void updateStore.quitAndInstallUpdate()"
    />
  </div>
</template>
