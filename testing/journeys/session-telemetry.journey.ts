import { defineJourney } from '../contracts/testing-contracts'

export const sessionTelemetryCompleteJourney = defineJourney({
  id: 'journey.session.telemetry.complete',
  behavior: 'session.telemetry.complete',
  usageMode: 'active_workflow',
  setup: ['project.withProviderSession', 'session.selectedInCommandSurface'],
  act: ['post.session.complete', 'post.claude.userPromptSubmitHook', 'post.claude.stopHook'],
  assert: ['command.sessionStatusCompleteVisible', 'terminal.liveSessionPreserved', 'persisted.sessionPresenceUpdated'],
  variants: ['canonical', 'claude-hook']
})

export const sessionTelemetryBlockedJourney = defineJourney({
  id: 'journey.session.telemetry.blocked',
  behavior: 'session.telemetry.blocked',
  usageMode: 'active_workflow',
  setup: ['project.withProviderSession', 'session.selectedInCommandSurface'],
  act: ['post.claude.permissionRequestHook'],
  assert: ['command.sessionStatusBlockedVisible', 'terminal.liveSessionPreserved', 'persisted.sessionPresenceUpdated'],
  variants: ['claude-hook']
})

export const sessionPresenceReadyJourney = defineJourney({
  id: 'journey.session.presence.ready',
  behavior: 'session.presence.ready',
  usageMode: 'active_workflow',
  setup: ['project.withClaudeSession', 'session.runtimeAlive'],
  act: ['observe.presence.ready'],
  assert: ['command.sessionStatusReadyVisible', 'command.sessionStatusNonAccent'],
  variants: ['claude-runtime-alive']
})

export const sessionPresenceRunningJourney = defineJourney({
  id: 'journey.session.presence.running',
  behavior: 'session.presence.running',
  usageMode: 'active_workflow',
  setup: ['project.withClaudeSession', 'session.runtimeAlive'],
  act: ['post.claude.userPromptSubmitHook', 'observe.presence.running'],
  assert: ['command.sessionStatusRunningVisible', 'command.sessionStatusMediumPriority'],
  variants: ['claude-hook']
})

export const sessionPresenceReadyAfterInterruptJourney = defineJourney({
  id: 'journey.session.presence.ready-after-interrupt',
  behavior: 'session.presence.running',
  usageMode: 'active_workflow',
  setup: ['project.withCodexSession', 'session.runtimeAlive', 'post.codex.userPromptSubmitHook'],
  act: ['send.agentInterruptInput', 'observe.presence.ready'],
  assert: ['command.sessionStatusReadyVisible', 'session.hasUnseenCompletion=false'],
  variants: ['codex-input-interrupt']
})

export const sessionPresenceBlockedJourney = defineJourney({
  id: 'journey.session.presence.blocked',
  behavior: 'session.presence.blocked',
  usageMode: 'active_workflow',
  setup: ['project.withClaudeSession', 'session.runtimeAlive', 'post.claude.userPromptSubmitHook'],
  act: ['post.claude.permissionRequestHook', 'observe.presence.blocked'],
  assert: ['command.sessionStatusBlockedVisible', 'command.sessionRequiresUserIntervention'],
  variants: ['claude-hook']
})

export const sessionPresenceFailureJourney = defineJourney({
  id: 'journey.session.presence.failure',
  behavior: 'session.presence.failure',
  usageMode: 'active_workflow',
  setup: ['project.withClaudeSession', 'session.runtimeAlive', 'post.claude.userPromptSubmitHook', 'post.claude.stopHook'],
  act: ['runtime.exitedFailed', 'observe.presence.failure'],
  assert: ['command.sessionStatusFailureVisible', 'command.sessionStatusFailureOverridesComplete'],
  variants: ['runtime-failed-after-complete']
})

export const sessionTelemetryClaudeLifecycleJourney = defineJourney({
  id: 'journey.session.telemetry.claude-lifecycle',
  behavior: 'session.presence.complete',
  usageMode: 'active_workflow',
  setup: [
    'project.withClaudeSession',
    'session.runtimeAlive',
    'session.selectedInCommandSurface'
  ],
  act: [
    'assert.presence.ready',
    'post.claude.userPromptSubmitHook',
    'assert.presence.running',
    'post.claude.permissionRequestHook',
    'assert.presence.blocked',
    'post.claude.preToolUseHook',
    'assert.presence.running',
    'post.claude.stopHook',
    'assert.presence.complete',
    'select.completedSession'
  ],
  assert: [
    'command.sessionStatusReadyVisible',
    'command.sessionStatusRunningVisible',
    'command.sessionStatusBlockedVisible',
    'command.sessionStatusCompleteVisible',
    'command.sessionStatusReadyVisible.afterVisit',
    'terminal.liveSessionPreserved',
    'persisted.sessionPresenceUpdated'
  ],
  variants: ['claude-hook-lifecycle']
})
