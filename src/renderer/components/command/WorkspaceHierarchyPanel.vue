<script setup lang="ts">
import { ref } from 'vue'
import type { SessionType } from '@shared/project-session'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import NewProjectModal from './NewProjectModal.vue'
import NewSessionModal from './NewSessionModal.vue'

const props = defineProps<{
  hierarchy: ProjectHierarchyNode[]
  activeProjectId: string | null
  activeSessionId: string | null
}>()

const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: SessionType; title: string }]
}>()

const showNewProject = ref(false)
const showNewSession = ref(false)
const targetProjectId = ref('')

function openSessionModal(projectId: string) {
  targetProjectId.value = projectId
  showNewSession.value = true
}

function handleSessionCreate(payload: { title: string; type: SessionType }) {
  emit('createSession', { ...payload, projectId: targetProjectId.value })
}
</script>

<template>
  <aside class="workspace-hierarchy-panel">
    <div class="route-body">
      <div class="route-actions">
        <button class="route-action" type="button" @click="showNewProject = true">
          <span class="route-action-label">New Project</span>
          <span class="route-action-icon">+</span>
        </button>
      </div>

      <div class="route-group">
        <div class="group-label">Projects</div>

        <div v-for="project in hierarchy" :key="project.id" class="route-project">
          <div
            class="route-item route-item--parent"
            :class="{ 'route-item--active': project.id === activeProjectId }"
            @click="emit('selectProject', project.id)"
          >
            <div class="route-dot idle" />
            <div class="route-copy">
              <div class="route-name">{{ project.name }}</div>
              <div class="route-path">{{ project.path }}</div>
            </div>
            <div class="route-project-actions">
              <button
                class="route-add-session"
                type="button"
                title="Add session"
                @click.stop="openSessionModal(project.id)"
              >
                +
              </button>
            </div>
          </div>

          <button
            v-for="session in project.sessions"
            :key="session.id"
            class="route-item child"
            :class="{ 'route-item--active': session.id === activeSessionId }"
            type="button"
            @click="emit('selectSession', session.id)"
          >
            <div class="route-dot" :class="session.status" />
            <div class="route-copy">
              <div class="route-name">{{ session.title }}</div>
              <div class="route-time">{{ session.type }}</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  </aside>

  <NewProjectModal
    v-model:show="showNewProject"
    @create="emit('createProject', $event)"
  />
  <NewSessionModal
    v-model:show="showNewSession"
    @create="handleSessionCreate"
  />
</template>
