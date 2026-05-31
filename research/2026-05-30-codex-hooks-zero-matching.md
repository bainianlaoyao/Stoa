---
date: 2026-05-30
topic: zero-hooks-listCodexHooksThroughAppServer
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Codex hooks/list Returns Zero Hooks for `.tmp` Path Workspaces

### Why This Was Gathered

The test `'real Codex app-server sees project hooks as trusted after sidecar install'` in `tests/e2e/provider-integration.test.ts:1321` fails with:

```
AssertionError: expected [] to have a length of 5 but got +0
```

The filter at line 1329–1333 yields zero matching hooks because the Codex `hooks/list` JSON-RPC endpoint returns an empty hooks array for the test workspace.

### Summary

Codex CLI v0.135.0 **silently skips loading project hooks** when the workspace path contains a `.tmp` directory component. The test creates workspaces under `process.cwd() + '/.tmp/tests/'` via `testing/test-temp.ts`, and the `.tmp` segment triggers Codex's safety check. The trust entries, hook config, and filter logic are all correct — the issue is purely path-based.

### Key Findings

1. **Root cause: `.tmp` in workspace path triggers Codex hook suppression.** A three-way comparison proves it:
   - `C:\Users\30280\AppData\Local\Temp\stoa-XMruFq` → **1 hook returned** ✓
   - `D:\Data\DEV\ultra_simple_panel\.worktrees\unified-session-tree\.tmp\tests\stoa-xxx` → **0 hooks** ✗
   - `D:\Data\DEV\_hooktest\stoa-Fc7jeG` → **1 hook returned** ✓
   - The D: drive is NOT the issue; only the `.tmp` path segment is.

2. **The hooks/list response shape has evolved in Codex CLI v0.135.0.** Each hook now includes: `key`, `eventName`, `handlerType`, `matcher`, `command`, `timeoutSec`, `statusMessage`, `sourcePath`, `source`, `pluginId`, `displayOrder`, `enabled`, `isManaged`, `currentHash`, `trustStatus`. The test's filter logic (`command.includes('hook-dispatch') && sourcePath.toLowerCase().includes(workspaceDir.toLowerCase())`) remains compatible with the new schema.

3. **The trust mechanism (`ensureCodexProjectTrusted`) works correctly.** When the workspace is at a non-`.tmp` path, the Codex app-server returns hooks with `trustStatus: "trusted"` and the Stoa-side `sha256ForCanonicalJson` hash matches the server's `currentHash`.

4. **No configWarning is emitted for the `.tmp` case.** Unlike untrusted projects (which produce a `configWarning` notification), the `.tmp` suppression is silent — the server returns `{"hooks":[],"warnings":[],"errors":[]}` with no diagnostic message.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Test assertion failure: `expected [] to have length 5` | Vitest output | `tests/e2e/provider-integration.test.ts:1334` |
| Filter logic checking `command` + `sourcePath` | Test code | `tests/e2e/provider-integration.test.ts:1329–1333` |
| `listCodexHooksThroughAppServer` parses `result.data[0].hooks` | Test code | `tests/e2e/provider-integration.test.ts:256–345` |
| `createTestTempDir` uses `.tmp/tests` as root | Test infrastructure | `testing/test-temp.ts:4,10–13` |
| Three-way path comparison proving `.tmp` is the trigger | Probe `research/_probe-path-compare.mts` | system-temp=1, project-tmp=0, d-dev-clean=1 |
| Hooks/list response new schema (15 fields per hook) | Probe `research/_probe-hooks-list.mjs` | Codex CLI v0.135.0 response |
| Stoa hash matches Codex server hash | Manual verification | `sha256:7a9f2fa5...` for SessionStart |
| Codex CLI version | `codex --version` | `codex-cli 0.135.0` |
| User home config `[features]` has no `hooks = true` | `~/.codex/config.toml` line 46 | Has `multi_agent`, `js_repl`, etc. but not `hooks` |
| Trust entries use mixed quoting (single + double) in TOML | User's real `~/.codex/config.toml` | Old entries: `'[hooks.state.'...']`, new: `'[hooks.state."..."]` |
| `codexProjectTrustKey` lowercases on Windows | Provider code | `src/extensions/providers/codex-project-config.ts:158–168` |

### Fix

The test temp root `TEST_TEMP_ROOT` in `testing/test-temp.ts:4` defaults to:

```typescript
const TEST_TEMP_ROOT = resolve(process.env.VIBECODING_TEST_TMPDIR ?? join(process.cwd(), '.tmp', 'tests'))
```

The `.tmp` component causes Codex to suppress hooks. Change the default to avoid `.tmp`:

```typescript
const TEST_TEMP_ROOT = resolve(process.env.VIBECODING_TEST_TMPDIR ?? join(process.cwd(), '.test-work', 'tests'))
```

Or set `VIBECODING_TEST_TMPDIR` to a non-`.tmp` path when running Codex-related tests.

### Risks / Unknowns

- [!] The Codex CLI's `.tmp` suppression is undocumented behavior — it could change between versions.
- [?] The exact heuristic Codex uses (contains `.tmp`? regex on path segments?) is unknown — the probe only tested one `.tmp` scenario.
- [?] Whether other path patterns (e.g., `__tmp__`, `temp`) also trigger suppression was not tested.
- [!] Changing the test temp root affects ALL tests that use `createTestTempDir`, not just the Codex hook test — verify no regressions.
