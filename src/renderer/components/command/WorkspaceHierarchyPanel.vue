<script setup lang="ts">
import { ref } from 'vue'
import HierarchyNode from './HierarchyNode.vue'
import type { WorkspaceHierarchyGroup } from '@renderer/stores/workspaces'

const props = defineProps<{
  hierarchy: WorkspaceHierarchyGroup[]
}>()

const emit = defineEmits<{
  select: [workspaceId: string]
  createProject: []
}>()

const collapsedGroups = ref<Set<string>>(new Set())

function toggleGroup(groupId: string): void {
  const next = new Set(collapsedGroups.value)
  if (next.has(groupId)) {
    next.delete(groupId)
  } else {
    next.add(groupId)
  }
  collapsedGroups.value = next
}

function isCollapsed(groupId: string): boolean {
  return collapsedGroups.value.has(groupId)
}
</script>

<template>
  <aside class="workspace-hierarchy-panel route-column" aria-label="Internal session and workspace routing">
    <div class="route-body">
      <div class="route-actions">
        <button class="route-action" type="button" @click="emit('createProject')">
          <span class="route-action-label">New Project</span>
          <span class="route-action-icon">+</span>
        </button>
      </div>

      <div class="route-group">
        <div class="group-label">Projects</div>

        <section v-for="group in hierarchy" :key="group.id" class="workspace-group" :data-parent-group="group.id">
          <article class="route-project">
            <button
              class="route-item route-item--parent"
              type="button"
              :class="{ active: group.children.some((child) => child.active), 'route-item--active': group.children.some((child) => child.active) }"
              :data-collapse-toggle="group.id"
              :aria-expanded="!isCollapsed(group.id)"
              @click="toggleGroup(group.id)"
            >
              <span class="route-dot route-dot--idle idle" />
              <span class="route-item__main">
                <span class="route-copy">
                  <span class="route-name">{{ group.title }}</span>
                </span>
              </span>
              <span class="route-project-actions">
                <span class="route-add-session" :data-session-affordance="group.id">+</span>
                <span class="route-time">{{ group.children[0]?.metaLabel ?? '—' }}</span>
              </span>
            </button>

            <HierarchyNode
              v-for="child in isCollapsed(group.id) ? [] : group.children"
              :key="child.workspaceId"
              :parent="group"
              :child="child"
              @select="emit('select', $event)"
            />
          </article>
        </section>
      </div>
    </div>
  </aside>
</template>
