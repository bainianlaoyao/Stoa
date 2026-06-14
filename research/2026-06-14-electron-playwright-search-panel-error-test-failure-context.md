---
date: 2026-06-14
topic: electron-playwright-search-panel-error-test-failure-context
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Electron Playwright `search-panel.test.ts:143` failure — "shows error message when search fails"

### Why This Was Gathered

To fix the failing Electron Playwright test at `tests/e2e-playwright/search-panel.test.ts:143`. The report traces the test helper, the SR `/api/v1/fs/search` route, the IPC/preload path, and the Vue UI error rendering, then determines which boundary is responsible.

### Summary

The test fails because the **Stoa Server `/api/v1/fs/search` route treats a no-match `rg`/`git grep` exit code 1 as a thrown error**, returning HTTP 500 instead of an empty result. The Electron renderer (via the StoaClient path) surfaces the error message `"Filesystem search failed: Command failed: rg …"` in the panel, which contains **neither** the substring `"Error"` **nor** `"No results"`. The test asserts `text.includes('Error') || text.includes('No results')`, so it fails. This is **neither** "helper no longer triggers backend error" (the backend DOES error) **nor** "UI not displaying SR error" (the UI DOES display it) — it is a **third boundary**: a behavioural divergence between the SR route (`fs.ts`) and the now-dead Electron IPC handler (`sidebar-fs-handlers.ts`) around exit code 1, exposed by the recent migration of the Electron desktop renderer onto the StoaClient path.

### Key Findings

1. **The Electron desktop renderer no longer uses IPC for search.** `bootstrap-electron.ts:33` calls `initStoaClientForStores()`, which sets `clientInstance` in `stoa-store-plugin.ts:16`. `isStoaClientMode()` (`stoa-store-plugin.ts:53-55`) therefore returns `true` even inside Electron, so `search.ts:23-29` routes every search through `client.post('/api/v1/fs/search', …)` instead of `requireRendererApi().fsSearch()`. The IPC handler `registerFilesystemHandlers` / `fsSearch` (`sidebar-fs-handlers.ts:553-559`) is effectively **dead code** for search in the current architecture.

2. **The SR route does NOT handle exit code 1 (no matches).** `runRipgrepSearch` in `fs.ts:117-208` calls `execFileAsync('rg', args, {…})` (line 143), which **rejects** when `rg` exits with code 1 (rg's "no matches" signal). The guard `if (!stdout.trim())` at `fs.ts:147` is **dead code** for the no-match case — the rejection happens at the `await` before `stdout` is destructured. `runGitGrepSearch` (`fs.ts:210-265`) has the identical defect via `execFileAsync('git', …)` at line 225.

3. **The SR fallback regex does not catch exit-code-1 errors.** `searchContent` (`fs.ts:267-279`) only falls back to `git grep` when the error message matches `/ENOENT|not recognized|not available/i`. The Node `execFile` rejection for exit code 1 has message `"Command failed: rg …"`, which does **not** match that regex, so the error is re-thrown. (When `rg` is genuinely absent the ENOENT branch works, but `git grep` then hits the same exit-code-1 defect.)

4. **Contrast with the IPC handler (the reference behaviour the test was written against).** `sidebar-fs-handlers.ts:238-320` uses a custom `spawnCommand()` (`sidebar-fs-handlers.ts:145-168`) that **always resolves** with `{ code, stdout, stderr }`, then explicitly handles `result.code === 1` as empty results (`sidebar-fs-handlers.ts:274-280` for rg, `sidebar-fs-handlers.ts:348-354` for git grep). This is the contract the test's "No results" branch assumed.

5. **The error envelope the UI receives.** The SR route catch (`fs.ts:513-519`) wraps the thrown error as `AppError({ code: 'internal_error', message: 'Filesystem search failed: …', statusCode: 500 })`. The global error handler (`error-handler.ts:16-27`) serialises it to `{ ok:false, error:{ code:'internal_error', message:'Filesystem search failed: Command failed: rg …' } }` with status 500.

6. **The StoaClient surfaces that message verbatim.** `stoa-client.ts:115-122` throws `StoaClientError(json.error.code, json.error.message, …)` when `!json.ok`. The search store catch (`search.ts:59-62`) sets `error.value = e.message`, i.e. `"Filesystem search failed: Command failed: rg --json --max-count 500 …"`.

7. **The UI DOES render the error, but the text doesn't match the assertion.** `SearchPanel.vue:171-173` renders `<div v-else-if="error">{{ error }}</div>`. The panel's `textContent` therefore equals the raw message above, which contains **no** substring `"Error"` and **no** substring `"No results"`. The test (`search-panel.test.ts:149-152`) reads `panel.textContent()` and asserts `text.includes('Error') || text.includes('No results')` → both false → `expect(false).toBe(true)` **FAILS**.

8. **The test's own comment reveals the intended contract.** `search-panel.test.ts:147`: `"// Search may fail with error (rg not found) or show 'No results' — either is acceptable"`. The author expected: rg-present + no-match → empty results → UI shows `"No results found"` (`SearchPanel.vue:175-177`, the `v-else-if="results && !hasResults"` branch). That path is unreachable because the SR route errors before producing an empty `results` object.

9. **No unit test covers the SR exit-code-1 path or the panel error branch.** `fs-git-routes.test.ts:144-164` only tests the 422 validation branches of `POST /fs/search`; there is no test exercising `runRipgrepSearch`/`runGitGrepSearch` with a no-match query. `SearchPanel.test.ts` (full file read) has no test for the `v-else-if="error"` rendering branch — so the divergence was never caught at the unit tier.

10. **Only one search fires per `searchFor` call (no debounce/Enter race).** `sidebar-actions.ts:179-187` does `fill(query)` then `press('Enter')`. `SearchPanel.vue:55-66` `executeSearch()` clears the debounce timer before calling `searchStore.search()`, so the `watch(query)` 300ms debounce (`SearchPanel.vue:28-39`) never races the Enter-triggered search. The single search is guaranteed to complete (error or success) within the 1000ms wait.

### Evidence Chain

| # | Finding | Source | Location |
|---|---------|--------|----------|
| 1 | Test reads panel text, asserts `Error` OR `No results` substring | `tests/e2e-playwright/search-panel.test.ts` | `search-panel.test.ts:143-153` |
| 2 | `searchFor` helper: switch→fill→Enter→wait 1000ms | `tests/e2e-playwright/helpers/sidebar-actions.ts` | `sidebar-actions.ts:179-187` |
| 3 | Search store prefers StoaClient when `isStoaClientMode()` is true | `src/renderer/stores/search.ts` | `search.ts:22-32` |
| 4 | `isStoaClientMode()` returns `clientInstance !== null` | `src/renderer/stores/stoa-store-plugin.ts` | `stoa-store-plugin.ts:53-55` |
| 5 | Desktop bootstrap sets `clientInstance` via `initStoaClientForStores` | `src/renderer/bootstrap-electron.ts` | `bootstrap-electron.ts:30-51` |
| 6 | `main.ts` invokes `bootstrapDesktopRenderer()` when `window.stoaElectron` present | `src/renderer/main.ts` | `main.ts:10-17` |
| 7 | Preload exposes `window.stoaElectron` (not `window.stoa`) | `src/preload/index.ts` | `index.ts:21-87` |
| 8 | SR `POST /fs/search` route → `searchContent(body)` | `stoa-server/src/routes/fs.ts` | `fs.ts:500-520` |
| 9 | SR `runRipgrepSearch` uses `execFileAsync('rg', …)` — rejects on exit code 1 | `stoa-server/src/routes/fs.ts` | `fs.ts:117-149` |
| 10 | SR `runGitGrepSearch` uses `execFileAsync('git', …)` — same defect | `stoa-server/src/routes/fs.ts` | `fs.ts:210-229` |
| 11 | SR `searchContent` fallback regex misses exit-code-1 message | `stoa-server/src/routes/fs.ts` | `fs.ts:267-279` |
| 12 | SR route catch wraps as `internal_error` / 500 | `stoa-server/src/routes/fs.ts` | `fs.ts:513-519` |
| 13 | Global error handler serialises `AppError` → `{ok:false,error:{…}}` | `stoa-server/src/middleware/error-handler.ts` | `error-handler.ts:16-27` |
| 14 | StoaClient throws `StoaClientError(code, message)` on `!json.ok` | `src/renderer/lib/stoa-client.ts` | `stoa-client.ts:96-125` |
| 15 | Search store sets `error.value = e.message` | `src/renderer/stores/search.ts` | `search.ts:54-67` |
| 16 | SearchPanel renders `{{ error }}` in `v-else-if="error"` branch | `src/renderer/components/right-sidebar/search/SearchPanel.vue` | `SearchPanel.vue:167-177` |
| 17 | "No results found" only shows when `results && !hasResults` (unreachable here) | `src/renderer/components/right-sidebar/search/SearchPanel.vue` | `SearchPanel.vue:175-177` |
| 18 | IPC handler `spawnCommand` always resolves, checks `result.code === 1` | `src/main/sidebar-fs-handlers.ts` | `sidebar-fs-handlers.ts:145-168, 274-280, 348-354` |
| 19 | IPC `fsSearch` handler is dead code in current Electron path | `src/main/sidebar-fs-handlers.ts` | `sidebar-fs-handlers.ts:553-559` |
| 20 | SR search route has only 422 validation tests, no exit-code test | `stoa-server/src/routes/fs-git-routes.test.ts` | `fs-git-routes.test.ts:144-164` |
| 21 | SearchPanel unit test has no `error`-branch coverage | `src/renderer/components/right-sidebar/search/SearchPanel.test.ts` | full file (no `error`/`No results` tests) |

### Boundary Determination

The task asked to decide between two candidate boundaries. **Neither is correct;** the actual boundary is a third one:

- ❌ **"Helper no longer triggers backend error"** — False. The helper (`searchFor`) triggers a search that the backend (`fs.ts`) turns into a 500 error. The backend IS erroring.
- ❌ **"UI not displaying SR error"** — False. `SearchPanel.vue:171-173` renders `{{ error }}`; the error message IS displayed in the panel. The UI surface works.
- ✅ **Actual boundary — SR route exit-code-1 divergence + substring mismatch:** The SR route `fs.ts` rejects on `rg`/`git grep` exit code 1 instead of returning empty results (diverging from `sidebar-fs-handlers.ts`, which the test was authored against). The resulting 500 error message `"Filesystem search failed: Command failed: rg …"` is faithfully shown by the UI, but contains neither `"Error"` nor `"No results"`, so `search-panel.test.ts:150-152` fails. The regression was surfaced when the Electron desktop renderer migrated onto the StoaClient path (`bootstrap-electron.ts:33`), making the IPC handler's correct exit-code-1 handling unreachable.

### Recommended Fix Direction (for the implementer — not applied here)

1. **Primary — fix the SR route to match IPC semantics.** In `fs.ts` `runRipgrepSearch`/`runGitGrepSearch`, treat exit code 1 as "no matches" (return `{ files: [], totalMatches: 0, truncated: false }`), mirroring `sidebar-fs-handlers.ts:274-280, 348-354`. Either switch `execFileAsync` to a spawn-based wrapper that resolves with `{code, stdout, stderr}`, or catch the exec error and inspect `error.code === 1` (and only re-throw on other codes). With this fix, a no-match query returns 200 + empty results → UI shows `"No results found"` → the test's `hasNoResults` branch passes.
2. **Secondary — add unit coverage.** Extend `fs-git-routes.test.ts:144` `POST /fs/search` describe block with a test that mocks `execFile` to exit code 1 and asserts a 200 + empty `SearchResult` envelope. Add a `SearchPanel.test.ts` case that sets `searchStore.error` and asserts `wrapper.text()` contains the message (covers the `v-else-if="error"` branch).
3. **Do not weaken the test assertion alone** — changing the substring to `text.includes('failed')` would make the test green but hides the SR route bug (no-match queries would still 500 for any other caller, e.g. web mode).

### Risks / Unknowns

- [!] **Confirmation requires a live run**, which this research was instructed NOT to perform. The analysis is based on static reading of `execFile`/`spawn` semantics and the SR vs IPC code divergence. A live run capturing the actual HTTP response body and the rendered panel text would confirm the exact error string (e.g. whether `rg`'s exit-code-1 rejection message includes the stdout JSON summary lines).
- [!] **rg availability in the test environment is unknown** to this research pass. If `rg` IS installed, the chain is `rg exits 1 → execFileAsync rejects → searchContent re-throws (no regex match) → 500`. If `rg` is NOT installed, the chain is `rg ENOENT → git grep exits 1 → execFileAsync rejects → searchContent re-throws → 500`. Both terminate in a 500 whose message lacks `"Error"`/`"No results"`, so the test fails either way; only the middle of the chain differs.
- [?] **Whether `searching` stays `true` long enough** to matter: the `search()` `finally` block (`search.ts:63-67`) always sets `searching = false` for the in-flight search, so the panel cannot get stuck on `"Searching…"`. Not the failure mode.
- [?] **Concurrent debounce**: ruled out — `executeSearch()` clears the debounce timer (`SearchPanel.vue:57`), so Enter triggers exactly one search.

---

## Context Handoff: Electron Playwright search-panel.test.ts:143 failure

Start here: `research/2026-06-14-electron-playwright-search-panel-error-test-failure-context.md`

Context only. Use the saved report as the source of truth.
