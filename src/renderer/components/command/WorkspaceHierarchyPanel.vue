<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SessionRowViewModel } from '@shared/observability'
import type { SessionType } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import NewProjectModal from './NewProjectModal.vue'
import ProviderFloatingCard from './ProviderFloatingCard.vue'
import ProviderRadialMenu from './ProviderRadialMenu.vue'
import SessionContextMenu from './SessionContextMenu.vue'

const { t } = useI18n()

interface SessionContextMenuItem {
  id: string
  label: string
  description?: string
  danger?: boolean
  disabled?: boolean
}

interface DetailState {
  kind: 'project' | 'session'
  name: string
  path?: string
  sessionType?: string
  phase?: string
  x: number
  y: number
}

type HierarchySession = ProjectHierarchyNode['sessions'][number]

interface SessionTreeRow {
  session: HierarchySession
  depth: number
}

interface ProjectTreeView extends ProjectHierarchyNode {
  liveRows: SessionTreeRow[]
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
  restoreSession: [sessionId: string]
  regenerateSessionTitle: [sessionId: string]
  restartSession: [sessionId: string]
}>()

const showNewProject = ref(false)
const LONG_PRESS_MS = 220

const collapsedProjectIds = ref<Set<string>>(new Set())

const detailState = ref<DetailState | null>(null)

const floatingCardVisible = ref(false)
const floatingCardProjectId = ref('')
const floatingCardPosition = ref({ x: 0, y: 0, width: 0, height: 0 })

const radialMenuVisible = ref(false)
const radialMenuProjectId = ref('')
const radialMenuCenter = ref({ x: 0, y: 0 })

const sessionContextMenuVisible = ref(false)
const sessionContextMenuSessionId = ref('')
const sessionContextMenuSessionTitle = ref('')
const sessionContextMenuPosition = ref({ x: 0, y: 0 })

let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressActivated = false
let addButtonPressStartedAt = 0
let addButtonPressedProjectId: string | null = null

function buildSessionRows(sessionList: HierarchySession[]): SessionTreeRow[] {
  if (sessionList.length === 0) {
    return []
  }

  const sessionById = new Map(sessionList.map((session) => [session.id, session]))
  const indexById = new Map(sessionList.map((session, index) => [session.id, index]))
  const childrenByParentId = new Map<string, HierarchySession[]>()

  for (const session of sessionList) {
    if (!session.parentSessionId || !sessionById.has(session.parentSessionId)) {
      continue
    }

    const siblings = childrenByParentId.get(session.parentSessionId) ?? []
    siblings.push(session)
    childrenByParentId.set(session.parentSessionId, siblings)
  }

  function orderedChildren(parentId: string): HierarchySession[] {
    return [...(childrenByParentId.get(parentId) ?? [])].sort((left, right) => {
      return (indexById.get(left.id) ?? 0) - (indexById.get(right.id) ?? 0)
    })
  }

  const rows: SessionTreeRow[] = []
  const visited = new Set<string>()

  function visit(session: HierarchySession, depth: number): void {
    if (visited.has(session.id)) {
      return
    }

    visited.add(session.id)
    rows.push({
      session,
      depth
    })

    for (const child of orderedChildren(session.id)) {
      visit(child, depth + 1)
    }
  }

  const rootSessions = sessionList
    .filter((session) => !session.parentSessionId || !sessionById.has(session.parentSessionId))
    .sort((left, right) => (indexById.get(left.id) ?? 0) - (indexById.get(right.id) ?? 0))

  for (const rootSession of rootSessions) {
    visit(rootSession, 0)
  }

  for (const session of [...sessionList].sort((left, right) => (indexById.get(left.id) ?? 0) - (indexById.get(right.id) ?? 0))) {
    visit(session, 0)
  }

  return rows
}

const projectTreeViews = computed<ProjectTreeView[]>(() => {
  return props.hierarchy.map((project) => ({
    ...project,
    liveRows: buildSessionRows(project.sessions)
  }))
})

function providerIcon(type: SessionType): string {
  const map: Record<SessionType, string> = {
    'claude-code': new URL('@renderer/assets/providers/claude-code.svg', import.meta.url).href,
    'shell': new URL('@renderer/assets/providers/shell.svg', import.meta.url).href,
    'codex': new URL('@renderer/assets/providers/codex.svg', import.meta.url).href,
    'opencode': new URL('@renderer/assets/providers/opencode.svg', import.meta.url).href
  }
  return map[type]
}

function handleFloatingCardCreate(payload: { type: SessionType }) {
  emit('createSession', { projectId: floatingCardProjectId.value, type: payload.type, title: '' })
  floatingCardVisible.value = false
}

function handleRadialMenuCreate(payload: { type: SessionType }) {
  emit('createSession', { projectId: radialMenuProjectId.value, type: payload.type, title: '' })
  radialMenuVisible.value = false
}

function closeFloatingCard() {
  floatingCardVisible.value = false
}

function closeRadialMenu() {
  radialMenuVisible.value = false
}

function openSessionContextMenu(event: MouseEvent, session: HierarchySession): void {
  event.preventDefault()
  sessionContextMenuSessionId.value = session.id
  sessionContextMenuSessionTitle.value = session.title
  sessionContextMenuPosition.value = { x: event.clientX, y: event.clientY }
  sessionContextMenuVisible.value = true
}

function closeSessionContextMenu(): void {
  sessionContextMenuVisible.value = false
}

function sessionContextMenuItems(): SessionContextMenuItem[] {
  return [
    {
      id: 'regenerate-title',
      label: t('workspace.regenerateSessionTitle')
    },
    {
      id: 'restart',
      label: t('workspace.restartSession')
    }
  ]
}

function handleSessionContextMenuSelect(actionId: string): void {
  if (!sessionContextMenuVisible.value) {
    return
  }

  if (actionId === 'restart') {
    emit('restartSession', sessionContextMenuSessionId.value)
  }

  if (actionId === 'regenerate-title') {
    emit('regenerateSessionTitle', sessionContextMenuSessionId.value)
  }

  closeSessionContextMenu()
}

function sessionRowViewModel(sessionId: string): SessionRowViewModel | null {
  return props.sessionRowViewModels?.[sessionId] ?? null
}

function sessionTone(session: HierarchySession): string {
  return sessionRowViewModel(session.id)?.tone ?? 'neutral'
}

function sessionPrimaryLabel(session: HierarchySession): string {
  return session.title
}

function sessionStatusLabel(session: HierarchySession): string | null {
  const viewModel = sessionRowViewModel(session.id)
  if (!viewModel) {
    return session.summary || null
  }
  const parts: string[] = []
  if (viewModel.primaryLabel) parts.push(viewModel.primaryLabel)
  if (viewModel.updatedAgoLabel) parts.push(viewModel.updatedAgoLabel)
  return parts.length ? parts.join(' ') : null
}

function sessionPhase(session: HierarchySession): string {
  return sessionRowViewModel(session.id)?.phase ?? (session.runtimeState === 'exited' ? 'complete' : 'unknown')
}

function sessionAttentionReason(session: HierarchySession): string | null {
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

function sessionTreeIndentStyle(depth: number): Record<string, string> {
  return {
    '--tree-depth': String(depth)
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
  addButtonPressStartedAt = event.timeStamp
  addButtonPressedProjectId = projectId
  longPressActivated = false

  longPressTimer = setTimeout(() => {
    longPressTimer = null
    longPressActivated = true
    floatingCardVisible.value = false
    radialMenuVisible.value = true
  }, LONG_PRESS_MS)
}

function onAddButtonMouseUp(event: MouseEvent, projectId: string) {
  const pressDuration = Math.max(0, event.timeStamp - addButtonPressStartedAt)
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }

  const pressedProjectId = addButtonPressedProjectId
  addButtonPressedProjectId = null

  if (pressedProjectId !== projectId) {
    longPressActivated = false
    return
  }

  if (pressDuration >= LONG_PRESS_MS) {
    radialMenuVisible.value = false
    longPressActivated = false
    return
  }

  const shouldCloseFloatingCard = floatingCardVisible.value && floatingCardProjectId.value === projectId
  floatingCardVisible.value = !shouldCloseFloatingCard
  radialMenuVisible.value = false
  longPressActivated = false
}

function onAddButtonMouseLeave() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  addButtonPressedProjectId = null
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
  <aside class="min-h-0 flex flex-col rounded-none border-r border-line bg-mica" data-testid="workspace-hierarchy-panel" aria-label="Workspace hierarchy">
    
    <!-- Sleek Fluent Sidebar Header Toolbar -->
    <div class="flex items-center justify-between px-3.5 py-3 border-b border-line bg-surface-soft select-none" data-testid="sidebar-header">
      <span class="text-[10px] tracking-[0.12em] font-bold text-muted uppercase">{{ t('workspace.eyebrow') }}</span>
      <div class="flex items-center gap-1" data-testid="route-actions">
        <!-- New Project Action -->
        <button
          class="route-action flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)] hover:bg-black-soft text-muted hover:text-text-strong transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:bg-black-soft"
          type="button"
          data-testid="workspace.new-project"
          :aria-label="t('workspace.newProject')"
          :title="t('workspace.newProject')"
          @click="showNewProject = true"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span class="sr-only">{{ t('workspace.newProject') }}</span>
        </button>
        <!-- Collapse/Expand All Action -->
        <button
          class="flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)] hover:bg-black-soft text-muted hover:text-text-strong transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:bg-black-soft"
          type="button"
          :title="collapsedProjectIds.size === hierarchy.length && hierarchy.length > 0 ? 'Expand All' : 'Collapse All'"
          @click="toggleAllCollapsed"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 14h16" />
            <path d="m4 18 8-8 8 8" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Scrollable Content Body -->
    <div class="flex-1 overflow-y-auto px-2.5 py-3 grid gap-3 align-content-start route-body-scroll" data-testid="route-body">
      <div class="grid gap-1">
        <button class="group-label" type="button" @click="toggleAllCollapsed">
          <span class="group-label__chevron" :class="{ 'group-label__chevron--collapsed': collapsedProjectIds.size === hierarchy.length && hierarchy.length > 0 }">▾</span>
          {{ t('workspace.eyebrow') }}
        </button>

        <div v-for="project in projectTreeViews" :key="project.id" class="route-project grid gap-1">
          <div
            class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center"
            @contextmenu="onProjectRowContextmenu($event, project.id)"
          >
            <button
              class="route-item route-item--parent"
              :class="{ 'route-item--active': project.id === activeProjectId }"
              :data-has-active-session="project.id === activeProjectId && !!activeSessionId ? 'true' : undefined"
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
              <!-- Fluent Folder Icon -->
              <svg class="route-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
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
                @mouseup="onAddButtonMouseUp($event, project.id)"
                @mouseleave="onAddButtonMouseLeave"
              >
                <span class="route-icon-button__glyph" aria-hidden="true">+</span>
              </button>
            </div>
          </div>

          <template v-if="!isProjectCollapsed(project.id)">
            <div
              v-for="row in project.liveRows"
              :key="row.session.id"
              class="route-session-row"
              :style="sessionTreeIndentStyle(row.depth)"
              :data-tree-depth="row.depth"
            >
              <button
                class="route-item child"
                :class="{ 'route-item--active': row.session.id === activeSessionId }"
                :aria-current="row.session.id === activeSessionId ? 'true' : undefined"
                data-testid="session-row"
                :data-session-id="row.session.id"
                :data-tree-depth="String(row.depth)"
                :data-session-title="row.session.title"
                :data-session-type="row.session.type"
                type="button"
                @click="emit('selectSession', row.session.id)"
                @contextmenu="openSessionContextMenu($event, row.session)"
              >
                <div
                  class="route-dot"
                  data-testid="session-status-dot"
                  :data-tone="sessionTone(row.session)"
                  :data-phase="sessionPhase(row.session)"
                  :data-session-status-testid="`session-status-${sessionPhase(row.session)}`"
                  :data-attention-reason="sessionAttentionReason(row.session) ?? undefined"
                />
                <img class="route-provider-icon" :src="providerIcon(row.session.type)" :alt="row.session.type" />
                <div class="route-copy route-copy--session">
                  <span class="route-session-name">{{ sessionPrimaryLabel(row.session) }}</span>
                  <span v-if="sessionStatusLabel(row.session)" class="route-session-label">{{ sessionStatusLabel(row.session) }}</span>
                </div>
              </button>
              <span class="route-row-actions">
                <button
                  class="route-row-action route-icon-button"
                  type="button"
                  data-testid="workspace.archive-session"
                  :data-session-id="row.session.id"
                  :aria-label="t('workspace.archiveSession', { title: row.session.title })"
                  :title="t('workspace.archiveSessionTitle')"
                  :data-row-archive="row.session.id"
                  @click.stop="emit('archiveSession', row.session.id)"
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

  <SessionContextMenu
    :visible="sessionContextMenuVisible"
    :position="sessionContextMenuPosition"
    :items="sessionContextMenuItems()"
    :aria-label="t('workspace.sessionActions', { title: sessionContextMenuSessionTitle })"
    @select="handleSessionContextMenuSelect"
    @close="closeSessionContextMenu"
  />

  <Teleport to="body">
    <div
      v-if="detailState"
      class="detail-popover"
      :style="{ left: `${detailState.x}px`, top: `${detailState.y}px` }"
    >
      <div class="detail-popover__name">{{ detailState.name }}</div>
      <div v-if="detailState.path" class="detail-popover__info">{{ detailState.path }}</div>
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

/* Primary hierarchy line connecting sessions to the project */
.route-session-row::before {
  content: '';
  position: absolute;
  left: 14px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-line);
  pointer-events: none;
}

/* Additional hierarchy guide lines for deeper levels */
.route-session-row[data-tree-depth='1']::after {
  content: '';
  position: absolute;
  left: 28px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-line);
  pointer-events: none;
}

.route-session-row[data-tree-depth='2']::after {
  content: '';
  position: absolute;
  left: 42px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-line);
  pointer-events: none;
}

.route-session-row .route-item {
  min-width: 0;
}

.route-session-row[data-tree-depth='0'] .route-item.child {
  padding-left: 20px;
}

.route-session-row[data-tree-depth='1'] .route-item.child {
  padding-left: 34px;
}

.route-session-row[data-tree-depth='2'] .route-item.child {
  padding-left: 48px;
}

.route-session-row[data-tree-depth='3'] .route-item.child {
  padding-left: 62px;
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
  /* Unified height: 28px effective row height via consistent padding */
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  min-height: 30px;
}

.route-item.child {
  grid-template-columns: 6px 18px minmax(0, 1fr);
  gap: 6px;
  /* Same vertical padding as parent for height parity */
  padding: 5px 8px 5px 20px;
  min-height: 30px;
}

.route-item:hover:not(.route-item--active),
.route-item:focus-visible {
  background: var(--color-black-soft);
  outline: none;
}

.route-item--active {
  background: var(--color-black-soft);
  border-color: var(--color-line-strong);
  box-shadow: var(--shadow-soft);
}

/* When a child session is active, the parent project row is de-emphasized:
   no fill, no border — only the folder icon gets a gentle accent tint */
.route-item--active[data-has-active-session] {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

.route-item--active[data-has-active-session] .route-folder-icon {
  color: var(--color-accent);
  opacity: 0.6;
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
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 8px;
  /* Align with session row: same left offset so active indicator sits at same x */
  padding-right: 10px;
  padding-left: 20px;
}

.route-folder-icon {
  width: 14px;
  height: 14px;
  color: var(--color-subtle);
  flex-shrink: 0;
  transition: color 0.2s ease;
}

.route-item--parent:hover .route-folder-icon,
.route-item--parent.route-item--active .route-folder-icon {
  color: var(--color-accent);
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
  background: var(--color-black-soft);
  color: var(--color-text-strong);
}

.route-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.route-copy--session {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.route-provider-icon {
  flex: none;
  height: 1.75em;
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
  box-shadow: var(--shadow-card);
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
  font-size: var(--text-caption);
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
  font-size: var(--text-body);
  line-height: 1;
}

.route-icon-button__icon {
  width: var(--text-meta);
  height: var(--text-meta);
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
  font-size: var(--text-body);
  line-height: 1;
  font-weight: 400;
  flex: none;
  cursor: pointer;
}

.route-add-session:hover {
  background: var(--color-black-soft);
  color: var(--color-text-strong);
}

.route-body-scroll {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}

.route-body-scroll:hover {
  scrollbar-color: var(--color-black-soft) transparent;
}

.route-body-scroll::-webkit-scrollbar {
  width: 4px;
}

.route-body-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.route-body-scroll::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 2px;
}

.route-body-scroll:hover::-webkit-scrollbar-thumb {
  background: var(--color-black-soft);
}
</style>
