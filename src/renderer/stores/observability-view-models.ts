import {
  buildSessionRowViewModel,
  mapPhaseToTone,
  phaseLabel
} from '@shared/observability-projection'
import type {
  ActiveSessionViewModel,
  ObservabilityConfidence,
  SessionPresenceSnapshot,
  SessionRowViewModel
} from '@shared/observability'
import type { SessionSummary } from '@shared/project-session'

export function toSessionRowViewModel(
  session: SessionSummary,
  presence: SessionPresenceSnapshot,
  nowIso: string
): SessionRowViewModel {
  const baseViewModel = buildSessionRowViewModel(session, presence, nowIso)

  return {
    ...baseViewModel,
    updatedAgoLabel: formatRelativeAge(presence.updatedAt, nowIso)
  }
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
    lastUpdatedLabel: formatRelativeAge(presence.updatedAt, nowIso),
    snippet: presence.lastAssistantSnippet,
    explanation: explanationForPresence(presence)
  }
}

function confidenceLabel(confidence: ObservabilityConfidence): string {
  switch (confidence) {
    case 'authoritative':
      return 'Live'
    case 'provisional':
      return 'Provisional'
    case 'stale':
      return 'Stale'
  }
}

function explanationForPresence(presence: SessionPresenceSnapshot): string | null {
  if (presence.blockingReason === 'permission') {
    return 'Provider is waiting for permission.'
  }

  if (presence.blockingReason === 'resume-confirmation') {
    return 'Provider is waiting for confirmation.'
  }

  if (presence.phase === 'failed') {
    return 'Provider reported an error.'
  }

  return null
}

function formatRelativeAge(updatedAt: string, nowIso: string): string {
  const elapsedMs = Date.parse(nowIso) - Date.parse(updatedAt)

  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return '0s ago'
  }

  if (elapsedMs < 60_000) {
    return `${Math.floor(elapsedMs / 1_000)}s ago`
  }

  return `${Math.floor(elapsedMs / 60_000)}m ago`
}
