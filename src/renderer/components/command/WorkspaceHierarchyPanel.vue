<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { SessionRowViewModel } from '@shared/observability'
import type { SessionStatus, SessionType } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import NewProjectModal from './NewProjectModal.vue'
import ProviderFloatingCard from './ProviderFloatingCard.vue'
import ProviderRadialMenu from './ProviderRadialMenu.vue'

interface DetailState {
  kind: 'project' | 'session'
  name: string
  path?: string
  sessionType?: string
  status?: string
  x: number
  y: number
}

const props = defineProps<{
  hierarchy: ProjectHierarchyNode[]
  activeProjectId: string | null
  activeSessionId: string | null
  sessionRowViewModels?: Record<string, SessionRowViewModel>
}>()

const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: SessionType; title: string }]
  archiveSession: [sessionId: string]
}>()

const showNewProject = ref(false)

const detailState = ref<DetailState | null>(null)

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
  const descriptor = getProviderDescriptorBySessionType(type)
  if (type === 'shell') {
    const shellCount = project?.sessions.filter(s => s.type === 'shell').length ?? 0
    return `shell-${shellCount + 1}`
  }
  const projectName = project?.name ?? 'session'
  return `${descriptor.titlePrefix}-${projectName}`
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

function sessionRowViewModel(sessionId: string): SessionRowViewModel | null {
  return props.sessionRowViewModels?.[sessionId] ?? null
}

function sessionSecondaryLabel(session: ProjectHierarchyNode['sessions'][number]): string {
  const viewModel = sessionRowViewModel(session.id)

  if (viewModel) {
    return viewModel.secondaryLabel
  }

  return session.type
}

function sessionTone(session: ProjectHierarchyNode['sessions'][number]): string {
  return sessionRowViewModel(session.id)?.tone ?? 'neutral'
}

function sessionPrimaryLabel(session: ProjectHierarchyNode['sessions'][number]): string | null {
  return sessionRowViewModel(session.id)?.primaryLabel ?? null
}

function sessionPhase(session: ProjectHierarchyNode['sessions'][number]): string {
  return sessionRowViewModel(session.id)?.phase ?? 'unknown'
}

function sessionAttentionReason(session: ProjectHierarchyNode['sessions'][number]): string | null {
  return sessionRowViewModel(session.id)?.attentionReason ?? null
}

function sessionStatusClasses(session: ProjectHierarchyNode['sessions'][number]): Record<string, boolean> {
  const tone = sessionTone(session)
  const phase = sessionPhase(session)

  return {
    'route-dot--tone-neutral': tone === 'neutral',
    'route-dot--tone-success': tone === 'success',
    'route-dot--tone-warning': tone === 'warning',
    'route-dot--tone-danger': tone === 'danger',
    'route-dot--attention-complete': phase === 'complete',
    'route-dot--attention-blocked': phase === 'blocked',
    'route-dot--attention-failed': phase === 'failed'
  }
}

function openDetail(event: MouseEvent | KeyboardEvent, kind: 'project', project: ProjectHierarchyNode): void
function openDetail(event: MouseEvent | KeyboardEvent, kind: 'session', session: { title: string; type: string; status: SessionStatus }): void
function openDetail(event: MouseEvent | KeyboardEvent, kind: 'project' | 'session', data: ProjectHierarchyNode | { title: string; type: string; status: SessionStatus }): void {
  event.stopPropagation()
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const x = rect.right + 4
  const y = rect.top

  if (kind === 'project') {
    const p = data as ProjectHierarchyNode
    detailState.value = { kind: 'project', name: p.name, path: p.path, x, y }
  } else {
    const s = data as { title: string; type: string; status: SessionStatus }
    detailState.value = { kind: 'session', name: s.title, sessionType: s.type, status: s.status.replace(/_/g, ' '), x, y }
  }
}

function closeDetail() {
  detailState.value = null
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
  }, 100)
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
  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return
  }

  if (detailState.value && !target.closest('.detail-popover')) {
    detailState.value = null
  }

  if (!floatingCardVisible.value) {
    return
  }

  if (target.closest('.provider-floating-card') || target.closest('.route-add-session')) {
    return
  }

  floatingCardVisible.value = false
}

function handleDocumentMouseUp() {
  if (!radialMenuVisible.value) {
    return
  }

  radialMenuVisible.value = false
  longPressActivated = false
}

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMouseDown)
  document.addEventListener('mouseup', handleDocumentMouseUp)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown)
  document.removeEventListener('mouseup', handleDocumentMouseUp)
})
</script>

<template>
  <aside class="min-h-0 overflow-hidden rounded-[var(--radius-sm)] bg-surface border border-line" data-testid="workspace-hierarchy-panel" aria-label="Workspace hierarchy">
    <div class="min-h-0 overflow-auto p-2.5 grid gap-3 align-content-start" data-testid="route-body">
      <div class="grid gap-1" data-testid="route-actions">
        <button class="route-action flex items-center justify-between gap-2 px-2.5 py-2 border border-line rounded-[var(--radius-sm)] bg-surface-solid text-text-strong shadow-card cursor-pointer transition-all duration-200 hover:bg-black-faint focus-visible:bg-black-faint focus-visible:outline-none" type="button" data-testid="workspace.new-project" @click="showNewProject = true">
          <span class="text-xs font-semibold tracking-[0.05em]">New Project</span>
          <span class="w-[18px] h-[18px] grid place-items-center rounded-[var(--radius-sm)] bg-canvas text-text-strong text-xs">+</span>
        </button>
      </div>

      <div class="grid gap-1">
        <div class="group-label">Projects</div>

        <div v-for="project in hierarchy" :key="project.id" class="route-project grid gap-1">
          <div
            class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center"
            @contextmenu="onProjectRowContextmenu($event, project.id)"
          >
            <button
              class="route-item route-item--parent"
              :class="{ 'route-item--active': project.id === activeProjectId }"
              :aria-current="project.id === activeProjectId ? 'true' : undefined"
              data-testid="project-row"
              :data-project-name="project.name"
              type="button"
              @click="emit('selectProject', project.id)"
            >
              <span class="route-detail-trigger" role="button" tabindex="0" aria-label="Project details" @click="openDetail($event, 'project', project)" @keydown.enter="openDetail($event, 'project', project)">
                <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <circle cx="8" cy="3.5" r="1.25" fill="currentColor" />
                  <circle cx="8" cy="8" r="1.25" fill="currentColor" />
                  <circle cx="8" cy="12.5" r="1.25" fill="currentColor" />
                </svg>
              </span>
              <div class="route-copy">
                <div class="route-name">{{ project.name }}</div>
              </div>
            </button>
            <div class="route-project-actions">
              <button
                class="route-add-session route-icon-button"
                type="button"
                data-testid="workspace.add-session"
                :data-project-id="project.id"
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
              data-testid="session-row"
              :data-session-title="session.title"
              :data-session-type="session.type"
              type="button"
              @click="emit('selectSession', session.id)"
            >
              <div
                class="route-dot"
                :class="sessionStatusClasses(session)"
                data-testid="session-status-dot"
                :data-status="session.status"
                :data-tone="sessionTone(session)"
                :data-phase="sessionPhase(session)"
                :data-attention-reason="sessionAttentionReason(session) ?? undefined"
              />
              <div class="route-copy">
                <div class="route-name">{{ session.title }}</div>
                <div class="route-time">
                  <span v-if="sessionPrimaryLabel(session)" class="route-time__primary">{{ sessionPrimaryLabel(session) }}</span>
                  <span v-if="sessionPrimaryLabel(session) && sessionSecondaryLabel(session)" class="route-time__separator" aria-hidden="true"> · </span>
                  <span class="route-time__secondary">{{ sessionSecondaryLabel(session) }}</span>
                </div>
              </div>
            </button>
            <span class="route-row-actions">
              <button
                class="route-row-action route-icon-button"
                type="button"
                data-testid="workspace.archive-session"
                :data-session-id="session.id"
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

  <Teleport to="body">
    <div
      v-if="detailState"
      class="detail-popover"
      :style="{ left: `${detailState.x}px`, top: `${detailState.y}px` }"
    >
      <div class="detail-popover__name">{{ detailState.name }}</div>
      <div v-if="detailState.path" class="detail-popover__info">{{ detailState.path }}</div>
      <div v-if="detailState.sessionType" class="detail-popover__info">{{ detailState.sessionType }}</div>
      <div v-if="detailState.status" class="detail-popover__info">{{ detailState.status }}</div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Layout */
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

/* Route items */
.route-item {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 6px 8px 6px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

/* Session rows use the original dot column */
.route-item.child {
  grid-template-columns: 8px minmax(0, 1fr);
  gap: 10px;
  padding: 6px 8px 6px 10px;
  padding-left: 24px;
}

.route-item:hover:not(.route-item--active),
.route-item:focus-visible {
  background: var(--color-black-faint);
  outline: none;
}

.route-item--active {
  background: var(--color-surface-solid);
  border-color: var(--color-line);
  box-shadow: var(--shadow-card);
}

.route-item--parent {
  padding-right: 10px;
}

/* Detail trigger (⋮) */
.route-detail-trigger {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-subtle);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.route-detail-trigger svg {
  width: 14px;
  height: 14px;
}

.route-detail-trigger:hover {
  background: var(--color-black-faint);
  color: var(--color-text-strong);
}

/* Copy/text */
.route-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.route-name {
  overflow: hidden;
  color: var(--color-text-strong);
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--text-body-sm);
  font-weight: 600;
}

/* Route dot status colors (session rows only) */
.route-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid transparent;
  background: var(--color-subtle);
  opacity: 0.85;
}

.route-dot--tone-neutral {
  background: var(--color-subtle);
  border-color: var(--color-line);
  box-shadow: none;
  opacity: 0.72;
}

.route-dot--tone-success {
  background: var(--color-success);
  box-shadow: var(--shadow-success-ring);
  opacity: 0.9;
}

.route-dot--tone-warning {
  background: var(--color-warning);
  opacity: 0.95;
}

.route-dot--attention-complete {
  background: var(--color-warning);
  border-color: var(--color-line);
  box-shadow: inset 0 0 0 1px var(--color-surface-solid);
  opacity: 1;
}

.route-dot--attention-blocked {
  border-color: var(--color-line);
  box-shadow: inset 0 0 0 1px var(--color-surface-solid);
  opacity: 1;
}

.route-dot--tone-danger {
  background: var(--color-error);
  opacity: 1;
}

.route-dot--attention-failed {
  background: var(--color-error);
  opacity: 1;
}

.route-time {
  min-width: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 0;
  color: var(--color-muted);
  font: var(--text-caption) var(--font-mono);
}

.route-time__primary,
.route-time__secondary,
.route-time__separator {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.route-time__primary {
  color: var(--color-subtle);
}

/* Detail popover */
.detail-popover {
  position: fixed;
  z-index: 100;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-glass);
  padding: 8px 10px;
  max-width: 280px;
  min-width: 160px;
  display: grid;
  gap: 4px;
}

.detail-popover__name {
  font-size: var(--text-body-sm);
  font-weight: 600;
  color: var(--color-text-strong);
}

.detail-popover__info {
  overflow: hidden;
  color: var(--color-muted);
  font: var(--text-caption) var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Group label */
.group-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--color-muted);
}

.group-label::before {
  content: '\25BE';
  font-size: var(--text-caption);
  opacity: 0.6;
}

/* Icon buttons */
.route-icon-button {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-surface-solid);
  color: var(--color-muted);
  display: grid;
  place-items: center;
  box-shadow: var(--shadow-card);
  cursor: pointer;
  transition: all 0.2s ease;
}

.route-icon-button:hover,
.route-icon-button:focus-visible {
  background: var(--color-surface);
  color: var(--color-text-strong);
  border-color: var(--color-accent);
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

/* Add session button */
.route-add-session {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--color-muted);
  font-size: 14px;
  line-height: 1;
  font-weight: 400;
  flex: none;
  cursor: pointer;
}

.route-add-session:hover {
  background: var(--color-black-soft);
  color: var(--color-text-strong);
}
</style>
