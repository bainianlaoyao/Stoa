<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { SessionType } from '@shared/project-session'
import { getProviderDescriptorBySessionType, listMetaSessionProviderDescriptors } from '@shared/provider-descriptors'
import type { HermesBackendSessionType, HermesSessionStatus } from '@shared/hermes'
import { useHermesStore } from '@renderer/stores/hermes'
import { ICONS } from '@renderer/composables/provider-icons'
import ProviderFloatingCard from '../command/ProviderFloatingCard.vue'

const hermesStore = useHermesStore()
const { sessions, activeHermesSessionId } = storeToRefs(hermesStore)

const orderedSessions = computed(() => {
  return [...sessions.value].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
})

const HERMES_BACKEND_TYPES = new Set<HermesBackendSessionType>(['opencode', 'codex', 'claude-code'])

function isHermesBackendType(type: SessionType): type is HermesBackendSessionType {
  return HERMES_BACKEND_TYPES.has(type as HermesBackendSessionType)
}

// Only providers with meta-session capability (supportsResume + supportsStructuredEvents)
const allProviderButtons = computed(() => {
  const metaTypes = new Set(
    listMetaSessionProviderDescriptors()
      .map((descriptor) => descriptor.sessionType)
      .filter(isHermesBackendType)
  )
  const icons = Object.values(ICONS).filter((icon): icon is (typeof ICONS)[HermesBackendSessionType] => {
    return isHermesBackendType(icon.type) && metaTypes.has(icon.type)
  })
  return icons
})

const floatingCardVisible = ref(false)
const floatingCardPosition = ref({ x: 0, y: 0, width: 0, height: 0 })

function providerIcon(type: SessionType): string {
  return ICONS[type].src
}

function statusTone(status: HermesSessionStatus): string {
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

function statusPhase(status: HermesSessionStatus): string {
  switch (status) {
    case 'waiting_approval':
      return 'blocked'
    case 'created':
    case 'closed':
      return status
    default:
      return status
  }
}

function statusLabel(session: { status: HermesSessionStatus; pendingProposalCount: number }): string {
  const parts: string[] = [session.status.replace(/_/g, ' ')]
  if (session.pendingProposalCount > 0) {
    parts.push(`${session.pendingProposalCount} pending`)
  }
  return parts.join(' · ')
}

function backendLabel(type: SessionType): string {
  return getProviderDescriptorBySessionType(type).displayName
}

function generateHermesTitle(): string {
  const nextIndex = sessions.value.length + 1
  return `hermes-${nextIndex}`
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

  if (isHermesBackendType(payload.type)) {
    void hermesStore.createSession({
      title: generateHermesTitle(),
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
    class="hermes-sidebar"
    data-testid="hermes-session-list"
    aria-label="Hermes sessions"
  >
    <div class="hermes-sidebar__body">
      <div class="hermes-sidebar__actions">
        <button
          class="route-action"
          type="button"
          data-testid="hermes.session.create"
          @mousedown="onAddButtonClick($event)"
        >
          <span class="route-action__label">New session</span>
          <span class="route-action__icon">+</span>
        </button>
      </div>

      <div class="hermes-sidebar__items">
        <div
          v-for="session in orderedSessions"
          :key="session.id"
          class="hermes-session-row"
        >
          <button
            class="route-item child"
            :class="{ 'route-item--active': session.id === activeHermesSessionId }"
            data-testid="hermes.session.item"
            :data-session-id="session.id"
            type="button"
            @click="void hermesStore.setActiveSession(session.id)"
          >
            <div
              class="route-dot"
              :data-tone="statusTone(session.status)"
              :data-phase="statusPhase(session.status)"
            />
            <img class="route-provider-icon" :src="providerIcon(session.backendSessionType)" :alt="session.backendSessionType" />
            <div class="route-copy">
              <strong class="route-session-title">{{ session.title }}</strong>
              <div class="route-copy--session">
                <span class="route-session-label">{{ backendLabel(session.backendSessionType) }}</span>
                <span class="route-session-label">{{ statusLabel(session) }}</span>
              </div>
            </div>
          </button>
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
.hermes-sidebar {
  min-height: 0;
  overflow-y: auto;
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.hermes-sidebar__body {
  min-height: 0;
  overflow: auto;
  padding: 10px 10px 40px;
  display: grid;
  gap: 12px;
  align-content: start;
}

.hermes-sidebar__actions {
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

.hermes-sidebar__items {
  display: grid;
  gap: 2px;
}

.hermes-session-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  min-width: 0;
  position: relative;
}

.hermes-session-row .route-item {
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
  grid-template-columns: 6px 18px minmax(0, 1fr);
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

.hermes-session-row:has(.route-item--active)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 0;
  background: var(--color-active-indicator);
}

.route-item--active .route-session-label {
  color: var(--color-text);
  font-weight: 500;
}

.route-item:not(.route-item--active) .route-session-label {
  color: var(--color-subtle);
}

.route-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.route-copy--session {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.route-provider-icon {
  flex: none;
  height: 1.75em;
  width: auto;
}

.route-session-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-strong);
  font-size: var(--text-body-sm);
  font-weight: 600;
  font-family: var(--font-ui);
}

.route-session-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-muted);
  font: var(--text-caption) var(--font-mono);
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

.route-dot[data-tone='danger'] {
  background: var(--color-error);
}

aside.hermes-sidebar {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}

aside.hermes-sidebar:hover {
  scrollbar-color: var(--color-black-soft) transparent;
}

aside.hermes-sidebar::-webkit-scrollbar {
  width: 4px;
}

aside.hermes-sidebar::-webkit-scrollbar-track {
  background: transparent;
}

aside.hermes-sidebar::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 2px;
}

aside.hermes-sidebar:hover::-webkit-scrollbar-thumb {
  background: var(--color-black-soft);
}
</style>
