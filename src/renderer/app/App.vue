<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import WorkspaceList from '@renderer/components/WorkspaceList.vue'
import TerminalViewport from '@renderer/components/TerminalViewport.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

const workspaceStore = useWorkspaceStore()
const { workspaces, activeWorkspaceId, activeWorkspace } = storeToRefs(workspaceStore)
const draftName = ref('')
const draftPath = ref('')
const draftProviderId = ref<'local-shell' | 'opencode'>('local-shell')

let teardown: (() => void) | undefined

function handleWorkspaceSelect(workspaceId: string): void {
  workspaceStore.setActiveWorkspace(workspaceId)
  void window.vibecoding.setActiveWorkspace(workspaceId)
}

async function handleWorkspaceCreate(): Promise<void> {
  const name = draftName.value.trim()
  const path = draftPath.value.trim()
  if (!name || !path) {
    return
  }

  const created = await window.vibecoding.createWorkspace({
    name,
    path,
    providerId: draftProviderId.value
  })

  if (created) {
    workspaceStore.addWorkspace(created)
  }

  draftName.value = ''
  draftPath.value = ''
}

onMounted(async () => {
  const bootstrapState = await window.vibecoding.getBootstrapState()
  workspaceStore.hydrate(bootstrapState)

  teardown = window.vibecoding.onWorkspaceEvent((event) => {
    workspaceStore.applyEvent(event)
  })
})

onUnmounted(() => {
  teardown?.()
})
</script>

<template>
  <main class="app-shell">
    <WorkspaceList
      :workspaces="workspaces"
      :active-workspace-id="activeWorkspaceId"
      v-model:name="draftName"
      v-model:path="draftPath"
      v-model:provider-id="draftProviderId"
      @select="handleWorkspaceSelect"
      @create="handleWorkspaceCreate"
    />
    <TerminalViewport :workspace="activeWorkspace" />
  </main>
</template>
