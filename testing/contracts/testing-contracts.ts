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

export function assertNonEmptyList(value: string[], message: string, itemLabel?: string): void {
  if (value.length === 0) {
    throw new Error(message)
  }

  if (itemLabel && value.some((item) => item.trim().length === 0)) {
    throw new Error(`${itemLabel} must not contain empty values`)
  }
}

export function defineBehavior<T extends BehaviorSpec>(spec: T): T {
  assertNonEmpty(spec.id, 'Behavior id')
  assertNonEmpty(spec.goal, `Behavior ${spec.id} goal`)
  assertNonEmpty(spec.action, `Behavior ${spec.id} action`)
  assertNonEmptyList(spec.entities, `Behavior ${spec.id} must declare at least one entity`, `Behavior ${spec.id} entities`)
  assertNonEmptyList(
    spec.usageModes,
    `Behavior ${spec.id} must declare at least one usage mode`,
    `Behavior ${spec.id} usage modes`
  )
  assertNonEmptyList(
    spec.preconditions,
    `Behavior ${spec.id} must declare at least one precondition`,
    `Behavior ${spec.id} preconditions`
  )
  assertNonEmptyList(
    spec.expects,
    `Behavior ${spec.id} must declare at least one expected effect`,
    `Behavior ${spec.id} expected effects`
  )
  assertNonEmptyList(
    spec.observationLayers,
    `Behavior ${spec.id} must declare at least one observation layer`,
    `Behavior ${spec.id} observation layers`
  )
  return spec
}

export function defineTopology<T extends TopologySpec>(spec: T): T {
  assertNonEmpty(spec.surface, 'Topology surface')
  const testIds = Object.values(spec.testIds)
  assertNonEmptyList(testIds, `Topology ${spec.surface} must declare at least one test id`)
  const seen = new Set<string>()

  for (const testId of testIds) {
    assertNonEmpty(testId, `Topology ${spec.surface} test id`)
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
  assertNonEmptyList(spec.setup, `Journey ${spec.id} must declare setup steps`, `Journey ${spec.id} setup steps`)
  assertNonEmptyList(spec.act, `Journey ${spec.id} must declare action steps`, `Journey ${spec.id} action steps`)
  assertNonEmptyList(spec.assert, `Journey ${spec.id} must declare assertions`, `Journey ${spec.id} assertions`)
  assertNonEmptyList(spec.variants, `Journey ${spec.id} must declare variants`, `Journey ${spec.id} variants`)
  return spec
}

export function defineGeneratedTestMeta<T extends GeneratedTestMeta>(meta: T): T {
  assertNonEmpty(meta.id, 'Generated test id')
  assertNonEmptyList(
    meta.behaviorIds,
    `Generated test ${meta.id} must cover at least one behavior`,
    `Generated test ${meta.id} behavior ids`
  )
  assertNonEmptyList(
    meta.entities,
    `Generated test ${meta.id} must cover at least one entity`,
    `Generated test ${meta.id} entities`
  )
  assertNonEmptyList(
    meta.observationLayers,
    `Generated test ${meta.id} must declare observation layers`,
    `Generated test ${meta.id} observation layers`
  )
  return meta
}
