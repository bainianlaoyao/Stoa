import { defineJourney } from '../contracts/testing-contracts'

export const sessionRestoreJourney = defineJourney({
  id: 'journey.session.restore.base',
  behavior: 'session.restore',
  usageMode: 'recovery_workflow',
  setup: ['project.withArchivedSession'],
  act: ['click.activity.archive', 'find.archive.archived-session', 'click.archive.restore'],
  assert: ['archive.sessionRemoved', 'command.sessionVisible', 'persisted.sessionRestored'],
  variants: ['base']
})
