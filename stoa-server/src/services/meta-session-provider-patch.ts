/**
 * MetaSessionProviderPatch — session state -> meta-session status mapping.
 *
 * Extracted from `src/core/meta-session-provider-patch.ts` to stoa-server.
 * This module is pure: it takes a MetaSessionSummary + SessionStatePatchEvent
 * and returns the patch to apply. No persistence side-effects.
 */
import type { MetaSessionSummary } from 'stoa-shared'
import type { BlockingReason } from 'stoa-shared'
import type { FailureReason, SessionStatePatchEvent } from 'stoa-shared'

export type MetaSessionRuntimePatch = Partial<Pick<
  MetaSessionSummary,
  'status' | 'lastSummary' | 'lastRisk' | 'backendSessionId'
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

export function deriveMetaSessionProviderSessionPatch(
  session: MetaSessionSummary,
  patch: SessionStatePatchEvent
): MetaSessionRuntimePatch {
  const backendSessionId = patch.externalSessionId ?? session.backendSessionId

  switch (patch.intent) {
    case 'runtime.created':
      return {
        status: 'created',
        lastSummary: 'Meta session created.',
        backendSessionId
      }
    case 'runtime.starting':
      return {
        status: 'starting',
        lastSummary: 'Starting meta session backend.',
        lastRisk: null,
        backendSessionId
      }
    case 'runtime.alive':
      return {
        status: 'running',
        lastSummary: 'Meta session is running.',
        lastRisk: null,
        backendSessionId
      }
    case 'agent.turn_started':
    case 'agent.tool_started':
    case 'agent.tool_completed':
    case 'agent.permission_resolved':
      return {
        status: 'running',
        lastSummary: 'Meta session is working.',
        lastRisk: null,
        backendSessionId
      }
    case 'agent.permission_requested':
      return {
        status: 'waiting_approval',
        lastSummary: 'Meta session is waiting for approval.',
        lastRisk: formatBlockingReason(patch.blockingReason),
        backendSessionId
      }
    case 'agent.turn_completed':
      return {
        status: 'idle',
        lastSummary: 'Meta session turn complete.',
        lastRisk: null,
        backendSessionId
      }
    case 'agent.turn_interrupted':
      return {
        status: 'idle',
        lastSummary: 'Meta session turn interrupted.',
        lastRisk: null,
        backendSessionId
      }
    case 'agent.turn_cancelled':
      return {
        status: 'idle',
        lastSummary: 'Meta session turn cancelled.',
        lastRisk: null,
        backendSessionId
      }
    case 'runtime.exited_clean':
      return {
        status: 'idle',
        lastSummary: 'Meta session backend exited.',
        lastRisk: null,
        backendSessionId
      }
    case 'agent.turn_failed':
    case 'runtime.exited_failed':
    case 'runtime.failed_to_start':
      return {
        status: 'failed',
        lastSummary: 'Meta session turn failed.',
        lastRisk: formatFailureReason(patch.failureReason),
        backendSessionId
      }
    case 'agent.completion_seen':
    case 'agent.recovered':
      return {
        status: 'idle',
        lastSummary: 'Meta session is ready.',
        lastRisk: null,
        backendSessionId
      }
    default:
      return {
        backendSessionId
      }
  }
}
