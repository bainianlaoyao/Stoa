<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SessionType } from '@shared/project-session'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import NewProjectModal from './NewProjectModal.vue'
import ProviderFloatingCard from './ProviderFloatingCard.vue'
import ProviderRadialMenu from './ProviderRadialMenu.vue'

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
  archiveSession: [sessionId: string]
}>()

const showNewProject = ref(false)
const workspaceStore = useWorkspaceStore()

const floatingCardVisible = ref(false)
const floatingCardProjectId = ref('')
const floatingCardPosition = ref({ x: 0, y: 0, width: 0, height: 0 })

const radialMenuVisible = ref(false)
const radialMenuProjectId = ref('')
const radialMenuCenter = ref({ x: 0, y: 0 })

let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressActivated = false

function generateTitle(projectId: string, type: SessionType): string {
  const project = props.hierarchy.find(p => p.id === projectId)
  if (type === 'opencode') {
    const projectName = project?.name ?? 'session'
    return `opencode-${projectName}`
  }
  const shellCount = project?.sessions.filter(s => s.type === 'shell').length ?? 0
  return `shell-${shellCount + 1}`
}

function handleFloatingCardCreate(payload: { type: SessionType }) {
  const title = generateTitle(floatingCardProjectId.value, payload.type)
  emit('createSession', { projectId: floatingCardProjectId.value, type: payload.type, title })
  floatingCardVisible.value = false
}

function handleRadialMenuCreate(payload: { type: SessionType }) {
  const title = generateTitle(radialMenuProjectId.value, payload.type)
  emit('createSession', { projectId: radialMenuProjectId.value, type: payload.type, title })
  radialMenuVisible.value = false
}

function closeFloatingCard() {
  floatingCardVisible.value = false
}

function closeRadialMenu() {
  radialMenuVisible.value = false
}

function onAddButtonMouseDown(event: MouseEvent, projectId: string) {
  const buttonEl = event.currentTarget as HTMLElement
  const rect = buttonEl.getBoundingClientRect()

  radialMenuProjectId.value = projectId
  floatingCardProjectId.value = projectId
  floatingCardPosition.value = { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  radialMenuCenter.value = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  longPressActivated = false

  longPressTimer = setTimeout(() => {
    longPressTimer = null
    longPressActivated = true
    floatingCardVisible.value = false
    radialMenuVisible.value = true
  }, 200)
}

function onAddButtonMouseUp() {
  if (longPressActivated) {
    radialMenuVisible.value = false
    longPressActivated = false
    return
  }

  if (longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
    const shouldCloseFloatingCard = floatingCardVisible.value && floatingCardProjectId.value === radialMenuProjectId.value

    floatingCardVisible.value = !shouldCloseFloatingCard
    radialMenuVisible.value = false
  }
}

function onAddButtonMouseLeave() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  longPressActivated = false
}

function onProjectRowContextmenu(event: MouseEvent, projectId: string) {
  event.preventDefault()
  floatingCardProjectId.value = projectId
  floatingCardPosition.value = { x: event.clientX, y: event.clientY, width: 0, height: 0 }
  floatingCardVisible.value = true
  radialMenuVisible.value = false
}

function handleDocumentMouseDown(event: MouseEvent) {
  if (!floatingCardVisible.value) {
    return
  }

  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return
  }

  if (target.closest('.provider-floating-card') || target.closest('.route-add-session')) {
    return
  }

  floatingCardVisible.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMouseDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown)
})

watch(
  () => workspaceStore.isCreatingSession,
  (isCreatingSession, wasCreatingSession) => {
    if (wasCreatingSession && !isCreatingSession && workspaceStore.sessionCreateSucceeded) {
      floatingCardVisible.value = false
      radialMenuVisible.value = false
    }
  }
)

watch(
  () => workspaceStore.isCreatingProject,
  (isCreatingProject, wasCreatingProject) => {
    if (wasCreatingProject && !isCreatingProject && workspaceStore.projectCreateSucceeded) {
      showNewProject.value = false
    }
  }
)
</script>

<template>
  <aside class="workspace-hierarchy-panel" aria-label="Workspace hierarchy">
    <div class="route-body">
      <div class="route-actions">
        <button class="route-action" type="button" @click="showNewProject = true">
          <span class="route-action-label">New Project</span>
          <span class="route-action-icon">+</span>
        </button>
      </div>

      <div class="route-group">
        <h2 class="group-label">Projects</h2>

        <div v-for="project in hierarchy" :key="project.id" class="route-project">
          <div
            class="route-project-row"
            @contextmenu="onProjectRowContextmenu($event, project.id)"
          >
            <button
              class="route-item route-item--parent"
              :class="{ 'route-item--active': project.id === activeProjectId }"
              :aria-current="project.id === activeProjectId ? 'true' : undefined"
              type="button"
              @click="emit('selectProject', project.id)"
            >
              <div class="route-dot idle" />
              <div class="route-copy">
                <div class="route-name">{{ project.name }}</div>
                <div class="route-path">{{ project.path }}</div>
              </div>
            </button>
            <div class="route-project-actions">
              <button
                class="route-add-session"
                type="button"
                :aria-label="`Add session to ${project.name}`"
                title="Add session · long-press for radial"
                @mousedown="onAddButtonMouseDown($event, project.id)"
                @mouseup="onAddButtonMouseUp"
                @mouseleave="onAddButtonMouseLeave"
              >
                +
              </button>
            </div>
          </div>

          <div
            v-for="session in project.sessions"
            :key="session.id"
            class="route-session-row"
          >
            <button
              class="route-item child"
              :class="{ 'route-item--active': session.id === activeSessionId }"
              :aria-current="session.id === activeSessionId ? 'true' : undefined"
              type="button"
              @click="emit('selectSession', session.id)"
            >
              <div class="route-dot" :class="session.status" />
              <div class="route-copy">
                <div class="route-name">{{ session.title }}</div>
                <div class="route-time">{{ session.type }}</div>
              </div>
            </button>
            <button
              class="route-archive-session"
              type="button"
              :aria-label="`Archive ${session.title}`"
              :data-archive-session="session.id"
              @click.stop="emit('archiveSession', session.id)"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    </div>
  </aside>

  <NewProjectModal
    v-model:show="showNewProject"
    :pending="workspaceStore.isCreatingProject"
    @create="emit('createProject', $event)"
  />

  <ProviderFloatingCard
    :visible="floatingCardVisible"
    :project-id="floatingCardProjectId"
    :position="floatingCardPosition"
    @create="handleFloatingCardCreate"
    @close="closeFloatingCard"
  />

  <ProviderRadialMenu
    :visible="radialMenuVisible"
    :project-id="radialMenuProjectId"
    :center="radialMenuCenter"
    @create="handleRadialMenuCreate"
    @close="closeRadialMenu"
  />
</template>
