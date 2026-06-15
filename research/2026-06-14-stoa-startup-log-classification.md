---
date: 2026-06-14
topic: STOA server spawn / runtime connection startup log classification
status: completed
mode: context-gathering
sources: 18
---

## Context Report: STOA Server Spawn / Runtime Connection Startup Logs

### Why This Was Gathered

A reviewer needs to distinguish **expected informational** startup logs from
**bug-symptom** logs in the Stoa Server (SR) spawn + runtime-client connection
flow, and to flag any **suspicious formatting or duplication** issues worth
fixing in the logging code itself. Focus tags: `[stoa-server-spawner]`, `[main]`,
`[stoa-runtime-client]`, `[sr:stdout]` / `[sr:stderr]`.

### Summary

The happy-path startup produces 7 distinct log lines from 3 modules, all
informational. The one genuine code defect in the logging layer is a
**multiline-prefix bug**: the `[sr:stdout]` / `[sr:stderr]` forwarder prepends
its tag to a raw stdout *chunk*, so when the SR child emits several startup
lines in one buffer, only the first line is tagged and the rest appear as bare
unattributed lines. The forwarder is also **duplicated verbatim** in both
`spawn()` and `restart()`. The existing spawner test does not catch either
issue because it only asserts `stringContaining`.

---

### Key Findings

#### A. The canonical happy-path log sequence (all expected / informational)

Emitted during a healthy boot, in this causal order (asynchronous `[sr:stdout]`
lines may interleave with the `[main]` lines because child stdout is piped):

| # | Log line | Source | Expected? |
|---|----------|--------|-----------|
| 1 | `[stoa-server-spawner] Spawning SR from <entry> on port <p>` | `src/main/stoa-server-spawner.ts:189` | ✅ info |
| 2 | `[main] Stoa Server spawned on port <p>` | `src/main/index.ts:1613` | ✅ info |
| 3 | `[sr:stdout] Persistence: SQLite (<DB_PATH>)` | `stoa-server/src/index.ts:79` | ✅ info |
| 4 | `Meta-sessions: SQLite-backed` *(bare — see Finding B)* | `stoa-server/src/index.ts:140` | ✅ info (but untagged) |
| 5 | `Stoa Server listening on port <p>` *(bare)* | `stoa-server/src/index.ts:257` | ✅ info (but untagged) |
| 6 | `Web client: enabled (serving from stoa-server/dist/web/)` *(bare)* | `stoa-server/src/index.ts:259` | ✅ info (but untagged) |
| 7 | `[stoa-server-spawner] SR health check passed on port <p>` | `src/main/stoa-server-spawner.ts:225` | ✅ info |
| 8 | `[stoa-runtime-client] Connected to ws://127.0.0.1:<p>` | `src/main/stoa-runtime-client.ts:179` | ✅ info |
| 9 | `[stoa-server-spawner] Runtime client connected` | `src/main/stoa-server-spawner.ts:252` | ✅ info |
| 10 | `[main] Stoa Server fully initialized` | `src/main/index.ts:1616` | ✅ info |

Notes on the ordering:
- SR is always forked with `['--port', p, '--web']` (`stoa-server-spawner.ts:191`,
  `:366`), so the `Web client: enabled` branch (`stoa-server/src/index.ts:258-259`)
  is the one taken — lines 261/263 are dead on this path.
- `[main] Stoa Server spawned on port` (line 2) logs **immediately after
  `spawn()` returns** (`index.ts:1611-1613`), i.e. *before* SR has actually
  announced it is listening. Because child stdout arrives asynchronously, the
  `[main] Stoa Server spawned` line can appear **before** the `[sr:stdout]
  Stoa Server listening` line. This is a cosmetic ordering quirk of async pipe
  forwarding, **not** a bug.

#### B. THE bug: `[sr:stdout]` / `[sr:stderr]` forwarder only tags the first line of each chunk ★★★

```ts
// src/main/stoa-server-spawner.ts:197-199  (and duplicated 372-374)
this.process.stdout?.on('data', (data: Buffer) => {
  process.stdout.write(`[sr:stdout] ${data}`)
})
```

`data` is a raw `Buffer`; `${data}` implicitly coerces it via
`Buffer.toString()` ('utf8'). The tag `[sr:stdout] ` is prepended **once per
emitted chunk**, not once per line. At startup the SR child emits its 4
bootstrap lines (`Persistence`, `Meta-sessions`, `listening`, `Web client`)
in rapid succession, which Node typically delivers as a single `'data'`
buffer. The rendered console output is therefore:

```
[sr:stdout] Persistence: SQLite (/home/.stoa/server.db)
Meta-sessions: SQLite-backed
Stoa Server listening on port 3270
Web client: enabled (serving from stoa-server/dist/web/)
```

Only the first line is tagged; lines 2–4 are bare. Two secondary effects:

1. **Missing-trailing-newline glue** — if a chunk does not end in `\n`, the
   next chunk's `[sr:stdout]` tag glues onto the tail of the previous line:
   `[sr:stdout] Stoa Server listening on port 3270[sr:stdout] Web client:...`
2. **Same bug on stderr** (`spawner.ts:200-202` and `:375-377`), so SR
   warnings like `SQLite backend failed, falling back to JSON files:`
   (`stoa-server/src/index.ts:81`) lose their tag on every line after the
   first.

A correct forwarder would split the decoded chunk on `\n` and tag each line,
or line-buffer the stream.

#### C. Verbatim duplication of the stdio-forwarding + exit-handler blocks ★★

The stdout/stderr forwarding block is byte-identical in `spawn()`
(`stoa-server-spawner.ts:197-202`) and `restart()` (`:372-377`). The `exit`
handler is also near-duplicated (`:204-210` vs `:379-385`), differing only in
the log text (`SR exited` vs `SR exited after restart`). Both should be
extracted into a private `attachProcessIO(proc)` / `attachProcessExit(proc)`
helper. Any fix to Finding B must be applied in **two** places today, which
is exactly the kind of duplication that lets a fix land in only one path.

#### D. The existing test does not catch Finding B/C ★

`src/main/stoa-server-spawner.test.ts:416-440` ("forwards stdout and stderr
from child process") emits a single `'data'` event with `Buffer.from('hello-out')`
and asserts:
```ts
expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('hello-out'))
```
`stringContaining` only checks that the substring exists in *some* write call;
it does **not** verify every line is prefixed, and the test payload has no
newline, so it cannot observe the multiline mis-tag. A regression test for
Finding B would emit a multi-line buffer (`'line1\nline2\nline3'`) and assert
each line carries the `[sr:stdout]` prefix.

#### E. Bug-symptom logs (appear only when something is wrong)

These are NOT expected on a healthy boot; seeing them indicates a real fault:

| Log line | Source | Symptom of |
|----------|--------|------------|
| `[sr:stderr] SQLite backend failed, falling back to JSON files: ...` (only first line tagged — see B) | `stoa-server/src/index.ts:81` | `better-sqlite3` load failure (ABI mismatch — see `research/2026-06-14-e2e-hang-diagnosis-context.md` R2) |
| `[sr:stderr] Cannot start: meta-session services require SQLite...` then SR `process.exit(1)` | `stoa-server/src/index.ts:147-148` | Fatal — SR will crash immediately |
| `[sr:stderr] Failed to start Stoa Server: ...` then SR `process.exit(1)` | `stoa-server/src/index.ts:291-293` | Fatal boot error |
| `[stoa-server-spawner] SR exited (code=1, signal=null)` | `src/main/stoa-server-spawner.ts:205` | Child crashed; triggers `handleCrash` |
| `[stoa-server-spawner] SR crashed, restarting in 2000ms...` | `src/main/stoa-server-spawner.ts:350` | Crash-restart engaged |
| `[stoa-server-spawner] SR crashed again after restart, giving up` | `src/main/stoa-server-spawner.ts:342` | Second crash; SR is now permanently down |
| `[stoa-server-spawner] SR did not exit gracefully, sending SIGKILL` | `src/main/stoa-server-spawner.ts:295` | Shutdown path — SR ignored SIGTERM (Windows SIGTERM caveat, see e2e-hang R5) |
| `[stoa-runtime-client] Disconnected (code=..., reason=...)` | `src/main/stoa-runtime-client.ts:191` | WS dropped; triggers reconnect |
| `[stoa-runtime-client] Reconnecting in <n>ms (attempt <n>)` | `src/main/stoa-runtime-client.ts:450` | Reconnect backoff active |
| `[stoa-runtime-client] WebSocket error: ...` | `src/main/stoa-runtime-client.ts:207` | Transport error |
| `[main] Failed to read Stoa Server settings for runtime launch: ...` | `src/main/index.ts:1050` | `fetchStoaServerSettings` rejected (non-fatal, falls back to defaults) |
| `[main] Failed during startup: ...` then `app.exit(1)` | `src/main/index.ts:2041-2042` | Any unhandled error in `app.whenReady()` |

Also note the SR graceful-shutdown logs (expected during *quit*, not startup,
but same prefix bug applies): `[sr:stdout] Received SIGTERM, shutting down
gracefully...` (`stoa-server/src/index.ts:270`), `Stoa Server stopped.`
(`:272`), `[sr:stderr] Forced shutdown after timeout.` (`:278`).

#### F. Minor verbosity — not a bug

`[stoa-server-spawner] Runtime client connected` (`spawner.ts:252`) is logged
inside `connectRuntime()`, immediately followed by `[main] Stoa Server fully
initialized` (`index.ts:1616`). The pair is slightly redundant but lives at
different layers (spawner lifecycle vs main orchestration); not worth
"fixing."

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `[stoa-server-spawner] Spawning SR...` | `src/main/stoa-server-spawner.ts` | `:189` |
| stdout forwarder (spawn) — prefix-once-per-chunk bug | `src/main/stoa-server-spawner.ts` | `:197-199` |
| stderr forwarder (spawn) — same bug | `src/main/stoa-server-spawner.ts` | `:200-202` |
| exit handler (spawn) | `src/main/stoa-server-spawner.ts` | `:204-210` |
| `SR health check passed` | `src/main/stoa-server-spawner.ts` | `:225` |
| `Runtime client connected` | `src/main/stoa-server-spawner.ts` | `:252` |
| SIGKILL warning | `src/main/stoa-server-spawner.ts` | `:295` |
| `crashed again ... giving up` | `src/main/stoa-server-spawner.ts` | `:342` |
| `SR crashed, restarting...` | `src/main/stoa-server-spawner.ts` | `:350` |
| `Restarting SR...` | `src/main/stoa-server-spawner.ts` | `:359` |
| stdout/stderr forwarder (restart) — **duplicated** from spawn | `src/main/stoa-server-spawner.ts` | `:372-377` |
| exit handler (restart) — near-duplicated | `src/main/stoa-server-spawner.ts` | `:379-385` |
| `SR restarted successfully` | `src/main/stoa-server-spawner.ts` | `:389` |
| `Connected to ws://...` | `src/main/stoa-runtime-client.ts` | `:179` |
| `Disconnected (code=, reason=)` | `src/main/stoa-runtime-client.ts` | `:191` |
| `WebSocket error:` | `src/main/stoa-runtime-client.ts` | `:207` |
| `Reconnecting in ... (attempt ...)` | `src/main/stoa-runtime-client.ts` | `:450` |
| `[main] Stoa Server spawned on port` | `src/main/index.ts` | `:1613` |
| `[main] Stoa Server fully initialized` | `src/main/index.ts` | `:1616` |
| `[main] Failed to read Stoa Server settings` | `src/main/index.ts` | `:1050` |
| `[main] Failed during startup` | `src/main/index.ts` | `:2041` |
| SR `Persistence: SQLite` | `stoa-server/src/index.ts` | `:79` |
| SR `SQLite backend failed` (warn) | `stoa-server/src/index.ts` | `:81` |
| SR `Meta-sessions: SQLite-backed` | `stoa-server/src/index.ts` | `:140` |
| SR `Cannot start: meta-session services require SQLite` (fatal) | `stoa-server/src/index.ts` | `:147-148` |
| SR `Stoa Server listening on port` | `stoa-server/src/index.ts` | `:257` |
| SR `Web client: enabled` (the branch taken, `--web` always passed) | `stoa-server/src/index.ts` | `:259` |
| SR `Received <signal>, shutting down` (shutdown, not startup) | `stoa-server/src/index.ts` | `:270` |
| SR `Failed to start Stoa Server` (fatal) | `stoa-server/src/index.ts` | `:291-293` |
| Test only asserts `stringContaining` (does not catch prefix bug) | `src/main/stoa-server-spawner.test.ts` | `:416-440` |
| Cross-ref: prior R2 SQLite ABI / R5 SIGTERM-R5 orphan diagnosis | `research/2026-06-14-e2e-hang-diagnosis-context.md` | `:177-196` |

### Risks / Unknowns

- [!] **Finding B is the actionable defect.** Any grep/filter that relies on
  every SR stdout line carrying `[sr:stdout]` (e.g. triaging `[sr:stdout]`
  vs unattributed lines in a captured log) will mis-classify lines 2..N of
  each startup burst as belonging to the main process.
- [!] **Finding C means a half-fix is likely.** If someone fixes only the
  `spawn()` path, the `restart()` path stays broken silently.
- [?] The exact chunking of SR's stdout at boot is runtime-dependent (depends
  on libuv flush boundaries). In practice Node coalesces the 4 rapid
  `console.log` calls into one or two `'data'` buffers, so the bug is
  reliably visible; but a test should emit an explicit multi-line buffer
  rather than rely on coalescing.
- [?] Whether anyone downstream (observability, log shippers) parses these
  tags line-by-line was not investigated — if they do, Finding B is higher
  severity than cosmetic.

### Suggested fix shape (for the implementing agent, not done here)

Extract a shared helper on `StoaServerSpawner`:
```ts
private attachStdio(proc: ChildProcess): void {
  const forward = (stream: NodeJS.WriteStream, tag: string, buf: Buffer): void => {
    const text = buf.toString('utf8')
    for (const line of text.split('\n')) {
      if (line.length > 0) stream.write(`${tag} ${line}\n`)
    }
  }
  proc.stdout?.on('data', (d: Buffer) => forward(process.stdout, '[sr:stdout]', d))
  proc.stderr?.on('data', (d: Buffer) => forward(process.stderr, '[sr:stderr]', d))
}
```
Call it from both `spawn()` and `restart()` (replacing `:197-202` and
`:372-377`), and add a multi-line regression assertion to
`stoa-server-spawner.test.ts`. (Splitting on `\n` and re-emitting with
trailing `\n` also resolves the missing-newline glue in Finding B.2.)

---

## Context Handoff: STOA Startup Log Classification

Start here: `D:\Data\DEV\ultra_simple_panel\research\2026-06-14-stoa-startup-log-classification.md`

Context only. Use the saved report as the source of truth.
- **One real defect:** `[sr:stdout]`/`[sr:stderr]` forwarder tags only the
  first line of each stdout chunk (`src/main/stoa-server-spawner.ts:197-202`,
  duplicated at `:372-377`); test at `:416-440` does not catch it.
- **Everything else on a healthy boot is informational** (full sequence in
  Finding A, table). Bug-symptom logs enumerated in Finding E.
