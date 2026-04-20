<script setup lang="ts">
import type { WorkspaceHierarchyChild, WorkspaceHierarchyGroup } from '@renderer/stores/workspaces'

defineProps<{
  parent: WorkspaceHierarchyGroup
  child: WorkspaceHierarchyChild
}>()

const emit = defineEmits<{
  select: [workspaceId: string]
}>()
</script>

<template>
  <button
    class="hierarchy-node route-item child"
    :class="{ 'hierarchy-node--active route-item--active active': child.active }"
    :data-workspace-id="child.workspaceId"
    :data-status="child.status"
    :data-active="String(child.active)"
    type="button"
    @click="emit('select', child.workspaceId)"
  >
    <span class="hierarchy-node__status route-dot" :class="child.status" :data-status="child.status" />
    <span class="hierarchy-node__copy route-copy">
      <span class="route-name">{{ child.label }}</span>
    </span>
    <span class="hierarchy-node__meta route-time">{{ child.metaLabel }}</span>
  </button>
</template>
