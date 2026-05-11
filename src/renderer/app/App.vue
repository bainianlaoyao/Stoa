<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import type { OpenWorkspaceRequest, SessionType } from '@shared/project-session'
import AppShell from '@renderer/components/AppShell.vue'
import MemoryToastHost from '@renderer/components/memory/MemoryToastHost.vue'
import UpdatePrompt from '@renderer/components/update/UpdatePrompt.vue'
import { useMetaSessionStore } from '@renderer/stores/meta-session'
import { useMemoryNotificationsStore } from '@renderer/stores/memory-notifications'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { useSettingsStore } from '@renderer/stores/settings'
import { useUpdateStore } from '@renderer/stores/update'

const workspaceStore = useWorkspaceStore()
const metaSessionStore = useMetaSessionStore()
const settingsStore = useSettingsStore()
const updateStore = useUpdateStore()
const memoryNotificationsStore = useMemoryNotificationsStore()
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
const { notifications: memoryNotifications } = storeToRefs(memoryNotificationsStore)

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

async function handleProjectDelete(projectId: string): Promise<void> {
  workspaceStore.clearError()
  const project = workspaceStore.projects.find(p => p.id === projectId)
  if (!project) return
  try {
    await window.stoa.deleteProject(projectId)
    workspaceStore.removeProject(projectId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

async function handleArchiveSession(sessionId: string): Promise<void> {
  workspaceStore.clearError()
  try {
    await window.stoa.archiveSession(sessionId)
    workspaceStore.archiveSession(sessionId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

async function handleRestoreSession(sessionId: string): Promise<void> {
  workspaceStore.clearError()
  try {
    await window.stoa.restoreSession(sessionId)
    workspaceStore.restoreSession(sessionId)
    workspaceStore.setActiveSession(sessionId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

async function handleRestartSession(sessionId: string): Promise<void> {
  workspaceStore.clearError()
  workspaceStore.setActiveSession(sessionId)
  try {
    await window.stoa.restartSession(sessionId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
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

let unsubscribeUpdateState: (() => void) | null = null
let unsubscribeMemoryNotification: (() => void) | null = null
let unsubscribeMetaSessionEvents: (() => void) | null = null
let isUnmounted = false

onMounted(async () => {
  unsubscribeUpdateState = window.stoa.onUpdateState((state) => {
    updateStore.applyState(state)
  })
  unsubscribeMemoryNotification = window.stoa.onMemoryNotification((event) => {
    if (event.sessionId !== activeSessionId.value) {
      return
    }
    memoryNotificationsStore.enqueue(event)
  })

  const bootstrapState = await window.stoa.getBootstrapState()
  if (isUnmounted) {
    return
  }

  workspaceStore.hydrate(bootstrapState)
  await workspaceStore.hydrateObservability()
  if (isUnmounted) {
    workspaceStore.unsubscribeObservability()
    return
  }

  unsubscribeMetaSessionEvents = await metaSessionStore.bootstrapFromBridge()
  if (isUnmounted) {
    unsubscribeMetaSessionEvents?.()
    unsubscribeMetaSessionEvents = null
    workspaceStore.unsubscribeObservability()
    return
  }

  await Promise.all([
    settingsStore.loadSettings(),
    updateStore.refresh()
  ])
  if (isUnmounted) {
    return
  }

  void settingsStore.detectAndSetVscode()
  if (isUnmounted) {
    return
  }
})

onBeforeUnmount(() => {
  isUnmounted = true
  unsubscribeUpdateState?.()
  unsubscribeMemoryNotification?.()
  unsubscribeMetaSessionEvents?.()
  memoryNotificationsStore.reset()
  metaSessionStore.unsubscribe()
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
      @delete-project="handleProjectDelete"
      @archive-session="handleArchiveSession"
      @restart-session="handleRestartSession"
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
    <MemoryToastHost :notifications="memoryNotifications" />
  </div>
</template>
