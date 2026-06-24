<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { OpenWorkspaceRequest, ProjectSummary, SessionSummary, SessionType } from '@shared/project-session'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import type { ToastNotification } from '@renderer/stores/memory-notifications'
import { getProviderDescriptorBySessionType, listProviderDescriptors } from '@shared/provider-descriptors'
import { PROVIDER_ICONS } from '@renderer/composables/provider-icons'
import MobileSessionTerminal from './MobileSessionTerminal.vue'
import SettingsSurface from '@renderer/components/settings/SettingsSurface.vue'

type MobileRoute = 'home' | 'sessions' | 'session' | 'archive' | 'settings'

interface SearchResult {
  id: string
  kind: 'workspace' | 'session'
  projectId: string
  sessionId?: string
  title: string
  detail: string
}

const props = defineProps<{
  hierarchy: ProjectHierarchyNode[]
  activeProjectId: string | null
  activeSessionId: string | null
  activeProject: ProjectSummary | null
  activeSession: SessionSummary | null
  healthStatus: 'connected' | 'reconnecting' | 'offline'
  healthMessage?: string | null
  memoryNotifications?: ToastNotification[]
}>()

const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: string; title: string }, done?: (sessionId: string | null) => void]
  deleteProject: [projectId: string]
  archiveSession: [sessionId: string]
  regenerateSessionTitle: [sessionId: string]
  restartSession: [sessionId: string]
  restoreSession: [sessionId: string]
  openWorkspace: [request: OpenWorkspaceRequest]
  retryHealth: []
}>()

const route = shallowRef<MobileRoute>('home')
const selectedProjectId = shallowRef<string | null>(null)
const searchOpen = shallowRef(false)
const searchQuery = shallowRef('')
const newSessionOpen = shallowRef(false)
const sessionSearchQuery = shallowRef('')
const sessionFilter = shallowRef<'all' | 'running' | 'blocked' | 'recent'>('all')
const sessionActionsOpen = shallowRef(false)

const selectedProject = computed<ProjectHierarchyNode | null>(() => {
  return props.hierarchy.find((project) => project.id === selectedProjectId.value)
    ?? props.hierarchy.find((project) => project.id === props.activeProjectId)
    ?? props.hierarchy[0]
    ?? null
})

const sortedProjectSessions = computed(() => {
  const project = selectedProject.value
  if (!project) {
    return []
  }

  return prioritizeSessions(project.sessions)
})

const selectedProjectSessions = computed(() => {
  const query = sessionSearchQuery.value.trim().toLowerCase()
  const now = Date.now()
  const recentThreshold = 7 * 24 * 60 * 60 * 1000

  return sortedProjectSessions.value.filter((session) => {
    const matchesQuery = !query
      || session.title.toLowerCase().includes(query)
      || session.summary.toLowerCase().includes(query)
      || getProviderDescriptorBySessionType(session.type).displayName.toLowerCase().includes(query)
    const isRunning = session.turnState === 'running'
    const isBlocked = Boolean(session.blockingReason)
    const isRecent = Number.isFinite(Date.parse(session.updatedAt))
      && now - Date.parse(session.updatedAt) <= recentThreshold

    if (!matchesQuery) {
      return false
    }

    if (sessionFilter.value === 'running') {
      return isRunning
    }

    if (sessionFilter.value === 'blocked') {
      return isBlocked
    }

    if (sessionFilter.value === 'recent') {
      return isRecent
    }

    return true
  })
})

const providerButtons = computed(() => {
  return listProviderDescriptors().map((descriptor) => {
    const icon = PROVIDER_ICONS.find((candidate) => candidate.type === descriptor.sessionType)
    return {
      type: descriptor.sessionType,
      label: descriptor.displayName,
      iconSrc: icon?.src ?? ''
    }
  })
})

const sessionSearchResults = computed<SearchResult[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) {
    return []
  }

  return props.hierarchy
    .flatMap((project) => project.sessions.map((session) => ({ project, session })))
    .filter(({ session }) => {
      const provider = getProviderDescriptorBySessionType(session.type).displayName
      return (
        session.title.toLowerCase().includes(query)
        || session.summary.toLowerCase().includes(query)
        || provider.toLowerCase().includes(query)
      )
    })
    .sort((left, right) => {
      const priorityDelta = sessionPriority(left.session) - sessionPriority(right.session)
      if (priorityDelta !== 0) {
        return priorityDelta
      }

      return right.session.updatedAt.localeCompare(left.session.updatedAt)
    })
    .slice(0, 12)
    .map(({ project, session }) => {
      const provider = getProviderDescriptorBySessionType(session.type).displayName
      return {
        id: `session:${session.id}`,
        kind: 'session',
        projectId: project.id,
        sessionId: session.id,
        title: session.title,
        detail: `${project.name} · ${provider} · ${sessionStatusLabel(session)}`
      }
    })
})

const workspaceSearchResults = computed<SearchResult[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) {
    return []
  }

  return props.hierarchy
    .filter((project) => project.name.toLowerCase().includes(query) || project.path.toLowerCase().includes(query))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 6)
    .map((project) => ({
      id: `workspace:${project.id}`,
      kind: 'workspace',
      projectId: project.id,
      title: project.name,
      detail: project.path
    }))
})

const recentSessions = computed(() => {
  return props.hierarchy
    .flatMap((project) => project.sessions.map((session) => ({ project, session })))
    .sort((left, right) => right.session.updatedAt.localeCompare(left.session.updatedAt))
    .slice(0, 4)
})

const recentWorkspaces = computed(() => {
  return [...props.hierarchy]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 4)
})

const archivedSessions = computed(() => {
  return props.hierarchy
    .flatMap((project) => project.archivedSessions.map((session) => ({ project, session })))
    .sort((left, right) => right.session.updatedAt.localeCompare(left.session.updatedAt))
})

const latestMemoryNotification = computed(() => {
  const notifications = props.memoryNotifications ?? []
  return notifications.at(-1) ?? null
})

const headerTitle = computed(() => {
  if (route.value === 'home') return 'Workspaces'
  if (route.value === 'archive') return 'Archive'
  if (route.value === 'settings') return 'Settings'
  if (route.value === 'session') return props.activeSession?.title ?? 'Session'
  return selectedProject.value?.name ?? 'Workspace'
})

const showHealthBanner = computed(() => props.healthStatus !== 'connected')

const activeSessionState = computed(() => {
  if (!props.activeSession) {
    return 'idle'
  }

  if (props.activeSession.blockingReason) {
    return 'blocked'
  }

  return props.activeSession.turnState
})

function formatRelativeActivity(updatedAt: string): string {
  const parsedAt = Date.parse(updatedAt)
  if (!Number.isFinite(parsedAt)) {
    return 'activity unknown'
  }

  const deltaMs = Math.max(0, Date.now() - parsedAt)
  const minuteMs = 60 * 1000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs

  if (deltaMs < minuteMs) {
    return 'just now'
  }

  if (deltaMs < hourMs) {
    return `${Math.floor(deltaMs / minuteMs)}m ago`
  }

  if (deltaMs < dayMs) {
    return `${Math.floor(deltaMs / hourMs)}h ago`
  }

  return `${Math.floor(deltaMs / dayMs)}d ago`
}

function sessionStatusLabel(session: SessionSummary): string {
  if (session.blockingReason) {
    return 'Blocked'
  }

  if (session.turnState === 'running') {
    return 'Running'
  }

  if (session.runtimeState === 'exited') {
    return 'Exited'
  }

  return 'Ready'
}

function workspaceSessionSummary(project: ProjectHierarchyNode): string {
  const running = project.sessions.filter((session) => session.turnState === 'running').length
  const blocked = project.sessions.filter((session) => Boolean(session.blockingReason)).length
  const fragments = [`${project.sessions.length} sessions`]

  if (running > 0) {
    fragments.push(`${running} running`)
  }

  if (blocked > 0) {
    fragments.push(`${blocked} blocked`)
  }

  fragments.push(formatRelativeActivity(project.updatedAt))
  return fragments.join(' · ')
}

function sessionPriority(session: SessionSummary): number {
  if (session.turnState === 'running') {
    return 0
  }

  if (session.blockingReason) {
    return 1
  }

  return 2
}

function prioritizeSessions(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((left, right) => {
    const priorityDelta = sessionPriority(left) - sessionPriority(right)
    if (priorityDelta !== 0) {
      return priorityDelta
    }

    return right.updatedAt.localeCompare(left.updatedAt)
  })
}

function openProject(projectId: string): void {
  selectedProjectId.value = projectId
  emit('selectProject', projectId)
  route.value = 'sessions'
}

function openSession(sessionId: string): void {
  emit('selectSession', sessionId)
  route.value = 'session'
}

function goBack(): void {
  newSessionOpen.value = false
  if (route.value === 'session') {
    sessionActionsOpen.value = false
    route.value = 'sessions'
    return
  }

  route.value = 'home'
}

function openSearch(): void {
  searchOpen.value = true
  searchQuery.value = ''
}

function closeSearch(): void {
  searchOpen.value = false
  searchQuery.value = ''
}

function selectSearchResult(result: SearchResult): void {
  selectedProjectId.value = result.projectId
  emit('selectProject', result.projectId)

  if (result.sessionId) {
    emit('selectSession', result.sessionId)
    route.value = 'session'
  } else {
    route.value = 'sessions'
  }

  closeSearch()
}

function createSession(type: SessionType): void {
  const projectId = selectedProject.value?.id
  if (!projectId || route.value !== 'sessions') {
    return
  }

  const finishCreate = (sessionId: string | null): void => {
    if (!sessionId) {
      return
    }

    newSessionOpen.value = false
    emit('selectSession', sessionId)
    route.value = 'session'
  }

  emit('createSession', { projectId, type, title: '' }, finishCreate)
}

function restoreArchivedSession(sessionId: string, projectId?: string): void {
  if (projectId) {
    selectedProjectId.value = projectId
    emit('selectProject', projectId)
  }
  emit('restoreSession', sessionId)
  emit('selectSession', sessionId)
  route.value = 'session'
}
</script>

<template>
  <section class="mobile-shell" data-testid="mobile-shell" aria-label="Mobile app shell">
    <header
      class="mobile-shell__header"
      :data-testid="route === 'session' ? 'mobile-session-header' : undefined"
    >
      <button
        v-if="route !== 'home'"
        class="mobile-shell__icon-button"
        type="button"
        aria-label="Back"
        data-testid="mobile-back"
        @click="goBack"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div class="mobile-shell__title">
        <span class="mobile-shell__eyebrow">
          <span
            class="mobile-shell__health-dot"
            :data-health-status="healthStatus"
            data-testid="mobile-health-dot"
            aria-label="Backend connection status"
          />
          {{ healthStatus }}
        </span>
        <strong>
          <span
            v-if="route === 'session'"
            class="mobile-shell__session-dot"
            :data-state="activeSessionState"
            aria-hidden="true"
          />
          {{ headerTitle }}
        </strong>
      </div>
      <button
        v-if="route === 'home'"
        class="mobile-shell__icon-button"
        type="button"
        aria-label="Search"
        data-testid="mobile-global-search-trigger"
        @click="openSearch"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="m13.2 13.2 3.2 3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
      <button
        v-else-if="route === 'session'"
        class="mobile-shell__icon-button"
        type="button"
        aria-label="More"
        data-testid="mobile-session-more"
        @click="sessionActionsOpen = !sessionActionsOpen"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="5" cy="10" r="1.3" fill="currentColor" />
          <circle cx="10" cy="10" r="1.3" fill="currentColor" />
          <circle cx="15" cy="10" r="1.3" fill="currentColor" />
        </svg>
      </button>
      <span v-else class="mobile-shell__header-spacer" aria-hidden="true" />
    </header>

    <main class="mobile-shell__body">
      <div
        v-if="latestMemoryNotification"
        class="mobile-shell__memory-banner"
        data-testid="mobile-memory-banner"
        role="status"
      >
        <strong>{{ latestMemoryNotification.title }}</strong>
        <span>{{ latestMemoryNotification.message }}</span>
      </div>

      <div v-if="showHealthBanner" class="mobile-shell__health-banner" data-testid="mobile-health-banner" role="status">
        <span>{{ healthMessage ?? 'Backend connection is not healthy.' }}</span>
        <button type="button" data-testid="mobile-health-retry" aria-label="Retry connection check" @click="emit('retryHealth')">
          Retry
        </button>
      </div>

      <section v-if="route === 'home'" class="mobile-list" data-testid="mobile-workspace-home" aria-label="Workspace Home">
        <button
          v-for="{ project, session } in recentSessions.slice(0, 1)"
          :key="`home-recent-session:${session.id}`"
          class="mobile-list-row"
          type="button"
          data-testid="mobile-recent-session"
          @click="selectSearchResult({ id: `session:${session.id}`, kind: 'session', projectId: project.id, sessionId: session.id, title: session.title, detail: project.name })"
        >
          <span class="mobile-list-row__status" :data-state="session.blockingReason ? 'blocked' : session.turnState" aria-hidden="true" />
          <span class="mobile-list-row__copy">
            <strong>{{ session.title }}</strong>
            <span>Recent session · {{ project.name }} · {{ sessionStatusLabel(session) }}</span>
          </span>
        </button>
        <button
          v-for="project in hierarchy"
          :key="project.id"
          class="mobile-list-row"
          type="button"
          data-testid="mobile-workspace-row"
          :aria-current="project.id === activeProjectId ? 'true' : undefined"
          @click="openProject(project.id)"
        >
          <span class="mobile-list-row__icon" aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <path d="M2.5 6.5a2 2 0 0 1 2-2h4l1.5 2h5.5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
            </svg>
          </span>
          <span class="mobile-list-row__copy">
            <strong>{{ project.name }}</strong>
            <span>{{ project.path }}</span>
            <span>{{ workspaceSessionSummary(project) }}</span>
          </span>
        </button>
        <div class="mobile-shell__home-tools" aria-label="Workspace tools">
          <button type="button" data-testid="mobile-tool-archive" @click="route = 'archive'">Archive</button>
          <button type="button" data-testid="mobile-tool-settings" @click="route = 'settings'">Settings</button>
        </div>
      </section>

      <section v-else-if="route === 'sessions'" class="mobile-list" data-testid="mobile-session-list" aria-label="Session List">
        <div class="mobile-list__toolbar">
          <span>{{ selectedProjectSessions.length }} sessions</span>
          <button
            class="mobile-shell__text-button"
            type="button"
            data-testid="mobile-new-session"
            @click="newSessionOpen = !newSessionOpen"
          >
            New session
          </button>
        </div>
        <input
          v-model="sessionSearchQuery"
          class="mobile-shell__search-inline"
          type="search"
          data-testid="mobile-session-search-input"
          aria-label="Search sessions"
          placeholder="Search sessions"
        />
        <div class="mobile-shell__filters" role="group" aria-label="Session filters">
          <button type="button" data-testid="mobile-session-filter-all" :aria-pressed="sessionFilter === 'all'" @click="sessionFilter = 'all'">All</button>
          <button type="button" data-testid="mobile-session-filter-running" :aria-pressed="sessionFilter === 'running'" @click="sessionFilter = 'running'">Running</button>
          <button type="button" data-testid="mobile-session-filter-blocked" :aria-pressed="sessionFilter === 'blocked'" @click="sessionFilter = 'blocked'">Blocked</button>
          <button type="button" data-testid="mobile-session-filter-recent" :aria-pressed="sessionFilter === 'recent'" @click="sessionFilter = 'recent'">Recent</button>
        </div>
        <button
          v-for="session in selectedProjectSessions"
          :key="session.id"
          class="mobile-list-row"
          type="button"
          data-testid="mobile-session-row"
          :aria-current="session.id === activeSessionId ? 'true' : undefined"
          @click="openSession(session.id)"
        >
          <span class="mobile-list-row__status" :data-state="session.blockingReason ? 'blocked' : session.turnState" aria-hidden="true" />
          <span class="mobile-list-row__copy">
            <strong>{{ session.title }}</strong>
            <span>{{ sessionStatusLabel(session) }} · {{ getProviderDescriptorBySessionType(session.type).displayName }}</span>
            <span>{{ formatRelativeActivity(session.updatedAt) }}</span>
          </span>
        </button>
      </section>

      <section
        v-else-if="route === 'archive'"
        class="mobile-list"
        data-testid="mobile-archive"
        aria-label="Archived sessions"
      >
        <article
          v-for="{ project, session } in archivedSessions"
          :key="session.id"
          class="mobile-list-row mobile-list-row--split"
          data-testid="mobile-archive-row"
        >
          <span class="mobile-list-row__copy">
            <strong>{{ session.title }}</strong>
            <span>{{ project.name }} · {{ getProviderDescriptorBySessionType(session.type).displayName }}</span>
          </span>
          <button
            class="mobile-shell__text-button"
            type="button"
            data-testid="mobile-archive-restore"
            @click="restoreArchivedSession(session.id, project.id)"
          >
            Restore
          </button>
        </article>
        <p v-if="archivedSessions.length === 0" class="mobile-shell__empty">
          No archived sessions.
        </p>
      </section>

      <SettingsSurface
        v-else-if="route === 'settings'"
        class="mobile-shell__embedded-surface"
        data-testid="mobile-settings"
      />

      <MobileSessionTerminal
        v-else
        data-testid="mobile-session-view"
        :project="activeProject"
        :session="activeSession"
        :health-status="healthStatus"
        @open-workspace="emit('openWorkspace', $event)"
      />
    </main>

    <div
      v-if="route === 'sessions' && newSessionOpen"
      class="mobile-search mobile-sheet-layer"
      @click.self="newSessionOpen = false"
    >
      <section
        class="mobile-provider-grid mobile-provider-grid--sheet"
        data-testid="mobile-new-session-sheet"
        role="group"
        aria-label="Choose session type"
      >
        <button
          v-for="provider in providerButtons"
          :key="provider.type"
          class="mobile-provider-grid__item"
          type="button"
          :data-provider-type="provider.type"
          data-testid="mobile-session-type-option"
          :aria-label="provider.label"
          @click="createSession(provider.type)"
        >
          <img :src="provider.iconSrc" alt="" aria-hidden="true" />
        </button>
      </section>
    </div>

    <div v-if="sessionActionsOpen" class="mobile-search" data-testid="mobile-session-actions-sheet" @click.self="sessionActionsOpen = false">
      <section class="mobile-search__panel" role="dialog" aria-label="Session actions">
        <button
          v-if="activeSession"
          type="button"
          class="mobile-list-row"
          @click="emit('restartSession', activeSession.id); sessionActionsOpen = false"
        >
          <span class="mobile-list-row__copy">
            <strong>Restart</strong>
            <span>{{ activeSession.title }}</span>
          </span>
        </button>
        <button
          v-if="activeSession"
          type="button"
          class="mobile-list-row"
          @click="emit('archiveSession', activeSession.id); sessionActionsOpen = false; route = 'sessions'"
        >
          <span class="mobile-list-row__copy">
            <strong>Archive</strong>
            <span>{{ activeSession.title }}</span>
          </span>
        </button>
      </section>
    </div>

    <div v-if="searchOpen" class="mobile-search" data-testid="mobile-global-search-layer" @click.self="closeSearch">
      <section class="mobile-search__panel" role="dialog" aria-label="Search workspaces and sessions">
        <div class="mobile-search__field">
          <input v-model="searchQuery" data-testid="mobile-global-search-input" type="search" placeholder="Search" autofocus />
          <button type="button" class="mobile-shell__text-button" @click="closeSearch">Close</button>
        </div>
        <template v-if="!searchQuery.trim()">
          <button
            v-for="{ project, session } in recentSessions"
            :key="`recent-session:${session.id}`"
            class="mobile-list-row"
            type="button"
            data-testid="mobile-recent-session"
            @click="selectSearchResult({ id: `session:${session.id}`, kind: 'session', projectId: project.id, sessionId: session.id, title: session.title, detail: project.name })"
          >
            <span class="mobile-list-row__copy">
              <strong>{{ session.title }}</strong>
              <span>{{ project.name }}</span>
            </span>
          </button>
          <button
            v-for="project in recentWorkspaces"
            :key="`recent-workspace:${project.id}`"
            class="mobile-list-row"
            type="button"
            data-testid="mobile-global-search-workspace-result"
            @click="selectSearchResult({ id: `workspace:${project.id}`, kind: 'workspace', projectId: project.id, title: project.name, detail: project.path })"
          >
            <span class="mobile-list-row__copy">
              <strong>{{ project.name }}</strong>
              <span>{{ project.path }}</span>
            </span>
          </button>
        </template>
        <template v-else>
          <p v-if="sessionSearchResults.length > 0" class="mobile-search__group-label">Sessions</p>
          <button
            v-for="result in sessionSearchResults"
            :key="result.id"
            class="mobile-list-row"
            type="button"
            data-testid="mobile-global-search-session-result"
            @click="selectSearchResult(result)"
          >
            <span class="mobile-list-row__copy">
              <strong>{{ result.title }}</strong>
              <span>{{ result.detail }}</span>
            </span>
          </button>
          <p v-if="workspaceSearchResults.length > 0" class="mobile-search__group-label">Workspaces</p>
          <button
            v-for="result in workspaceSearchResults"
            :key="result.id"
            class="mobile-list-row"
            type="button"
            data-testid="mobile-global-search-workspace-result"
            @click="selectSearchResult(result)"
          >
            <span class="mobile-list-row__copy">
              <strong>{{ result.title }}</strong>
              <span>{{ result.detail }}</span>
            </span>
          </button>
        </template>
      </section>
    </div>
  </section>
</template>

<style scoped>
.mobile-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--mica);
  color: var(--text);
  font-family: var(--font-ui);
}

.mobile-shell__header {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  align-items: center;
  min-height: 56px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--stroke-divider);
  background: var(--mica-alt);
}

.mobile-shell__title {
  display: grid;
  gap: 2px;
  min-width: 0;
  text-align: center;
}

.mobile-shell__title strong,
.mobile-list-row__copy strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-strong);
  font-size: var(--text-body);
  font-weight: 600;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-shell__eyebrow,
.mobile-list-row__copy span,
.mobile-list__toolbar {
  color: var(--muted);
  font-size: var(--text-caption);
  line-height: 1.2;
}

.mobile-shell__eyebrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}

.mobile-shell__health-dot {
  width: 8px;
  height: 8px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--radius-sm);
  background: var(--success);
}

.mobile-shell__health-dot[data-health-status='reconnecting'] {
  background: var(--warning);
}

.mobile-shell__health-dot[data-health-status='offline'] {
  background: var(--error);
}

.mobile-shell__session-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--radius-sm);
  background: var(--subtle);
  vertical-align: middle;
}

.mobile-shell__session-dot[data-state='running'] {
  background: var(--accent);
}

.mobile-shell__session-dot[data-state='blocked'] {
  background: var(--warning);
}

.mobile-shell__icon-button,
.mobile-shell__text-button {
  min-height: 44px;
  border: 1px solid var(--stroke-control);
  border-radius: var(--radius-sm);
  background: var(--control-fill);
  color: var(--text);
  cursor: pointer;
  transition:
    background-color var(--duration-rest) var(--curve-standard),
    color var(--duration-rest) var(--curve-standard),
    box-shadow var(--duration-rest) var(--curve-standard);
}

.mobile-shell__icon-button {
  display: grid;
  width: 44px;
  place-items: center;
  padding: 0;
}

.mobile-shell__icon-button svg {
  width: 20px;
  height: 20px;
}

.mobile-shell__header-spacer {
  width: 44px;
  height: 44px;
}

.mobile-shell__text-button {
  padding: 0 12px;
  font-weight: 600;
}

.mobile-shell__icon-button:hover,
.mobile-shell__text-button:hover,
.mobile-list-row:hover,
.mobile-provider-grid__item:hover {
  background: var(--control-fill-hover);
  color: var(--text-strong);
}

.mobile-shell__icon-button:focus-visible,
.mobile-shell__text-button:focus-visible,
.mobile-list-row:focus-visible,
.mobile-provider-grid__item:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus-ring);
}

.mobile-shell__body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.mobile-shell__health-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 40px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--stroke-divider);
  background: var(--surface-solid);
  color: var(--text);
  font-size: var(--text-caption);
}

.mobile-shell__memory-banner {
  display: grid;
  gap: 2px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--stroke-divider);
  background: var(--surface-solid);
  color: var(--text);
}

.mobile-shell__memory-banner strong,
.mobile-shell__memory-banner span,
.mobile-shell__empty {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-shell__memory-banner strong {
  color: var(--text-strong);
  font-size: var(--text-body-sm);
  font-weight: 600;
  line-height: 1.25;
}

.mobile-shell__memory-banner span,
.mobile-shell__empty {
  color: var(--muted);
  font-size: var(--text-caption);
  line-height: 1.25;
}

.mobile-shell__health-banner button,
.mobile-shell__home-tools button,
.mobile-shell__filters button {
  min-height: 44px;
  border: 1px solid var(--stroke-control);
  border-radius: var(--radius-sm);
  background: var(--control-fill);
  color: var(--text);
  cursor: pointer;
}

.mobile-list {
  flex: 1 1 auto;
  display: grid;
  align-content: start;
  gap: 8px;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.mobile-shell__home-tools {
  position: sticky;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding-top: 8px;
  background: var(--mica);
}

.mobile-list__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mobile-shell__search-inline {
  min-height: 44px;
  min-width: 0;
  border: 1px solid var(--stroke-control);
  border-radius: var(--radius-sm);
  background: var(--surface-solid);
  color: var(--text);
  padding: 0 12px;
  font: var(--text-body-sm) var(--font-ui);
}

.mobile-shell__filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.mobile-shell__filters button[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--active-fill);
  color: var(--text-strong);
}

.mobile-list-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 8px 10px;
  border: 1px solid var(--stroke-control);
  border-radius: var(--radius-md);
  background: var(--surface-solid);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.mobile-list-row[aria-current='true'] {
  border-color: var(--accent);
  background: var(--active-fill);
}

.mobile-list-row--split {
  grid-template-columns: minmax(0, 1fr) auto;
  cursor: default;
}

.mobile-list-row__icon,
.mobile-list-row__status {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  color: var(--accent);
}

.mobile-list-row__icon svg {
  width: 20px;
  height: 20px;
}

.mobile-list-row__status {
  width: 10px;
  height: 10px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--radius-sm);
  background: var(--subtle);
}

.mobile-list-row__status[data-state='running'] {
  background: var(--accent);
}

.mobile-list-row__status[data-state='blocked'] {
  background: var(--color-warning);
}

.mobile-list-row__copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.mobile-provider-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.mobile-provider-grid--sheet {
  align-self: end;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--acrylic);
  box-shadow: var(--shadow-flyout);
}

.mobile-provider-grid__item {
  display: grid;
  min-height: 76px;
  place-items: center;
  gap: 6px;
  border: 1px solid var(--stroke-control);
  border-radius: var(--radius-md);
  background: var(--surface-solid);
  color: var(--text);
  cursor: pointer;
}

.mobile-provider-grid__item img {
  width: 28px;
  height: 28px;
}

.mobile-shell__embedded-surface {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.mobile-search {
  position: fixed;
  inset: 0;
  z-index: 30;
  padding: 10px;
  background: var(--smoke);
}

.mobile-sheet-layer {
  display: grid;
  align-items: end;
  padding: 0;
}

.mobile-search__panel {
  display: grid;
  align-content: start;
  gap: 8px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--radius-lg);
  background: var(--acrylic);
  box-shadow: var(--shadow-flyout);
}

.mobile-search__field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.mobile-search__group-label {
  margin: 6px 2px 0;
  color: var(--muted);
  font-size: var(--text-caption);
  font-weight: 600;
  line-height: 1.2;
}

.mobile-search__field input {
  min-height: 44px;
  min-width: 0;
  border: 1px solid var(--stroke-control);
  border-radius: var(--radius-sm);
  background: var(--surface-solid);
  color: var(--text);
  padding: 0 12px;
  font: var(--text-body-sm) var(--font-ui);
}
</style>
