import { defineJourney } from '../contracts/testing-contracts'

export const sessionTelemetryTurnCompleteJourney = defineJourney({
  id: 'journey.session.telemetry.turn-complete',
  behavior: 'session.telemetry.turn-complete',
  usageMode: 'active_workflow',
  setup: ['project.withProviderSession', 'session.selectedInCommandSurface'],
  act: ['post.session.turnComplete', 'post.claude.stopHook'],
  assert: ['command.sessionStatusVisible', 'terminal.liveSessionPreserved', 'persisted.sessionStatusUpdated'],
  variants: ['canonical', 'claude-hook']
})

export const sessionTelemetryNeedsConfirmationJourney = defineJourney({
  id: 'journey.session.telemetry.needs-confirmation',
  behavior: 'session.telemetry.needs-confirmation',
  usageMode: 'active_workflow',
  setup: ['project.withProviderSession', 'session.selectedInCommandSurface'],
  act: ['post.claude.permissionRequestHook'],
  assert: ['command.sessionStatusVisible', 'terminal.liveSessionPreserved', 'persisted.sessionStatusUpdated'],
  variants: ['claude-hook']
})
