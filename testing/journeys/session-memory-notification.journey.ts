import { defineJourney } from '../contracts/testing-contracts'

export const sessionMemoryNotificationJourney = defineJourney({
  id: 'journey.session.memory-notification',
  behavior: 'session.memory-notification',
  usageMode: 'active_workflow',
  setup: ['project.withClaudeSession', 'session.runtimeAlive', 'session.selectedInCommandSurface'],
  act: ['post.claude.userPromptSubmitHook', 'post.claude.stopHook', 'observe.memory.notification'],
  assert: ['memory.toast.recallVisible', 'memory.toast.solidifyVisible', 'memory.toast.distillVisible'],
  variants: ['claude-hook']
})
