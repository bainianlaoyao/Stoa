# Session Observability Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dual-layer session/project/app observability architecture with canonical observation events, snapshots, renderer view models, and provider evidence enrichment.

**Architecture:** Provider payloads and existing session events become `ObservationEvent` facts. Projection functions derive session, project, and app snapshots. Renderer components consume view models derived from snapshots rather than raw provider payloads or raw session statuses.

**Tech Stack:** TypeScript, Electron IPC, Vue 3 Composition API, Pinia, Vitest, Playwright, existing state-store patterns.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-04-24-session-observability-architecture-design.md`
- Research: `research/2026-04-24-session-presence-and-ui.md`
- Provider inventory: `docs/architecture/provider-observable-information.md`
- Design language: `docs/engineering/design-language.md`

## File Map

- Create: `src/shared/observability.ts` — shared observation event, snapshot, and view-model types.
- Create: `src/shared/observability-projection.ts` — pure event-to-snapshot and snapshot-to-view-model functions.
- Create: `src/shared/observability-projection.test.ts` — unit tests for projection rules.
- Create: `src/core/observation-store.ts` — observation event append/list/dedupe/prune store.
- Create: `src/core/observation-store.test.ts` — store behavior tests.
- Create: `src/core/observability-service.ts` — ingestion, projection, and snapshot query service.
- Create: `src/core/observability-service.test.ts` — service tests.
- Modify: `src/shared/project-session.ts` — add renderer API types/channels for observability snapshots.
- Modify: `src/shared/ipc-channels.ts` — add observability IPC constants.
- Modify: `src/main/session-event-bridge.ts` — route canonical session events into observability service.
- Modify: `src/main/session-runtime-controller.ts` — publish presence snapshot changes.
- Modify: `src/main/preload.ts` — expose observability read/subscribe APIs.
- Modify: `src/main/index.ts` — register observability IPC handlers.
- Modify: `src/renderer/stores/workspaces.ts` — store presence/project/app snapshots.
- Create: `src/renderer/stores/observability-view-models.ts` — derive UI view models.
- Create: `src/renderer/stores/observability-view-models.test.ts` — view-model tests.
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue` — render session row view models.
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts` — assert status labels, tones, truncation.
- Modify: `src/renderer/components/command/TerminalMetaBar.vue` — render active session focus model.
- Modify: `src/renderer/components/command/TerminalMetaBar.test.ts` — assert active session presentation.
- Create: `src/renderer/components/command/SessionDetailPopover.vue` — identity/presence/timeline detail surface.
- Create: `src/renderer/components/command/SessionDetailPopover.test.ts` — detail surface tests.
- Modify: `testing/topology/session-status.topology.test.ts` — update topology expectations.
- Modify: `testing/behavior/` and `testing/journeys/` assets if user-visible behavior changes require generated journeys.

## Task 1: Shared Observability Types

**Files:**
- Create: `src/shared/observability.ts`
- Test: `src/shared/observability-projection.test.ts` in later task

- [ ] **Step 1: Create shared observability types**

Add `src/shared/observability.ts`:

```ts
import type { SessionStatus } from './project-session'

export type ObservationScope = 'session' | 'project' | 'app'
export type ObservationCategory = 'lifecycle' | 'presence' | 'evidence' | 'activity' | 'system'
export type ObservationSeverity = 'info' | 'attention' | 'warning' | 'error'
export type ObservationRetention = 'critical' | 'operational' | 'ephemeral'
export type ObservationSource = 'hook-sidecar' | 'provider-adapter' | 'system-recovery' | 'runtime-controller'

export interface ObservationEvent {
  eventId: string
  eventVersion: 1
  occurredAt: string
  ingestedAt: string
  scope: ObservationScope
  projectId: string | null
  sessionId: string | null
  providerId: string | null
  category: ObservationCategory
  type: string
  severity: ObservationSeverity
  retention: ObservationRetention
  source: ObservationSource
  correlationId: string | null
  dedupeKey: string | null
  payload: Record<string, unknown>
}

export type SessionPresencePhase = 'preparing' | 'working' | 'ready' | 'blocked' | 'degraded' | 'failed' | 'exited'
export type ObservabilityConfidence = 'authoritative' | 'provisional' | 'stale'
export type ObservabilityHealth = 'healthy' | 'degraded' | 'lost'
export type BlockingReason = 'permission' | 'elicitation' | 'resume-confirmation' | 'provider-error'
export type RecoveryPointerState = 'trusted' | 'suspect' | 'missing'
export type ObservabilityTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export interface SessionRuntimeSnapshot {
  sessionId: string
  projectId: string
  providerId: string
  canonicalStatus: SessionStatus
  runtimeAttached: boolean
  externalSessionId: string | null
  recoveryPointerState: RecoveryPointerState
  lastEventAt: string | null
  updatedAt: string
}

export interface SessionPresenceSnapshot {
  sessionId: string
  projectId: string
  providerId: string
  providerLabel: string
  modelLabel: string | null
  phase: SessionPresencePhase
  canonicalStatus: SessionStatus
  confidence: ObservabilityConfidence
  health: ObservabilityHealth
  blockingReason: BlockingReason | null
  lastAssistantSnippet: string | null
  lastEventAt: string | null
  lastEvidenceType: string | null
  hasUnreadTurn: boolean
  recoveryPointerState: RecoveryPointerState
  updatedAt: string
}

export interface ProjectObservabilitySnapshot {
  projectId: string
  overallHealth: 'healthy' | 'degraded' | 'blocked' | 'failed'
  activeSessionCount: number
  blockedSessionCount: number
  degradedSessionCount: number
  failedSessionCount: number
  unreadTurnCount: number
  latestAttentionSessionId: string | null
  latestAttentionReason: 'blocked' | 'failed' | 'unread' | 'degraded' | null
  lastEventAt: string | null
  updatedAt: string
}

export interface AppObservabilitySnapshot {
  blockedProjectCount: number
  failedProjectCount: number
  degradedProjectCount: number
  totalUnreadTurns: number
  projectsNeedingAttention: string[]
  providerHealthSummary: Record<string, ObservabilityHealth>
  lastGlobalEventAt: string | null
  updatedAt: string
}

export interface SessionRowViewModel {
  sessionId: string
  title: string
  primaryLabel: string
  secondaryLabel: string
  tone: ObservabilityTone
  hasUnreadTurn: boolean
  needsAttention: boolean
  attentionReason: 'blocked' | 'failed' | 'degraded' | 'unread' | null
  updatedAgoLabel: string | null
}

export interface ActiveSessionViewModel {
  sessionId: string
  title: string
  providerLabel: string
  modelLabel: string | null
  phaseLabel: string
  confidenceLabel: string
  tone: ObservabilityTone
  lastUpdatedLabel: string | null
  snippet: string | null
  explanation: string | null
}
```

- [ ] **Step 2: Run typecheck for shared type syntax**

Run: `npm run typecheck`

Expected: TypeScript compiles or only reports unrelated pre-existing errors. If this file causes errors, fix the imported type paths and exported names.

## Task 2: Pure Projection Functions

**Files:**
- Create: `src/shared/observability-projection.ts`
- Create: `src/shared/observability-projection.test.ts`

- [ ] **Step 1: Write projection tests first**

Create `src/shared/observability-projection.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import type { SessionSummary } from './project-session'
import {
  buildAppObservabilitySnapshot,
  buildProjectObservabilitySnapshot,
  buildSessionPresenceSnapshot,
  buildSessionRowViewModel,
  mapStatusToPresencePhase
} from './observability-projection'
import type { SessionPresenceSnapshot } from './observability'

const baseSession: SessionSummary = {
  id: 'session_1',
  projectId: 'project_1',
  type: 'claude-code',
  status: 'turn_complete',
  title: 'claude-main',
  summary: 'Stop',
  recoveryMode: 'resume-external',
  externalSessionId: 'external-1',
  createdAt: '2026-04-24T00:00:00.000Z',
  updatedAt: '2026-04-24T00:00:10.000Z',
  lastActivatedAt: null,
  archived: false
}

describe('observability projection', () => {
  test('maps turn_complete to ready instead of warning semantics', () => {
    expect(mapStatusToPresencePhase('turn_complete')).toBe('ready')
    expect(mapStatusToPresencePhase('awaiting_input')).toBe('ready')
    expect(mapStatusToPresencePhase('needs_confirmation')).toBe('blocked')
    expect(mapStatusToPresencePhase('degraded')).toBe('degraded')
  })

  test('builds a presence snapshot from a session summary', () => {
    const snapshot = buildSessionPresenceSnapshot(baseSession, {
      activeSessionId: null,
      nowIso: '2026-04-24T00:00:20.000Z'
    })

    expect(snapshot).toMatchObject({
      sessionId: 'session_1',
      projectId: 'project_1',
      providerId: 'claude-code',
      providerLabel: 'Claude',
      phase: 'ready',
      canonicalStatus: 'turn_complete',
      confidence: 'authoritative',
      health: 'healthy',
      recoveryPointerState: 'trusted'
    })
  })

  test('marks inactive assistant turn as unread', () => {
    const snapshot = buildSessionPresenceSnapshot(baseSession, {
      activeSessionId: 'session_other',
      nowIso: '2026-04-24T00:00:20.000Z',
      lastAssistantSnippet: 'The fix is ready.'
    })

    expect(snapshot.hasUnreadTurn).toBe(true)
  })

  test('builds session row view model with state-first labels', () => {
    const snapshot = buildSessionPresenceSnapshot(baseSession, {
      activeSessionId: null,
      nowIso: '2026-04-24T00:00:20.000Z',
      modelLabel: 'Sonnet'
    })

    const row = buildSessionRowViewModel(baseSession, snapshot, '2026-04-24T00:00:20.000Z')

    expect(row.primaryLabel).toBe('Ready')
    expect(row.secondaryLabel).toBe('Ready · Claude · Sonnet')
    expect(row.tone).toBe('accent')
  })

  test('project snapshot prioritizes failed, then blocked, then degraded', () => {
    const sessions: SessionPresenceSnapshot[] = [
      { ...buildSessionPresenceSnapshot(baseSession, { nowIso: '2026-04-24T00:00:20.000Z' }), sessionId: 'ready', phase: 'ready' },
      { ...buildSessionPresenceSnapshot(baseSession, { nowIso: '2026-04-24T00:00:20.000Z' }), sessionId: 'blocked', phase: 'blocked' },
      { ...buildSessionPresenceSnapshot(baseSession, { nowIso: '2026-04-24T00:00:20.000Z' }), sessionId: 'failed', phase: 'failed' }
    ]

    const snapshot = buildProjectObservabilitySnapshot('project_1', sessions, '2026-04-24T00:00:30.000Z')

    expect(snapshot.overallHealth).toBe('failed')
    expect(snapshot.failedSessionCount).toBe(1)
    expect(snapshot.blockedSessionCount).toBe(1)
    expect(snapshot.latestAttentionReason).toBe('failed')
  })

  test('app snapshot aggregates project attention', () => {
    const project = buildProjectObservabilitySnapshot('project_1', [
      { ...buildSessionPresenceSnapshot(baseSession, { nowIso: '2026-04-24T00:00:20.000Z' }), phase: 'blocked', hasUnreadTurn: true }
    ], '2026-04-24T00:00:30.000Z')

    const app = buildAppObservabilitySnapshot([project], [], '2026-04-24T00:00:40.000Z')

    expect(app.blockedProjectCount).toBe(1)
    expect(app.totalUnreadTurns).toBe(1)
    expect(app.projectsNeedingAttention).toEqual(['project_1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/observability-projection.test.ts`

Expected: FAIL because `observability-projection.ts` does not exist.

- [ ] **Step 3: Implement pure projections**

Create `src/shared/observability-projection.ts`:

```ts
import type { SessionStatus, SessionSummary } from './project-session'
import type {
  AppObservabilitySnapshot,
  ObservabilityTone,
  ProjectObservabilitySnapshot,
  SessionPresencePhase,
  SessionPresenceSnapshot,
  SessionRowViewModel
} from './observability'

export function mapStatusToPresencePhase(status: SessionStatus): SessionPresencePhase {
  switch (status) {
    case 'bootstrapping':
    case 'starting':
      return 'preparing'
    case 'running':
      return 'working'
    case 'turn_complete':
    case 'awaiting_input':
      return 'ready'
    case 'needs_confirmation':
      return 'blocked'
    case 'degraded':
      return 'degraded'
    case 'error':
      return 'failed'
    case 'exited':
      return 'exited'
  }
}

export function mapPhaseToTone(phase: SessionPresencePhase): ObservabilityTone {
  switch (phase) {
    case 'preparing':
    case 'exited':
      return 'neutral'
    case 'working':
      return 'success'
    case 'ready':
      return 'accent'
    case 'blocked':
    case 'degraded':
      return 'warning'
    case 'failed':
      return 'danger'
  }
}

export function providerLabel(providerId: string): string {
  switch (providerId) {
    case 'claude-code':
      return 'Claude'
    case 'opencode':
      return 'OpenCode'
    case 'codex':
      return 'Codex'
    case 'shell':
      return 'Shell'
    default:
      return providerId
  }
}

export function phaseLabel(phase: SessionPresencePhase): string {
  switch (phase) {
    case 'preparing':
      return 'Preparing'
    case 'working':
      return 'Working'
    case 'ready':
      return 'Ready'
    case 'blocked':
      return 'Needs approval'
    case 'degraded':
      return 'Attention needed'
    case 'failed':
      return 'Error'
    case 'exited':
      return 'Exited'
  }
}

export function buildSessionPresenceSnapshot(
  session: SessionSummary,
  options: {
    activeSessionId?: string | null
    nowIso: string
    modelLabel?: string | null
    lastAssistantSnippet?: string | null
  }
): SessionPresenceSnapshot {
  const phase = mapStatusToPresencePhase(session.status)
  const hasAssistantSnippet = Boolean(options.lastAssistantSnippet)
  const isInactive = options.activeSessionId !== undefined && options.activeSessionId !== null && options.activeSessionId !== session.id

  return {
    sessionId: session.id,
    projectId: session.projectId,
    providerId: session.type,
    providerLabel: providerLabel(session.type),
    modelLabel: options.modelLabel ?? null,
    phase,
    canonicalStatus: session.status,
    confidence: session.status === 'bootstrapping' || session.status === 'starting' ? 'provisional' : 'authoritative',
    health: session.status === 'degraded' ? 'degraded' : 'healthy',
    blockingReason: session.status === 'needs_confirmation' ? 'permission' : null,
    lastAssistantSnippet: options.lastAssistantSnippet ?? null,
    lastEventAt: session.updatedAt,
    lastEvidenceType: hasAssistantSnippet ? 'assistant_message' : null,
    hasUnreadTurn: hasAssistantSnippet && isInactive,
    recoveryPointerState: session.externalSessionId ? 'trusted' : 'missing',
    updatedAt: options.nowIso
  }
}

export function buildSessionRowViewModel(
  session: SessionSummary,
  snapshot: SessionPresenceSnapshot,
  nowIso: string
): SessionRowViewModel {
  const primaryLabel = phaseLabel(snapshot.phase)
  const providerParts = [primaryLabel, snapshot.providerLabel, snapshot.modelLabel].filter(Boolean)
  const attentionReason =
    snapshot.phase === 'failed' ? 'failed'
      : snapshot.phase === 'blocked' ? 'blocked'
        : snapshot.phase === 'degraded' ? 'degraded'
          : snapshot.hasUnreadTurn ? 'unread'
            : null

  return {
    sessionId: session.id,
    title: session.title,
    primaryLabel,
    secondaryLabel: providerParts.join(' · '),
    tone: mapPhaseToTone(snapshot.phase),
    hasUnreadTurn: snapshot.hasUnreadTurn,
    needsAttention: attentionReason !== null,
    attentionReason,
    updatedAgoLabel: formatRelativeAge(snapshot.lastEventAt, nowIso)
  }
}

export function buildProjectObservabilitySnapshot(
  projectId: string,
  sessions: SessionPresenceSnapshot[],
  nowIso: string
): ProjectObservabilitySnapshot {
  const failed = sessions.filter(session => session.phase === 'failed')
  const blocked = sessions.filter(session => session.phase === 'blocked')
  const degraded = sessions.filter(session => session.phase === 'degraded' || session.health !== 'healthy')
  const unread = sessions.filter(session => session.hasUnreadTurn)
  const latestAttention = failed[0] ?? blocked[0] ?? unread[0] ?? degraded[0] ?? null
  const latestAttentionReason =
    failed.length > 0 ? 'failed'
      : blocked.length > 0 ? 'blocked'
        : unread.length > 0 ? 'unread'
          : degraded.length > 0 ? 'degraded'
            : null

  return {
    projectId,
    overallHealth: failed.length > 0 ? 'failed' : blocked.length > 0 ? 'blocked' : degraded.length > 0 ? 'degraded' : 'healthy',
    activeSessionCount: sessions.filter(session => session.phase !== 'exited').length,
    blockedSessionCount: blocked.length,
    degradedSessionCount: degraded.length,
    failedSessionCount: failed.length,
    unreadTurnCount: unread.length,
    latestAttentionSessionId: latestAttention?.sessionId ?? null,
    latestAttentionReason,
    lastEventAt: latestEventTime(sessions.map(session => session.lastEventAt)),
    updatedAt: nowIso
  }
}

export function buildAppObservabilitySnapshot(
  projects: ProjectObservabilitySnapshot[],
  sessionSnapshots: SessionPresenceSnapshot[],
  nowIso: string
): AppObservabilitySnapshot {
  return {
    blockedProjectCount: projects.filter(project => project.overallHealth === 'blocked').length,
    failedProjectCount: projects.filter(project => project.overallHealth === 'failed').length,
    degradedProjectCount: projects.filter(project => project.overallHealth === 'degraded').length,
    totalUnreadTurns: projects.reduce((total, project) => total + project.unreadTurnCount, 0),
    projectsNeedingAttention: projects
      .filter(project => project.latestAttentionReason !== null)
      .map(project => project.projectId),
    providerHealthSummary: Object.fromEntries(sessionSnapshots.map(session => [session.providerId, session.health])),
    lastGlobalEventAt: latestEventTime(projects.map(project => project.lastEventAt)),
    updatedAt: nowIso
  }
}

function latestEventTime(values: Array<string | null>): string | null {
  const sorted = values.filter((value): value is string => value !== null).sort()
  return sorted.at(-1) ?? null
}

function formatRelativeAge(value: string | null, nowIso: string): string | null {
  if (!value) {
    return null
  }
  const deltaMs = new Date(nowIso).getTime() - new Date(value).getTime()
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    return null
  }
  const seconds = Math.floor(deltaMs / 1000)
  if (seconds < 60) {
    return `${seconds}s ago`
  }
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ago`
}
```

- [ ] **Step 4: Run projection tests**

Run: `npx vitest run src/shared/observability-projection.test.ts`

Expected: PASS.

## Task 3: Observation Event Store

**Files:**
- Create: `src/core/observation-store.ts`
- Create: `src/core/observation-store.test.ts`

- [ ] **Step 1: Write store tests**

Create `src/core/observation-store.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import type { ObservationEvent } from '@shared/observability'
import { InMemoryObservationStore } from './observation-store'

function event(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    eventId: 'event_1',
    eventVersion: 1,
    occurredAt: '2026-04-24T00:00:00.000Z',
    ingestedAt: '2026-04-24T00:00:01.000Z',
    scope: 'session',
    projectId: 'project_1',
    sessionId: 'session_1',
    providerId: 'claude-code',
    category: 'presence',
    type: 'presence.turn_complete',
    severity: 'info',
    retention: 'operational',
    source: 'provider-adapter',
    correlationId: null,
    dedupeKey: null,
    payload: {},
    ...overrides
  }
}

describe('InMemoryObservationStore', () => {
  let store: InMemoryObservationStore

  beforeEach(() => {
    store = new InMemoryObservationStore()
  })

  test('appends and lists events by session', async () => {
    await store.append(event())

    const events = await store.listSessionEvents('session_1', { limit: 10 })

    expect(events.events).toHaveLength(1)
    expect(events.events[0].eventId).toBe('event_1')
  })

  test('dedupes repeated event ids', async () => {
    await store.append(event())
    await store.append(event())

    const events = await store.listSessionEvents('session_1', { limit: 10 })

    expect(events.events).toHaveLength(1)
  })

  test('filters by categories', async () => {
    await store.append(event({ eventId: 'event_1', category: 'presence' }))
    await store.append(event({ eventId: 'event_2', category: 'evidence', type: 'evidence.model_observed' }))

    const events = await store.listSessionEvents('session_1', { limit: 10, categories: ['evidence'] })

    expect(events.events.map(item => item.eventId)).toEqual(['event_2'])
  })

  test('keeps ephemeral events out of persisted listing by default', async () => {
    await store.append(event({ eventId: 'event_1', retention: 'ephemeral', type: 'system.heartbeat_reported' }))
    await store.append(event({ eventId: 'event_2', retention: 'critical', type: 'lifecycle.session_started' }))

    const events = await store.listSessionEvents('session_1', { limit: 10 })

    expect(events.events.map(item => item.eventId)).toEqual(['event_2'])
  })
})
```

- [ ] **Step 2: Run store test to verify it fails**

Run: `npx vitest run src/core/observation-store.test.ts`

Expected: FAIL because `observation-store.ts` does not exist.

- [ ] **Step 3: Implement in-memory store**

Create `src/core/observation-store.ts`:

```ts
import type { ObservationCategory, ObservationEvent } from '@shared/observability'

export interface ListObservationEventsOptions {
  limit: number
  cursor?: string
  categories?: ObservationCategory[]
  includeEphemeral?: boolean
}

export interface ListObservationEventsResult {
  events: ObservationEvent[]
  nextCursor: string | null
}

export interface ObservationStore {
  append(event: ObservationEvent): Promise<boolean>
  listSessionEvents(sessionId: string, options: ListObservationEventsOptions): Promise<ListObservationEventsResult>
  listProjectEvents(projectId: string, options: ListObservationEventsOptions): Promise<ListObservationEventsResult>
}

export class InMemoryObservationStore implements ObservationStore {
  private readonly events: ObservationEvent[] = []
  private readonly eventIds = new Set<string>()

  async append(event: ObservationEvent): Promise<boolean> {
    if (this.eventIds.has(event.eventId)) {
      return false
    }
    this.eventIds.add(event.eventId)
    if (event.retention !== 'ephemeral') {
      this.events.push(event)
    }
    return true
  }

  async listSessionEvents(sessionId: string, options: ListObservationEventsOptions): Promise<ListObservationEventsResult> {
    return this.listEvents(event => event.sessionId === sessionId, options)
  }

  async listProjectEvents(projectId: string, options: ListObservationEventsOptions): Promise<ListObservationEventsResult> {
    return this.listEvents(event => event.projectId === projectId, options)
  }

  private listEvents(
    predicate: (event: ObservationEvent) => boolean,
    options: ListObservationEventsOptions
  ): ListObservationEventsResult {
    const startIndex = options.cursor ? Number(options.cursor) : 0
    const filtered = this.events.filter(event => {
      if (!predicate(event)) {
        return false
      }
      if (!options.includeEphemeral && event.retention === 'ephemeral') {
        return false
      }
      return !options.categories || options.categories.includes(event.category)
    })
    const events = filtered.slice(startIndex, startIndex + options.limit)
    const nextIndex = startIndex + events.length
    return {
      events,
      nextCursor: nextIndex < filtered.length ? String(nextIndex) : null
    }
  }
}
```

- [ ] **Step 4: Run store tests**

Run: `npx vitest run src/core/observation-store.test.ts`

Expected: PASS.

## Task 4: Observability Service

**Files:**
- Create: `src/core/observability-service.ts`
- Create: `src/core/observability-service.test.ts`

- [ ] **Step 1: Write service tests**

Create `src/core/observability-service.test.ts` with tests covering:

```ts
import { describe, expect, test } from 'vitest'
import type { SessionSummary } from '@shared/project-session'
import type { ObservationEvent } from '@shared/observability'
import { InMemoryObservationStore } from './observation-store'
import { ObservabilityService } from './observability-service'

const session: SessionSummary = {
  id: 'session_1',
  projectId: 'project_1',
  type: 'opencode',
  status: 'running',
  title: 'opencode-main',
  summary: 'Session running',
  recoveryMode: 'resume-external',
  externalSessionId: 'open-1',
  createdAt: '2026-04-24T00:00:00.000Z',
  updatedAt: '2026-04-24T00:00:10.000Z',
  lastActivatedAt: null,
  archived: false
}

function observation(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    eventId: 'event_1',
    eventVersion: 1,
    occurredAt: '2026-04-24T00:00:20.000Z',
    ingestedAt: '2026-04-24T00:00:21.000Z',
    scope: 'session',
    projectId: 'project_1',
    sessionId: 'session_1',
    providerId: 'opencode',
    category: 'presence',
    type: 'presence.turn_complete',
    severity: 'info',
    retention: 'operational',
    source: 'provider-adapter',
    correlationId: null,
    dedupeKey: null,
    payload: {},
    ...overrides
  }
}

describe('ObservabilityService', () => {
  test('builds presence from session registration and observation events', async () => {
    const service = new ObservabilityService(new InMemoryObservationStore(), () => '2026-04-24T00:00:30.000Z')

    await service.registerSession(session, null)
    await service.ingest(observation())

    const presence = service.getSessionPresence('session_1')

    expect(presence).toMatchObject({
      sessionId: 'session_1',
      phase: 'ready',
      canonicalStatus: 'turn_complete'
    })
  })

  test('records assistant evidence into presence snapshot', async () => {
    const service = new ObservabilityService(new InMemoryObservationStore(), () => '2026-04-24T00:00:30.000Z')

    await service.registerSession(session, 'session_other')
    await service.ingest(observation({
      eventId: 'event_2',
      category: 'evidence',
      type: 'evidence.assistant_message_observed',
      payload: { snippet: 'Ready for review.' }
    }))

    const presence = service.getSessionPresence('session_1')

    expect(presence?.lastAssistantSnippet).toBe('Ready for review.')
    expect(presence?.hasUnreadTurn).toBe(true)
  })

  test('aggregates project and app snapshots', async () => {
    const service = new ObservabilityService(new InMemoryObservationStore(), () => '2026-04-24T00:00:30.000Z')

    await service.registerSession({ ...session, status: 'needs_confirmation' }, null)

    expect(service.getProjectObservability('project_1')?.overallHealth).toBe('blocked')
    expect(service.getAppObservability().blockedProjectCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run service test to verify it fails**

Run: `npx vitest run src/core/observability-service.test.ts`

Expected: FAIL because `observability-service.ts` does not exist.

- [ ] **Step 3: Implement service**

Create `src/core/observability-service.ts` with:

```ts
import type { SessionSummary, SessionStatus } from '@shared/project-session'
import type {
  AppObservabilitySnapshot,
  ObservationEvent,
  ProjectObservabilitySnapshot,
  SessionPresenceSnapshot
} from '@shared/observability'
import {
  buildAppObservabilitySnapshot,
  buildProjectObservabilitySnapshot,
  buildSessionPresenceSnapshot
} from '@shared/observability-projection'
import type { ObservationStore } from './observation-store'

export class ObservabilityService {
  private readonly sessions = new Map<string, SessionSummary>()
  private readonly presence = new Map<string, SessionPresenceSnapshot>()
  private readonly projects = new Map<string, ProjectObservabilitySnapshot>()
  private app: AppObservabilitySnapshot
  private activeSessionId: string | null = null

  constructor(
    private readonly store: ObservationStore,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {
    this.app = buildAppObservabilitySnapshot([], [], this.nowIso())
  }

  async registerSession(session: SessionSummary, activeSessionId: string | null): Promise<void> {
    this.sessions.set(session.id, session)
    this.activeSessionId = activeSessionId
    this.rebuildSession(session.id, {})
  }

  async ingest(event: ObservationEvent): Promise<boolean> {
    const accepted = await this.store.append(event)
    if (!accepted || !event.sessionId) {
      return accepted
    }

    const session = this.sessions.get(event.sessionId)
    if (!session) {
      return accepted
    }

    const current = this.presence.get(event.sessionId)
    const nextStatus = statusFromEvent(event.type) ?? current?.canonicalStatus ?? session.status
    const updatedSession = { ...session, status: nextStatus, updatedAt: event.occurredAt }
    this.sessions.set(event.sessionId, updatedSession)

    this.rebuildSession(event.sessionId, {
      modelLabel: stringPayload(event, 'model'),
      lastAssistantSnippet: stringPayload(event, 'snippet') ?? current?.lastAssistantSnippet ?? null
    })

    return accepted
  }

  getSessionPresence(sessionId: string): SessionPresenceSnapshot | null {
    return this.presence.get(sessionId) ?? null
  }

  getProjectObservability(projectId: string): ProjectObservabilitySnapshot | null {
    return this.projects.get(projectId) ?? null
  }

  getAppObservability(): AppObservabilitySnapshot {
    return this.app
  }

  private rebuildSession(
    sessionId: string,
    evidence: { modelLabel?: string | null; lastAssistantSnippet?: string | null }
  ): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    const previous = this.presence.get(sessionId)
    const snapshot = buildSessionPresenceSnapshot(session, {
      activeSessionId: this.activeSessionId,
      nowIso: this.nowIso(),
      modelLabel: evidence.modelLabel ?? previous?.modelLabel ?? null,
      lastAssistantSnippet: evidence.lastAssistantSnippet ?? previous?.lastAssistantSnippet ?? null
    })

    this.presence.set(sessionId, snapshot)
    this.rebuildProject(session.projectId)
    this.rebuildApp()
  }

  private rebuildProject(projectId: string): void {
    const sessions = Array.from(this.presence.values()).filter(snapshot => snapshot.projectId === projectId)
    this.projects.set(projectId, buildProjectObservabilitySnapshot(projectId, sessions, this.nowIso()))
  }

  private rebuildApp(): void {
    this.app = buildAppObservabilitySnapshot(Array.from(this.projects.values()), Array.from(this.presence.values()), this.nowIso())
  }
}

function statusFromEvent(type: string): SessionStatus | null {
  switch (type) {
    case 'presence.running':
      return 'running'
    case 'presence.turn_complete':
      return 'turn_complete'
    case 'presence.awaiting_input':
      return 'awaiting_input'
    case 'presence.needs_confirmation':
      return 'needs_confirmation'
    case 'presence.degraded':
      return 'degraded'
    case 'presence.error':
      return 'error'
    case 'lifecycle.session_exited':
      return 'exited'
    default:
      return null
  }
}

function stringPayload(event: ObservationEvent, key: string): string | null {
  const value = event.payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}
```

- [ ] **Step 4: Run service tests**

Run: `npx vitest run src/core/observability-service.test.ts`

Expected: PASS.

## Task 5: IPC Contract and Preload API

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/main/index.ts`
- Test: `tests/e2e/ipc-bridge.test.ts`
- Test: `tests/e2e/main-config-guard.test.ts`

- [ ] **Step 1: Extend RendererApi types**

Modify `src/shared/project-session.ts` to import observability types and add methods:

```ts
import type {
  AppObservabilitySnapshot,
  ObservationCategory,
  ObservationEvent,
  ProjectObservabilitySnapshot,
  SessionPresenceSnapshot
} from './observability'
```

Add to `RendererApi`:

```ts
  getSessionPresence: (sessionId: string) => Promise<SessionPresenceSnapshot | null>
  getProjectObservability: (projectId: string) => Promise<ProjectObservabilitySnapshot | null>
  getAppObservability: () => Promise<AppObservabilitySnapshot>
  listSessionObservationEvents: (
    sessionId: string,
    options: { limit: number; cursor?: string; categories?: ObservationCategory[] }
  ) => Promise<{ events: ObservationEvent[]; nextCursor: string | null }>
  onSessionPresenceChanged: (callback: (snapshot: SessionPresenceSnapshot) => void) => () => void
  onProjectObservabilityChanged: (callback: (snapshot: ProjectObservabilitySnapshot) => void) => () => void
  onAppObservabilityChanged: (callback: (snapshot: AppObservabilitySnapshot) => void) => () => void
```

- [ ] **Step 2: Add IPC channel constants**

Modify `src/shared/ipc-channels.ts` to add constants using existing naming style:

```ts
  getSessionPresence: 'observability:get-session-presence',
  getProjectObservability: 'observability:get-project-observability',
  getAppObservability: 'observability:get-app-observability',
  listSessionObservationEvents: 'observability:list-session-events',
  sessionPresenceChanged: 'observability:session-presence-changed',
  projectObservabilityChanged: 'observability:project-observability-changed',
  appObservabilityChanged: 'observability:app-observability-changed',
```

- [ ] **Step 3: Expose preload methods**

Modify `src/main/preload.ts` to expose methods using `IPC_CHANNELS`, matching existing subscribe/unsubscribe patterns.

- [ ] **Step 4: Register main IPC handlers**

Modify `src/main/index.ts` to register handlers for:

```ts
ipcMain.handle(IPC_CHANNELS.getSessionPresence, (_event, sessionId: string) => observabilityService.getSessionPresence(sessionId))
ipcMain.handle(IPC_CHANNELS.getProjectObservability, (_event, projectId: string) => observabilityService.getProjectObservability(projectId))
ipcMain.handle(IPC_CHANNELS.getAppObservability, () => observabilityService.getAppObservability())
```

Use the actual service instance created in Task 6.

- [ ] **Step 5: Update IPC bridge tests**

Modify `tests/e2e/ipc-bridge.test.ts` to assert renderer -> preload -> main round-trip for the new query handlers.

- [ ] **Step 6: Update config guard tests**

Modify `tests/e2e/main-config-guard.test.ts` so preload API method coverage and channel registration include the new observability channels.

- [ ] **Step 7: Run IPC and guard tests**

Run: `npx vitest run tests/e2e/ipc-bridge.test.ts tests/e2e/main-config-guard.test.ts`

Expected: PASS.

## Task 6: Wire Session Events Into Observability

**Files:**
- Modify: `src/main/session-event-bridge.ts`
- Modify: `src/main/session-runtime-controller.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/session-event-bridge.test.ts`
- Modify: `src/main/session-runtime-controller.test.ts`

- [ ] **Step 1: Add failing bridge test**

Modify `src/main/session-event-bridge.test.ts` to assert that a canonical `turn_complete` event creates an observation event with:

```ts
expect(observabilityService.ingest).toHaveBeenCalledWith(expect.objectContaining({
  scope: 'session',
  category: 'presence',
  type: 'presence.turn_complete',
  retention: 'operational',
  sessionId: 'session_1'
}))
```

- [ ] **Step 2: Add event conversion helper**

Create a helper in `session-event-bridge.ts` or a small adjacent module if the file becomes crowded:

```ts
function observationFromCanonicalSessionEvent(event: CanonicalSessionEvent, ingestedAt: string): ObservationEvent {
  return {
    eventId: event.event_id,
    eventVersion: 1,
    occurredAt: event.timestamp,
    ingestedAt,
    scope: 'session',
    projectId: event.project_id,
    sessionId: event.session_id,
    providerId: null,
    category: categoryForStatus(event.payload.status),
    type: typeForStatus(event.payload.status, event.event_type),
    severity: severityForStatus(event.payload.status),
    retention: retentionForStatus(event.payload.status),
    source: event.source,
    correlationId: event.correlation_id ?? null,
    dedupeKey: null,
    payload: {
      summary: event.payload.summary ?? event.event_type,
      externalSessionId: event.payload.externalSessionId ?? null
    }
  }
}
```

- [ ] **Step 3: Inject observability service**

Modify `SessionEventBridge` construction so it receives an `ObservabilityService`. When canonical events pass validation and before/after controller application, call `observabilityService.ingest(...)`.

- [ ] **Step 4: Publish snapshot changes**

Modify `session-runtime-controller.ts` or the service integration point to send:

```ts
mainWindow.webContents.send(IPC_CHANNELS.sessionPresenceChanged, snapshot)
mainWindow.webContents.send(IPC_CHANNELS.projectObservabilityChanged, snapshot)
mainWindow.webContents.send(IPC_CHANNELS.appObservabilityChanged, snapshot)
```

Use the existing IPC push style from session status events.

- [ ] **Step 5: Run bridge/controller tests**

Run: `npx vitest run src/main/session-event-bridge.test.ts src/main/session-runtime-controller.test.ts`

Expected: PASS.

## Task 7: Renderer Store and View Models

**Files:**
- Modify: `src/renderer/stores/workspaces.ts`
- Create: `src/renderer/stores/observability-view-models.ts`
- Create: `src/renderer/stores/observability-view-models.test.ts`

- [ ] **Step 1: Write view-model tests**

Create `src/renderer/stores/observability-view-models.test.ts` to assert:

```ts
import { describe, expect, test } from 'vitest'
import type { SessionSummary } from '@shared/project-session'
import type { SessionPresenceSnapshot } from '@shared/observability'
import { toActiveSessionViewModel, toSessionRowViewModel } from './observability-view-models'

const session = {
  id: 'session_1',
  title: 'claude-main',
  type: 'claude-code',
  status: 'turn_complete'
} as SessionSummary

const presence = {
  sessionId: 'session_1',
  providerLabel: 'Claude',
  modelLabel: 'Sonnet',
  phase: 'ready',
  confidence: 'authoritative',
  lastAssistantSnippet: 'Done.',
  lastEventAt: '2026-04-24T00:00:00.000Z',
  hasUnreadTurn: true
} as SessionPresenceSnapshot

describe('observability view models', () => {
  test('builds state-first session row labels', () => {
    const row = toSessionRowViewModel(session, presence, '2026-04-24T00:00:10.000Z')
    expect(row.secondaryLabel).toBe('Ready · Claude · Sonnet')
    expect(row.needsAttention).toBe(true)
  })

  test('builds active session explanation', () => {
    const active = toActiveSessionViewModel(session, presence, '2026-04-24T00:00:10.000Z')
    expect(active.phaseLabel).toBe('Ready')
    expect(active.confidenceLabel).toBe('Live')
    expect(active.snippet).toBe('Done.')
  })
})
```

- [ ] **Step 2: Implement renderer view-model helpers**

Create `src/renderer/stores/observability-view-models.ts`:

```ts
import type { ActiveSessionViewModel, SessionPresenceSnapshot, SessionRowViewModel } from '@shared/observability'
import type { SessionSummary } from '@shared/project-session'
import { buildSessionRowViewModel, mapPhaseToTone, phaseLabel } from '@shared/observability-projection'

export function toSessionRowViewModel(
  session: SessionSummary,
  presence: SessionPresenceSnapshot,
  nowIso: string
): SessionRowViewModel {
  return buildSessionRowViewModel(session, presence, nowIso)
}

export function toActiveSessionViewModel(
  session: SessionSummary,
  presence: SessionPresenceSnapshot,
  nowIso: string
): ActiveSessionViewModel {
  return {
    sessionId: session.id,
    title: session.title,
    providerLabel: presence.providerLabel,
    modelLabel: presence.modelLabel,
    phaseLabel: phaseLabel(presence.phase),
    confidenceLabel: confidenceLabel(presence.confidence),
    tone: mapPhaseToTone(presence.phase),
    lastUpdatedLabel: relativeAge(presence.lastEventAt, nowIso),
    snippet: presence.lastAssistantSnippet,
    explanation: explanationForPresence(presence)
  }
}

function confidenceLabel(confidence: SessionPresenceSnapshot['confidence']): string {
  if (confidence === 'authoritative') {
    return 'Live'
  }
  if (confidence === 'provisional') {
    return 'Provisional'
  }
  return 'Stale'
}

function explanationForPresence(presence: SessionPresenceSnapshot): string | null {
  if (presence.blockingReason === 'permission') {
    return 'Provider is waiting for permission.'
  }
  if (presence.phase === 'degraded') {
    return 'Structured provider state is partially unavailable.'
  }
  if (presence.phase === 'failed') {
    return 'Provider reported an error.'
  }
  return null
}

function relativeAge(value: string | null, nowIso: string): string | null {
  if (!value) {
    return null
  }
  const seconds = Math.floor((new Date(nowIso).getTime() - new Date(value).getTime()) / 1000)
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null
  }
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`
}
```

- [ ] **Step 3: Extend workspaces store**

Modify `src/renderer/stores/workspaces.ts` to store:

```ts
const sessionPresenceById = ref<Record<string, SessionPresenceSnapshot>>({})
const projectObservabilityById = ref<Record<string, ProjectObservabilitySnapshot>>({})
const appObservability = ref<AppObservabilitySnapshot | null>(null)
```

During hydrate, call the new RendererApi query methods for existing sessions/projects. Subscribe to new push methods and update refs.

- [ ] **Step 4: Run store/view-model tests**

Run: `npx vitest run src/renderer/stores/observability-view-models.test.ts src/renderer/stores/workspaces.test.ts`

Expected: PASS.

## Task 8: Hierarchy Session Row UI

**Files:**
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

- [ ] **Step 1: Add component tests for labels and tones**

Modify `WorkspaceHierarchyPanel.test.ts` to assert:

```ts
expect(wrapper.text()).toContain('Ready · Claude')
expect(wrapper.find('[data-testid="session-status-dot"]').attributes('data-tone')).toBe('accent')
expect(wrapper.text()).not.toContain('claude-code')
```

Add separate cases for:

- `turn_complete` -> `Ready`
- `needs_confirmation` -> `Needs approval`
- `degraded` -> `Attention needed`
- `error` -> `Error`

- [ ] **Step 2: Update component props or internal mapping**

Pass `SessionRowViewModel` values into `WorkspaceHierarchyPanel.vue`, or derive them inside the component from store snapshots if that matches current component ownership.

The session row should render:

```vue
<div class="route-name">{{ row.title }}</div>
<div class="route-time">{{ row.secondaryLabel }}</div>
```

The dot should use tone:

```vue
<div
  class="route-dot"
  :class="`route-dot--${row.tone}`"
  data-testid="session-status-dot"
  :data-tone="row.tone"
/>
```

- [ ] **Step 3: Fix truncation for secondary text**

Ensure `.route-time` has:

```css
.route-time {
  overflow: hidden;
  color: var(--color-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
  font: var(--text-caption) var(--font-mono);
}
```

If project path still appears in the same layout, apply the same truncation to `.route-path`.

- [ ] **Step 4: Replace status color mapping**

Replace raw status grouping with tone classes:

```css
.route-dot--neutral { background: var(--color-subtle); }
.route-dot--success { background: var(--color-success); box-shadow: var(--shadow-success-ring); }
.route-dot--accent { background: var(--color-accent); }
.route-dot--warning { background: var(--color-warning); }
.route-dot--danger { background: var(--color-error); }
```

Use existing tokens only. If `--color-accent` is not available, use the established accent token in this repo.

- [ ] **Step 5: Run hierarchy tests**

Run: `npx vitest run src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

Expected: PASS.

## Task 9: Active Session Focus Surface

**Files:**
- Modify: `src/renderer/components/command/TerminalMetaBar.vue`
- Modify: `src/renderer/components/command/TerminalMetaBar.test.ts`

- [ ] **Step 1: Add tests for active session labels**

Modify `TerminalMetaBar.test.ts` to assert the component renders:

- session title
- provider/model label
- phase label
- confidence label
- snippet or explanation when present

- [ ] **Step 2: Update component props**

Change `TerminalMetaBar.vue` to receive an `ActiveSessionViewModel | null` prop instead of raw project/session if feasible. If parent ownership makes that too broad for this task, add an optional `activeViewModel` prop and prefer it when present.

- [ ] **Step 3: Render focus surface**

Render:

```vue
<div v-if="activeViewModel" class="terminal-meta">
  <div class="terminal-meta__group terminal-meta__group--primary">
    <span class="terminal-meta__title">{{ activeViewModel.title }}</span>
    <span>{{ activeViewModel.providerLabel }}</span>
    <span v-if="activeViewModel.modelLabel">{{ activeViewModel.modelLabel }}</span>
  </div>
  <div class="terminal-meta__group terminal-meta__group--secondary">
    <span class="terminal-meta__phase" :data-tone="activeViewModel.tone">{{ activeViewModel.phaseLabel }}</span>
    <span>{{ activeViewModel.confidenceLabel }}</span>
    <span v-if="activeViewModel.lastUpdatedLabel">{{ activeViewModel.lastUpdatedLabel }}</span>
  </div>
  <div v-if="activeViewModel.snippet || activeViewModel.explanation" class="terminal-meta__snippet">
    {{ activeViewModel.snippet ?? activeViewModel.explanation }}
  </div>
</div>
```

- [ ] **Step 4: Style with tokens**

Use `var(--color-surface-solid)`, `var(--color-line)`, `var(--radius-sm)`, text tokens, and existing typography tokens. Do not hardcode colors.

- [ ] **Step 5: Run meta bar tests**

Run: `npx vitest run src/renderer/components/command/TerminalMetaBar.test.ts`

Expected: PASS.

## Task 10: Session Detail Surface

**Files:**
- Create: `src/renderer/components/command/SessionDetailPopover.vue`
- Create: `src/renderer/components/command/SessionDetailPopover.test.ts`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`

- [ ] **Step 1: Write detail popover tests**

Create tests that assert:

- identity group shows provider/model/session id
- presence group shows phase/confidence/health
- timeline group shows bounded event summaries
- long IDs and paths use mono text

- [ ] **Step 2: Create component**

Create `SessionDetailPopover.vue` with props:

```ts
defineProps<{
  session: SessionSummary
  presence: SessionPresenceSnapshot | null
  events: ObservationEvent[]
}>()
```

Render three sections:

- Identity
- Current State
- Recent Observations

- [ ] **Step 3: Wire into hierarchy detail action**

Replace or wrap the existing detail popover content in `WorkspaceHierarchyPanel.vue` for session rows. Fetch bounded session events through the store/API when opening the detail.

- [ ] **Step 4: Run detail tests**

Run: `npx vitest run src/renderer/components/command/SessionDetailPopover.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

Expected: PASS.

## Task 11: Project and App Attention

**Files:**
- Modify: `src/renderer/stores/workspaces.ts`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

- [ ] **Step 1: Add project attention tests**

Add tests that a project with blocked/failed/unread sessions exposes a compact project-level marker without overflowing the row.

- [ ] **Step 2: Derive project attention model**

Use `ProjectObservabilitySnapshot` to render a small marker in project rows:

- failed
- blocked
- unread count
- degraded

- [ ] **Step 3: Keep visual density low**

Do not add third-line project metadata. Use compact marker plus detail popover.

- [ ] **Step 4: Run hierarchy tests**

Run: `npx vitest run src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

Expected: PASS.

## Task 12: Provider Evidence Enrichment

**Files:**
- Modify: `src/core/hook-event-adapter.ts`
- Modify: `src/extensions/providers/opencode-provider.ts`
- Modify: `src/extensions/providers/codex-provider.ts`
- Modify: relevant provider tests

- [ ] **Step 1: Claude evidence tests**

Add tests that raw Claude hooks produce observation events for:

- `SessionStart.model`
- `Stop.last_assistant_message`
- `StopFailure.error/error_details`
- `PermissionRequest`

- [ ] **Step 2: OpenCode evidence tests**

Add tests that OpenCode plugin events map:

- `session.idle` -> `presence.turn_complete`
- `permission.asked` -> `presence.needs_confirmation`
- `permission.replied` -> `presence.running`
- `session.error` -> `presence.error`
- `message.updated` -> `activity.message_updated`

- [ ] **Step 3: Codex evidence tests**

Add fixture tests for the currently supported notify payload shape:

- turn complete
- last assistant message
- thread identity when present

- [ ] **Step 4: Implement adapter mappings**

Add provider-specific mappings only in adapter/provider integration files. Do not put provider-specific conditionals in renderer code.

- [ ] **Step 5: Run provider tests**

Run: `npx vitest run src/core/hook-event-adapter.test.ts src/extensions/providers/opencode-provider.test.ts src/extensions/providers/codex-provider.test.ts`

Expected: PASS.

## Task 13: Behavior Assets and Generated Journeys

**Files:**
- Modify: `testing/behavior/`
- Modify: `testing/topology/`
- Modify: `testing/journeys/`
- Generated: `tests/generated/`

- [ ] **Step 1: Update topology contracts**

Update topology to assert stable test IDs for:

- session status dot tone
- session status label
- active session phase
- detail popover

- [ ] **Step 2: Update behavior assets**

Add or update behavior definitions for:

- ready session is not warning
- permission blocker needs attention
- unread turn appears on inactive session
- detail popover shows explanation

- [ ] **Step 3: Update journeys**

Add journey coverage for session presence scan and detail inspection.

- [ ] **Step 4: Regenerate generated tests**

Run: `npm run test:generate`

Expected: generated files update deterministically.

## Task 14: Full Verification

**Files:**
- No new files unless failures reveal required source fixes.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 2: Vitest suite**

Run: `npx vitest run`

Expected: PASS.

- [ ] **Step 3: Electron Playwright journeys**

Run: `npm run test:e2e`

Expected: PASS.

- [ ] **Step 4: Behavior coverage**

Run: `npm run test:behavior-coverage`

Expected: PASS.

- [ ] **Step 5: One-shot quality gate**

If the previous commands passed independently, optionally run:

Run: `npm run test:all`

Expected: PASS.

## Self-Review Checklist

- Spec coverage: Tasks cover shared types, event store, projections, IPC, renderer view models, hierarchy UI, focus UI, detail surface, project/app aggregation, provider evidence, behavior assets, and full verification.
- Placeholder scan: No task relies on vague “implement later” work; each implementation task names files, target behavior, and verification commands.
- Type consistency: Core names match the spec: `ObservationEvent`, `SessionPresenceSnapshot`, `ProjectObservabilitySnapshot`, `AppObservabilitySnapshot`, `SessionRowViewModel`, `ActiveSessionViewModel`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-24-session-observability-architecture.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
