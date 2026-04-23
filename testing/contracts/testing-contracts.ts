export type BehaviorRisk = 'low' | 'medium' | 'high'
export type CoverageBudget = 'minimal' | 'standard' | 'high' | 'critical'
export type CoverageMaturity = 'Declared' | 'Reachable' | 'Verified' | 'Hardened'
export type ObservationLayer = 'ui' | 'renderer-store' | 'main-debug-state' | 'persisted-state'

export interface BehaviorSpec {
  id: string
  actor: 'user' | 'system'
  goal: string
  entities: string[]
  usageModes: string[]
  preconditions: string[]
  action: string
  expects: string[]
  invalidPreconditions: string[]
  interruptions: string[]
  recovery: string[]
  observationLayers: ObservationLayer[]
  risk: BehaviorRisk
  coverageBudget: CoverageBudget
}

export interface TopologySpec {
  surface: string
  testIds: Record<string, string>
}

export interface JourneySpec {
  id: string
  behavior: string
  usageMode: string
  setup: string[]
  act: string[]
  assert: string[]
  variants: string[]
}

export interface GeneratedTestMeta {
  id: string
  behaviorIds: string[]
  entities: string[]
  statesCovered: string[]
  interruptionsCovered: string[]
  observationLayers: ObservationLayer[]
  riskBudget: CoverageBudget
  regressionSources: string[]
}

export function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`)
  }
}

export function assertNonEmptyList(value: string[], label: string, emptyMessage?: string): void {
  if (value.length === 0) {
    throw new Error(emptyMessage ?? `${label} must not be empty`)
  }

  if (value.some((item) => item.trim().length === 0)) {
    throw new Error(`${label} must not contain empty values`)
  }
}

export function defineBehavior<T extends BehaviorSpec>(spec: T): T {
  assertNonEmpty(spec.id, 'Behavior id')
  assertNonEmpty(spec.goal, `Behavior ${spec.id} goal`)
  assertNonEmpty(spec.action, `Behavior ${spec.id} action`)
  assertNonEmptyList(spec.entities, `Behavior ${spec.id} entities`, `Behavior ${spec.id} must declare at least one entity`)
  assertNonEmptyList(
    spec.usageModes,
    `Behavior ${spec.id} usage modes`,
    `Behavior ${spec.id} must declare at least one usage mode`
  )
  assertNonEmptyList(
    spec.preconditions,
    `Behavior ${spec.id} preconditions`,
    `Behavior ${spec.id} must declare at least one precondition`
  )
  assertNonEmptyList(
    spec.expects,
    `Behavior ${spec.id} expected effects`,
    `Behavior ${spec.id} must declare at least one expected effect`
  )
  assertNonEmptyList(
    spec.observationLayers,
    `Behavior ${spec.id} observation layers`,
    `Behavior ${spec.id} must declare at least one observation layer`
  )

  if (spec.invalidPreconditions.length > 0) {
    assertNonEmptyList(spec.invalidPreconditions, `Behavior ${spec.id} invalid preconditions`)
  }

  if (spec.interruptions.length > 0) {
    assertNonEmptyList(spec.interruptions, `Behavior ${spec.id} interruptions`)
  }

  if (spec.recovery.length > 0) {
    assertNonEmptyList(spec.recovery, `Behavior ${spec.id} recovery`)
  }

  return spec
}

export function defineTopology<T extends TopologySpec>(spec: T): T {
  assertNonEmpty(spec.surface, 'Topology surface')
  const testIds = Object.values(spec.testIds)
  assertNonEmptyList(testIds, `Topology ${spec.surface} test ids`, `Topology ${spec.surface} must declare at least one test id`)
  const seen = new Set<string>()

  for (const testId of testIds) {
    if (seen.has(testId)) {
      throw new Error(`Topology ${spec.surface} has duplicate test id ${testId}`)
    }
    seen.add(testId)
  }

  return spec
}

export function defineJourney<T extends JourneySpec>(spec: T): T {
  assertNonEmpty(spec.id, 'Journey id')
  assertNonEmpty(spec.behavior, `Journey ${spec.id} behavior`)
  assertNonEmpty(spec.usageMode, `Journey ${spec.id} usage mode`)
  assertNonEmptyList(spec.setup, `Journey ${spec.id} setup steps`, `Journey ${spec.id} must declare setup steps`)
  assertNonEmptyList(spec.act, `Journey ${spec.id} action steps`, `Journey ${spec.id} must declare action steps`)
  assertNonEmptyList(spec.assert, `Journey ${spec.id} assertions`, `Journey ${spec.id} must declare assertions`)
  assertNonEmptyList(spec.variants, `Journey ${spec.id} variants`, `Journey ${spec.id} must declare variants`)
  return spec
}

export function defineGeneratedTestMeta<T extends GeneratedTestMeta>(meta: T): T {
  assertNonEmpty(meta.id, 'Generated test id')
  assertNonEmptyList(
    meta.behaviorIds,
    `Generated test ${meta.id} behavior ids`,
    `Generated test ${meta.id} must cover at least one behavior`
  )
  assertNonEmptyList(
    meta.entities,
    `Generated test ${meta.id} entities`,
    `Generated test ${meta.id} must cover at least one entity`
  )
  assertNonEmptyList(
    meta.observationLayers,
    `Generated test ${meta.id} observation layers`,
    `Generated test ${meta.id} must declare observation layers`
  )

  if (meta.statesCovered.length > 0) {
    assertNonEmptyList(meta.statesCovered, `Generated test ${meta.id} states covered`)
  }

  if (meta.interruptionsCovered.length > 0) {
    assertNonEmptyList(meta.interruptionsCovered, `Generated test ${meta.id} interruptions covered`)
  }

  if (meta.regressionSources.length > 0) {
    assertNonEmptyList(meta.regressionSources, `Generated test ${meta.id} regression sources`)
  }

  return meta
}
