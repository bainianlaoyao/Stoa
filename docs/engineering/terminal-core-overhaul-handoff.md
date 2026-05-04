# Terminal Core Overhaul Handoff

Status: implemented. Architecture verified against 8-point audit (2026-05-04).

All verification points pass:

- [x] `onBinary` bound end-to-end (renderer → IPC → router → PTY)
- [x] Binary written as `Buffer` to node-pty (no UTF-16 / JSON pollution)
- [x] Text and binary share the same per-session ordered queue
- [x] No custom paste handler intercepting xterm paste
- [x] No CSI 3J/1049 parser interception in default path
- [x] TERM/COLORTERM set correctly in child process env
- [x] DOM layer does not steal terminal events
- [x] Provider hooks do not mutate terminal byte stream

Outstanding: PTY initial size currently defaults to 120x30. Planned fix is to defer PTY spawn until renderer reports actual dimensions via `session:resize`. See `docs/engineering/terminal-core-overhaul-spec.md` → PTY Contract.
