---
date: 2026-06-10
topic: stoa-ctl CLI and bootstrap prompt update for subagent control
status: completed
mode: context-gathering
sources: 5
---

## Context Report: stoa-ctl CLI + Bootstrap Prompt Subagent Control

### Why This Was Gathered
Phase 4 (CLI update) and Phase 5 (bootstrap prompt update) of the subagent control feature.

### Summary
Two files need updating: `tools/stoa-ctl/index.ts` (CLI parser) and `src/core/session-bootstrap-prompt-service.ts` (bootstrap prompts). Both have existing tests that must also be updated.

### Key Findings

1. **CLI file** (`tools/stoa-ctl/index.ts`, 460 lines):
   - Flat if-chain pattern for command routing (group === 'session', then action checks)
   - `USAGE_TEXT` constant contains all command help text
   - `run()` takes `argv` + `deps` (fetch, env, stdout, stderr, sleep, readPortFile)
   - `CallerMode` discriminated union: `session` | `local-user`
   - `CliUsageError` -> exit 2, `CliConfigError` -> exit 3
   - Current `session prompt` handler at lines 405-421 sends to `/ctl/session/:id/prompt`
   - Exit code 6 for `unknown_session` in non-aggregate commands

2. **Bootstrap prompt** (`src/core/session-bootstrap-prompt-service.ts`, 60 lines):
   - Single `UNIFIED_SESSION_BOOTSTRAP_PROMPT` constant
   - `SessionBootstrapPromptService.getPrompt(sessionType)` returns the same prompt for all types
   - References `session prompt` in multiple places (lines 24, 32-33, 37)
   - Has SUBSESSION DISPATCH PROTOCOL and SUBSESSION RETURN PROTOCOL sections

3. **Shared types** (`src/shared/project-session.ts`):
   - Phase 1 types already added: `SubagentResult`, `SubagentResultSummary`, `SubagentWaitAggregate`, `SubagentStopAggregate`, `SubagentListItem`, all request types
   - `SessionSummary` already has `subagentName`, `subagentResultSummary`, `subagentInputEpoch`, `subagentLatestInputAt`, `subagentResult`

4. **Existing test files**:
   - `tools/stoa-ctl/index.test.ts` (700 lines) - tests `session prompt`, must be updated
   - `src/core/session-bootstrap-prompt-service.test.ts` (60 lines) - tests for `session prompt` wording

5. **Spec routes** (from the design doc):
   - POST `/ctl/subagent/list` (GET in spec, but assume what other agent implements)
   - POST `/ctl/subagent/dispatch`
   - POST `/ctl/subagent/wait`
   - POST `/ctl/subagent/input`
   - POST `/ctl/subagent/stop`
   - POST `/ctl/subagent/result`
   - POST `/ctl/session/:id/input` (replaces `/ctl/session/:id/prompt`)

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| CLI flat if-chain | tools/stoa-ctl/index.ts | lines 229-439 |
| USAGE_TEXT constant | tools/stoa-ctl/index.ts | lines 46-67 |
| session prompt handler | tools/stoa-ctl/index.ts | lines 405-421 |
| Bootstrap prompt single constant | session-bootstrap-prompt-service.ts | lines 3-54 |
| Subagent shared types complete | src/shared/project-session.ts | lines 378-532 |
| Existing CLI tests | tools/stoa-ctl/index.test.ts | lines 1-699 |
| Existing bootstrap tests | session-bootstrap-prompt-service.test.ts | lines 1-60 |

### Risks / Unknowns
- [!] The parallel agent implementing SubagentSupervisor/routes may use GET vs POST for list - spec says GET but task notes say POST. CLI should use GET per spec.
- [!] `parseInputSource` needs stdin reading capability, which requires a `readStdin` dependency for testability
