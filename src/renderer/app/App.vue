<script setup lang="ts">
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import type { SessionType } from '@shared/project-session'
import AppShell from '@renderer/components/AppShell.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

const workspaceStore = useWorkspaceStore()
const {
  projectHierarchy,
  activeProjectId,
  activeSessionId,
  activeProject,
  activeSession
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
    const created = await window.vibecoding.createSession({
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

onMounted(async () => {
  const bootstrapState = await window.vibecoding.getBootstrapState()
  workspaceStore.hydrate(bootstrapState)
})
</script>

<template>
  <AppShell
    :hierarchy="projectHierarchy"
    :active-project-id="activeProjectId"
    :active-session-id="activeSessionId"
    :active-project="activeProject"
    :active-session="activeSession"
    @select-project="handleProjectSelect"
    @select-session="handleSessionSelect"
    @create-project="handleProjectCreate"
    @create-session="handleSessionCreate"
  />
</template>
