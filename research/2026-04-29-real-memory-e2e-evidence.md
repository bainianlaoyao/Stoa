---
date: 2026-04-29
topic: real claude memory e2e evidence
status: completed
mode: context-gathering
sources: 8
---

> **Status: DEPRECATED.** This document describes investigation done before the Stoa x Evolver hard boundary cleanup (2026-04-30). The `host-bridge` / `publish-context` / `uv-pip capsule` / `src/stoa/*` surfaces described here are no longer part of Stoa's integration. See `research/2026-04-30-evolver-upstream-hardcoding-inventory.md` for the current boundary state.

## Context Report: Real Claude Memory E2E Evidence

### Why This Was Gathered
To verify, with concrete artifacts, whether the real Claude CLI memory loop worked end-to-end: session evidence sealed by Stoa, processed by Evolver, and later injected back into a fresh session.

### Summary
The real E2E memory experiment passed on a fresh rerun. Three real Claude CLI invocations produced the expected behavioral shift: `session1:first` used `pip install -e .`, `session1:resume` switched to `uv sync`, and `session2:first` also chose `uv sync`.

The repository-specific memory created by Evolver in this run was a new capsule, not a new gene. The injected memory visible in Claude debug logs shows the capsule only appears before `session2:first`, which explains why the second session adopted `uv` automatically.

### Timeline
```text
session1:first
  prompt -> "install requests"
  inject -> generic genes only
  outcome -> pip install -e .
  seal -> turn b6b2...
  evolver -> outcome recorded

session1:resume
  SessionStart inject -> recent successful outcome hints
  UserPromptSubmit inject -> genes + recent hint
  outcome -> uv sync
  seal -> turn 689d...
  evolver -> capsule_repo_python_prefers_uv_over_pip created

session2:first
  SessionStart inject -> recent outcomes include uv update
  UserPromptSubmit inject -> genes + capsule_repo_python_prefers_uv_over_pip
  outcome -> uv sync
```

### Key Findings
- Fresh rerun succeeded and produced the expected three-step behavior shift.
- `session1:first` chose `pip install -e .`, `session1:resume` switched to `uv sync`, and `session2:first` also chose `uv sync`.
- Stoa sealed three turns and all three Evolver jobs reached `done`.
- No new repository-specific gene was created in this run.
- One new repository-specific capsule was created: `capsule_repo_python_prefers_uv_over_pip`.
- Claude received the capsule during `session2:first` `UserPromptSubmit`, and that is the first point where the repository-specific `uv over pip` memory is visible in the prompt path.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| `session1:first` sealed | runtime-state | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/project/.stoa/memory/runtime-state.json:3` |
| `session1:resume` sealed | runtime-state | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/project/.stoa/memory/runtime-state.json:16` |
| `session2:first` sealed | runtime-state | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/project/.stoa/memory/runtime-state.json:28` |
| all three turns reached `done` jobs | runtime-state | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/project/.stoa/memory/runtime-state.json:49` |
| repository-specific capsule exists | capsules | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/project/.stoa/evolver/assets/gep/capsules.json:6` |
| capsule summary is `use uv instead of pip` | capsules | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/project/.stoa/evolver/assets/gep/capsules.json:7` |
| only baseline genes exist | genes | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/project/.stoa/evolver/assets/gep/genes.json:6` |
| `session1:first` recall had only genes, no capsule | Claude debug log | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/claude-session1-first.debug.log:166` |
| `session1:first` actually executed `pip install -e .` and wrote that command file content | evidence transcript | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/project/.stoa/memory/evidence/session_3853db69-3108-484c-b91d-639674a97c0d/8f49ff9d-b7c5-4319-82ab-ac5c8528bc36/transcript.jsonl:18` |
| `session1:resume` SessionStart injected recent outcomes | Claude debug log | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/claude-session1-resume.debug.log:127` |
| `session1:resume` UserPromptSubmit injected genes + recent hint | Claude debug log | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/claude-session1-resume.debug.log:164` |
| `session1:resume` updated the command file from `pip install -e .` to `uv sync` | evidence transcript | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/project/.stoa/memory/evidence/session_3853db69-3108-484c-b91d-639674a97c0d/a7a2d714-e1a7-4010-bb0d-7c2c1035151b/transcript.jsonl:36` |
| `session2:first` SessionStart injected warm-start outcomes | Claude debug log | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/claude-session2-first.debug.log:120` |
| `session2:first` UserPromptSubmit injected the capsule explicitly | Claude debug log | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/claude-session2-first.debug.log:167` |
| `session2:first` executed `uv sync` and read back `uv sync` from `.python-install-command.txt` | evidence transcript | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/project/.stoa/memory/evidence/session_120e5cee-c9e4-4bcc-a78a-475a5b14fa67/4bb78cb0-6022-478d-8a8e-e36f97bcfe8f/transcript.jsonl:7` |
| memory graph recorded success outcomes for all three turns | memory graph | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/project/.stoa/evolver/memory/evolution/memory_graph.jsonl:4` |

### Injected Memory Snippets

`session1:first` `UserPromptSubmit`

```text
[Evolver Memory] Task recall
Task: Install the Python package "requests" ...
Relevant genes:
- gene_tool_integrity ...
- gene_gep_repair_from_errors ...
- gene_gep_optimize_prompt_and_assets ...
```

Source: `claude-session1-first.debug.log:166`

`session1:resume` `SessionStart`

```text
[Evolver Memory] Warm start
Recent outcomes:
- [success] score=0.68 signals=claude-code, userpromptsubmit, install, python :: stable_no_error|heuristic_delta|predictive
- [signal] claude-code, userpromptsubmit, install, python, package
- [signal] claude-code, posttooluse, write, provider-transcript, type
```

Source: `claude-session1-resume.debug.log:127-131`

`session1:resume` `UserPromptSubmit`

```text
[Evolver Memory] Task recall
Task: Update .python-install-command.txt ...
Relevant genes:
- gene_gep_optimize_prompt_and_assets ...
- gene_tool_integrity ...
- gene_gep_repair_from_errors ...
Recent memory graph hints:
- [success] score=0.68 signals=claude-code, userpromptsubmit, install, python :: stable_no_error|heuristic_delta|predictive
```

Source: `claude-session1-resume.debug.log:164`

`session2:first` `SessionStart`

```text
[Evolver Memory] Warm start
Recent outcomes:
- [success] score=0.68 signals=claude-code, userpromptsubmit, update, python-install-command :: stable_no_error|heuristic_delta|predictive
- [signal] claude-code, userpromptsubmit, update, python-install-command, txt
- [signal] claude-code, posttooluse, write, provider-transcript, type
- [success] score=0.68 signals=claude-code, userpromptsubmit, install, python :: stable_no_error|heuristic_delta|predictive
```

Source: `claude-session2-first.debug.log:120-124`

`session2:first` `UserPromptSubmit`

```text
[Evolver Memory] Task recall
Task: Install the Python package "requests" ...
Relevant genes:
- gene_tool_integrity ...
- gene_gep_repair_from_errors ...
- gene_gep_optimize_prompt_and_assets ...
Relevant capsule: capsule_repo_python_prefers_uv_over_pip :: For this repository, use uv instead of pip for Python environments and package installation.
Recent memory graph hints:
- [success] score=0.68 signals=claude-code, userpromptsubmit, update, python-install-command :: stable_no_error|heuristic_delta|predictive
- [success] score=0.68 signals=claude-code, userpromptsubmit, install, python :: stable_no_error|heuristic_delta|predictive
```

Source: `claude-session2-first.debug.log:167`

### Gene vs Capsule
- Genes are still the shared baseline assets: `gene_gep_repair_from_errors`, `gene_gep_optimize_prompt_and_assets`, `gene_tool_integrity`.
- The new repository-specific artifact in this run is the capsule `capsule_repo_python_prefers_uv_over_pip`.
- The memory graph outcome events for all three turns have `"gene":{"id":null,"category":null}`, which is further evidence that this run did not mint a new gene for the `uv` preference.

### Risks / Unknowns
- The run directory is under `%TEMP%`; this evidence is durable only as long as those files are retained.
- The memory graph shows `capsules.used: []` on outcome events; injection evidence comes from Claude debug logs rather than from `memory_graph.jsonl` itself.

## Context Handoff: Real Claude Memory E2E Evidence

Start here: `research/2026-04-29-real-memory-e2e-evidence.md`

Context only. Use the saved report as the source of truth.
