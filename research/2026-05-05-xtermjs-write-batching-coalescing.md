---
date: 2026-05-05
topic: xterm.js write batching coalescing strategies
status: completed
mode: context-gathering
sources: 20+
---

## Context Report: xterm.js Write Batching/Coalescing for UI Thread Starvation Prevention

### Why This Was Gathered
Finding production implementations of xterm.js write throttling or coalescing that prevent UI thread starvation during heavy terminal output, for potential application to Stoa terminal integration.

### Summary
xterm.js has a built-in `WriteBuffer` class that batches writes using a time-slice approach (`WRITE_TIMEOUT_MS = 12ms`), processing chunks until a frame budget is exhausted then yielding via `setTimeout(..., 0)`. VS Code uses additional node-pty level flow control with chunking and `EAGAIN` handling. The xterm.js team has considered but not implemented FPS-based coalescing as an optional feature.

### Key Findings

1. **xterm.js WriteBuffer (built-in batching)**
   - Located at `src/common/input/WriteBuffer.ts` in xterm.js repo
   - Uses `WRITE_TIMEOUT_MS = 12` (designed to stay under 16ms frame budget)
   - `DISCARD_WATERMARK = 50MB` safety limit to prevent OOM
   - `WRITE_BUFFER_LENGTH_THRESHOLD = 50` chunks before trimming processed ones
   - Core loop in `_innerWrite()` processes chunks, breaks after `WRITE_TIMEOUT_MS`, yields with `setTimeout(..., 0)`, then continues

2. **Proposed FPS-based Coalescing (not yet implemented)**
   - Issue #5447 proposes optional `targetFps` setting with "time-windowed coalescing"
   - First data rendered immediately, subsequent data buffered until timeout or user input
   - Would target GPU-heavy scenarios (Cursor reported 100fps spinner causing 3% GPU usage)

3. **VS Code node-pty flow control**
   - VS Code issue #74620: Create node-pty host process with flow control and event batching
   - Uses write callbacks from xterm.js to implement pause/resume on node-pty side
   - PR #116373 moved terminal to separate ptyHost process with binary data transfer

4. **node-pty EAGAIN handling (recent, PR #831)**
   - PR #831 (Dec 2025) rewrote PTY write path to use raw `fs.write(fd, ...)` instead of `tty.WriteStream`
   - Handles `EAGAIN` directly with `setImmediate` for retry
   - Removed VS Code-side throttling that was causing paste slowdowns (VS Code issue #283056)
   - Previously used `chunkInput()` to split large pastes at 512-byte chunks with 5ms pacing

5. **Microtask optimization (PRs #4145, #4159)**
   - PR #4145: Reduced input latency from ~10ms to ~4ms using `queueMicrotask` for write buffer flush
   - PR #4159: Flush write buffer via microtask after user input for immediate response
   - Key insight: `queueMicrotask` bypasses intermediate buffering and can cause message congestion with websockets

6. **Flow control documentation (official xterm.js guide)**
   - xterm.js flow control uses pause/resume on the PTY to avoid overwhelming the terminal
   - Watermark-based approach: HIGH ~500KB, LOW watermark, callbacks as commit responses
   - Note: Simple pause/resume per-chunk is inefficient (too many kernel context switches)

7. **VS Code terminal process architecture**
   - Issue #283065: Removed throttle on PTY input (the 5ms pacing mechanism for macOS multiline)
   - Issue #298993: Added `_writeChunked()` for macOS to avoid 1024-byte PTY buffer corruption
   - PR #300740: Made chunking byte-aware instead of line-based for more reliable flow control

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| WriteBuffer class with WRITE_TIMEOUT_MS=12 | xterm.js GitHub | [WriteBuffer.ts](https://github.com/xtermjs/xterm.js/blob/7f598a367/src/common/input/WriteBuffer.ts#L24-L28) |
| FPS coalescing proposal | xterm.js GitHub issue | [#5447](https://github.com/xtermjs/xterm.js/issues/5447) |
| VS Code flow control architecture | VS Code GitHub issue | [#74620](https://github.com/microsoft/vscode/issues/74620) |
| node-pty EAGAIN fix, removed JS-side throttling | node-pty PR | [#831](https://github.com/microsoft/node-pty/pull/831) |
| Microtask write buffer optimization | xterm.js PRs | [#4145](https://github.com/xtermjs/xterm.js/pull/4145), [#4159](https://github.com/xtermjs/xterm.js/pull/4159) |
| Official flow control guide | xterm.js docs | [flowcontrol](http://xtermjs.org/docs/guides/flowcontrol/) |
| VS Code removed 5ms throttle | VS Code issue | [#283065](https://github.com/microsoft/vscode/issues/283065) |
| macOS PTY chunking workaround | VS Code issue | [#298993](https://github.com/microsoft/vscode/issues/298993) |

### Code Examples

**xterm.js WriteBuffer core batching loop:**
```typescript
protected _innerWrite(): void {
  const startTime = Date.now();
  while (this._writeBuffer.length > this._bufferOffset) {
    const data = this._writeBuffer[this._bufferOffset];
    const cb = this._callbacks[this._bufferOffset];
    this._bufferOffset++;
    this._action(data);
    this._pendingData -= data.length;
    if (cb) cb();
    if (Date.now() - startTime >= WRITE_TIMEOUT_MS) {
      break;  // Yield after 12ms to let renderer catch up
    }
  }
  if (this._writeBuffer.length > this._bufferOffset) {
    if (this._bufferOffset > WRITE_BUFFER_LENGTH_THRESHOLD) {
      this._writeBuffer = this._writeBuffer.slice(this._bufferOffset);
      this._callbacks = this._callbacks.slice(this._bufferOffset);
      this._bufferOffset = 0;
    }
    setTimeout(() => this._innerWrite(), 0);  // Yield to event loop
  } else {
    // All done, reset
  }
}
```

**node-pty EAGAIN handling (PR #831):**
```typescript
// Raw fs.write instead of tty.WriteStream to handle EAGAIN directly
fs.write(fd, buffer, (err, bytesWritten) => {
  if (err && err.code === 'EAGAIN') {
    // Wait for I/O to complete before retrying
    setImmediate(() => retryWrite());
  }
});
```

**Watermark-based flow control pattern (from xterm.js docs):**
```typescript
let pendingCallbacks = 0;
const HIGH = 500000;
const LOW = 100000;
const CALLBACK_BYTE_LIMIT = 100000;

pty.onData(chunk => {
  written += chunk.length;
  if (written > CALLBACK_BYTE_LIMIT) {
    term.write(chunk, () => {
      pendingCallbacks = Math.max(pendingCallbacks - 1, 0);
      if (pendingCallbacks < LOW) pty.resume();
    });
    pendingCallbacks++;
    if (pendingCallbacks > HIGH) pty.pause();
  } else {
    term.write(chunk);  // fast path without callback
  }
});
```

### Risks / Unknowns
- [!] FPS coalescing proposal (#5447) is still open/not implemented - no production code to reference
- [!] node-pty PR #831 is very recent (Dec 2025) - may not be in released versions yet
- [?] The `queueMicrotask` optimization in PR #4159 was found to cause websocket message congestion - careful evaluation needed
- [?] xterm.js WriteBuffer is internal API, not exposed as a public addon/config option as of 2026

### Saved Report Path
`D:\Data\DEV\ultra_simple_panel\research\2026-05-05-xtermjs-write-batching-coalescing.md`