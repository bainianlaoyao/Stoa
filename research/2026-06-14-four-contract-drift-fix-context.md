---
date: 2026-06-14
topic: Focused fix-context for four contract drift issues (syncShadowStateToStoaServer, terminal-replay REST shape, context-export maxChars/maxLength, dead VITE_USE_STOA_CLIENT define)
status: completed
mode: context-gathering
depth: 2
max_depth: 2
sources: current source tree (re-verified against working tree on 2026-06-14)
---

# Fix-Context: Four Contract Drift Issues

## Why This Was Gathered

An implementation agent needs bounded, current-code context to fix exactly four contract-drift items. A prior audit (`research/2026-06-14-sr-mandatory-interface-consistency-audit.md`) flagged these as secondary findings F2 / F3 / F7 / F8. This report **re-verifies each against the current working tree** (several items drifted since earlier reports), pins exact file:line citations on both sides of every mismatch, lists the blast radius (callers, callees, tests), and — without prescribing — enumerates the consistent fix direction for each. Read-only. No code was modified.

Scope is strictly the four items. The higher-priority WS-protocol issues (F4 / F5 in the prior audit) are out of scope here.

---

## Issue 1 — `syncShadowStateToStoaServer` calls a non-existent route (prior audit F8)

### Helper

`src/main/index.ts:1009-1031` — `async function syncShadowStateToStoaServer(): Promise<void>`:
- Early-returns if `!projectSessionManager || !srSpawner` (`index.ts:1010-1012`).
- Builds `baseUrl = http://127.0.0.1:${srSpawner.getPort()}` and reads `srSpawner.getAuthToken()` (`index.ts:1014-1015`).
- Snapshots state + settings (`index.ts:1016-1017`).
- `fetch(`${baseUrl}/api/v1/electron/shadow-state`, { method: 'PUT', ... body: JSON.stringify({ state: snapshot, settings }) })` (`index.ts:1019-1026`).
- **No `try/catch`.** On `!response.ok` it `throw new Error('Stoa shadow-state sync failed with status ${response.status}')` (`index.ts:1028-1030`).

### Call site

`src/main/index.ts:581` — `void syncShadowStateToStoaServer()`, inside the state-change callback passed as the 3rd argument to `new SessionRuntimeController(...)` (`index.ts:576-584`). The callback also calls `void syncUpdateStateToWindow()` at `index.ts:580`. So this runs on **every runtime state change**, unconditionally.

### Route absence (re-verified)

`grep shadow-state|shadowState|electron/shadow` across `stoa-server/src/` → **no matches** (read confirmed this run). Repo-wide grep returns only the call site (`index.ts:1019`, `1029`) and this/prior research docs. **No plan or doc references the endpoint.** The `/api/v1` group mounts projects/sessions/settings/observability/meta-sessions/sidebar/fs/git (per prior audit, `stoa-server/src/app.ts:71-78`); there is no `electron` subgroup and no catch-all that would synthesise it.

### Sibling contrast (the call next to it works)

`mirrorCanonicalEventToStoaServer` (`index.ts:1033-1051`) POSTs to `/events` (`index.ts:1038`); that route **does** exist (`stoa-server/src/routes/webhooks.ts:316`, per prior audit). Only the shadow-state call is orphaned.

### Rejection behaviour (refines the prior audit's "needs runtime confirmation")

The caller `void syncShadowStateToStoaServer()` (`index.ts:581`) has **no `.catch()`**. A 404 → helper throws → unhandled promise rejection. An `unhandledRejection` handler is registered at `src/main/index.ts:339-344`, but its surrounding block (ends at `index.ts:345`) is the packaged-smoke setup gated by `app.isPackaged` (context at `index.ts:329-330`); coverage in normal/dev runtime is therefore not guaranteed. Net: the orphaned call produces a guaranteed-failing PUT on every state change, surfacing as an unhandled rejection whose handling depends on environment.

### Conclusion for the fix

Orphaned dead call — endpoint was never implemented, no design doc claims it. Consistent with the project's "no compatibility code, breaking changes only" rule: **delete `syncShadowStateToStoaServer`** (`index.ts:1009-1031`) and its call site at `index.ts:581`. If SR-side shadow-state sync is actually desired later, it must be reintroduced as a real route + call together (out of scope for this fix).

---

## Issue 2 — `terminal-replay` REST shape vs adapter's `Promise<string>` (prior audit F2)

### Adapter side

`src/renderer/lib/stoa-client-preload-adapter.ts:107-110`:
```ts
async getTerminalReplay(sessionId: string): Promise<string> {
  const res = await this.client.get<string>(`/api/v1/sessions/${sessionId}/terminal-replay`)
  return res.data!
}
```
Declares `Promise<string>` and returns `res.data!` typed as `string`.

### Route side

`stoa-server/src/routes/sessions.ts:260-266`:
```ts
routes.get('/sessions/:id/terminal-replay', async (c) => {
  const sessionId = c.req.param('id');
  const state = manager.snapshot();
  ensureSessionExists(state, sessionId);
  const replay = await runtimeBridge.getTerminalReplay(sessionId);
  return c.json(envelope({ sessionId, replay }));
});
```
`envelope(...)` (`sessions.ts:40-50`) wraps as `{ ok: true, data, meta }`. So `res.data` is **`{ sessionId, replay: string }`**, not a bare string.

### Type contract

`src/shared/project-session.ts:617` — `getTerminalReplay: (sessionId: string) => Promise<string>`. The canonical `RendererApi` contract says **string**.

### Blast radius

- **SR route test** (`stoa-server/src/routes/api-routes.test.ts:646-655`): mocks `runtimeBridge.getTerminalReplay` to return bare string `'terminal output'`; asserts `body.data` equals `{ sessionId, replay: 'terminal output' }`. So the route's object shape is pinned by its own test.
- **Adapter test** (`stoa-client-preload-adapter.test.ts:127-132`): mocks `client.get` to resolve `ok('replay-text')` (bare-string data) and asserts the adapter returns `'replay-text'`. This test **does not exercise the real envelope** — it feeds the adapter a bare string, masking the mismatch. A fix that changes the adapter must update this mock.
- **Production caller** (`src/renderer/components/TermeralViewport.vue:335-343`): `void stoa.getTerminalReplay(sessionId).then((replay) => { ... enqueueWrite(replay) })`. Treats the result as a string to write to the terminal. If the adapter returned `{ sessionId, replay }`, `enqueueWrite` would receive an object and the terminal restore would break.
- **Desktop IPC path returns bare string** (for contrast): `src/main/index.ts:225-226`, `865-866`, `924-925`, `1630` all return bare `string` from `runtimeController.getTerminalReplay(...)`. The IPC `session:terminal-replay` handler delivers a string. So on desktop the renderer gets a string; only the REST/SR path is mismatched.

### Separate (out-of-scope) shape note

The Electron runtime provider's `handleGetTerminalReplay` (`src/main/stoa-runtime-client.ts:325-328`) returns `{ text: replay }`. This is a **third** shape, but it lives on the WS runtime-bridge path (provider → SR), not the REST renderer path, so it is a separate concern from Issue 2. Noted only so the fixer does not conflate the two.

### Fix direction (context, not prescription)

Two consistent options:
- **(a) Route returns `envelope(replay)` — bare string.** Matches the `RendererApi` string contract, the adapter, the TerminalViewport caller, and the desktop IPC path. Requires updating `api-routes.test.ts:652-653` to expect bare-string `data`.
- **(b) Adapter unwraps `res.data.replay`.** Keeps the route's object shape, but diverges from every other adapter method (which return `res.data!` directly) and from the `Promise<string>` contract.

Option (a) is the consistent choice given the rest of the adapter and the shared type contract.

---

## Issue 3 — Context-export query param `maxChars` (adapter) vs `maxLength` (route) (prior audit F3)

### Adapter side

`src/renderer/lib/stoa-client-preload-adapter.ts:383-397` (`contextExportFullText`): sends `includeThinking` (`388`), `includeToolDetails` (`389`), **`maxChars`** (`390`), `cursor` (`391`). Return type `{ text; nextCursor?; truncated; totalTurns }` (`386`).
`src/renderer/lib/stoa-client-preload-adapter.ts:399-411` (`contextExportSlimText`): sends **`maxChars`** (`404`), `cursor` (`405`). Same return type (`402`).

### Route side

`stoa-server/src/routes/sessions.ts:329-346` (`context/full`):
```ts
const maxChars = Math.min(Math.max(1, Number(c.req.query('maxLength') ?? 100_000)), 1_000_000);
```
reads **`maxLength`** (`334`) — different name. Never reads `cursor` / `includeThinking` / `includeToolDetails`. Returns `envelope({ sessionId, text: '', truncated: false, totalTurns: 0, maxChars })` (`339-345`). Note the route **echoes a field named `maxChars`** in the response, so the route's own vocabulary is internally inconsistent (`maxLength` in, `maxChars` out).

`stoa-server/src/routes/sessions.ts:348-363` (`context/slim`): identical pattern, reads `maxLength` (`352`).

### Blast radius

- **Adapter tests** (`stoa-client-preload-adapter.test.ts:560-573`): assert the adapter **sends** `maxChars` (+ `includeThinking`), but mock `client.get`, so the route never sees the request and the name mismatch is invisible to tests.
- **No production renderer caller** of `contextExportFullText` / `contextExportSlimText` exists (grep of `src/renderer` returns only the adapter, its test, and `App.test.ts` mocks at `202-203`). Impact is latent until a real caller + real context assembly are wired.
- These are currently stub routes (return empty `text`), so the user-visible effect is nil today; but the moment real context assembly lands, the adapter's `maxChars`/`cursor`/`includeThinking`/`includeToolDetails` intent is silently dropped and `nextCursor` is never produced.

### Fix direction (context, not prescription)

Align on one param vocabulary. `maxChars` is the better anchor because (i) the adapter + `RendererApi`-style options already use it, and (ii) the route already names its response field `maxChars`. So: **route reads `maxChars`** (`sessions.ts:334`, `352`) and additionally reads `cursor` / `includeThinking` / `includeToolDetails`, and produces `nextCursor` when the result is truncated. (The alternative — adapter renames to `maxLength` and drops the extras — is less consistent with the rest of the surface.)

---

## Issue 4 — Dead `VITE_USE_STOA_CLIENT` define (prior audit F7)

### The define

`vite.web.config.ts:11-13`:
```ts
define: {
  'import.meta.env.VITE_USE_STOA_CLIENT': '"1"',
},
```

### Reader search (re-verified this run)

`grep VITE_USE_STOA_CLIENT` across all `**/*.{ts,vue,mjs,js}` (gitignored `node_modules` / `.worktrees` excluded) → **only `vite.web.config.ts:12`**. No source file reads `import.meta.env.VITE_USE_STOA_CLIENT`. `electron.vite.config.ts` does **not** define it (not in results), so the desktop build never relied on it either.

### Why it is inert now (correction to stale reports)

`src/renderer/stores/stoa-store-plugin.ts:53-55`:
```ts
export function isStoaClientMode(): boolean {
  return clientInstance !== null
}
```
This function was **rewritten** — it no longer reads the env flag. Earlier reports (e.g. `research/2026-06-13-stoa-server-web-client-build-and-wiring-gaps.md:39`, `research/2026-06-12-renderer-ui-and-state-boundary-audit.md:221`) that claim `isStoaClientMode()` checks `VITE_USE_STOA_CLIENT === '1'` are **stale**. The current gate is `clientInstance !== null`.

Web mode activates the client unconditionally at bootstrap, independent of any build-time flag: `src/renderer/bootstrap-web.ts:22-43` — `bootstrapWebRenderer()` calls `initStoaClientForStores(window.location.origin, token)` (`bootstrap-web.ts:24`, sets `clientInstance`), then `setRendererApi(adapter)` and `window.stoa = adapter` (`bootstrap-web.ts:39-40`). After that, `isStoaClientMode()` is `true`. Desktop uses `bootstrap-electron.ts` (which injects `window.stoa` via the preload adapter mixin) and never sets `clientInstance`, so `isStoaClientMode()` is `false` there — exactly as intended, with no flag involved.

### Test pinning (re-verified)

`grep VITE_USE_STOA_CLIENT|vite.web.config|define:` across all `*.test.ts` → **no matches**. No config-guard test pins the define; deleting it breaks no test.

### Conclusion for the fix

Pure dead define. **Delete the `define` block** (`vite.web.config.ts:11-13`). The web build's behaviour is already driven entirely by `bootstrap-web.ts`; removing the unused `define` cannot change any bundle.

---

## Cross-Reference & Corrections to the Prior Audit

The prior audit `research/2026-06-14-sr-mandatory-interface-consistency-audit.md` (F2/F3/F7/F8) is substantively correct. This report:
- Re-verifies F2/F3/F8 at current line numbers and adds the **adapter-test-masking** detail (the adapter tests mock `client.get` with bare values, so they do not catch the REST shape/param mismatches).
- **Confirms F7 against current code** and supersedes the stale `isStoaClientMode() reads the flag` claim in `research/2026-06-13-*` / `research/2026-06-12-*` reports.
- Refines F8: an `unhandledRejection` handler exists at `src/main/index.ts:339-344` but sits inside the packaged-smoke setup scope (gated by `app.isPackaged`, context at `index.ts:329-330`); normal/dev coverage is not guaranteed.

---

## Evidence Chain

| Issue | Fact | Source | Location |
|---|---|---|---|
| 1 | Helper body, no try/catch, throws on non-ok | main | `src/main/index.ts:1009-1031` |
| 1 | Call site `void syncShadowStateToStoaServer()` in state-change callback | main | `src/main/index.ts:581` (controller ctor `576-584`) |
| 1 | Route absent in stoa-server | grep | `stoa-server/src/` → no `shadow-state`/`shadowState`/`electron/shadow` matches |
| 1 | Sibling `/events` route exists | webhooks | `stoa-server/src/routes/webhooks.ts:316` (via prior audit) |
| 1 | `unhandledRejection` handler in packaged-smoke scope | main | `src/main/index.ts:339-344` (scope context `329-345`) |
| 2 | Adapter declares `Promise<string>`, returns `res.data!` | adapter | `src/renderer/lib/stoa-client-preload-adapter.ts:107-110` |
| 2 | Route returns `envelope({ sessionId, replay })` (object) | sessions route | `stoa-server/src/routes/sessions.ts:260-266` |
| 2 | `envelope` wraps `{ ok, data, meta }` | sessions route | `stoa-server/src/routes/sessions.ts:40-50` |
| 2 | RendererApi contract = `Promise<string>` | shared | `src/shared/project-session.ts:617` |
| 2 | Route test pins object shape | api-routes test | `stoa-server/src/routes/api-routes.test.ts:646-655` |
| 2 | Adapter test mocks bare string (masks mismatch) | adapter test | `src/renderer/lib/stoa-client-preload-adapter.test.ts:127-132` |
| 2 | Production caller expects string | TerminalViewport | `src/renderer/components/TerminalViewport.vue:335-343` |
| 2 | Desktop IPC path returns bare string | main | `src/main/index.ts:225-226`, `865-866`, `924-925`, `1630` |
| 2 | WS-path `handleGetTerminalReplay` returns `{ text }` (separate path) | runtime client | `src/main/stoa-runtime-client.ts:325-328` |
| 3 | Adapter sends `maxChars` (full) | adapter | `stoa-client-preload-adapter.ts:390` |
| 3 | Adapter sends `maxChars` (slim) | adapter | `stoa-client-preload-adapter.ts:404` |
| 3 | Route reads `maxLength` (full), echoes `maxChars` | sessions route | `stoa-server/src/routes/sessions.ts:333-345` |
| 3 | Route reads `maxLength` (slim) | sessions route | `stoa-server/src/routes/sessions.ts:352-362` |
| 3 | Adapter return type expects `nextCursor` | adapter | `stoa-client-preload-adapter.ts:386`, `402` |
| 3 | Adapter test sends `maxChars` but mocks `client.get` | adapter test | `stoa-client-preload-adapter.test.ts:560-573` |
| 3 | No production renderer caller | grep | `src/renderer` → only adapter + tests |
| 4 | Dead define | vite web config | `vite.web.config.ts:11-13` |
| 4 | No source reads the flag | grep | `**/*.{ts,vue,mjs,js}` → only `vite.web.config.ts:12` |
| 4 | `isStoaClientMode()` checks `clientInstance !== null` (not flag) | store plugin | `src/renderer/stores/stoa-store-plugin.ts:53-55` |
| 4 | Web bootstrap activates client unconditionally | bootstrap | `src/renderer/bootstrap-web.ts:22-43` (`24`, `39-40`) |
| 4 | No config-guard test pins the define | grep | `*.test.ts` for `VITE_USE_STOA_CLIENT|vite.web.config|define:` → none |

---

## Risks / Unknowns

- [!] **Issue 1 (F8) rejection surface.** The helper has no `try/catch` and the caller uses bare `void`; a 404 on every state change is a guaranteed unhandled rejection. The only `unhandledRejection` handler found (`index.ts:339`) is in the packaged-smoke scope; dev/normal-runtime handling was not fully traced. Deleting the call removes the risk entirely.
- [?] **Issue 2 (F2) — choosing fix direction (a) vs (b)** changes which test must update: (a) → `api-routes.test.ts:652-653`; (b) → adapter + adapter test + `RendererApi` contract drift. Both are viable; (a) is more consistent. Confirm with the implementer's preference, but (a) is the recommendation embedded above.
- [?] **Issue 3 (F3) stub status.** Both context routes are stubs returning empty text; the param-name mismatch has no user-visible effect today. The fix is still correct to land now so that real context assembly inherits the right contract.
- [?] **Issue 1 — intent.** No doc describes what `/api/v1/electron/shadow-state` was meant to do. If SR-side shadow-state ingestion is actually wanted, it must be reintroduced as a paired route + call; treating the current call as dead code to delete is the recommendation absent any such intent.
- [?] Stale build artefacts under `stoa-server/dist/web/` and `out/renderer/` may still reference `VITE_USE_STOA_CLIENT`; these are not source and will be regenerated.

---

## Context Handoff

Start here: `D:\Data\DEV\ultra_simple_panel\research\2026-06-14-four-contract-drift-fix-context.md`

Saved report path (exact): `D:\Data\DEV\ultra_simple_panel\research\2026-06-14-four-contract-drift-fix-context.md`

Read-only context. Four items, each with current-code citations on both sides of the mismatch, blast radius, and a recommended (not prescribed) fix direction. Implementer should confirm fix direction for Issue 2 (route-returns-bare-string is recommended) before editing. No compatibility/migration code per project rules — all four fixes are breaking-change-eligible cleanups.
