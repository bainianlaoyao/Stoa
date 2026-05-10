import type { HermesSessionSummary } from '@shared/hermes'
import type { BlockingReason } from '@shared/observability'
import type { FailureReason, SessionStatePatchEvent } from '@shared/project-session'

type HermesSessionRuntimePatch = Partial<Pick<
  HermesSessionSummary,
  'status' | 'lastSummary' | 'lastRisk' | 'resumeSessionId'
>>

function formatBlockingReason(reason: BlockingReason | null | undefined): string {
  switch (reason) {
    case 'permission':
      return 'Provider requested approval.'
    case 'elicitation':
      return 'Provider is waiting for additional user input.'
    default:
      return 'Provider is blocked and needs attention.'
  }
}

function formatFailureReason(reason: FailureReason | null | undefined): string {
  switch (reason) {
    case 'failed_to_start':
      return 'Provider failed to start.'
    case 'permission_denied':
      return 'Provider was blocked by permissions.'
    case 'provider_error':
      return 'Provider reported an internal error.'
    case 'tool_error':
      return 'Provider failed while running a tool.'
    case 'runtime_crash':
      return 'Provider runtime crashed.'
    case 'unknown':
    case null:
    case undefined:
      return 'Provider failed.'
    default:
      return `Provider failed: ${reason.replace(/_/g, ' ')}.`
  }
}

export function deriveHermesProviderSessionPatch(
  session: HermesSessionSummary,
  patch: SessionStatePatchEvent
): HermesSessionRuntimePatch {
  const resumeSessionId = patch.externalSessionId ?? session.resumeSessionId

  switch (patch.intent) {
    case 'runtime.created':
      return {
        status: 'created',
        lastSummary: 'Hermes session created.',
        resumeSessionId
      }
    case 'runtime.starting':
      return {
        status: 'starting',
        lastSummary: 'Starting Hermes backend session.',
        lastRisk: null,
        resumeSessionId
      }
    case 'runtime.alive':
      return {
        status: 'running',
        lastSummary: 'Hermes is running.',
        lastRisk: null,
        resumeSessionId
      }
    case 'agent.turn_started':
    case 'agent.tool_started':
    case 'agent.tool_completed':
    case 'agent.permission_resolved':
      return {
        status: 'running',
        lastSummary: 'Hermes is working.',
        lastRisk: null,
        resumeSessionId
      }
    case 'agent.permission_requested':
      return {
        status: 'waiting_approval',
        lastSummary: 'Hermes is waiting for approval.',
        lastRisk: formatBlockingReason(patch.blockingReason),
        resumeSessionId
      }
    case 'agent.turn_completed':
      return {
        status: 'idle',
        lastSummary: 'Hermes turn complete.',
        lastRisk: null,
        resumeSessionId
      }
    case 'agent.turn_interrupted':
      return {
        status: 'idle',
        lastSummary: 'Hermes turn interrupted.',
        lastRisk: null,
        resumeSessionId
      }
    case 'agent.turn_cancelled':
      return {
        status: 'idle',
        lastSummary: 'Hermes turn cancelled.',
        lastRisk: null,
        resumeSessionId
      }
    case 'runtime.exited_clean':
      return {
        status: 'idle',
        lastSummary: 'Hermes backend session exited.',
        lastRisk: null,
        resumeSessionId
      }
    case 'agent.turn_failed':
    case 'runtime.exited_failed':
    case 'runtime.failed_to_start':
      return {
        status: 'failed',
        lastSummary: 'Hermes turn failed.',
        lastRisk: formatFailureReason(patch.failureReason),
        resumeSessionId
      }
    case 'agent.completion_seen':
    case 'agent.recovered':
      return {
        status: 'idle',
        lastSummary: 'Hermes is ready.',
        lastRisk: null,
        resumeSessionId
      }
    default:
      return {
        resumeSessionId
      }
  }
}
