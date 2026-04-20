## Research Report: Existing Product Design Inference

### Summary

`ultra_simple_panel` is currently designed as a local desktop orchestration console for concurrent AI coding workspaces, not as a general IDE and not as a terminal emulator. Its product shape is a state-aware multi-workspace container: the left side helps the user choose and monitor workspaces, while the main area preserves a live PTY terminal view without teardown on workspace switches. The referenced mockup extends that baseline into a richer operator console by adding an inbox/queue lane and a file-context/blast-radius lane, while staying consistent with the repository's glassmorphism design language and dumb-UI/smart-backend architecture.

### User Clarifications (Authoritative Overrides)

The user clarified three authoritative points after the initial inference:

1. The two additional top-level panels are **allowed and part of the intended product shape**, but **the current implementation phase only needs placeholders**.
2. The routing/index model **must become hierarchical**, rather than staying a flat workspace list.
3. The `preview` artifacts represent the **latest product form and implicit authoritative design**, which means older docs should be read as lagging documentation where they conflict with preview-level product shape.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Product is a local orchestration console for multi-terminal, multi-agent, multi-workspace work, not an IDE replacement | `docs/overview/vision-and-principles.md` | `docs/overview/vision-and-principles.md:5-12` |
| Renderer is intentionally thin; real session/state control lives in main process | `docs/overview/vision-and-principles.md` | `docs/overview/vision-and-principles.md:19-22` |
| Overall runtime split is Electron main process for PTY/webhook/state, renderer only for state projection and intent forwarding | `docs/architecture/system-architecture.md` | `docs/architecture/system-architecture.md:5-18`, `docs/architecture/system-architecture.md:28-35` |
| Baseline UX is a strict binary layout: left workspace console, right main terminal view | `docs/product/workspace-console-ux.md` | `docs/product/workspace-console-ux.md:3-6` |
| Left side is a vertical workspace card list with name/path alias, state summary, status lamp, and active state | `docs/product/workspace-console-ux.md` | `docs/product/workspace-console-ux.md:7-16` |
| Workspace click is the single canonical switch mechanism | `docs/product/workspace-console-ux.md` | `docs/product/workspace-console-ux.md:16-16` |
| Right side terminal should remain alive across switches; UI only toggles visibility to preserve zero-delay switching and buffer continuity | `docs/product/workspace-console-ux.md` | `docs/product/workspace-console-ux.md:18-21` |
| Status feedback must come from structured state channel, not inferred from terminal text | `docs/product/workspace-console-ux.md` | `docs/product/workspace-console-ux.md:22-27` |
| Core workflow includes create workspace, switch workspace, resurrection, state event updates, and exception recovery | `docs/product/interaction-flows.md` | `docs/product/interaction-flows.md:3-40` |
| Workspace switching is implemented by updating `activeId` and toggling terminal visibility while PTYs keep running in background | `docs/product/interaction-flows.md` | `docs/product/interaction-flows.md:11-17` |
| Product has an explicit workspace identity model and 8-state lifecycle model | `docs/architecture/workspace-identity-and-state-machine.md` | `docs/architecture/workspace-identity-and-state-machine.md:7-10`, `docs/architecture/workspace-identity-and-state-machine.md:40-52` |
| States include `running`, `awaiting_input`, `error`, `needs_confirmation`, which strongly shape the UI model | `docs/architecture/workspace-identity-and-state-machine.md` | `docs/architecture/workspace-identity-and-state-machine.md:42-52`, `docs/architecture/workspace-identity-and-state-machine.md:73-86` |
| Authoritative visual language is Modern Minimalist Glassmorphism + Clean UI with tokenized surfaces, typography split, and restrained motion | `docs/engineering/design-language.md` | `docs/engineering/design-language.md:7-15`, `docs/engineering/design-language.md:19-38`, `docs/engineering/design-language.md:39-88`, `docs/engineering/design-language.md:89-147` |
| Mockup shell uses a 56px activity bar plus a main viewport, implying a higher-level navigation layer above the baseline binary split | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html` | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html:49-50`, `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html:77-81`, `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html:658-681` |
| Mockup contains three product surfaces: command/terminal, inbox queue, and context file tree | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html` | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html:685-875` |
| Command panel still centers on workspace/project routing plus a PTY terminal, preserving the core product loop from the docs | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html` | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html:689-761` |
| Mockup introduces nested project/session structure, not just flat workspaces, suggesting a richer operational index | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html` | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html:698-738` |
| Mockup terminal stream shows status events, terminal attach, human confirmation, and file operations together, expressing the dual machine/human monitoring role of the UI | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html` | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html:747-761` |
| Mockup inbox queue models human acknowledgement as an explicit review lane for completed/error outputs | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html` | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html:768-820` |
| Mockup tree panel models blast radius/context awareness through file tree status and association details | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html` | `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html:825-871` |

### Inferred Existing Product Design

#### 1. Product Role

The current product is designed as a **local operator console for AI-driven coding sessions**. Its purpose is to keep many workspaces/sessions alive, observable, and recoverable with lower switching cost and lower state-loss risk than a normal terminal workflow. This comes directly from the product vision: the tool is meant to stabilize a multi-agent, multi-terminal workflow rather than replace the IDE or emulate terminal internals (`docs/overview/vision-and-principles.md:5-12`).

#### 2. Core Product Objects

The canonical object is the **workspace**, backed by a stable `workspace_id`, persisted metadata, provider identity, latest CLI session pointer, and an explicit lifecycle state machine (`docs/architecture/workspace-identity-and-state-machine.md:7-31`). The UI is therefore not designed around tabs or files first; it is designed around **workspace identity and session continuity**. The lifecycle states (`bootstrapping`, `starting`, `running`, `awaiting_input`, `degraded`, `error`, `exited`, `needs_confirmation`) define the status language the product must expose (`docs/architecture/workspace-identity-and-state-machine.md:42-86`).

#### 3. Baseline Information Architecture

The repository docs define a **binary workbench**:

- **Left:** workspace console for low-cost switching and state scanning
- **Right:** persistent main terminal viewport for the active workspace

This is explicitly called an “absolute binary partition” and is intentionally simpler than an IDE-like multipanel environment (`docs/product/workspace-console-ux.md:3-6`). The left column is a card-based routing layer, and the right column is a persistent xterm surface that stays mounted in background per workspace for instant switching (`docs/product/workspace-console-ux.md:7-21`).

However, based on the user's clarification, this binary workbench should now be understood as the **older documented baseline**, not the latest authoritative product shape.

#### 4. Interaction Philosophy

The product favors **click-first, low-cognitive-load operations** over power-user abstractions. The docs explicitly reject a command palette as the primary interaction mechanism and insist that clicking a workspace card remains the only canonical switch path (`docs/product/workspace-console-ux.md:16-16`, `docs/product/workspace-console-ux.md:28-32`). This is consistent with the principle “intuition over power-user shortcuts” (`docs/overview/vision-and-principles.md:27-30`).

#### 5. Architecture-Driven UX Model

The UI is designed as a **projection of backend truth**, not as an autonomous stateful frontend. The renderer only mirrors state and forwards user intent, while the main process owns PTY lifecycle, webhook ingestion, state synthesis, persistence, and resurrection (`docs/architecture/system-architecture.md:5-18`, `docs/architecture/system-architecture.md:28-35`). As a result, the product design depends on two separate observation channels:

- terminal stream for human reading
- structured state/events for machine-accurate status and summaries

This explains why the docs forbid deriving workspace status from terminal parsing (`docs/overview/vision-and-principles.md:15-18`; `docs/product/workspace-console-ux.md:22-27`).

#### 6. What the Mockup Adds to the Existing Product Design

The specified mockup should now be treated as the **latest authoritative product form**. It preserves the core command/terminal workbench, but wraps it in a higher-order shell:

- **Global activity bar** for surface switching (`...style-h...:658-681`)
- **Command panel** for project/session routing + terminal (`...style-h...:685-761`)
- **Inbox queue panel** for human review and acknowledgement of outputs (`...style-h...:768-820`)
- **Context file tree panel** for blast radius and file association awareness (`...style-h...:825-871`)

From this, the existing product design can be inferred as evolving from a strict binary workspace-terminal console toward a **three-concern operator console**:

1. **What is running now?** — command/terminal lane
2. **What needs human attention?** — inbox/review lane
3. **What changed and why?** — file context / blast radius lane

Per the user's clarification, panels (2) and (3) are **not optional experiments**. They are valid parts of the current product shape, although the present implementation stage only requires **placeholder realization** for those two surfaces.

Also per the user's clarification, the left routing model should no longer be read as a flat workspace list. The mockup's `Projects` plus child session/task rows (`preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html:698-738`) should be interpreted as the intended **hierarchical navigation model** for the modern product shape.

#### 7. Visual Language and Tone

The visual system is deliberately **premium, restrained, and operational**, not playful or developer-tool brutalist. The authoritative design language requires glass layering, tokenized surfaces, subtle shadows, low-contrast lines, restrained transitions, and a strict UI-font / mono-font split (`docs/engineering/design-language.md:7-15`, `docs/engineering/design-language.md:39-88`, `docs/engineering/design-language.md:89-147`).

The mockup directly instantiates that language using:

- `--canvas`, `--surface`, `--surface-solid`, `--line`, `--text-strong`, `--accent`, `--font-ui`, `--font-mono`
- one elevated glass viewport with `backdrop-filter: blur(40px)`
- lighter internal cards/lists
- one dark terminal as the high-contrast focal surface

See `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html:8-50`, `:154-166`, `:221-227`, `:388-397`.

#### 8. Implied UX Priorities

Across docs and mockup, the existing product design prioritizes:

1. **Session continuity** — terminals stay alive, restoration is explicit (`docs/product/interaction-flows.md:18-26`)
2. **State fidelity** — summaries and status come from structured events (`docs/product/workspace-console-ux.md:22-27`)
3. **Low-cost workspace switching** — card click, instant visual swap (`docs/product/interaction-flows.md:11-17`)
4. **Human-in-the-loop supervision** — confirmation and acknowledgement are first-class states (`docs/architecture/workspace-identity-and-state-machine.md:77-82`; `preview/...style-h...:751-755`, `:805-819`)
5. **Operational transparency** — the operator can inspect not only logs, but also changed files and event context (`preview/...style-h...:825-871`)

### Risk Points

- [!] **Documentation lag:** older product docs still describe a stricter binary split and flatter routing model, but the user has explicitly designated preview as the latest authoritative design. Implementation and future docs should therefore treat preview as source-of-truth where product-shape conflicts exist.
- [!] **Terminology harmonization needed:** the architecture still uses `workspace` as the canonical persisted entity, while the latest preview uses a hierarchical `project -> child session/task` presentation. This is now an intentional direction, but naming and mapping rules still need explicit documentation.
- [?] **Placeholder scope definition:** queue and tree panels are authoritative surfaces, but the exact boundary of “placeholder only” is still not formally specified in repo docs and will need a concrete implementation contract.

### Recommendations

1. Treat the specified preview/mockup as the **current authoritative product design** for frontend shape and information architecture.
2. Treat older docs as **architectural and behavioral constraints**, but not as the final authority on surface layout where they conflict with preview.
3. Carry forward a **hierarchical left navigation model** and reserve top-level placeholders for **Inbox/Queue** and **Context Tree / Blast Radius** as part of the current product scope.

### Open Questions

- What is the exact mapping rule between persisted `workspace` entities and the hierarchical preview navigation nodes?
- What minimum placeholder fidelity is expected for Queue and Tree panels in the current phase: static shell, real data binding, or partial interactivity?

## Next Steps

Based on this research, the most natural follow-up is one of:

1. Produce a concise **current product spec reconstruction** in Chinese for team alignment.
2. Produce a **baseline docs vs style-h mockup diff** to identify ratified vs exploratory product design.
3. Convert this inferred design into a **frontend information architecture proposal** before implementation.
