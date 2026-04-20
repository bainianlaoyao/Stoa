<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { SessionType } from '@shared/project-session'
import WorkspaceList from '@renderer/components/WorkspaceList.vue'
import TerminalViewport from '@renderer/components/TerminalViewport.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

const workspaceStore = useWorkspaceStore()
const {
  projectHierarchy,
  activeProjectId,
  activeSessionId,
  activeProject,
  activeSession
} = storeToRefs(workspaceStore)

const draftProjectName = ref('')
const draftProjectPath = ref('')
const draftSessionTitle = ref('')
const draftSessionType = ref<SessionType>('shell')

function handleProjectSelect(projectId: string): void {
  workspaceStore.setActiveProject(projectId)
  void window.vibecoding.setActiveProject(projectId)
}

function handleSessionSelect(sessionId: string): void {
  workspaceStore.setActiveSession(sessionId)
  void window.vibecoding.setActiveSession(sessionId)
}

async function handleProjectCreate(): Promise<void> {
  const name = draftProjectName.value.trim()
  const path = draftProjectPath.value.trim()
  if (!name || !path) {
    return
  }

  const created = await window.vibecoding.createProject({ name, path })
  workspaceStore.addProject(created)
  workspaceStore.setActiveProject(created.id)
  draftProjectName.value = ''
  draftProjectPath.value = ''
}

async function handleSessionCreate(projectId: string): Promise<void> {
  const title = draftSessionTitle.value.trim()
  if (!title) {
    return
  }

  const created = await window.vibecoding.createSession({
    projectId,
    type: draftSessionType.value,
    title
  })
  workspaceStore.addSession(created)
  workspaceStore.setActiveSession(created.id)
  draftSessionTitle.value = ''
}

onMounted(async () => {
  const bootstrapState = await window.vibecoding.getBootstrapState()
  workspaceStore.hydrate(bootstrapState)
})
</script>

<template>
  <main class="app-shell">
    <WorkspaceList
      :hierarchy="projectHierarchy"
      :active-project-id="activeProjectId"
      :active-session-id="activeSessionId"
      v-model:project-name="draftProjectName"
      v-model:project-path="draftProjectPath"
      v-model:session-title="draftSessionTitle"
      v-model:session-type="draftSessionType"
      @select-project="handleProjectSelect"
      @select-session="handleSessionSelect"
      @create-project="handleProjectCreate"
      @create-session="handleSessionCreate"
    />
    <TerminalViewport :project="activeProject" :session="activeSession" />
  </main>
</template>
