<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import AppShell from '@renderer/components/AppShell.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

const workspaceStore = useWorkspaceStore()
const { workspaces, workspaceHierarchy, activeWorkspaceId, activeWorkspace } = storeToRefs(workspaceStore)
const draftName = ref('')
const draftPath = ref('')
const draftProviderId = ref<'local-shell' | 'opencode'>('local-shell')
const createWorkspaceError = ref('')

let teardown: (() => void) | undefined

function handleWorkspaceSelect(workspaceId: string): void {
  workspaceStore.setActiveWorkspace(workspaceId)
  void window.vibecoding.setActiveWorkspace(workspaceId)
}

async function handleWorkspaceCreate(): Promise<void> {
  const name = draftName.value.trim()
  const path = draftPath.value.trim()
  if (!name || !path) {
    createWorkspaceError.value = '请先填写工作区名称和路径'
    return
  }

  try {
    createWorkspaceError.value = ''
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
  } catch (error) {
    createWorkspaceError.value = error instanceof Error ? error.message : '添加工作区失败'
  }
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
  <AppShell
      :workspaces="workspaces"
      :hierarchy="workspaceHierarchy"
      :active-workspace-id="activeWorkspaceId"
      :active-workspace="activeWorkspace"
      v-model:name="draftName"
      v-model:path="draftPath"
      v-model:provider-id="draftProviderId"
      :error-message="createWorkspaceError"
      @select="handleWorkspaceSelect"
      @create="handleWorkspaceCreate"
    />
</template>
