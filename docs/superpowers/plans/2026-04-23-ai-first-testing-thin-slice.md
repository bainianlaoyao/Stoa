# AI-First Testing Thin Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first closed loop of the AI-first testing architecture: behavior/topology/journey contracts, one `session.restore` behavior asset, one generated Playwright skeleton, and one behavior coverage report.

**Architecture:** Add a small `testing/**` contract layer with runtime validation and plain TypeScript objects. Keep generated Playwright output deterministic and excluded from Vitest. Use Vitest for all contract/generator checks before any Playwright execution is introduced.

**Tech Stack:** TypeScript, Vitest, Playwright, Node `fs/promises`, existing Electron/Vue test stack.

---

## Baseline

Worktree: `D:\Data\DEV\ultra_simple_panel\.worktrees\ai-first-testing`

Baseline command already run:

```bash
npx vitest run
```

Baseline result:

```text
Test Files 54 passed (54)
Tests 588 passed (588)
Exit code 0
```

Environment observation: output ends with a `node-pty` child-process `AttachConsole failed` stack trace after Vitest has already reported success. Treat this as baseline noise unless it starts changing exit code or test results.

## File Map

- Create: `testing/contracts/testing-contracts.ts`
  Defines `defineBehavior`, `defineTopology`, `defineJourney`, `defineGeneratedTestMeta`, supporting types, and runtime validation.

- Create: `testing/contracts/testing-contracts.test.ts`
  Verifies contract helpers preserve valid specs and reject invalid specs.

- Modify: `tsconfig.vitest.json`
  Includes `testing/**/*.ts` so contract tests are typechecked.

- Modify: `vitest.config.ts`
  Excludes generated Playwright specs from Vitest.

- Create: `testing/behavior/session.behavior.ts`
  Defines first behavior asset: `session.restore`.

- Create: `testing/behavior/session.behavior.test.ts`
  Verifies the behavior carries critical coverage requirements.

- Create: `testing/topology/archive.topology.ts`
  Defines stable test ids for archive restore topology.

- Create: `testing/topology/archive.topology.test.ts`
  Verifies topology ids are stable and unique.

- Create: `testing/journeys/session-restore.journey.ts`
  Defines first journey asset for `session.restore`.

- Create: `testing/journeys/session-restore.journey.test.ts`
  Verifies journey links to behavior and topology-level action ids.

- Create: `testing/generators/behavior-coverage.ts`
  Computes behavior coverage maturity from behaviors, journeys, and generated test metadata.

- Create: `testing/generators/behavior-coverage.test.ts`
  Verifies `Declared`, `Reachable`, `Verified`, and `Hardened` classifications.

- Create: `testing/generators/generate-playwright.ts`
  Generates deterministic Playwright skeleton text for the first journey.

- Create: `testing/generators/generate-playwright.test.ts`
  Verifies generated skeleton contains behavior metadata and topology locators.

- Create: `testing/generators/write-generated-playwright.mjs`
  Node script used by `npm run test:generate` to write generated Playwright files.

- Create: `tests/generated/playwright/session-restore.generated.spec.ts`
  Generated output from the script. Do not hand-edit after generator exists.

- Modify: `playwright.config.ts`
  Allows Playwright to discover both existing `tests/e2e-playwright/**/*.test.ts` and generated `tests/generated/playwright/**/*.spec.ts`.

- Modify: `package.json`
  Adds `test:generate`, `test:e2e`, `test:behavior-coverage`, and `test:all`.

---

### Task 1: Contract DSL

**Files:**
- Create: `testing/contracts/testing-contracts.test.ts`
- Create: `testing/contracts/testing-contracts.ts`
- Modify: `tsconfig.vitest.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write the failing contract tests**

Create `testing/contracts/testing-contracts.test.ts`:

```ts
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
    expect(() => defineBehavior({
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
    })).toThrow('Behavior session.restore must declare at least one expected effect')
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
    expect(() => defineTopology({
      surface: 'archive',
      testIds: {
        root: 'surface.archive',
        duplicateRoot: 'surface.archive'
      }
    })).toThrow('Topology archive has duplicate test id surface.archive')
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run testing/contracts/testing-contracts.test.ts
```

Expected: FAIL because `./testing-contracts` does not exist.

- [ ] **Step 3: Implement the contract helpers**

Create `testing/contracts/testing-contracts.ts`:

```ts
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

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`)
  }
}

function assertNonEmptyList(value: string[], message: string): void {
  if (value.length === 0) {
    throw new Error(message)
  }
}

export function defineBehavior<T extends BehaviorSpec>(spec: T): T {
  assertNonEmpty(spec.id, 'Behavior id')
  assertNonEmpty(spec.goal, `Behavior ${spec.id} goal`)
  assertNonEmpty(spec.action, `Behavior ${spec.id} action`)
  assertNonEmptyList(spec.entities, `Behavior ${spec.id} must declare at least one entity`)
  assertNonEmptyList(spec.usageModes, `Behavior ${spec.id} must declare at least one usage mode`)
  assertNonEmptyList(spec.preconditions, `Behavior ${spec.id} must declare at least one precondition`)
  assertNonEmptyList(spec.expects, `Behavior ${spec.id} must declare at least one expected effect`)
  assertNonEmptyList(spec.observationLayers, `Behavior ${spec.id} must declare at least one observation layer`)
  return spec
}

export function defineTopology<T extends TopologySpec>(spec: T): T {
  assertNonEmpty(spec.surface, 'Topology surface')
  const seen = new Set<string>()

  for (const testId of Object.values(spec.testIds)) {
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
  assertNonEmptyList(spec.setup, `Journey ${spec.id} must declare setup steps`)
  assertNonEmptyList(spec.act, `Journey ${spec.id} must declare action steps`)
  assertNonEmptyList(spec.assert, `Journey ${spec.id} must declare assertions`)
  assertNonEmptyList(spec.variants, `Journey ${spec.id} must declare variants`)
  return spec
}

export function defineGeneratedTestMeta<T extends GeneratedTestMeta>(meta: T): T {
  assertNonEmpty(meta.id, 'Generated test id')
  assertNonEmptyList(meta.behaviorIds, `Generated test ${meta.id} must cover at least one behavior`)
  assertNonEmptyList(meta.entities, `Generated test ${meta.id} must cover at least one entity`)
  assertNonEmptyList(meta.observationLayers, `Generated test ${meta.id} must declare observation layers`)
  return meta
}
```

Modify `tsconfig.vitest.json` include array:

```json
  "include": [
    "src/**/*.test.ts",
    "src/**/*.spec.ts",
    "src/**/*.d.ts",
    "src/shared/**/*.ts",
    "src/renderer/**/*.ts",
    "src/renderer/**/*.vue",
    "testing/**/*.ts"
  ]
```

Modify `vitest.config.ts` test exclude array:

```ts
exclude: [
  '**/node_modules/**',
  '**/.git/**',
  '**/.worktrees/**',
  '**/dist/**',
  '**/e2e-playwright/**',
  '**/tests/generated/playwright/**'
]
```

- [ ] **Step 4: Run focused test and verify GREEN**

Run:

```bash
npx vitest run testing/contracts/testing-contracts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add testing/contracts/testing-contracts.ts testing/contracts/testing-contracts.test.ts tsconfig.vitest.json vitest.config.ts
git commit -m "test: add ai testing contract dsl"
```

---

### Task 2: First Behavior, Topology, and Journey Assets

**Files:**
- Create: `testing/behavior/session.behavior.test.ts`
- Create: `testing/behavior/session.behavior.ts`
- Create: `testing/topology/archive.topology.test.ts`
- Create: `testing/topology/archive.topology.ts`
- Create: `testing/journeys/session-restore.journey.test.ts`
- Create: `testing/journeys/session-restore.journey.ts`

- [ ] **Step 1: Write failing behavior asset test**

Create `testing/behavior/session.behavior.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sessionRestoreBehavior } from './session.behavior'

describe('session behavior assets', () => {
  it('marks session.restore as critical and recovery-oriented', () => {
    expect(sessionRestoreBehavior.id).toBe('session.restore')
    expect(sessionRestoreBehavior.coverageBudget).toBe('critical')
    expect(sessionRestoreBehavior.entities).toEqual(['project', 'session', 'archive', 'recovery'])
    expect(sessionRestoreBehavior.interruptions).toContain('app.relaunch.duringAction')
    expect(sessionRestoreBehavior.invalidPreconditions).toContain('session.notArchived')
    expect(sessionRestoreBehavior.observationLayers).toEqual(['ui', 'main-debug-state', 'persisted-state'])
  })
})
```

- [ ] **Step 2: Run behavior test and verify RED**

Run:

```bash
npx vitest run testing/behavior/session.behavior.test.ts
```

Expected: FAIL because `./session.behavior` does not exist.

- [ ] **Step 3: Implement `session.restore` behavior**

Create `testing/behavior/session.behavior.ts`:

```ts
import { defineBehavior } from '../contracts/testing-contracts'

export const sessionRestoreBehavior = defineBehavior({
  id: 'session.restore',
  actor: 'user',
  goal: 'restore an archived session so it can be used again from the command surface',
  entities: ['project', 'session', 'archive', 'recovery'],
  usageModes: ['active_workflow', 'recovery_workflow'],
  preconditions: ['project.exists', 'session.archived'],
  action: 'archive.restoreSession',
  expects: [
    'archive.sessionRemoved',
    'command.sessionVisible',
    'session.archived=false',
    'session.status in [starting, running]'
  ],
  invalidPreconditions: ['session.notArchived', 'session.missing', 'project.missing'],
  interruptions: ['duplicateAction', 'app.relaunch.duringAction', 'webhook.lateStatusEvent'],
  recovery: ['noDuplicateSession', 'activeSessionRemainsValid', 'persistedStateRemainsConsistent'],
  observationLayers: ['ui', 'main-debug-state', 'persisted-state'],
  risk: 'high',
  coverageBudget: 'critical'
})
```

- [ ] **Step 4: Write failing topology test**

Create `testing/topology/archive.topology.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { archiveTopology } from './archive.topology'

describe('archive topology', () => {
  it('declares stable archive restore test ids', () => {
    expect(archiveTopology.surface).toBe('archive')
    expect(archiveTopology.testIds.root).toBe('surface.archive')
    expect(archiveTopology.testIds.sessionRow).toBe('archive.session.row')
    expect(archiveTopology.testIds.restoreButton).toBe('archive.session.restore')
  })
})
```

- [ ] **Step 5: Run topology test and verify RED**

Run:

```bash
npx vitest run testing/topology/archive.topology.test.ts
```

Expected: FAIL because `./archive.topology` does not exist.

- [ ] **Step 6: Implement archive topology**

Create `testing/topology/archive.topology.ts`:

```ts
import { defineTopology } from '../contracts/testing-contracts'

export const archiveTopology = defineTopology({
  surface: 'archive',
  testIds: {
    root: 'surface.archive',
    sessionRow: 'archive.session.row',
    restoreButton: 'archive.session.restore'
  }
})
```

- [ ] **Step 7: Write failing journey test**

Create `testing/journeys/session-restore.journey.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sessionRestoreJourney } from './session-restore.journey'

describe('session restore journey', () => {
  it('links the restore journey to session.restore behavior', () => {
    expect(sessionRestoreJourney.id).toBe('journey.session.restore.base')
    expect(sessionRestoreJourney.behavior).toBe('session.restore')
    expect(sessionRestoreJourney.usageMode).toBe('recovery_workflow')
    expect(sessionRestoreJourney.act).toEqual(['open.archive.surface', 'click.archive.restore'])
    expect(sessionRestoreJourney.variants).toContain('base')
  })
})
```

- [ ] **Step 8: Run journey test and verify RED**

Run:

```bash
npx vitest run testing/journeys/session-restore.journey.test.ts
```

Expected: FAIL because `./session-restore.journey` does not exist.

- [ ] **Step 9: Implement restore journey**

Create `testing/journeys/session-restore.journey.ts`:

```ts
import { defineJourney } from '../contracts/testing-contracts'

export const sessionRestoreJourney = defineJourney({
  id: 'journey.session.restore.base',
  behavior: 'session.restore',
  usageMode: 'recovery_workflow',
  setup: ['project.withArchivedSession'],
  act: ['open.archive.surface', 'click.archive.restore'],
  assert: ['archive.sessionRemoved', 'command.sessionVisible', 'persisted.sessionRestored'],
  variants: ['base']
})
```

- [ ] **Step 10: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run testing/behavior/session.behavior.test.ts testing/topology/archive.topology.test.ts testing/journeys/session-restore.journey.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

Run:

```bash
git add testing/behavior testing/topology testing/journeys
git commit -m "test: model session restore behavior assets"
```

---

### Task 3: Behavior Coverage Intelligence

**Files:**
- Create: `testing/generators/behavior-coverage.test.ts`
- Create: `testing/generators/behavior-coverage.ts`

- [ ] **Step 1: Write failing behavior coverage tests**

Create `testing/generators/behavior-coverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sessionRestoreBehavior } from '../behavior/session.behavior'
import { defineGeneratedTestMeta } from '../contracts/testing-contracts'
import { sessionRestoreJourney } from '../journeys/session-restore.journey'
import { buildBehaviorCoverageReport } from './behavior-coverage'

describe('behavior coverage report', () => {
  it('marks behavior as Declared when no journey exists', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionRestoreBehavior],
      journeys: [],
      generatedTests: []
    })

    expect(report.behaviors['session.restore']?.maturity).toBe('Declared')
  })

  it('marks behavior as Reachable when a journey exists without generated test metadata', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionRestoreBehavior],
      journeys: [sessionRestoreJourney],
      generatedTests: []
    })

    expect(report.behaviors['session.restore']?.maturity).toBe('Reachable')
  })

  it('marks critical behavior as Verified with generated metadata but no interruption coverage', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionRestoreBehavior],
      journeys: [sessionRestoreJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.session.restore.base',
          behaviorIds: ['session.restore'],
          entities: ['session', 'archive'],
          statesCovered: ['session.archived', 'session.running'],
          interruptionsCovered: [],
          observationLayers: ['ui', 'main-debug-state'],
          riskBudget: 'critical',
          regressionSources: []
        })
      ]
    })

    expect(report.behaviors['session.restore']?.maturity).toBe('Verified')
  })

  it('marks critical behavior as Hardened when interruptions and persistence are covered', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionRestoreBehavior],
      journeys: [sessionRestoreJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.session.restore.relaunch',
          behaviorIds: ['session.restore'],
          entities: ['session', 'archive', 'recovery'],
          statesCovered: ['session.archived', 'session.running'],
          interruptionsCovered: ['app.relaunch.duringAction'],
          observationLayers: ['ui', 'main-debug-state', 'persisted-state'],
          riskBudget: 'critical',
          regressionSources: []
        })
      ]
    })

    expect(report.behaviors['session.restore']?.maturity).toBe('Hardened')
    expect(report.summary.hardened).toBe(1)
  })
})
```

- [ ] **Step 2: Run coverage tests and verify RED**

Run:

```bash
npx vitest run testing/generators/behavior-coverage.test.ts
```

Expected: FAIL because `./behavior-coverage` does not exist.

- [ ] **Step 3: Implement behavior coverage report**

Create `testing/generators/behavior-coverage.ts`:

```ts
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

function classifyBehavior(
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

  const observedLayers = new Set(generatedTests.flatMap((test) => test.observationLayers))
  const coveredInterruptions = new Set(generatedTests.flatMap((test) => test.interruptionsCovered))
  const hasAllObservationLayers = behavior.observationLayers.every((layer) => observedLayers.has(layer))
  const hasInterruptionCoverage = behavior.interruptions.some((interruption) => coveredInterruptions.has(interruption))

  if (behavior.coverageBudget === 'critical' && hasAllObservationLayers && hasInterruptionCoverage) {
    return 'Hardened'
  }

  return 'Verified'
}

export function buildBehaviorCoverageReport(input: BehaviorCoverageInput): BehaviorCoverageReport {
  const behaviors: Record<string, BehaviorCoverageEntry> = {}
  const summary: Record<Lowercase<CoverageMaturity>, number> = {
    declared: 0,
    reachable: 0,
    verified: 0,
    hardened: 0
  }

  for (const behavior of input.behaviors) {
    const matchingJourneys = input.journeys.filter((journey) => journey.behavior === behavior.id)
    const matchingTests = input.generatedTests.filter((test) => test.behaviorIds.includes(behavior.id))
    const observedLayers = new Set(matchingTests.flatMap((test) => test.observationLayers))
    const coveredInterruptions = new Set(matchingTests.flatMap((test) => test.interruptionsCovered))
    const maturity = classifyBehavior(behavior, matchingJourneys, matchingTests)

    summary[maturity.toLowerCase() as Lowercase<CoverageMaturity>] += 1
    behaviors[behavior.id] = {
      behaviorId: behavior.id,
      maturity,
      journeyIds: matchingJourneys.map((journey) => journey.id),
      generatedTestIds: matchingTests.map((test) => test.id),
      missingObservationLayers: behavior.observationLayers.filter((layer) => !observedLayers.has(layer)),
      missingInterruptions: behavior.interruptions.filter((interruption) => !coveredInterruptions.has(interruption))
    }
  }

  return {
    behaviors,
    summary
  }
}
```

- [ ] **Step 4: Run coverage tests and verify GREEN**

Run:

```bash
npx vitest run testing/generators/behavior-coverage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add testing/generators/behavior-coverage.ts testing/generators/behavior-coverage.test.ts
git commit -m "test: add behavior coverage report"
```

---

### Task 4: Deterministic Playwright Skeleton Generation

**Files:**
- Create: `testing/generators/generate-playwright.test.ts`
- Create: `testing/generators/generate-playwright.ts`
- Create: `testing/generators/write-generated-playwright.mjs`
- Create: `tests/generated/playwright/session-restore.generated.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing generator test**

Create `testing/generators/generate-playwright.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sessionRestoreBehavior } from '../behavior/session.behavior'
import { archiveTopology } from '../topology/archive.topology'
import { sessionRestoreJourney } from '../journeys/session-restore.journey'
import { generatePlaywrightSkeleton } from './generate-playwright'

describe('Playwright skeleton generator', () => {
  it('generates deterministic skeleton with behavior metadata and topology locators', () => {
    const skeleton = generatePlaywrightSkeleton({
      behavior: sessionRestoreBehavior,
      topology: archiveTopology,
      journey: sessionRestoreJourney
    })

    expect(skeleton).toContain("behaviorIds: ['session.restore']")
    expect(skeleton).toContain("test('journey.session.restore.base'")
    expect(skeleton).toContain("page.getByTestId('surface.archive')")
    expect(skeleton).toContain("page.getByTestId('archive.session.restore')")
    expect(skeleton).toContain('AUTO-GENERATED FILE. DO NOT EDIT.')
  })
})
```

- [ ] **Step 2: Run generator test and verify RED**

Run:

```bash
npx vitest run testing/generators/generate-playwright.test.ts
```

Expected: FAIL because `./generate-playwright` does not exist.

- [ ] **Step 3: Implement deterministic skeleton generator**

Create `testing/generators/generate-playwright.ts`:

```ts
import type { BehaviorSpec, JourneySpec, TopologySpec } from '../contracts/testing-contracts'

export interface PlaywrightSkeletonInput {
  behavior: BehaviorSpec
  topology: TopologySpec
  journey: JourneySpec
}

export function generatePlaywrightSkeleton(input: PlaywrightSkeletonInput): string {
  const { behavior, topology, journey } = input

  return `// AUTO-GENERATED FILE. DO NOT EDIT.
import { test, expect } from '@playwright/test'
import { defineGeneratedTestMeta } from '../../../testing/contracts/testing-contracts'

export const meta = defineGeneratedTestMeta({
  id: '${journey.id}',
  behaviorIds: ['${behavior.id}'],
  entities: ${JSON.stringify(behavior.entities)},
  statesCovered: ['session.archived', 'session.running'],
  interruptionsCovered: [],
  observationLayers: ${JSON.stringify(behavior.observationLayers)},
  riskBudget: '${behavior.coverageBudget}',
  regressionSources: []
})

test('${journey.id}', async ({ page }) => {
  await test.step('open archive surface', async () => {
    await expect(page.getByTestId('${topology.testIds.root}')).toBeVisible()
  })

  await test.step('restore archived session', async () => {
    await page.getByTestId('${topology.testIds.restoreButton}').click()
  })

  await test.step('archive projection updates', async () => {
    await expect(page.getByTestId('${topology.testIds.sessionRow}')).toHaveCount(0)
  })
})
`
}
```

- [ ] **Step 4: Run generator test and verify GREEN**

Run:

```bash
npx vitest run testing/generators/generate-playwright.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add write script**

Create `testing/generators/write-generated-playwright.mjs`:

```js
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePlaywrightSkeleton } from './generate-playwright.ts'
import { sessionRestoreBehavior } from '../behavior/session.behavior.ts'
import { sessionRestoreJourney } from '../journeys/session-restore.journey.ts'
import { archiveTopology } from '../topology/archive.topology.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outputPath = join(repoRoot, 'tests', 'generated', 'playwright', 'session-restore.generated.spec.ts')
const skeleton = generatePlaywrightSkeleton({
  behavior: sessionRestoreBehavior,
  topology: archiveTopology,
  journey: sessionRestoreJourney
})

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, skeleton)
console.log(`Generated ${outputPath}`)
```

- [ ] **Step 6: Wire scripts and Playwright/Vitest discovery**

Modify `package.json` scripts:

```json
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "package": "electron-builder --config electron-builder.yml",
    "rebuild:native": "node scripts/rebuild-node-pty.mjs",
    "verify:packaging": "node scripts/verify-packaging-baseline.mjs",
    "typecheck": "vue-tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.node.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:generate": "tsx testing/generators/write-generated-playwright.mjs",
    "test:e2e": "playwright test",
    "test:behavior-coverage": "vitest run testing/generators/behavior-coverage.test.ts",
    "test:all": "npm run test:generate && npm run test && npm run test:e2e && npm run test:behavior-coverage"
  }
```

Add `tsx` to `devDependencies`:

```json
"tsx": "^4.20.6"
```

Modify `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: [
    'e2e-playwright/**/*.test.ts',
    'generated/playwright/**/*.spec.ts'
  ],
  testIgnore: ['**/fixtures/**/*.test.ts'],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 1 : 0,
  fullyParallel: false,
  workers: 1,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
```

- [ ] **Step 7: Install updated dependency**

Run:

```bash
corepack pnpm install
```

Expected: `pnpm-lock.yaml` updates to include `tsx`.

- [ ] **Step 8: Generate the skeleton**

Run:

```bash
npm run test:generate
```

Expected: `tests/generated/playwright/session-restore.generated.spec.ts` is created and contains `AUTO-GENERATED FILE. DO NOT EDIT.`

- [ ] **Step 9: Run focused generator tests**

Run:

```bash
npx vitest run testing/generators/generate-playwright.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add package.json pnpm-lock.yaml playwright.config.ts testing/generators/generate-playwright.ts testing/generators/generate-playwright.test.ts testing/generators/write-generated-playwright.mjs tests/generated/playwright/session-restore.generated.spec.ts
git commit -m "test: generate first playwright journey skeleton"
```

---

### Task 5: Final Verification and Plan Closure

**Files:**
- No new files unless verification exposes a failure.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run generator**

Run:

```bash
npm run test:generate
```

Expected: generated output remains deterministic. `git diff -- tests/generated/playwright/session-restore.generated.spec.ts` is empty.

- [ ] **Step 3: Run mandatory Vitest quality gate**

Run:

```bash
npx vitest run
```

Expected: PASS with zero unexpected failures.

- [ ] **Step 4: Check generated Playwright test discovery without executing Electron UI journeys**

Run:

```bash
npx playwright test --list
```

Expected: output includes `tests\generated\playwright\session-restore.generated.spec.ts`.

- [ ] **Step 5: Commit verification-only fixes if needed**

If any verification command fails, fix the underlying implementation with a failing test first, rerun the focused command, then rerun the full verification commands.

- [ ] **Step 6: Report status**

Report:

```text
Implemented first AI-first testing thin slice.
Verification:
- npm run typecheck: PASS
- npm run test:generate: deterministic
- npx vitest run: PASS
- npx playwright test --list: generated skeleton discovered
```

Do not claim completion unless all commands have been run in this task and produced the expected results.

---

## Self-Review

Spec coverage:

- `defineBehavior()`, `defineTopology()`, and `defineJourney()` are covered by Task 1.
- First `session.restore` behavior asset is covered by Task 2.
- First Playwright skeleton generation is covered by Task 4.
- Behavior coverage report is covered by Task 3.
- Contract check proving generated test maps back to metadata is covered by Task 4 through generated metadata and Task 3 through coverage classification.
- Full migration, AI repair, and complete selector migration are intentionally out of scope for this first thin slice.

Type consistency:

- `CoverageBudget`, `BehaviorSpec`, `TopologySpec`, `JourneySpec`, and `GeneratedTestMeta` are defined once in `testing/contracts/testing-contracts.ts`.
- Behavior ids use `session.restore`.
- Journey id uses `journey.session.restore.base`.
- Topology ids use `surface.archive`, `archive.session.row`, and `archive.session.restore`.

Execution boundary:

- This plan starts with a thin vertical slice.
- Existing tests are not deleted, skipped, or weakened.
- Generated Playwright specs are excluded from Vitest and discovered by Playwright.
