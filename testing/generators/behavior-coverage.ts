import type {
  BehaviorSpec,
  CoverageMaturity,
  GeneratedTestMeta,
  JourneySpec
} from '../contracts/testing-contracts'

export interface BehaviorCoverageInput {
  behaviors: BehaviorSpec[]
  journeys: JourneySpec[]
  generatedTests: GeneratedTestMeta[]
}

export interface BehaviorCoverageEntry {
  behaviorId: string
  maturity: CoverageMaturity
  journeyIds: string[]
  generatedTestIds: string[]
  missingObservationLayers: string[]
  missingInterruptions: string[]
}

export interface BehaviorCoverageReport {
  behaviors: Record<string, BehaviorCoverageEntry>
  summary: Record<Lowercase<CoverageMaturity>, number>
}

export function classifyBehavior(
  behavior: BehaviorSpec,
  journeys: JourneySpec[],
  generatedTests: GeneratedTestMeta[]
): CoverageMaturity {
  if (journeys.length === 0) {
    return 'Declared'
  }

  if (generatedTests.length === 0) {
    return 'Reachable'
  }

  const coveredObservationLayers = new Set(generatedTests.flatMap((generatedTest) => generatedTest.observationLayers))
  const coveredInterruptions = new Set(generatedTests.flatMap((generatedTest) => generatedTest.interruptionsCovered))
  const hasAllObservationLayers = behavior.observationLayers.every((layer) => coveredObservationLayers.has(layer))
  const hasCoveredInterruption = behavior.interruptions.some((interruption) => coveredInterruptions.has(interruption))

  if (behavior.coverageBudget === 'critical' && hasAllObservationLayers && hasCoveredInterruption) {
    return 'Hardened'
  }

  return 'Verified'
}

export function buildBehaviorCoverageReport(input: BehaviorCoverageInput): BehaviorCoverageReport {
  const summary: Record<Lowercase<CoverageMaturity>, number> = {
    declared: 0,
    reachable: 0,
    verified: 0,
    hardened: 0
  }
  const behaviors: Record<string, BehaviorCoverageEntry> = {}

  for (const behavior of input.behaviors) {
    const matchingJourneys = input.journeys.filter((journey) => journey.behavior === behavior.id)
    const matchingGeneratedTests = input.generatedTests.filter((generatedTest) => generatedTest.behaviorIds.includes(behavior.id))
    const coveredObservationLayers = new Set(
      matchingGeneratedTests.flatMap((generatedTest) => generatedTest.observationLayers)
    )
    const coveredInterruptions = new Set(
      matchingGeneratedTests.flatMap((generatedTest) => generatedTest.interruptionsCovered)
    )
    const maturity = classifyBehavior(behavior, matchingJourneys, matchingGeneratedTests)

    summary[maturity.toLowerCase() as Lowercase<CoverageMaturity>] += 1
    behaviors[behavior.id] = {
      behaviorId: behavior.id,
      maturity,
      journeyIds: matchingJourneys.map((journey) => journey.id),
      generatedTestIds: matchingGeneratedTests.map((generatedTest) => generatedTest.id),
      missingObservationLayers: behavior.observationLayers.filter((layer) => !coveredObservationLayers.has(layer)),
      missingInterruptions: behavior.interruptions.filter((interruption) => !coveredInterruptions.has(interruption))
    }
  }

  return {
    behaviors,
    summary
  }
}
