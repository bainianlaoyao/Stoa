# AI-First Testing Architecture Design

Date: 2026-04-23
Status: Accepted direction, ready for implementation planning
Owner: Codex

## Goal

Define the target-state testing architecture for `ultra_simple_panel` under an AI-first philosophy where:

- product design is the source of truth for test generation
- E2E coverage is optimized for real user behavior, not DOM trivia
- AI is used to generate, expand, diagnose, and repair tests
- contracts and behavior models constrain AI so generated tests remain stable

This design intentionally prefers breaking changes over compatibility layers.

## Why Change

The current test stack is strong but still follows a traditional hand-authored model:

- `vitest run` covers unit, store, component, and static-guard tests
- `tests/e2e/*.test.ts` covers backend, bridge, and config integration
- `tests/e2e-playwright/*.test.ts` covers real Electron UI journeys

Current limitations:

- Playwright relies partly on UI text and structural class fallbacks
- renderer bridge mocks are hand-maintained and can drift from real contracts
- visual screenshot assertions are too expensive for fast UI iteration
- product design does not directly define the E2E space
- there is no behavior coverage intelligence layer
- AI can help today, but it is not the primary path

## Design Principles

1. Contracts before tests.
2. Behavior before pages.
3. Topology before text.
4. Generated tests before handwritten tests.
5. AI operates inside explicit contracts, never from a blank page.
6. Coverage is measured in behavior assets, transitions, interruptions, and regressions.

## Recommended Architecture

The recommended target state is a contract-driven AI testing platform.

Pipeline:

`source code + contracts + behavior specs -> metadata extraction -> skeleton generation -> AI expansion -> execution -> failure triage -> AI patch proposal`

Primary layers:

1. `Contract Tests`
   Protect preload, IPC, topology, manifest schemas, and generator invariants.

2. `Logic Tests`
   Keep direct Vitest coverage for pure logic, stores, and focused module behavior.

3. `Generated Component Tests`
   Generate baseline component tests from manifests and contracts, with small handwritten overrides only where needed.

4. `Generated Journey Tests`
   Generate Playwright journeys from product behavior graphs rather than from raw DOM structure.

## Behavioral Source of Truth

### Product Behavior Graph

High-value E2E coverage must come from a machine-readable behavior graph, not from manual page exploration.

Core entities for this repository:

- `Project`
- `Session`
- `Surface`
- `Terminal`
- `Provider`
- `Archive`
- `Settings`
- `Recovery`

Behaviors are defined as user goals, for example:

- `project.create`
- `session.create`
- `session.activate`
- `session.archive`
- `session.restore`
- `terminal.sendInput`
- `webhook.receiveEvent`
- `app.relaunch.restoreState`
- `settings.provider.configure`

Each behavior must declare:

- `actor`
- `goal`
- `entities`
- `preconditions`
- `action`
- `observable effects`
- `state transition`
- `interruptions`
- `recovery expectation`
- `risk`
- `coverageBudget`

### Usage Modes

Journey generation must also include usage modes so the same behavior can be exercised under different operational conditions.

Initial modes:

- `first_run`
- `active_workflow`
- `recovery_workflow`
- `misconfigured_workflow`

## Coverage Model

Traditional line coverage is secondary. The primary coverage model is behavior coverage intelligence.

Tracked coverage dimensions:

1. `Behavior Coverage`
   Whether a declared behavior has executable and passing journeys.

2. `Transition Coverage`
   Whether state-machine edges have been exercised.

3. `Interruption Coverage`
   Whether high-risk behaviors have been tested under interruption.

4. `Observation Coverage`
   Whether each behavior is verified at both UI and system-state layers.

5. `Regression Coverage`
   Whether fixed bugs have been captured as durable behavior variants.

Coverage maturity levels:

- `Declared`
- `Reachable`
- `Verified`
- `Hardened`

## Selector and Topology Policy

E2E stability must come from explicit topology contracts.

Rules:

- all interactive UI nodes must expose stable `data-testid`
- E2E tests must not depend on UI copy as primary selectors
- E2E tests must not depend on CSS class names as selectors
- ARIA stays for accessibility and secondary semantic assertions
- topology constants must be shared between implementation and tests

Visual regression is not a primary validation strategy. Screenshot assertions may remain only as a tiny set of shell-level disaster sentinels.

## Contract-Driven Bridge Testing

`RendererApi`, preload exposure, and IPC channels must be treated as generated contracts.

Required outcomes:

- generate `RendererApi` mock factories from shared contracts
- generate preload/main/renderer consistency guards
- generate IPC harness/fake bus helpers from channel definitions
- remove repeated handwritten `window.stoa = { ... }` blocks

This prevents component tests from staying green when the real bridge has drifted.

## Proposed Repository Structure

```text
testing/
  behavior/
    *.behavior.ts
  contracts/
    *.contract.ts
  topology/
    *.topology.ts
  journeys/
    *.journey.ts
  generators/
    *.ts

tests/
  generated/
    component/
    playwright/
  handwritten/
    regressions/
    complex-failures/
```

Existing test locations remain during migration, but the target state shifts authority toward `testing/**`.

## DSL and Contract Shapes

### Behavior Spec

```ts
defineBehavior({
  id: 'session.restore',
  actor: 'user',
  goal: 'restore an archived session',
  entities: ['project', 'session', 'archive'],
  preconditions: ['project.exists', 'session.archived'],
  action: 'archive.restoreSession',
  expects: [
    'archive.sessionRemoved',
    'command.sessionVisible',
    'session.status in [starting, running]',
  ],
  interruptions: [
    'app.relaunch.duringAction',
    'doubleClick.restore',
  ],
  recovery: [
    'noDuplicateSession',
    'activeSessionRemainsValid',
  ],
  risk: 'high',
  coverageBudget: 'critical',
})
```

### Topology Spec

```ts
defineTopology({
  surface: 'archive',
  testIds: {
    root: 'surface.archive',
    sessionRow: 'archive.session.row',
    restoreButton: 'archive.session.restore',
  },
})
```

### Journey Spec

```ts
defineJourney({
  behavior: 'session.restore',
  usageMode: 'recovery_workflow',
  setup: ['project.withArchivedSession'],
  act: ['open.archive.surface', 'click.archive.restore'],
  assert: ['archive.sessionRemoved', 'command.sessionVisible'],
  variants: ['base', 'app.relaunch.duringAction', 'doubleClick.restore'],
})
```

### Generated Test Metadata

```ts
defineGeneratedTestMeta({
  id: 'journey.session.restore.relaunch',
  behaviorIds: ['session.restore', 'app.relaunch.restoreState'],
  entities: ['session', 'archive', 'recovery'],
  statesCovered: ['session.archived', 'session.starting'],
  interruptionsCovered: ['app.relaunch.duringAction'],
  observationLayers: ['ui', 'main-debug-state', 'persisted-state'],
  riskBudget: 'critical',
  regressionSources: [],
})
```

## E2E Generation Strategy

Generated E2E must not attempt full combinatorial explosion.

Use a layered strategy:

1. `Sentinel journeys`
   One shortest happy-path journey per core behavior.

2. `Transition journeys`
   One journey per critical state transition.

3. `Interruption journeys`
   At least one interruption variant for each high-risk behavior.

4. `Pairwise journeys`
   Pairwise combinations across high-risk entities, states, and interruptions.

5. `Exploration journeys`
   Small AI-generated variants under explicit execution budget.

Priority high-risk chains for this repository:

- `project.create`
- `session.create`
- `session.activate`
- `session.archive`
- `session.restore`
- `terminal.sendInput`
- `webhook.receiveEvent`
- `app.relaunch.restoreState`
- `provider.configure`
- `terminal.switchIsolation`

## Behavior Coverage Plan Requirement

Every future product design that introduces any of the following must include a Behavior Coverage Plan:

- a new state
- a new interruption point
- a new cross-process interaction
- a new recoverable behavior
- a new user goal

The plan must specify:

- user goal
- entities and states involved
- observation layers
- required interruptions
- minimum E2E budget

Without this, the design is incomplete.

## Failure Triage and AI Repair

AI-assisted repair is allowed only after structured failure capture.

Every failed generated test should emit a triage bundle containing:

- failing behavior id
- failing topology locator
- DOM snapshot
- Playwright trace path or Vitest error context
- main-process debug state when available
- persisted-state snapshot when relevant
- manifest and generator inputs used to create the test

AI may classify failures as:

1. `locator drift`
2. `journey drift`
3. `contract drift`

AI may propose automatic patches only for:

- topology fixes caused by locator drift
- journey-step fixes caused by journey drift

Contract drift must be fixed at the contract source, not by patching generated tests directly.

## Migration Strategy

### Phase 1: Unify Contracts

- introduce shared `data-testid` constants and naming rules
- introduce generated `RendererApi` mock factories
- define first behavior graph for project, session, archive, terminal, and recovery
- forbid new E2E tests from using copy or class-name selectors

### Phase 2: Generate Main Paths

- generate component test skeletons
- generate Playwright sentinel journeys
- generate transition and interruption journeys
- generate coverage metadata per test
- add failure triage bundle output

### Phase 3: Close the AI Repair Loop

- classify failures automatically
- propose topology and journey patches
- feed production bugs back as regression variants
- prune redundant tests based on coverage gain versus runtime cost

## Impact on Existing Tests

Keep:

- `src/core/**/*.test.ts`
- store tests
- backend and contract-style integration tests
- a very small number of complex handwritten recovery tests

Migrate:

- renderer component tests toward generated skeletons plus overrides
- Playwright helpers toward topology-contract-driven actions

Reduce or remove:

- copy-based locators
- class-based E2E fallbacks
- large repeated `window.stoa` handwritten mocks
- primary-path screenshot regression assertions

## CI and Workflow Integration

The target workflow is:

1. product design writes Behavior Coverage Plan
2. implementation updates contracts, topology, and behavior specs
3. generators emit tests
4. `npx vitest run` remains mandatory
5. generated Playwright journeys run as the E2E stage
6. coverage intelligence reports behavior and interruption gaps
7. failure triage bundle is produced on failure
8. AI suggests constrained patches where safe

This makes testing a compilation byproduct of product intent, not a manual afterthought.

### CI Gates

The target CI pipeline has five explicit gates:

1. `contract:check`
   Verify `RendererApi`, IPC channels, preload exposure, test id constants, behavior schema, and journey schema.

2. `test:generate`
   Generate component and Playwright tests from behavior, topology, and contract inputs. The generator must be deterministic. Any unexpected generated diff fails CI.

3. `test:unit`
   Run `npx vitest run`. This remains the mandatory repository quality gate.

4. `test:e2e:generated`
   Run generated Playwright journeys. Local and pull-request runs should execute sentinel and high-risk interruption journeys. Full pairwise expansion can run on a scheduled job.

5. `coverage:behavior`
   Generate behavior coverage intelligence and fail when required behavior budgets are not met.

Target script shape:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:e2e": "playwright test",
    "test:contracts": "node testing/generators/check-contracts.mjs",
    "test:generate": "node testing/generators/generate-tests.mjs",
    "test:behavior-coverage": "node testing/generators/report-behavior-coverage.mjs",
    "test:all": "pnpm test:contracts && pnpm test:generate && pnpm test && pnpm test:e2e && pnpm test:behavior-coverage"
  }
}
```

### AI Permissions in CI

AI must not directly mutate CI state to make a failing pipeline green.

Allowed:

- generate a triage bundle
- classify failure cause
- propose topology or journey patches
- propose regression variants for true product bugs

Not allowed:

- directly edit generated tests as the source of truth
- hide a product bug by weakening assertions
- automatically merge locator repairs without review

## Product Design to E2E Workflow

New features should flow through this sequence:

1. Write the `Behavior Coverage Plan`.
2. Generate the behavior matrix.
3. Generate journey skeletons.
4. Let AI add bounded realistic path variants.
5. Implement the feature against generated expectations.
6. Classify failures before patching.
7. Feed real bugs back into regression variants.

Every feature design should contain a machine-readable behavior block.

Example:

```ts
export const bulkRestoreSessions = defineBehavior({
  id: 'session.bulkRestore',
  actor: 'user',
  goal: 'restore multiple archived sessions in one action',
  entities: ['project', 'session', 'archive'],
  usageModes: ['active_workflow', 'recovery_workflow'],
  preconditions: [
    'project.exists',
    'session.archived.count >= 2',
  ],
  action: 'archive.bulkRestoreSessions',
  expects: [
    'archive.selectedSessionsRemoved',
    'command.restoredSessionsVisible',
    'persisted.sessions.archived=false',
  ],
  invalidPreconditions: [
    'archive.selection.empty',
    'session.id.missing',
  ],
  interruptions: [
    'duplicateAction',
    'app.relaunch.duringAction',
    'webhook.lateStatusEvent',
  ],
  observationLayers: [
    'ui',
    'renderer-store',
    'main-debug-state',
    'persisted-state',
  ],
  coverageBudget: 'critical',
})
```

Critical behaviors must cover these six dimensions:

- base success path
- invalid precondition
- interruption
- persistence after relaunch
- cross-surface projection
- backend truth through debug state or persisted state

## First Behavior Blocks

The first implementation pass should model only the highest-leverage behaviors:

1. `project.create`
   Cover first run, duplicate path, and relaunch recovery.

2. `session.create`
   Cover shell, opencode, codex, claude-code, missing provider config, and startup status.

3. `session.activate`
   Cover multi-session switching, terminal buffer isolation, and surface switching.

4. `session.archive`
   Cover archiving the active session, command-surface projection, and relaunch persistence.

5. `session.restore`
   Cover duplicate restore, relaunch during restore, and active linkage after restore.

6. `terminal.sendInput`
   Cover terminal readiness, session switching, and input routing to the correct runtime.

7. `webhook.receiveEvent`
   Cover late events, duplicate events, unknown session ids, and relaunch after events.

8. `app.relaunch.restoreState`
   Cover project, session, settings, and runtime recovery projections.

## First Thin Slice

The first implementation milestone should be a thin closed loop, not a full migration:

1. Implement `defineBehavior()`.
2. Implement `defineTopology()`.
3. Implement `defineJourney()`.
4. Model `session.restore`.
5. Generate one Playwright skeleton from that model.
6. Generate one behavior coverage report.
7. Add a contract check proving the generated test maps back to declared behavior metadata.

Once this works, expanding coverage becomes an act of adding behavior assets rather than hand-writing journeys.

## Final Recommendation

This repository should not replace Vitest or Playwright. It should upgrade them into a behavior-driven, contract-constrained, AI-native testing system.

The strongest near-term leverage points are:

- shared selector contracts
- generated bridge mocks
- behavior specs for session, archive, terminal, and recovery
- generated sentinel plus interruption journeys
- behavior coverage reporting

These changes move the project from a strong traditional test suite to a system where product design directly produces high-value E2E coverage.
