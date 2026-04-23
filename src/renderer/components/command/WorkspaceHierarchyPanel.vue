<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { SessionType } from '@shared/project-session'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
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
                class="route-add-session route-icon-button"
                type="button"
                :aria-label="`Add session to ${project.name}`"
                title="Add session · long-press for radial"
                @mousedown="onAddButtonMouseDown($event, project.id)"
                @mouseup="onAddButtonMouseUp"
                @mouseleave="onAddButtonMouseLeave"
              >
                <span class="route-icon-button__glyph" aria-hidden="true">+</span>
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
            <span class="route-row-actions">
              <button
                class="route-row-action route-icon-button"
                type="button"
                :aria-label="`Archive ${session.title}`"
                title="Archive session"
                :data-row-archive="session.id"
                @click.stop="emit('archiveSession', session.id)"
              >
                <svg
                  class="route-icon-button__icon"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M2.5 3.5H13.5V6H2.5V3.5ZM4 7.5H12V12.5H4V7.5ZM6 9.5H10"
                    stroke="currentColor"
                    stroke-width="1.25"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  </aside>

  <NewProjectModal
    v-model:show="showNewProject"
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

<style scoped>
.route-session-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.route-session-row .route-item {
  min-width: 0;
}

.route-project-actions,
.route-row-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.route-icon-button {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-solid);
  color: var(--muted);
  display: grid;
  place-items: center;
  box-shadow: var(--shadow-card);
  cursor: pointer;
  transition: all 0.2s ease;
}

.route-icon-button:hover,
.route-icon-button:focus-visible {
  background: var(--surface);
  color: var(--text-strong);
  border-color: var(--accent);
  outline: none;
}

.route-icon-button__glyph {
  color: currentColor;
  font-size: 14px;
  line-height: 1;
}

.route-icon-button__icon {
  width: 12px;
  height: 12px;
}
</style>
