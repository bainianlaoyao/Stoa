# State Persistence Safety: Root Cause Analysis and Fix Design

**Date:** 2026-04-24
**Scope:** Data loss and corruption risks in the state persistence layer
**Status:** Research complete, pending implementation

---

## 1. Problem Statement

Stoa stores user data in two locations:

| File | Contents | Path |
|------|----------|------|
| `global.json` | Project list, active selections, settings | `~/.stoa/global.json` |
| `sessions.json` (per project) | Sessions belonging to a project | `<project_path>/.stoa/sessions.json` |

The persistence layer (`src/core/state-store.ts` and `src/core/project-session-manager.ts`) has six interconnected safety defects. In the worst case, a transient file lock during app startup causes permanent loss of all project data.

### Real-World Loss Scenario (Windows)

1. User has 10 projects with active sessions.
2. Antivirus (Windows Defender, etc.) places a short-lived lock on `~/.stoa/global.json` during a scan.
3. User launches stoa.
4. `ProjectSessionManager.create()` calls `readGlobalState()` at `src/core/project-session-manager.ts:148`. The file is locked. The `catch` block at `src/core/state-store.ts:66` returns `DEFAULT_GLOBAL_STATE` -- an object with `projects: []`.
5. In-memory state now has zero projects.
6. Immediately after, `sessionEventBridge.start()` calls `manager.setTerminalWebhookPort(port)` at `src/main/session-event-bridge.ts:47`.
7. `setTerminalWebhookPort` calls `persist()` at `src/core/project-session-manager.ts:230`.
8. `persist()` sees `this.state.projects.length === 0` and writes a nearly-empty `global.json` at line 369: `{ version: 3, settings: {...} }` -- no projects array at all.
9. The antivirus releases the lock. But the file has already been overwritten with empty data.
10. All 10 projects are permanently lost. The per-project `sessions.json` files still exist on disk but are orphaned because `global.json` no longer references their projects.

This is not theoretical. The sequence from `create()` to `setTerminalWebhookPort` to `persist()` happens on every app launch at `src/main/index.ts:104-116`.
---

## 2. Root Cause Analysis

### Issue C1: Read Failures Treated as No Data (CRITICAL)

**Location:** `src/core/state-store.ts`

`readGlobalState()` (lines 54-69):

```typescript
export async function readGlobalState(filePath = getGlobalStateFilePath()): Promise<PersistedGlobalStateV3> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as PersistedGlobalStateV3
    if (parsed.version !== 3 || !Array.isArray(parsed.projects)) {
      return structuredClone(DEFAULT_GLOBAL_STATE)
    }
    return parsed
  } catch {
    return structuredClone(DEFAULT_GLOBAL_STATE)  // <-- ANY error = empty state
  }
}
```

`readProjectSessions()` (lines 71-84):

```typescript
export async function readProjectSessions(projectPath: string): Promise<PersistedProjectSessions> {
  try {
    // ...read and parse...
  } catch {
    return { project_id: '', sessions: [] }  // <-- ANY error = empty sessions
  }
}
```

`readAllProjectSessions()` (lines 86-100):

```typescript
export async function readAllProjectSessions(projects: PersistedProject[]): Promise<PersistedSession[]> {
  const allSessions: PersistedSession[] = []
  for (const project of projects) {
    try {
      // ...read and parse...
    } catch {
      // silently swallowed -- sessions for this project are simply missing
    }
  }
  return allSessions
}
```

**The problem:** Every `catch` block treats all errors identically -- file not found, permission denied, file locked, corrupt JSON, disk I/O error -- all return the same empty default. There is no distinction between 'file does not exist yet' (legitimate first-run) and 'file exists but cannot be read' (transient or permanent failure).

### Issue C2: No Write Serialization (HIGH)

**Location:** `src/core/project-session-manager.ts`, `persist()` method (lines 364-397)

`persist()` is `async` and performs multiple sequential `await` operations:

```typescript
private async persist(): Promise<void> {
  if (this.persistDisabled) return
  await writeGlobalState(globalState, this.globalStatePath)          // await 1
  for (const project of persistedProjects) {
    await writeProjectSessions(project.path, data)                   // await 2..N
  }
}
```

Multiple callers can invoke `persist()` concurrently:

- A webhook event calls `applySessionEvent()` (line 233) -> `persist()` (line 248).
- While that persist is mid-flight, the user clicks a different project, triggering `setActiveProject()` (line 275) -> `persist()` (line 279).
- The second persist overwrites `global.json` with state from a snapshot taken before the first persist finishes.

There is no mutex, no queue, no serialization mechanism.

### Issue C3: readAllProjectSessions Silently Drops Failed Projects (HIGH)

**Location:** `src/core/state-store.ts:86-100`

When `readAllProjectSessions` encounters an error reading one project `sessions.json`, it skips that project. The returned array contains only sessions from successfully-read files.

During the next `persist()`, only in-memory sessions are written back. Sessions from the failed project are missing from memory, so they are not written. The `sessions.json` for that project is overwritten with an empty sessions array. All sessions for that project are lost.

### Issue M1: Non-Atomic Writes (MEDIUM)

**Location:** `src/core/state-store.ts`, all write functions (lines 102-125)

```typescript
export async function writeGlobalState(
  state: PersistedGlobalStateV3,
  filePath = getGlobalStateFilePath()
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8')  // direct overwrite
}
```

All three write functions (`writeGlobalState`, `writeProjectSessions`, `writePersistedState`) directly overwrite the target file. No write-to-temp-then-rename. Crash mid-write = truncated/corrupt file -> triggers Issue C1 on next launch.

### Issue M2: persist() Has No Error Handling (MEDIUM)

**Location:** `src/core/project-session-manager.ts:364-397`

`persist()` has no try/catch. If any `writeFile` call fails (disk full, permissions, path too long), the exception propagates up. But in-memory state was already mutated before `persist()` was called. Memory/disk state diverges.

### Issue M3: Empty Projects Branch Amplifies Data Loss (MEDIUM)

**Location:** `src/core/project-session-manager.ts:367-376`

```typescript
const globalState: PersistedGlobalStateV3 =
  this.state.projects.length === 0
    ? { ...structuredClone(DEFAULT_GLOBAL_STATE), settings: this.settings }
    : { version: 3, active_project_id: ..., projects: ..., settings: ... }
```

When `projects.length === 0`, `persist()` writes a `global.json` with only `{ version: 3, projects: [], settings: {...} }`. Combined with Issue C1, this creates a feedback loop: read failure produces empty state, persist writes empty state, file is permanently empty.
---

## 3. Previously Applied Mitigations

Three fixes were applied before this research:

1. **Removed unconditional `persist()` in `create()`:** The factory method previously called `persist()` at the end. This was removed. However, `setTerminalWebhookPort` still triggers `persist()` immediately after construction (see `src/main/index.ts:116`).

2. **`persistDisabled` flag for test instances:** `createForTest()` sets `persistDisabled = true`, preventing test instances from writing to the real filesystem. Good isolation measure but does not help production users.

3. **`createProject()` reads existing `sessions.json`:** At `src/core/project-session-manager.ts:215-222`, when adding a project that already has a `.stoa/sessions.json`, the manager loads those sessions into memory. Prevents one class of data loss but does not address the read-failure cascade.

These mitigations reduce the attack surface but do not fix any of the six root causes.
---

## 4. Proposed Solution Design

### Fix 1: Discriminated Error Handling in Read Functions (Addresses C1, C3)

Replace blanket `catch { return default }` with error-classification logic.

**Design for `readGlobalState`** (`src/core/state-store.ts:54-69`):

```typescript
export class StateReadError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown,
    public readonly filePath: string,
    public readonly isTransient: boolean
  ) {
    super(message)
    this.name = 'StateReadError'
  }
}

export async function readGlobalState(
  filePath = getGlobalStateFilePath()
): Promise<PersistedGlobalStateV3> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as PersistedGlobalStateV3
    if (parsed.version !== 3 || !Array.isArray(parsed.projects)) {
      throw new StateReadError('Invalid global state', undefined, filePath, false)
    }
    return parsed
  } catch (error) {
    if (error instanceof StateReadError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return structuredClone(DEFAULT_GLOBAL_STATE)  // first run
    }
    throw new StateReadError('Cannot read global state', error, filePath, isTransientError(code))
  }
}

function isTransientError(code: string | undefined): boolean {
  return code === 'EBUSY' || code === 'EAGAIN' || code === 'EIO'
    || code === 'EPERM' || code === 'EACCES'
}
```

Same pattern for `readProjectSessions` and `readAllProjectSessions`. For `readAllProjectSessions`, collect errors into a result object with `sessions` and `errors` arrays. ENOENT errors are silently skipped. All other errors are reported.

**Caller changes in `ProjectSessionManager.create()`** (`src/core/project-session-manager.ts:147-163`):

```typescript
static async create(options: ProjectSessionManagerOptions): Promise<ProjectSessionManager> {
  let persistedGlobal: PersistedGlobalStateV3
  try {
    persistedGlobal = await readGlobalState(options.globalStatePath)
  } catch (error) {
    if (error instanceof StateReadError && error.isTransient) {
      await new Promise(resolve => setTimeout(resolve, 200))  // retry once
      persistedGlobal = await readGlobalState(options.globalStatePath)
    }
    throw error  // crash the app rather than silently losing data
  }
  // ...rest of constructor...
}
```

The key principle: **crash rather than silently lose data**. A user who sees "stoa failed to start" will restart. A user whose projects vanish silently has a much worse experience.

### Fix 2: Write Serialization Queue (Addresses C2)

Add a promise-based mutex to serialize all `persist()` calls.

```typescript
class SimpleMutex {
  private queue: (() => void)[] = []
  private locked = false
  async acquire(): Promise<() => void> {
    return new Promise(resolve => {
      const tryAcquire = () => {
        if (!this.locked) { this.locked = true; resolve(this.release.bind(this)) }
        else { this.queue.push(tryAcquire) }
      }
      tryAcquire()
    })
  }
  private release(): void { this.locked = false; this.queue.shift()?.() }
}
```

Then wrap `persist()` to acquire the mutex before writing, ensuring only one persist runs at a time. Concurrent callers queue and execute sequentially.

### Fix 3: Atomic Writes (Addresses M1)

Use write-to-temp-then-rename for all file writes.

```typescript
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmpPath = join(dir, '.tmp-' + randomUUID())
  try {
    await writeFile(tmpPath, content, 'utf-8')
    await rename(tmpPath, filePath)
  } catch (error) {
    try { await unlink(tmpPath) } catch { /* ignore */ }
    throw error
  }
}
```

**Why `rename` works:** On both NTFS and ext4/APFS, `rename()` is atomic at the filesystem level. The old file is replaced in a single operation. If the process crashes during `writeFile` to the temp file, the original remains intact.

### Fix 4: Error Handling in persist() (Addresses M2)

Wrap `doPersist()` in try/catch. On failure, set a `persistFailed` flag and log the error. Do NOT throw -- callers should not crash due to write failures. In-memory state remains the source of truth. The app should show a warning to the user.

### Fix 5: Guard Against Empty-Projects Persist (Addresses M3)

```typescript
private previouslyHadProjects = false
private async doPersist(): Promise<void> {
  if (this.previouslyHadProjects && this.state.projects.length === 0) {
    console.error('[state] refusing to persist empty projects list')
    return
  }
  // ...normal persist logic...
  this.previouslyHadProjects = this.state.projects.length > 0
}
```

Set `previouslyHadProjects = true` in the constructor when the initial load succeeds with projects. This is a last-resort safety net that prevents the most catastrophic scenario.

### Fix 6: Startup Sequence Safety

The startup sequence in `src/main/index.ts:103-116` is the highest-risk window:
```
create() reads global.json -> setTerminalWebhookPort() -> persist()
```

With Fix 1, `create()` will throw if the file is locked. Additionally, consider decoupling the webhook port:
- **Option A:** Rely on Fix 1. Show error and retry.
- **Option B:** Stop persisting the webhook port. It is ephemeral (OS-assigned via port 0). `setTerminalWebhookPort` should just update in-memory state without triggering `persist()`.
---

## 5. Implementation Plan (Priority Order)

### Phase 1: Critical Safety Net (prevents data loss immediately)

| Step | Fix | File(s) | Effort |
|------|-----|---------|--------|
| 1.1 | Empty-projects guard (Fix 5) | `project-session-manager.ts` | Small |
| 1.2 | Atomic writes (Fix 3) | `state-store.ts` | Small |
| 1.3 | persist() try/catch (Fix 4) | `project-session-manager.ts` | Small |

These three changes can be shipped independently and immediately. No architectural changes required.

**Step 1.1 rationale:** Even without any other fix, refusing to overwrite `global.json` with an empty project list prevents the worst-case scenario.

### Phase 2: Discriminated Error Handling (prevents silent data loss)

| Step | Fix | File(s) | Effort |
|------|-----|---------|--------|
| 2.1 | `StateReadError` class | `state-store.ts` | Medium |
| 2.2 | Rewrite `readGlobalState` | `state-store.ts` | Medium |
| 2.3 | Rewrite `readProjectSessions` | `state-store.ts` | Medium |
| 2.4 | Rewrite `readAllProjectSessions` | `state-store.ts` | Medium |
| 2.5 | Update `create()` to handle new errors | `project-session-manager.ts` | Medium |
| 2.6 | Add retry logic for transient errors | `project-session-manager.ts` | Small |

### Phase 3: Concurrency Safety (prevents interleaved writes)

| Step | Fix | File(s) | Effort |
|------|-----|---------|--------|
| 3.1 | Implement `SimpleMutex` | `project-session-manager.ts` | Small |
| 3.2 | Wrap `persist()` with mutex | `project-session-manager.ts` | Small |
| 3.3 | Refactor to `persist() / doPersist()` | `project-session-manager.ts` | Small |

### Phase 4: Startup Sequence Hardening

| Step | Fix | File(s) | Effort |
|------|-----|---------|--------|
| 4.1 | Decide whether webhook port needs persistence | `session-event-bridge.ts` | Design decision |
| 4.2 | Remove persist from `setTerminalWebhookPort` (or separate file) | `project-session-manager.ts` | Small |
---

## 6. Testing Strategy

### Unit Tests

**Test file:** `tests/unit/state-store.test.ts` (new)

| Test Case | What It Verifies |
|-----------|-----------------|
| `readGlobalState` with missing file returns defaults | ENOENT is handled as first-run |
| `readGlobalState` with locked file throws `StateReadError` | EBUSY does not return defaults |
| `readGlobalState` with corrupt JSON throws `StateReadError` | Parse failure is not silent |
| `readGlobalState` with wrong version throws `StateReadError` | Version mismatch is caught |
| `readAllProjectSessions` reports partial failures | Failed projects appear in `errors` |
| `atomicWriteFile` leaves original intact on write failure | Temp file cleaned up, original unchanged |
| `atomicWriteFile` replaces original on success | Rename is verified |
| `SimpleMutex` serializes concurrent calls | Second caller waits for first |

**Test file:** `tests/unit/project-session-manager.test.ts` (extend existing)

| Test Case | What It Verifies |
|-----------|-----------------|
| `create()` retries once on transient read error | Retry logic works |
| `create()` throws on non-transient read error | Corrupt data prevents startup |
| `persist()` serializes concurrent calls | No interleaved writes |
| `persist()` skips write when projects unexpectedly empty | Guard works |
| `persist()` catches write errors and sets dirty flag | Failure is handled |
| `applySessionEvent` during active persist queues correctly | Concurrency is safe |

### Integration Tests

**Test file:** `tests/integration/persistence-safety.test.ts` (new)

| Test Case | What It Verifies |
|-----------|-----------------|
| Simulate antivirus lock during startup | App does not overwrite data |
| Kill process mid-write | File is not corrupt (atomic writes) |
| Concurrent webhook events + user actions | No data loss |
| Fill disk, trigger persist | Error is handled, in-memory state intact |

### File Lock Simulation

On Windows, file locks can be simulated by opening a file with `fs.open()` and holding the handle while attempting to read. On Linux/macOS, use `flock` or exclusive open.

The `createForTest()` factory with `persistDisabled: true` already isolates unit tests from the filesystem. New persistence layer tests should use real filesystem operations to verify atomic writes and error handling.
---

## 7. Open Design Decisions

1. **Webhook port persistence:** Does anything external read `global.json` to discover the webhook port? If not, `setTerminalWebhookPort` should not trigger `persist()`.
2. **Crash-on-read-failure policy:** Show error dialog with retry button vs. hard crash.
3. **Stale temp file cleanup:** Should the app clean up `.tmp-*` files on startup?
4. **Backup strategy:** Keep `global.json.bak` before overwriting for manual recovery.
---

## 8. Summary of Files to Change

| File | Changes |
|------|---------|
| `src/core/state-store.ts` | Add `StateReadError`, `isTransientError`, `atomicWriteFile`; rewrite all read/write functions |
| `src/core/project-session-manager.ts` | Add `SimpleMutex`, `persistFailed`, `previouslyHadProjects`; refactor `persist()`; update `create()`; add retry logic |
| `src/main/index.ts` | May need error handling around `create()` call for crash-on-failure UX |
| `src/main/session-event-bridge.ts` | Possibly decouple `setTerminalWebhookPort` from persistence |
| `src/shared/project-session.ts` | Possibly add `ReadAllSessionsResult` type |