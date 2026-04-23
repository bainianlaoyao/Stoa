import { describe, expect, it } from 'vitest'
import {
  defineBehavior,
  defineGeneratedTestMeta,
  defineJourney,
  defineTopology
} from './testing-contracts'

describe('testing contracts', () => {
  it('preserves a valid behavior contract', () => {
    const behavior = defineBehavior({
      id: 'session.restore',
      actor: 'user',
      goal: 'restore an archived session',
      entities: ['project', 'session', 'archive'],
      usageModes: ['recovery_workflow'],
      preconditions: ['project.exists', 'session.archived'],
      action: 'archive.restoreSession',
      expects: ['archive.sessionRemoved', 'command.sessionVisible'],
      invalidPreconditions: ['session.notArchived'],
      interruptions: ['duplicateAction'],
      recovery: ['noDuplicateSession'],
      observationLayers: ['ui', 'main-debug-state'],
      risk: 'high',
      coverageBudget: 'critical'
    })

    expect(behavior.id).toBe('session.restore')
    expect(behavior.coverageBudget).toBe('critical')
  })

  it('rejects a behavior without observable effects', () => {
    expect(() =>
      defineBehavior({
        id: 'session.restore',
        actor: 'user',
        goal: 'restore an archived session',
        entities: ['session'],
        usageModes: ['recovery_workflow'],
        preconditions: ['session.archived'],
        action: 'archive.restoreSession',
        expects: [],
        invalidPreconditions: ['session.notArchived'],
        interruptions: ['duplicateAction'],
        recovery: ['noDuplicateSession'],
        observationLayers: ['ui'],
        risk: 'high',
        coverageBudget: 'critical'
      })
    ).toThrow('Behavior session.restore must declare at least one expected effect')
  })

  it('preserves topology test ids', () => {
    const topology = defineTopology({
      surface: 'archive',
      testIds: {
        root: 'surface.archive',
        restoreButton: 'archive.session.restore'
      }
    })

    expect(topology.testIds.restoreButton).toBe('archive.session.restore')
  })

  it('rejects duplicate topology test ids', () => {
    expect(() =>
      defineTopology({
        surface: 'archive',
        testIds: {
          root: 'surface.archive',
          duplicateRoot: 'surface.archive'
        }
      })
    ).toThrow('Topology archive has duplicate test id surface.archive')
  })

  it('preserves journey linkage and generated metadata', () => {
    const journey = defineJourney({
      id: 'journey.session.restore.base',
      behavior: 'session.restore',
      usageMode: 'recovery_workflow',
      setup: ['project.withArchivedSession'],
      act: ['open.archive.surface', 'click.archive.restore'],
      assert: ['archive.sessionRemoved', 'command.sessionVisible'],
      variants: ['base']
    })

    const meta = defineGeneratedTestMeta({
      id: 'journey.session.restore.base',
      behaviorIds: ['session.restore'],
      entities: ['session', 'archive'],
      statesCovered: ['session.archived', 'session.running'],
      interruptionsCovered: [],
      observationLayers: ['ui', 'main-debug-state'],
      riskBudget: 'critical',
      regressionSources: []
    })

    expect(journey.behavior).toBe('session.restore')
    expect(meta.behaviorIds).toEqual(['session.restore'])
  })
})
