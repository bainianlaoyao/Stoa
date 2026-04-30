---
date: 2026-04-29
topic: evolver host-bridge recall non-zero exits
status: completed
mode: context-gathering
sources: 10
---

## Context Report: Evolver host-bridge recall non-zero exits

### Why This Was Gathered
User reported that the earlier Stoa-side change only suppressed the visible `Recall failed / command failed` symptom and did not fix the underlying cause. This report identifies which concrete conditions actually make `host-bridge recall` exit non-zero.

### Summary
`host-bridge recall` itself is tolerant of missing or malformed Evolver memory assets. In local reproduction, corrupt `genes.json`, `capsules.json`, `memory_graph.jsonl`, and even directory/file-shape mismatches still returned exit code `0` and `null`. The real non-zero-exit cases split into two buckets: structured host-bridge failures that still emit JSON, and earlier CLI boot failures that never reach the host-bridge JSON wrapper and therefore surface in Stoa as `JsonCommandError("Command failed: ...")`.

### Key Findings
- Stoa only throws `Command failed` when the child process exits non-zero and stdout is not parseable JSON. If stdout contains JSON, even on exit code `2`, Stoa does not throw at the process layer. Source: [src/core/memory/command-runner.ts](/D:/Data/DEV/ultra_simple_panel/src/core/memory/command-runner.ts:69), [src/core/memory/command-runner.ts](/D:/Data/DEV/ultra_simple_panel/src/core/memory/command-runner.ts:80), [src/core/memory/command-runner.ts](/D:/Data/DEV/ultra_simple_panel/src/core/memory/command-runner.ts:99), [src/core/memory/command-runner.ts](/D:/Data/DEV/ultra_simple_panel/src/core/memory/command-runner.ts:113)
- Stoa always invokes the bundled Evolver CLI as `process.execPath <repo>/index.js host-bridge recall --request-file=... --json`, and it writes the request JSON before spawning. Source: [src/core/memory/bundled-evolver.ts](/D:/Data/DEV/ultra_simple_panel/src/core/memory/bundled-evolver.ts:44), [src/core/memory/bundled-evolver.ts](/D:/Data/DEV/ultra_simple_panel/src/core/memory/bundled-evolver.ts:93), [src/core/memory/evolver-client.ts](/D:/Data/DEV/ultra_simple_panel/src/core/memory/evolver-client.ts:304), [src/core/memory/evolver-client.ts](/D:/Data/DEV/ultra_simple_panel/src/core/memory/evolver-client.ts:314), [src/core/memory/evolver-client.ts](/D:/Data/DEV/ultra_simple_panel/src/core/memory/evolver-client.ts:350)
- The upstream Evolver CLI has a dedicated `host-bridge` branch that emits JSON `{ ok: false, error }` on caught exceptions and exits `2`. Missing `action` or `--request-file` exits `1` with usage text on stderr. Source: [research/upstreams/evolver/index.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/index.js:635), [research/upstreams/evolver/index.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/index.js:640), [research/upstreams/evolver/index.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/index.js:647), [research/upstreams/evolver/index.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/index.js:661)
- `handleRecall()` is shallow: it calls `ensureAssetFiles()`, reads task text, loads genes/capsules, asks `getMemoryAdvice()`, reads recent graph events, and returns `null` when nothing is recalled. “No memory found” is not an error path. Source: [research/upstreams/evolver/src/stoa/hostBridge.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/hostBridge.js:537), [research/upstreams/evolver/src/stoa/hostBridge.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/hostBridge.js:547), [research/upstreams/evolver/src/stoa/hostBridge.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/hostBridge.js:554), [research/upstreams/evolver/src/stoa/hostBridge.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/hostBridge.js:559), [research/upstreams/evolver/src/stoa/hostBridge.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/hostBridge.js:1025)
- Asset reads are intentionally forgiving: `readJsonIfExists()` catches parse/read errors and returns fallback data, and `ensureAssetFiles()` logs create failures but continues. Source: [research/upstreams/evolver/src/gep/assetStore.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/gep/assetStore.js:80), [research/upstreams/evolver/src/gep/assetStore.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/gep/assetStore.js:87), [research/upstreams/evolver/src/gep/assetStore.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/gep/assetStore.js:416), [research/upstreams/evolver/src/gep/assetStore.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/gep/assetStore.js:433)
- The asset-store lock timeout is not on the recall path. `withFileLock()` is used by write/update APIs, but recall only reads via `loadGenes()`, `loadCapsules()`, and graph readers. Source: [research/upstreams/evolver/src/gep/assetStore.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/gep/assetStore.js:63), [research/upstreams/evolver/src/gep/assetStore.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/gep/assetStore.js:71), [research/upstreams/evolver/src/stoa/hostBridge.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/hostBridge.js:541)
- The biggest root-cause risk is earlier than the host-bridge branch: `index.js` eagerly requires `./src/evolve` and `./src/gep/solidify` at module load time, before it checks `command === 'host-bridge'`. If either top-level require fails, the process exits before the host-bridge JSON wrapper runs. Source: [research/upstreams/evolver/index.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/index.js:1), [research/upstreams/evolver/index.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/index.js:8), [research/upstreams/evolver/index.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/index.js:12), [research/upstreams/evolver/index.js](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/index.js:635)
- Stoa logs recall failures from the `UserPromptSubmit` hook path when `evolverBridge.recall()` throws. Source: [src/main/session-event-bridge.ts](/D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:404), [src/main/session-event-bridge.ts](/D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:426)

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Stoa throws `Command failed` only when non-zero exit has non-JSON stdout | `src/core/memory/command-runner.ts` | 69-80 |
| Stoa treats valid JSON stdout as parseable even on error exit | `src/core/memory/command-runner.ts` | 69-76, 99-113 |
| Stoa launches `<node> <repo>/index.js host-bridge ... --json` | `src/core/memory/bundled-evolver.ts` | 93-96 |
| Stoa writes request file before spawn | `src/core/memory/evolver-client.ts` | 304-321 |
| Host-bridge env targets `<project>/.stoa/evolver/...` | `src/core/memory/evolver-client.ts` | 337-351 |
| Host-bridge missing flag path exits `1` with usage | `research/upstreams/evolver/index.js` | 635-642 |
| Host-bridge caught exceptions emit JSON and exit `2` | `research/upstreams/evolver/index.js` | 647-661 |
| Recall returns `null` on empty task or no matches | `research/upstreams/evolver/src/stoa/hostBridge.js` | 537-560 |
| Asset store read failures fall back instead of throwing | `research/upstreams/evolver/src/gep/assetStore.js` | 80-87 |
| Asset creation failures are logged and continued | `research/upstreams/evolver/src/gep/assetStore.js` | 416-433 |

### Local Reproductions
- `host-bridge recall --json` with missing `--request-file` flag: exit `1`, stderr usage, no stdout JSON.
- `host-bridge recall --json` with missing request file path on disk: exit `2`, stdout JSON error.
- `host-bridge recall --json` with invalid request JSON: exit `2`, stdout JSON error.
- `host-bridge recall --json` with malformed `genes.json`, malformed `capsules.json`, malformed `memory_graph.jsonl`, `genes.json` as directory, `capsules.json` as directory, `memory_graph.jsonl` as directory, `EVOLUTION_DIR` as file, or `GEP_ASSETS_DIR` as file: exit `0`, recall result `null`, warnings only on stderr.
- Simulated top-level require failure in `./src/evolve` before the `host-bridge` branch: exit `1`, stderr stack trace, empty stdout. This exactly matches the class of failure that Stoa surfaces as `JsonCommandError("Command failed: ...")`.

### Risks / Unknowns
- The actual past user-facing failure may have been caused by a transient top-level module-load error in bundled Evolver, but this report cannot recover the original stack trace because the workspace currently has no persisted `.stoa/evolver` runtime logs for that incident.
- There may be additional pre-branch failures in Node bootstrap or dependency loading with the same symptom class as the simulated `require('./src/evolve')` failure.

### Recommended Fix Direction
- Root fix: decouple host-bridge from unrelated Evolver boot paths.
- Minimal patch: lazy-load `./src/evolve` and `./src/gep/solidify` only inside the branches that use them, instead of requiring them at the top of `index.js`.
- Better patch: introduce a dedicated lightweight host-bridge entrypoint that only imports `src/stoa/hostBridge` and its direct dependencies.

## Context Handoff: Evolver host-bridge recall non-zero exits

Start here: `research/2026-04-29-evolver-recall-exit-analysis.md`

Context only. Use the saved report as the source of truth.
