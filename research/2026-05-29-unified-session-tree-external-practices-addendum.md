---
date: 2026-05-29
topic: unified session tree external practices addendum
status: completed
mode: context-gathering
sources: 6
---

## Context Report: Unified Session Tree External Practices Addendum

### Why This Was Gathered

Provide external, evidence-backed justification for the unified `stoa-ctl` session tree design, especially these choices:

- remove standalone meta-session product surface
- expose one session control surface for all sessions
- use a minimal session/subagent control command set
- sync frontend visibility with snapshot + push instead of polling
- keep archived subtree structure visible in the same management surface

### Summary

The recommended direction is:

- one unified session management surface
- one unified session control API for all sessions
- main-process-authoritative graph mutations
- startup snapshot plus main-to-renderer push updates
- tree-preserving projection for both live and archived subtrees

This aligns with official Electron IPC guidance, GitHub's cross-client agent session management model, and the push/upsert/tree-lineage patterns already observed in Orca-adjacent research. Stoa's same-depth-plus-descendants visibility rule is intentionally stricter and more product-specific than the public defaults exposed by GitHub or Electron, so it should remain a Stoa-owned contract implemented centrally rather than inferred from upstream behavior.

### Key Findings

- GitHub's official agent-session UX is a single management surface where users monitor progress, inspect logs, steer, stop, and archive sessions. That supports Stoa removing a separate meta-session product surface and converging on one session management surface instead of two parallel products.
  Evidence: https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents

- GitHub and VS Code explicitly sync local agent sessions into a shared session view across clients. That supports Stoa's requirement that sessions created from inside another session must still appear in the frontend without manual refresh or restart.
  Evidence: https://code.visualstudio.com/docs/copilot/chat/session-sync

- Electron's official main-to-renderer IPC pattern is `webContents.send(...)` from main, a preload bridge that exposes a narrow listener, and renderer subscription through that bridge. That directly supports Stoa's `main -> preload -> renderer` `session:graph-event` push path.
  Evidence: https://www.electronjs.org/docs/latest/tutorial/ipc

- Electron recommends using preload-exposed narrow callbacks instead of exposing raw `ipcRenderer` broadly. That supports a dedicated `onSessionGraphEvent` bridge rather than leaking lower-level IPC details into renderer code.
  Evidence: https://www.electronjs.org/docs/latest/tutorial/ipc

- Repository-local Orca research shows a push-based architecture with one-time snapshot hydration, main-process event push, store upsert, and derived lineage rendering. That is the closest concrete product pattern to Stoa's frontend session-tree sync problem, and it argues against polling or periodic full reload as a correctness path.
  Evidence: [research/2026-05-29-orca-frontend-child-visibility-subagent.md](/D:/Data/DEV/ultra_simple_panel/.worktrees/unified-session-tree/research/2026-05-29-orca-frontend-child-visibility-subagent.md:14), [research/2026-05-29-orca-frontend-child-visibility-subagent.md](/D:/Data/DEV/ultra_simple_panel/.worktrees/unified-session-tree/research/2026-05-29-orca-frontend-child-visibility-subagent.md:19), [research/2026-05-29-orca-frontend-child-visibility-subagent.md](/D:/Data/DEV/ultra_simple_panel/.worktrees/unified-session-tree/research/2026-05-29-orca-frontend-child-visibility-subagent.md:26), [research/2026-05-29-orca-frontend-child-visibility-subagent.md](/D:/Data/DEV/ultra_simple_panel/.worktrees/unified-session-tree/research/2026-05-29-orca-frontend-child-visibility-subagent.md:43), [research/2026-05-29-orca-frontend-child-visibility-subagent.md](/D:/Data/DEV/ultra_simple_panel/.worktrees/unified-session-tree/research/2026-05-29-orca-frontend-child-visibility-subagent.md:51)

- The vendored `research/upstreams/orca/` tree is empty locally, so there is no locally auditable upstream Orca permission model to adopt verbatim. Stoa's tree-local same-depth-plus-descendants visibility rule should therefore remain an explicit Stoa contract, implemented by a single visibility service and tested directly.
  Evidence: [research/2026-05-29-orca-permission-visibility-subagent.md](/D:/Data/DEV/ultra_simple_panel/.worktrees/unified-session-tree/research/2026-05-29-orca-permission-visibility-subagent.md:19), [research/2026-05-29-orca-permission-visibility-subagent.md](/D:/Data/DEV/ultra_simple_panel/.worktrees/unified-session-tree/research/2026-05-29-orca-permission-visibility-subagent.md:39)

- Existing internal research already identified that frontend correctness requires an explicit graph-event path, a preload listener, and store upsert semantics. That confirms the spec should name these pieces directly rather than leaving them implicit.
  Evidence: [research/2026-05-29-spec-coverage-visibility-authority-frontend-sync.md](/D:/Data/DEV/ultra_simple_panel/.worktrees/unified-session-tree/research/2026-05-29-spec-coverage-visibility-authority-frontend-sync.md:19), [research/2026-05-29-spec-coverage-visibility-authority-frontend-sync.md](/D:/Data/DEV/ultra_simple_panel/.worktrees/unified-session-tree/research/2026-05-29-spec-coverage-visibility-authority-frontend-sync.md:55)

### Recommendation

Adopt the unified session-tree design already outlined in the spec, with three points made explicit:

1. The product keeps one session management surface, not a user-facing meta-session surface.
2. The transport contract for graph mutations is a dedicated `session:graph-event` push channel, with bootstrap snapshot plus store upsert.
3. Session-local visibility remains a Stoa-specific rule: same-depth peers plus own descendants, with no ancestor or cross-branch visibility leakage.

### Risks / Unknowns

- [!] Public GitHub and Electron docs justify the control-plane and sync shape, but they do not prescribe Stoa's tree-local authority matrix. That matrix remains a Stoa-owned product contract.
- [!] Because the vendored Orca tree is empty locally, any "reference Orca implementation" claim must be framed as conceptual similarity, not code-level parity.
- [?] GitHub's archive UX removes sessions from the main list, while Stoa intentionally keeps archived subtrees in the same command surface to preserve hierarchy. That divergence is intentional and should remain explicit in the spec.

### Context Handoff: Unified Session Tree External Practices

Start here: `D:\Data\DEV\ultra_simple_panel\.worktrees\unified-session-tree\research\2026-05-29-unified-session-tree-external-practices-addendum.md`

Context only. Use the saved report as the source of truth.
