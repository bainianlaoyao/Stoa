<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SessionRowViewModel } from '@shared/observability'
import type { SessionType } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import NewProjectModal from './NewProjectModal.vue'

const { t } = useI18n()
import ProviderFloatingCard from './ProviderFloatingCard.vue'
import ProviderRadialMenu from './ProviderRadialMenu.vue'

interface DetailState {
  kind: 'project' | 'session'
  name: string
  path?: string
  sessionType?: string
  phase?: string
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
  deleteProject: [projectId: string]
  archiveSession: [sessionId: string]
}>()

const showNewProject = ref(false)

const collapsedProjectIds = ref<Set<string>>(new Set())

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

function providerIcon(type: SessionType): string {
  const map: Record<SessionType, string> = {
    'claude-code': new URL('@renderer/assets/providers/claude-code.svg', import.meta.url).href,
    'shell': new URL('@renderer/assets/providers/shell.svg', import.meta.url).href,
    'codex': new URL('@renderer/assets/providers/codex.svg', import.meta.url).href,
    'opencode': new URL('@renderer/assets/providers/opencode.svg', import.meta.url).href,
  }
  return map[type]
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

function sessionTone(session: ProjectHierarchyNode['sessions'][number]): string {
  return sessionRowViewModel(session.id)?.tone ?? 'neutral'
}

function sessionPrimaryLabel(session: ProjectHierarchyNode['sessions'][number]): string | null {
  return sessionRowViewModel(session.id)?.primaryLabel ?? null
}

function sessionStatusLabel(session: ProjectHierarchyNode['sessions'][number]): string | null {
  const viewModel = sessionRowViewModel(session.id)
  if (!viewModel) return null
  const parts: string[] = []
  if (viewModel.primaryLabel) parts.push(viewModel.primaryLabel)
  if (viewModel.updatedAgoLabel) parts.push(viewModel.updatedAgoLabel)
  return parts.length ? parts.join(' ') : null
}

function sessionPhase(session: ProjectHierarchyNode['sessions'][number]): string {
  return sessionRowViewModel(session.id)?.phase ?? 'unknown'
}

function sessionAttentionReason(session: ProjectHierarchyNode['sessions'][number]): string | null {
  return sessionRowViewModel(session.id)?.attentionReason ?? null
}

function isProjectCollapsed(projectId: string): boolean {
  return collapsedProjectIds.value.has(projectId)
}

function toggleProjectCollapse(projectId: string): void {
  const next = new Set(collapsedProjectIds.value)
  if (next.has(projectId)) {
    next.delete(projectId)
  } else {
    next.add(projectId)
  }
  collapsedProjectIds.value = next
}

function toggleAllCollapsed(): void {
  if (collapsedProjectIds.value.size === props.hierarchy.length) {
    collapsedProjectIds.value = new Set()
  } else {
    collapsedProjectIds.value = new Set(props.hierarchy.map(p => p.id))
  }
}

function openDetail(event: MouseEvent | KeyboardEvent, kind: 'project', project: ProjectHierarchyNode): void
function openDetail(event: MouseEvent | KeyboardEvent, kind: 'session', session: { title: string; type: string; phase: string }): void
function openDetail(event: MouseEvent | KeyboardEvent, kind: 'project' | 'session', data: ProjectHierarchyNode | { title: string; type: string; phase: string }): void {
  event.stopPropagation()
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const x = rect.right + 4
  const y = rect.top

  if (kind === 'project') {
    const project = data as ProjectHierarchyNode
    detailState.value = { kind: 'project', name: project.name, path: project.path, x, y }
  } else {
    const session = data as { title: string; type: string; phase: string }
    const descriptor = getProviderDescriptorBySessionType(session.type as SessionType)
    detailState.value = {
      kind: 'session',
      name: descriptor.displayName,
      sessionType: session.type,
      phase: session.phase.replace(/_/g, ' '),
      x,
      y
    }
  }
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
  <aside class="min-h-0 overflow-hidden rounded-[var(--radius-sm)] bg-surface" data-testid="workspace-hierarchy-panel" aria-label="Workspace hierarchy">
    <div class="min-h-0 overflow-auto p-2.5 grid gap-3 align-content-start" data-testid="route-body">
      <div class="grid gap-1" data-testid="route-actions">
        <button class="route-action flex items-center justify-between gap-2 px-2.5 py-2 rounded-[var(--radius-sm)] bg-surface-solid text-text-strong cursor-pointer transition-all duration-200 hover:bg-black-faint focus-visible:bg-black-faint focus-visible:outline-none" type="button" data-testid="workspace.new-project" @click="showNewProject = true">
          <span class="text-xs font-semibold tracking-[0.05em]">{{ t('workspace.newProject') }}</span>
          <span class="w-[18px] h-[18px] grid place-items-center rounded-[var(--radius-sm)] bg-canvas text-text-strong text-xs">+</span>
        </button>
      </div>

      <div class="grid gap-1">
        <button class="group-label" type="button" @click="toggleAllCollapsed">
          <span class="group-label__chevron" :class="{ 'group-label__chevron--collapsed': collapsedProjectIds.size === hierarchy.length && hierarchy.length > 0 }">▾</span>
          {{ t('workspace.eyebrow') }}
        </button>

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
              @click="toggleProjectCollapse(project.id); emit('selectProject', project.id)"
            >
              <span class="route-collapse-chevron" :class="{ 'route-collapse-chevron--collapsed': isProjectCollapsed(project.id) }">▾</span>
              <span class="route-detail-trigger" role="button" tabindex="0" :aria-label="t('workspace.projectDetails')" @click="openDetail($event, 'project', project)" @keydown.enter="openDetail($event, 'project', project)">
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
                class="route-delete-project route-icon-button"
                type="button"
                data-testid="workspace.delete-project"
                :data-project-id="project.id"
                :aria-label="t('workspace.deleteProject', { name: project.name })"
                :title="t('workspace.deleteProjectTitle')"
                @click.stop="emit('deleteProject', project.id)"
              >
                <svg class="route-icon-button__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M4 4H12L11.5 13H4.5L4 4Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" />
                  <path d="M6.5 6.5V10.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
                  <path d="M9.5 6.5V10.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
                  <path d="M3 4H13" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
                  <path d="M6.5 2.5H9.5V4H6.5V2.5Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" />
                </svg>
              </button>
              <button
                class="route-add-session route-icon-button"
                type="button"
                data-testid="workspace.add-session"
                :data-project-id="project.id"
                :aria-label="t('workspace.addSessionTo', { name: project.name })"
                :title="t('workspace.addSessionTitle')"
                @mousedown="onAddButtonMouseDown($event, project.id)"
                @mouseup="onAddButtonMouseUp"
                @mouseleave="onAddButtonMouseLeave"
              >
                <span class="route-icon-button__glyph" aria-hidden="true">+</span>
              </button>
            </div>
          </div>

          <template v-if="!isProjectCollapsed(project.id)">
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
              @contextmenu.prevent="openDetail($event, 'session', { title: session.title, type: session.type, phase: sessionPrimaryLabel(session) ?? sessionPhase(session) })"
            >
              <div
                class="route-dot"
                data-testid="session-status-dot"
                :data-tone="sessionTone(session)"
                :data-phase="sessionPhase(session)"
                :data-session-status-testid="`session-status-${sessionPhase(session)}`"
                :data-attention-reason="sessionAttentionReason(session) ?? undefined"
              />
              <img class="route-provider-icon" :src="providerIcon(session.type)" :alt="session.type" />
              <span class="route-session-name">{{ session.title }}</span>
              <span v-if="sessionStatusLabel(session)" class="route-session-label">{{ sessionStatusLabel(session) }}</span>
            </button>
            <span class="route-row-actions">
              <button
                class="route-row-action route-icon-button"
                type="button"
                data-testid="workspace.archive-session"
                :data-session-id="session.id"
                :aria-label="t('workspace.archiveSession', { title: session.title })"
                :title="t('workspace.archiveSessionTitle')"
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
          </template>
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
      <div v-if="detailState.phase" class="detail-popover__info">{{ detailState.phase }}</div>
    </div>
  </Teleport>
</template>

<style scoped>
.route-session-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  min-width: 0;
  position: relative;
}

.route-session-row .route-item {
  min-width: 0;
}

.route-project-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.route-project:hover .route-project-actions,
.route-project:focus-within .route-project-actions {
  opacity: 1;
}

.route-row-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.route-session-row:hover .route-row-actions,
.route-session-row:focus-within .route-row-actions {
  opacity: 1;
}

.route-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 5px 8px 5px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.route-item.child {
  grid-template-columns: 6px 14px minmax(0, 1fr) auto;
  gap: 6px;
  padding: 4px 8px 4px 20px;
}

.route-item:hover:not(.route-item--active),
.route-item:focus-visible {
  background: var(--color-black-faint);
  outline: none;
}

.route-item--active {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

.route-session-row:has(.route-item--active)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 0;
  background: var(--color-active-indicator);
}

.route-item--active .route-name {
  font-weight: 600;
}

.route-item--active .route-session-label {
  color: var(--color-text);
  font-weight: 500;
}

.route-item:not(.route-item--active) .route-session-label {
  color: var(--color-subtle);
}

.route-item--parent {
  padding-right: 10px;
  padding-left: 24px;
}

.route-detail-trigger {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
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
  opacity: 0;
  z-index: 1;
}

.route-item:hover .route-detail-trigger,
.route-item:focus-within .route-detail-trigger {
  opacity: 1;
}

.route-detail-trigger svg {
  width: 14px;
  height: 14px;
}

.route-detail-trigger:hover {
  background: var(--color-black-faint);
  color: var(--color-text-strong);
}

.route-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.route-copy--session {
  display: flex;
  align-items: center;
  gap: 6px;
}

.route-provider-icon {
  flex: none;
  height: 1em;
  width: auto;
}

.route-session-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-muted);
  font: var(--text-caption) var(--font-mono);
}

.route-session-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-body-sm);
  font-weight: 400;
  color: var(--color-muted);
}

.route-item.child.route-item--active .route-session-name {
  color: var(--color-text-strong);
  font-weight: 600;
}

.route-item.child:not(.route-item--active) .route-session-name {
  color: var(--color-muted);
  font-weight: 400;
}

.route-name {
  overflow: hidden;
  color: var(--color-text-strong);
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--text-body-sm);
  font-weight: 600;
}

.route-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid transparent;
  background: var(--color-subtle);
  opacity: 0.85;
}

.route-dot[data-tone='neutral'] {
  background: var(--color-subtle);
}

.route-dot[data-tone='success'] {
  background: var(--color-success);
  box-shadow: var(--shadow-success-ring);
}

.route-dot[data-tone='accent'] {
  background: var(--color-accent);
}

.route-dot[data-tone='warning'] {
  background: var(--color-warning);
}

.route-dot[data-phase='blocked'] {
  border-color: var(--color-line);
  box-shadow: inset 0 0 0 1px var(--color-surface-solid);
  opacity: 1;
}

.route-dot[data-phase='degraded'] {
  opacity: 0.7;
}

.route-dot[data-tone='danger'] {
  background: var(--color-error);
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

.group-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--color-muted);
  background: transparent;
  border: 0;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: color 0.15s ease;
}

.group-label:hover {
  color: var(--color-text-strong);
}

.group-label__chevron {
  display: inline-block;
  font-size: var(--text-caption);
  opacity: 0.6;
  transition: transform 0.15s ease;
}

.group-label__chevron--collapsed {
  transform: rotate(-90deg);
}

.route-collapse-chevron {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  line-height: 1;
  color: var(--color-muted);
  opacity: 0.5;
  transition: transform 0.15s ease, opacity 0.15s ease;
  flex: none;
  user-select: none;
}

.route-item:hover .route-collapse-chevron {
  opacity: 0.8;
}

.route-collapse-chevron--collapsed {
  transform: translateY(-50%) rotate(-90deg);
}

.route-delete-project {
  color: var(--color-muted);
}

.route-delete-project:hover {
  color: var(--color-error);
}

.route-icon-button {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--color-surface-solid);
  color: var(--color-muted);
  display: grid;
  place-items: center;
  box-shadow: none;
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
