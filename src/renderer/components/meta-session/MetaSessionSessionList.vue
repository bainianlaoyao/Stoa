<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { SessionType } from '@shared/project-session'
import { listMetaSessionProviderDescriptors } from '@shared/provider-descriptors'
import type { MetaSessionBackendSessionType, MetaSessionStatus } from '@shared/meta-session'
import { useMetaSessionStore } from '@renderer/stores/meta-session'
import { ICONS } from '@renderer/composables/provider-icons'
import ProviderFloatingCard from '../command/ProviderFloatingCard.vue'

const metaSessionStore = useMetaSessionStore()
const { sessions, activeMetaSessionId } = storeToRefs(metaSessionStore)

const activeSessions = computed(() => {
  return sessions.value.filter((s) => !s.archived)
})

const archivedSessions = computed(() => {
  return sessions.value.filter((s) => s.archived)
})

const orderedActiveSessions = computed(() => {
  return [...activeSessions.value].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
})

const orderedArchivedSessions = computed(() => {
  return [...archivedSessions.value].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
})

const archivedSectionOpen = ref(false)

const META_SESSION_BACKEND_TYPES = new Set<MetaSessionBackendSessionType>(['opencode', 'codex', 'claude-code'])

function isMetaSessionBackendType(type: SessionType): type is MetaSessionBackendSessionType {
  return META_SESSION_BACKEND_TYPES.has(type as MetaSessionBackendSessionType)
}

const allProviderButtons = computed(() => {
  const metaTypes = new Set(
    listMetaSessionProviderDescriptors()
      .map((descriptor) => descriptor.sessionType)
      .filter(isMetaSessionBackendType)
  )
  const icons = Object.values(ICONS).filter((icon): icon is (typeof ICONS)[MetaSessionBackendSessionType] => {
    return isMetaSessionBackendType(icon.type) && metaTypes.has(icon.type)
  })
  return icons
})

const floatingCardVisible = ref(false)
const floatingCardPosition = ref({ x: 0, y: 0, width: 0, height: 0 })

function providerIcon(type: SessionType): string {
  return ICONS[type].src
}

function statusTone(status: MetaSessionStatus): string {
  switch (status) {
    case 'running':
    case 'starting':
      return 'accent'
    case 'waiting_approval':
      return 'warning'
    case 'idle':
      return 'success'
    case 'failed':
      return 'danger'
    default:
      return 'neutral'
  }
}

function statusChipLabel(status: MetaSessionStatus): string {
  return status.replace(/_/g, ' ')
}

function relativeTime(updatedAt: string): string {
  const elapsedMs = Date.now() - Date.parse(updatedAt)
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) return 'Just now'
  return `${Math.floor(elapsedMs / 60_000)}m ago`
}

function generateMetaSessionTitle(): string {
  const nextIndex = sessions.value.length + 1
  return `meta-session-${nextIndex}`
}

function onAddButtonClick(event: MouseEvent): void {
  const buttonEl = event.currentTarget as HTMLElement
  const rect = buttonEl.getBoundingClientRect()

  const shouldClose = floatingCardVisible.value
  floatingCardVisible.value = !shouldClose
  floatingCardPosition.value = { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

function handleProviderCreate(payload: { type: SessionType }): void {
  floatingCardVisible.value = false

  if (isMetaSessionBackendType(payload.type)) {
    void metaSessionStore.createSession({
      title: generateMetaSessionTitle(),
      backendSessionType: payload.type,
      capabilityLevel: 3
    })
    return
  }
}

function handleDocumentMouseDown(event: MouseEvent): void {
  if (!floatingCardVisible.value) return
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  if (target.closest('.provider-floating-card') || target.closest('.route-action')) return
  floatingCardVisible.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMouseDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown)
})

const emit = defineEmits<{
  createWorkspaceSession: [payload: { projectId: string; type: SessionType; title: string }]
}>()
</script>

<template>
  <aside
    class="meta-session-sidebar"
    data-testid="meta-session-session-list"
    aria-label="Meta sessions"
  >
    <div class="meta-session-sidebar__body">
      <div class="meta-session-sidebar__actions">
        <button
          class="route-action"
          type="button"
          data-testid="meta-session.session.create"
          @mousedown="onAddButtonClick($event)"
        >
          <span class="route-action__label">New session</span>
          <span class="route-action__icon">+</span>
        </button>
      </div>

      <div class="meta-session-sidebar__items">
        <div
          v-for="session in orderedActiveSessions"
          :key="session.id"
          class="route-session-row"
        >
          <button
            class="route-item child"
            :class="{ 'route-item--active': session.id === activeMetaSessionId }"
            data-testid="meta-session.session.item"
            :data-session-id="session.id"
            type="button"
            @click="void metaSessionStore.setActiveSession(session.id)"
          >
            <img class="route-provider-icon" :src="providerIcon(session.backendSessionType)" :alt="session.backendSessionType" />
            <div class="route-copy">
              <span class="route-session-title">{{ session.title }}</span>
              <div class="route-session-meta">
                <span class="route-chip" :data-tone="statusTone(session.status)">{{ statusChipLabel(session.status) }}</span>
                <span class="route-time">{{ relativeTime(session.updatedAt) }}</span>
                <span v-if="session.pendingProposalCount > 0" class="route-pending">· {{ session.pendingProposalCount }} pending</span>
              </div>
            </div>
          </button>
          <span class="route-row-actions">
            <button
              class="route-row-action route-icon-button"
              type="button"
              data-testid="meta-session.session.archive"
              :data-session-id="session.id"
              :aria-label="`Archive session ${session.title}`"
              title="Archive session"
              @click.stop="void metaSessionStore.archiveSession(session.id)"
            >
              <svg
                class="route-icon-button__icon"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path d="M2 4H14V12C14 13.1046 13.1046 14 12 14H4C2.89543 14 2 13.1046 2 12V4Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
                <path d="M6 8H10" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
                <path d="M1 4H15" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
                <path d="M6 1H10V4H6V1Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
              </svg>
            </button>
          </span>
        </div>
      </div>

      <div v-if="orderedArchivedSessions.length > 0" class="meta-session-sidebar__archived">
        <button
          class="route-archived-toggle"
          type="button"
          @click="archivedSectionOpen = !archivedSectionOpen"
        >
          <span class="route-archived-label">Archived ({{ orderedArchivedSessions.length }})</span>
          <span class="route-archived-chevron" :class="{ 'route-archived-chevron--open': archivedSectionOpen }">&#9662;</span>
        </button>
        <div v-if="archivedSectionOpen" class="meta-session-sidebar__archived-items">
          <div
            v-for="session in orderedArchivedSessions"
            :key="session.id"
            class="route-session-row route-session-row--archived"
          >
            <button
              class="route-item child"
              data-testid="meta-session.session.archived-item"
              :data-session-id="session.id"
              type="button"
              @click="void metaSessionStore.restoreSession(session.id)"
            >
              <img class="route-provider-icon" :src="providerIcon(session.backendSessionType)" :alt="session.backendSessionType" />
              <div class="route-copy">
                <span class="route-session-title">{{ session.title }}</span>
                <div class="route-session-meta">
                  <span class="route-chip" data-tone="neutral">{{ statusChipLabel(session.status) }}</span>
                  <span class="route-time">{{ relativeTime(session.updatedAt) }}</span>
                </div>
              </div>
            </button>
            <span class="route-row-actions">
              <button
                class="route-row-action route-icon-button"
                type="button"
                data-testid="meta-session.session.restore"
                :data-session-id="session.id"
                :aria-label="`Restore session ${session.title}`"
                title="Restore session"
                @click.stop="void metaSessionStore.restoreSession(session.id)"
              >
                <svg class="route-icon-button__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M2 8C2 4.68629 4.68629 2 8 2V2C11.3137 2 14 4.68629 14 8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
                  <path d="M14 8L12 6" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M14 8L12 10" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  </aside>

  <ProviderFloatingCard
    :visible="floatingCardVisible"
    project-id=""
    :position="floatingCardPosition"
    :providers="allProviderButtons"
    @create="handleProviderCreate"
    @close="floatingCardVisible = false"
  />
</template>

<style scoped>
.meta-session-sidebar {
  min-height: 0;
  overflow-y: auto;
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.meta-session-sidebar__body {
  min-height: 0;
  overflow: auto;
  padding: 10px 10px 40px;
  display: grid;
  gap: 12px;
  align-content: start;
}

.meta-session-sidebar__actions {
  display: grid;
  gap: 4px;
}

.route-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-solid);
  color: var(--color-text-strong);
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  font-family: var(--font-ui);
}

.route-action:hover,
.route-action:focus-visible {
  background: var(--color-black-faint);
  outline: none;
}

.route-action__label {
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.05em;
}

.route-action__icon {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--color-canvas);
  color: var(--color-text-strong);
  font-size: 12px;
}

.meta-session-sidebar__items {
  display: grid;
  gap: 2px;
}

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

.route-item {
  display: grid;
  gap: 8px;
  align-items: center;
  padding: 5px 8px;
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
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
  padding: 6px 8px 6px 12px;
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

.route-item--active .route-session-title {
  color: var(--color-text);
}

.route-item:not(.route-item--active) .route-session-title {
  color: var(--color-muted);
}

.route-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.route-session-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 500 var(--text-body-sm) / 1.2 var(--font-mono);
}

.route-session-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.route-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text-strong);
  font: 500 var(--text-caption) / 1.4 var(--font-mono);
  white-space: nowrap;
}

.route-chip[data-tone='neutral'] {
  color: var(--color-subtle);
}

.route-chip[data-tone='accent'] {
  color: var(--color-accent);
}

.route-chip[data-tone='success'] {
  color: var(--color-success);
}

.route-chip[data-tone='warning'] {
  color: var(--color-warning);
}

.route-chip[data-tone='danger'] {
  color: var(--color-error);
}

.route-time {
  color: var(--color-subtle);
  font: var(--text-caption) / 1.4 var(--font-mono);
  white-space: nowrap;
}

.route-pending {
  color: var(--color-muted);
  font: var(--text-caption) / 1.4 var(--font-mono);
  white-space: nowrap;
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

.route-icon-button__icon {
  width: 12px;
  height: 12px;
}

.route-provider-icon {
  flex: none;
  height: 1.75em;
  width: auto;
}

.meta-session-sidebar__archived {
  display: grid;
  gap: 2px;
  border-top: 1px solid var(--color-line);
  padding-top: 8px;
}

.route-archived-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-family: var(--font-ui);
}

.route-archived-toggle:hover {
  background: var(--color-black-faint);
}

.route-archived-label {
  color: var(--color-muted);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.05em;
}

.route-archived-chevron {
  color: var(--color-subtle);
  font-size: 10px;
  transition: transform 0.2s ease;
}

.route-archived-chevron--open {
  transform: rotate(180deg);
}

.route-session-row--archived .route-session-title {
  color: var(--color-muted);
}

aside.meta-session-sidebar {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}

aside.meta-session-sidebar:hover {
  scrollbar-color: var(--color-black-soft) transparent;
}

aside.meta-session-sidebar::-webkit-scrollbar {
  width: 4px;
}

aside.meta-session-sidebar::-webkit-scrollbar-track {
  background: transparent;
}

aside.meta-session-sidebar::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 2px;
}

aside.meta-session-sidebar:hover::-webkit-scrollbar-thumb {
  background: var(--color-black-soft);
}
</style>
