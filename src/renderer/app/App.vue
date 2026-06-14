<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type {
  OpenWorkspaceRequest,
  SessionGraphEvent,
  SessionTitleGenerationNotification,
  SessionTitleGenerationNotificationStatus,
  SessionType
} from '@shared/project-session'
import AppShell from '@renderer/components/AppShell.vue'
import MemoryToastHost from '@renderer/components/memory/MemoryToastHost.vue'
import UpdatePrompt from '@renderer/components/update/UpdatePrompt.vue'
import { useMemoryNotificationsStore } from '@renderer/stores/memory-notifications'
import type { TitleGenerationToastNotification } from '@renderer/stores/memory-notifications'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { useSettingsStore } from '@renderer/stores/settings'
import { useUpdateStore } from '@renderer/stores/update'
import { useSidebarStore } from '@renderer/stores/sidebar'
import { useSidebarShortcuts } from '@renderer/composables/useSidebarShortcuts'
import { requireRendererApi } from '@renderer/stores/stoa-store-plugin'

const { t } = useI18n()
const workspaceStore = useWorkspaceStore()
const settingsStore = useSettingsStore()
const updateStore = useUpdateStore()
const memoryNotificationsStore = useMemoryNotificationsStore()
const sidebarStore = useSidebarStore()

// Register global keyboard shortcuts (Ctrl+B toggle, Ctrl+Shift+E/F/G tab jumps)
useSidebarShortcuts()

const {
  projectHierarchy,
  activeProjectId,
  activeSessionId,
  activeProject,
  activeSession
} = storeToRefs(workspaceStore)
const {
  state: updateState,
  shouldShowPrompt
} = storeToRefs(updateStore)
const { notifications: memoryNotifications } = storeToRefs(memoryNotificationsStore)
const sessionTitleById = computed(() => {
  return new Map(workspaceStore.sessions.map((session) => [session.id, session.title]))
})

function handleProjectSelect(projectId: string): void {
  workspaceStore.setActiveProject(projectId)
  void requireRendererApi().setActiveProject(projectId)
}

function handleSessionSelect(sessionId: string): void {
  workspaceStore.setActiveSession(sessionId)
  void requireRendererApi()
    .setActiveSession(sessionId)
    .then(() => workspaceStore.hydrateFromStoaClient())
    .then(() => workspaceStore.hydrateObservability())
}

async function handleProjectCreate(payload: { name: string; path: string }): Promise<void> {
  workspaceStore.clearError()
  try {
    const stoa = requireRendererApi()
    const created = await stoa.createProject({ name: payload.name, path: payload.path })
    if (!created) {
      workspaceStore.lastError = 'Failed to create project: no response from main process'
      return
    }
    workspaceStore.addProject(created)
    workspaceStore.setActiveProject(created.id)
    void stoa.setActiveProject(created.id)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

async function handleSessionCreate(payload: { projectId: string; type: string; title: string }): Promise<void> {
  workspaceStore.clearError()
  try {
    const stoa = requireRendererApi()
    const created = await stoa.createSession({
      projectId: payload.projectId,
      type: payload.type as SessionType,
      title: payload.title
    })
    if (!created) {
      workspaceStore.lastError = 'Failed to create session: no response from main process'
      return
    }
    workspaceStore.addSession(created)
    workspaceStore.setActiveSession(created.id)
    void stoa.setActiveSession(created.id)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

async function handleProjectDelete(projectId: string): Promise<void> {
  workspaceStore.clearError()
  const project = workspaceStore.projects.find(p => p.id === projectId)
  if (!project) return
  try {
    await requireRendererApi().deleteProject(projectId)
    workspaceStore.removeProject(projectId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

async function handleArchiveSession(sessionId: string): Promise<void> {
  workspaceStore.clearError()
  try {
    await requireRendererApi().archiveSession(sessionId)
    workspaceStore.archiveSession(sessionId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

async function handleRegenerateSessionTitle(sessionId: string): Promise<void> {
  workspaceStore.clearError()
  try {
    const updated = await requireRendererApi().regenerateSessionTitle(sessionId)
    if (!updated) {
      return
    }
    workspaceStore.updateSession(sessionId, updated)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

async function handleRestoreSession(sessionId: string): Promise<void> {
  workspaceStore.clearError()
  try {
    await requireRendererApi().restoreSession(sessionId)
    workspaceStore.restoreSession(sessionId)
    workspaceStore.setActiveSession(sessionId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

async function handleRestartSession(sessionId: string): Promise<void> {
  workspaceStore.clearError()
  workspaceStore.setActiveSession(sessionId)
  try {
    await requireRendererApi().restartSession(sessionId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

async function handleOpenWorkspace(request: OpenWorkspaceRequest): Promise<void> {
  workspaceStore.clearError()
  try {
    await requireRendererApi().openWorkspace(request)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
  }
}

let unsubscribeUpdateState: (() => void) | null = null
let unsubscribeMemoryNotification: (() => void) | null = null
let unsubscribeTitleGenerationNotification: (() => void) | null = null
let unsubscribeSessionEvents: (() => void) | null = null
let unsubscribeSessionGraphEvents: (() => void) | null = null
let isUnmounted = false

function isActiveSessionNotification(sessionId: string): boolean {
  return sessionId === activeSessionId.value
}

function titleGenerationToastStatus(
  status: SessionTitleGenerationNotificationStatus
): TitleGenerationToastNotification['status'] {
  return status
}

function titleGenerationToastTitle(event: SessionTitleGenerationNotification): string {
  if (event.status === 'pending') {
    return t('titleGenerationToast.pendingTitle')
  }

  if (event.status === 'error') {
    return t('titleGenerationToast.errorTitle')
  }

  return event.trigger === 'automatic'
    ? t('titleGenerationToast.automaticSuccessTitle')
    : t('titleGenerationToast.manualSuccessTitle')
}

function titleGenerationToastMessage(event: SessionTitleGenerationNotification): string {
  if (event.status === 'pending') {
    const currentTitle = sessionTitleById.value.get(event.sessionId) ?? t('titleGenerationToast.untitledFallback')
    return t('titleGenerationToast.pendingMessage', { title: currentTitle })
  }

  if (event.status === 'error') {
    return event.errorMessage ?? t('titleGenerationToast.errorFallbackMessage')
  }

  return t('titleGenerationToast.successMessage', {
    title: event.title ?? t('titleGenerationToast.untitledFallback')
  })
}

function applyTitleGenerationNotification(event: SessionTitleGenerationNotification): void {
  memoryNotificationsStore.enqueueTitleGeneration({
    id: `title-generation:${event.trigger}:${event.sessionId}:${event.status}:${event.title ?? ''}:${event.errorMessage ?? ''}`,
    projectId: event.projectId,
    sessionId: event.sessionId,
    status: titleGenerationToastStatus(event.status),
    title: titleGenerationToastTitle(event),
    message: titleGenerationToastMessage(event),
    createdAt: new Date().toISOString()
  })
}

onMounted(async () => {
  const stoa = requireRendererApi()

  unsubscribeUpdateState = stoa.onUpdateState((state) => {
    updateStore.applyState(state)
  })
  unsubscribeMemoryNotification = stoa.onMemoryNotification((event) => {
    if (!isActiveSessionNotification(event.sessionId)) {
      return
    }
    memoryNotificationsStore.enqueue(event)
  })
  unsubscribeTitleGenerationNotification = stoa.onTitleGenerationNotification((event) => {
    applyTitleGenerationNotification(event)
  })

  if (stoa.onSessionGraphEvent) {
    unsubscribeSessionGraphEvents = stoa.onSessionGraphEvent((event: SessionGraphEvent) => {
      workspaceStore.applySessionGraphEvent(event)
    })
  } else {
    unsubscribeSessionEvents = stoa.onSessionEvent((event) => {
      const existingSession = workspaceStore.sessions.find((session) => session.id === event.session.id)
      if (existingSession) {
        workspaceStore.updateSession(event.session.id, event.session)
        return
      }

      workspaceStore.addSession(event.session)
    })
  }

  const bootstrapState = await stoa.getBootstrapState()
  if (isUnmounted) {
    return
  }

  workspaceStore.hydrate(bootstrapState)
  await workspaceStore.hydrateObservability()
  if (isUnmounted) {
    workspaceStore.unsubscribeObservability()
    return
  }

  await Promise.all([
    settingsStore.loadSettings(),
    updateStore.refresh(),
    sidebarStore.hydrate(),
  ])
  if (isUnmounted) {
    return
  }

  void settingsStore.detectAndSetVscode()
  if (isUnmounted) {
    return
  }
})

onBeforeUnmount(() => {
  isUnmounted = true
  unsubscribeUpdateState?.()
  unsubscribeMemoryNotification?.()
  unsubscribeTitleGenerationNotification?.()
  unsubscribeSessionGraphEvents?.()
  unsubscribeSessionEvents?.()
  memoryNotificationsStore.reset()
  workspaceStore.unsubscribeObservability()
})
</script>

<template>
  <div class="app-root h-full flex flex-col overflow-hidden">
    <AppShell
      class="flex-1 min-h-0"
      :hierarchy="projectHierarchy"
      :active-project-id="activeProjectId"
      :active-session-id="activeSessionId"
      :active-project="activeProject"
      :active-session="activeSession"
      @select-project="handleProjectSelect"
      @select-session="handleSessionSelect"
      @create-project="handleProjectCreate"
      @create-session="handleSessionCreate"
      @delete-project="handleProjectDelete"
      @archive-session="handleArchiveSession"
      @regenerate-session-title="handleRegenerateSessionTitle"
      @restart-session="handleRestartSession"
      @restore-session="handleRestoreSession"
      @open-workspace="handleOpenWorkspace"
    />
    <UpdatePrompt
      :visible="shouldShowPrompt"
      :state="updateState"
      @dismiss="void updateStore.dismissUpdate()"
      @download="void updateStore.downloadUpdate()"
      @install="void updateStore.quitAndInstallUpdate()"
    />
    <MemoryToastHost :notifications="memoryNotifications" />
  </div>
</template>
