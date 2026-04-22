<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import type { SessionType, SessionStatusEvent } from '@shared/project-session'
import AppShell from '@renderer/components/AppShell.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

const workspaceStore = useWorkspaceStore()
const {
  projectHierarchy,
  activeProjectId,
  activeSessionId,
  activeProject,
  activeSession,
  archivedSessions
} = storeToRefs(workspaceStore)

function handleProjectSelect(projectId: string): void {
  workspaceStore.setActiveProject(projectId)
  void window.vibecoding.setActiveProject(projectId)
}

function handleSessionSelect(sessionId: string): void {
  workspaceStore.setActiveSession(sessionId)
  void window.vibecoding.setActiveSession(sessionId)
}

async function handleProjectCreate(payload: { name: string; path: string }): Promise<void> {
  workspaceStore.clearError()
  try {
    const created = await window.vibecoding.createProject({ name: payload.name, path: payload.path })
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
    console.log('[App.vue] handleSessionCreate:', payload)
    const created = await window.vibecoding.createSession({
      projectId: payload.projectId,
      type: payload.type as SessionType,
      title: payload.title
    })
    console.log('[App.vue] createSession result:', created)
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
    await window.vibecoding.archiveSession(sessionId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
    workspaceStore.restoreSession(sessionId)
  }
}

async function handleRestoreSession(sessionId: string): Promise<void> {
  workspaceStore.restoreSession(sessionId)
  try {
    await window.vibecoding.restoreSession(sessionId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
    workspaceStore.archiveSession(sessionId)
  }
}

let unsubscribeSessionEvent: (() => void) | null = null

onMounted(async () => {
  const bootstrapState = await window.vibecoding.getBootstrapState()
  workspaceStore.hydrate(bootstrapState)
  const archived = await window.vibecoding.listArchivedSessions()
  workspaceStore.setArchivedSessions(archived)

  unsubscribeSessionEvent = window.vibecoding?.onSessionEvent?.((event: SessionStatusEvent) => {
    console.log('[App.vue] onSessionEvent:', event)
    workspaceStore.updateSession(event.sessionId, {
      status: event.status,
      summary: event.summary
    })
  })
})

onBeforeUnmount(() => {
  unsubscribeSessionEvent?.()
})
</script>

<template>
  <AppShell
    :hierarchy="projectHierarchy"
    :active-project-id="activeProjectId"
    :active-session-id="activeSessionId"
    :active-project="activeProject"
    :active-session="activeSession"
    :archived-sessions="archivedSessions"
    @select-project="handleProjectSelect"
    @select-session="handleSessionSelect"
    @create-project="handleProjectCreate"
    @create-session="handleSessionCreate"
    @archive-session="handleArchiveSession"
    @restore-session="handleRestoreSession"
  />
</template>
