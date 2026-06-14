# Context Report — File Explorer "expand src shows root entries" E2E Failure

**Date:** 2026-06-14
**Depth:** depth=2, max_depth=2 (leaf — no further sub-agents dispatched; research done in this run)
**Scope:** Read-only context gathering. No files were edited.
**Question:** Why does expanding `src` in `tests/e2e-playwright/file-explorer.test.ts` still render root entries instead of child entries (`components`, `index.ts`, `utils.ts`)?

---

## TL;DR

The expand path is **fire-and-forget async**, and the Playwright helper reads the DOM **before the directory load resolves**. The composable's own unit test proves this is the contract: after `toggleExpand(...)` it always `await vi.waitFor(() => flatRows.value.length === 2)`. The E2E helper `expandFolder` does the opposite — it clicks and returns with **zero wait**, so `flatRows` is still in its pre-load state (root entries only) when the assertions run.

This is a **deterministic** (not flaky) failure: `src` is never pre-cached in a fresh project, so every expand requires a real HTTP roundtrip that always loses the race against the immediately-following read.

Secondary, **separately-breaking** Windows path-separator assumptions exist in the create/rename/delete/drag flows (already `test.skip`'d in the spec), and a casing-sensitive `startsWith` in `toRelative` is a latent Windows risk. Neither is the expand blocker, but both belong to the broader "file explorer failures" surface.

---

## The exact failing data flow (with citations)

Running in the real Electron app, the renderer is in **Stoa Client mode** — `bootstrap-electron.ts:33` calls `initStoaClientForStores(baseUrl, token)`, so `isStoaClientMode()` is `true` and `loadDir` takes the HTTP branch (`useFileTree.ts:54-64`), not the IPC branch.

1. **Test clicks the `src` row.**
   `tests/e2e-playwright/file-explorer.test.ts:53` → `expandFolder(app.page, 'src')` (`tests/e2e-playwright/helpers/sidebar-actions.ts:47-59`). The helper finds the row by `textContent === 'src'` and calls `await rows.nth(i).click()` then **returns immediately** (no wait, no poll).

2. **Click handler calls `toggleExpand` with the absolute path.**
   `FileExplorer.vue:546` `@click="handleRowClick(row.node)"` → `FileExplorer.vue:65-78`. For a directory it calls `toggleExpand(projectPath.value, node.path)` where `node.path` is the DirEntry `path` — a **backslash absolute** path on Windows (built via `path.join` in `stoa-server/src/routes/fs.ts:293`,399 `entryPath = path.join(fullPath, entry.name)`).

3. **`toggleExpand` updates state synchronously and fires the load with `void`.**
   `useFileTree.ts:88-101`:
   - Adds the absolute path to `expandedDirs` (a fresh `Set`, reassigned to `.value` → reactive, `useFileTree.ts:100`).
   - Calls `void loadDir(projectPath, dirPath)` — **fire-and-forget** (`useFileTree.ts:97`).

4. **`loadDir` is async; the cache is empty until it resolves.**
   `useFileTree.ts:37-86`:
   - `relativePath = toRelative(dirPath, projectPath)` → `'src'` (`useFileTree.ts:25-31, 51`). This part is correct on Windows.
   - `await client.get('/api/v1/fs/dir?projectPath=…&path=src')` (`useFileTree.ts:57-61`). The server returns the envelope `{ok,data,meta}`; `entries = response.data ?? []` correctly unwraps it (`useFileTree.ts:60-61`; server envelope at `fs.ts:42-51`, listDirectory at `fs.ts:281-314`).
   - Only **after** the await resolves does it write `dirCache.value = { …[key]: { children, loading:false } }` (`useFileTree.ts:81`), which triggers `flatRows` to recompute.

5. **`flatRows` recomputes synchronously on the `expandedDirs` change — before the await resolves.**
   `useFileTree.ts:125-147`: the recursion `addChildren(child.path)` looks up `cache[child.path]`. At click time `src` is in `expandedDirs` but `cache['…\\src']` is **still undefined/loading**, so `addChildren` returns early (`useFileTree.ts:134-135`) and `flatRows` yields **only the root entries**.

6. **Test reads the DOM in that window.**
   `file-explorer.test.ts:55` → `getVisibleExplorerEntryNames` (`sidebar-actions.ts:153-162`) snapshots `rows.count()` + `textContent` with no auto-wait. Result: only root entries. `expect(names).toContain('components')` fails.

The same gap breaks the other expansion assertions: `expands nested folders deeply` (`file-explorer.test.ts:75-83`), `collapses a folder when clicked again` (`:61-73`), and `collapse all …` (`:85-98`).

---

## Proof that "wait for the async load" is the intended contract

The composable's own unit test does exactly the wait the E2E helper omits — `src/renderer/composables/useFileTree.test.ts:116-140`:

```ts
toggleExpand('/project', '/project/src')
await vi.waitFor(() => expect(flatRows.value.length).toBe(2))   // ← wait for async load
expect(mockFsReadDir).toHaveBeenCalledWith('/project', 'src')
```

And `:95-114` ("flatRows returns empty when dirCache is not yet populated") explicitly asserts flatRows is **empty before** `fsReadDir` resolves. That is the exact state the E2E read captures.

The client-mode unwrap is also verified there (`:294-314`), ruling out an envelope-parsing cause.

---

## Why it's deterministic, not flaky

- Each `beforeEach` (`file-explorer.test.ts:18-28`) builds a **fresh** temp project (`fixtures/sidebar-test-project.ts:34-42`) and launches a **fresh** Electron process (`fixtures/electron-app.ts:110-162`). `src` has never been expanded, so its children are never in `dirCache`.
- Therefore every expand must perform a real `client.get(…)` roundtrip (localhost Stoa Server) — never instantaneous.
- `expandFolder` provides no settle/poll (`sidebar-actions.ts:47-59`), and `getVisibleExplorerEntryNames` doesn't auto-wait dynamic content (`sidebar-actions.ts:153-162`).
- The read therefore always lands in the pre-resolve window → always sees root entries only.

---

## Primary root cause

**Async timing gap between `toggleExpand` and the DOM read.** `toggleExpand` schedules `loadDir` with `void` (`useFileTree.ts:97`) and updates `expandedDirs` synchronously, but the children only materialize in `flatRows` after the awaited fetch resolves (`useFileTree.ts:60-61, 81`). The Playwright helper asserts before that happens.

(Not the cause: client-vs-IPC routing — both paths share the same gap; envelope unwrapping — verified correct by unit test; path-keying logic — self-consistent because the expand key and `child.path` both originate from `DirEntry.path`.)

---

## Secondary findings (other "file explorer failures", not the expand blocker)

These are real latent Windows bugs, surfaced by the spec's own `test.skip` notes and present in the focus files / directly-coupled component:

| Location | Issue | Evidence |
|---|---|---|
| `useFileTree.ts:26` `toRelative` | `dirPath.startsWith(projectPath)` is **case-sensitive**. A Windows drive-letter/path-casing difference between `activeProject.path` and the `path.join`-normalised `DirEntry.path` makes `toRelative` return `undefined`, which causes `loadDir` to re-fetch the **root** and cache root entries under the `src` key — yielding the literal symptom "root entries under src". Unverified by tests (unit tests only use `/project/…`). | `useFileTree.ts:25-31, 51-67`; contrast unit tests at `useFileTree.test.ts:117-140` using consistent forward-slash paths |
| `useFileOperations.ts:72` `startRename` | `parentPath = existingPath.slice(0, existingPath.lastIndexOf('/'))`. On Windows the path uses `\`, so `lastIndexOf('/')` is `-1` → `parentPath` becomes the whole path. | flagged in spec `file-explorer.test.ts:100-101, 144, 173` |
| `useFileOperations.ts:96,100` `commitInput` | `oldRel.lastIndexOf('/')`, `parentPath.slice(projectPath.length + 1)` assume `/`. | `useFileOperations.ts:94-101` |
| `FileExplorer.vue:159-161,180,329-345` | Parent-path extraction via `node.path.includes('/')` / `lastIndexOf('/')`; on Windows backslash paths these are false/-1. | `FileExplorer.vue:159-163, 180, 329-345` |
| `useFileTree.ts:18-19` | `dirCache`/`expandedDirs` are **module-level** refs shared across all `useFileTree` callers. Reactivity is handled correctly (new Set / spread reassign), but cross-project leakage is possible if a second project is opened in one process without `refreshTree`. Not triggered by the current single-project E2E setup. | `useFileTree.ts:18-19, 88-101` |

---

## Evidence index

- Failing spec + helpers: `tests/e2e-playwright/file-explorer.test.ts:51-98`, `tests/e2e-playwright/helpers/sidebar-actions.ts:47-59,153-162`
- Composable (the async gap): `src/renderer/composables/useFileTree.ts:37-101, 125-147`
- Composable contract proof (wait-after-toggle): `src/renderer/composables/useFileTree.test.ts:95-140, 264-292`
- Component click wiring: `src/renderer/components/right-sidebar/explorer/FileExplorer.vue:65-78, 546, 561`
- Client mode is active in Electron (HTTP path used): `src/renderer/bootstrap-electron.ts:30-53`; mode check `src/renderer/stores/stoa-store-plugin.ts:53-55`; HTTP branch `useFileTree.ts:54-64`
- Server dir listing + envelope: `stoa-server/src/routes/fs.ts:42-51, 281-314, 324-344` (route tests only cover 422 branches at `fs-git-routes.test.ts:48-164`)
- IPC path (not used in this E2E, but same gap): `src/main/sidebar-fs-handlers.ts:392-419, 491-499`
- Latent Windows bugs: `src/renderer/composables/useFileOperations.ts:62-78, 94-108`; `src/renderer/components/right-sidebar/explorer/FileExplorer.vue:159-163, 180, 329-345`
- Fixture freshness (determinism): `tests/e2e-playwright/fixtures/electron-app.ts:110-162`, `tests/e2e-playwright/fixtures/sidebar-test-project.ts:34-42`

---

## Suggested verification steps (read-only; no edits made)

1. Confirm the gap empirically: in the spec, replace `await expandFolder(app.page, 'src')` with a follow-up `await expect(app.page.getByTestId('file-row-src/index.ts')).toBeVisible({ timeout: 5000 })` before `getVisibleExplorerEntryNames`. If that makes `expands a folder to show children` pass, the timing gap is confirmed as the sole expand blocker.
2. Cross-check against the unit test's pattern: `useFileTree.test.ts:130-139` shows `toggleExpand` must be followed by a wait for `flatRows` length growth.
3. Separately validate `toRelative` casing robustness by seeding a `projectPath` whose drive letter differs in case from `DirEntry.path` — this exercises the "root entries cached under src key" failure mode.
4. Note `expandFolder` has no return value / settle hook to extend; any fix belongs in the helper (await a row-count increase or a specific child testid), matching the unit-test convention.

---

## Context Handoff

**Saved report path:**
`D:\Data\DEV\ultra_simple_panel\research\2026-06-14-file-explorer-expand-failure-context.md`

Primary conclusion: deterministic async timing gap — `expandFolder`/`getVisibleExplorerEntryNames` read the DOM before `toggleExpand`'s fire-and-forget `loadDir` (`useFileTree.ts:97`) resolves and repopulates `flatRows`; the unit test at `useFileTree.test.ts:116-140` demonstrates the required `vi.waitFor`. Secondary: latent Windows path-separator/casing bugs in `useFileOperations.ts`, `FileExplorer.vue`, and `toRelative`.
