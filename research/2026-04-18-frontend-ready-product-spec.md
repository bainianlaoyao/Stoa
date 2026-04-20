# Frontend-Ready Product Specification

## Purpose

This document translates the latest authoritative product shape into a frontend-facing specification that can directly guide layout design, component boundaries, state presentation, and phased implementation.

Authoritative source order for this spec:

1. User clarification in current session
2. `preview/mockup/examples-style/style-h-editorial-white-glass-toolbar.html`
3. Existing architecture and lifecycle docs
4. Older product docs where not in conflict with preview

---

## 1. Product Form

`ultra_simple_panel` should now be implemented as a **hierarchical operator console** for AI coding workspaces and sessions.

It has three top-level product surfaces:

1. **Command / Terminal** — primary execution workspace
2. **Inbox / Queue** — human attention lane
3. **Context Tree / Blast Radius** — workspace file/context lane

Current phase rule:

- **Command / Terminal** must be real and usable
- **Inbox / Queue** may be placeholder-only
- **Context Tree / Blast Radius** may be placeholder-only

Even when placeholder-only, the latter two must exist in the navigation model and page shell. They are part of the information architecture, not future optional add-ons.

---

## 2. Platform and Shell

- Platform: **desktop app** (Electron)
- Renderer stack: **Vue 3 + Pinia + xterm.js**
- Backend boundary: renderer mirrors state and sends intent; main process owns PTY/session/state truth

The shell is a full-height desktop console with:

- **Global Activity Bar** on the far left
- **Main Glass Viewport** on the right

### Shell regions

#### A. Activity Bar

Purpose: switch top-level product surfaces.

Required entries:

1. Command / Terminal
2. Inbox / Queue
3. Context Tree / Blast Radius
4. Settings

Rules:

- Exactly one top-level surface is active at a time
- Activity bar icons use subtle active state, not loud accent fill
- Queue icon may carry unread/pending badge
- The activity bar remains visible across all surfaces

#### B. Viewport

Purpose: host the currently active top-level surface inside one premium glass container.

Rules:

- Viewport is the single highest z-axis glass surface
- Internal columns/cards are flatter and lighter
- Terminal remains the darkest focal surface when Command view is active

---

## 3. Navigation Model

The old flat workspace list is no longer sufficient.

The left-side index inside Command view must become **hierarchical**.

### Canonical hierarchy

Recommended visual hierarchy:

- **Project / Workspace Group**
  - persistent parent node
  - represents the top-level local project or managed workspace container
- **Child Session / Task Node**
  - represents a concrete running, awaiting, failed, or idle execution thread under that project

### Data interpretation rule

Architecture docs still define `workspace` as the canonical persisted entity. Frontend should therefore apply this interpretation:

- `workspace` remains the canonical backend identity and persisted runtime object
- UI may present a parent/child hierarchy that groups one logical project/workspace with its child sessions/tasks
- The hierarchical presentation is a **UI model**, but it must map back to canonical workspace/session data without inventing fake state ownership in the renderer

### Left navigation behaviors

Required behaviors:

- Expand/collapse parent group
- Select active child session/task
- Show active state clearly
- Show status dot per child node
- Show recency/time metadata
- Allow a visible affordance for “new session” under a parent group
- Allow a visible affordance for “new project/workspace” at top of list

Not required in current phase:

- Drag and drop reordering
- Complex inline renaming
- Command palette-based routing

---

## 4. Top-Level Surfaces

## 4.1 Command / Terminal Surface

This is the primary working surface and the only one that must be fully functional in the current phase.

### Internal layout

Two-column layout:

- **Left:** hierarchical route/index column
- **Right:** execution surface

### Left index column contents

Required blocks:

1. **Primary creation action**
   - New project/workspace
2. **Grouped hierarchy section**
   - parent project/workspace entries
   - child session/task entries

Each row may contain:

- status dot
- label
- optional summary or subtype
- last activity time
- child creation affordance on parent row

### Right execution surface contents

Required blocks:

1. **Terminal meta row**
   - workspace/session identifiers
   - optional provider/session metadata
2. **Persistent terminal viewport**
   - xterm-based
   - dark high-contrast surface
   - remains alive when switching active workspace/session

Optional in current phase:

- lightweight header actions
- summary banner above terminal
- bottom status strip

### Command view state requirements

Child nodes and/or terminal header must visually support:

- bootstrapping
- starting
- running
- awaiting_input
- degraded
- error
- exited
- needs_confirmation

Minimum UI contract:

- dot/status color must distinguish the key states
- state summary text must come from structured state channel
- terminal remains visible even if state is awaiting_input or degraded
- confirmation-needed states must not look identical to ordinary running states

---

## 4.2 Inbox / Queue Surface

This is an authoritative product surface, but current phase may implement it as a placeholder.

### Product role

Represents the lane for things that require human attention, acknowledgement, or review.

Examples:

- completed outputs waiting for review
- errors requiring action
- confirmation/acknowledgement items

### Current-phase placeholder requirement

Placeholder fidelity should include:

- surface is reachable from activity bar
- surface has a stable layout shell
- left list / right detail structure is visible
- clearly labeled as placeholder or limited mode if live data is absent

Good placeholder contents:

- empty state explaining future role
- mocked list item structure
- mocked detail panel structure
- “Acknowledge” action can be disabled or non-functional if backend is not ready

---

## 4.3 Context Tree / Blast Radius Surface

This is also an authoritative product surface with placeholder-only allowance in the current phase.

### Product role

Shows file-level context for the focused workspace/session:

- what was read
- what was modified
- what was created
- why those files are associated with the current execution context

### Current-phase placeholder requirement

Placeholder fidelity should include:

- surface is reachable from activity bar
- left tree / right detail structure is visible
- tree rows visually support READ / MOD / NEW marks
- detail pane explains intended future role

Good placeholder contents:

- representative file nodes
- static association details
- footer text declaring read-only / placeholder nature

---

## 5. Component Boundary Proposal

Suggested renderer component split:

### Shell-level

- `AppShell`
  - owns top-level active surface state
  - composes activity bar + viewport
- `GlobalActivityBar`
  - renders top-level icons and badges

### Command surface

- `CommandSurface`
  - composes hierarchy rail + terminal area
- `WorkspaceHierarchyPanel`
  - parent/child project/workspace/session routing
- `HierarchyNode`
  - reusable node renderer for parent/child rows
- `TerminalSurface`
  - xterm container + terminal metadata
- `TerminalMetaBar`
  - workspace/session/provider identifiers

### Placeholder surfaces

- `InboxQueueSurface`
  - placeholder shell in current phase
- `QueueListPlaceholder`
  - mocked or limited queue lane
- `QueueDetailPlaceholder`
  - mocked or limited detail lane
- `ContextTreeSurface`
  - placeholder shell in current phase
- `TreePlaceholder`
  - mocked tree lane
- `TreeDetailPlaceholder`
  - mocked detail lane

### Shared UI primitives

- `StatusDot`
- `SurfaceCard`
- `GlassViewport`
- `BadgePill`
- `EmptyState`

---

## 6. State Presentation Rules

### Source-of-truth rules

- Renderer never infers authoritative state from terminal text
- State summaries and lifecycle values come from structured backend events
- Renderer may display terminal text and state text together, but must not merge them into invented logic

### Visual state mapping

At minimum, define distinct visual treatment for:

- **running** — success/active signal
- **awaiting_input** — warning/attention signal
- **error** — destructive/error signal
- **needs_confirmation** — special human-decision signal
- **idle/exited** — neutral low-priority signal

### Placeholder surfaces and state

Placeholder surfaces must still reflect shell-level active/inactive state correctly. “Placeholder” cannot mean visually broken or disconnected.

---

## 7. Visual Specification

The UI must follow the repository design language:

- Modern Minimalist Glassmorphism + Clean UI
- tokenized surfaces only
- restrained transitions
- UI font and mono font split
- hierarchy through blur/transparency/shadow, not thick borders

### Required tokens in practical use

- `--canvas`
- `--surface`
- `--surface-solid`
- `--text-strong`
- `--text`
- `--muted`
- `--subtle`
- `--accent`
- `--line`
- radius tokens
- shadow tokens
- `--font-ui`
- `--font-mono`

### Spatial guidance

- Activity bar remains narrow and visually quiet
- Viewport carries premium glass treatment
- Internal list panels use lighter semi-solid surfaces
- Terminal is the strongest contrast zone
- Queue and tree placeholders should match final shell language even before full function exists

---

## 8. UX Flows to Preserve

Even after moving to the new product shape, these behaviors remain mandatory:

1. Create project/workspace
2. Create child session/task under a parent group
3. Switch active child node by click
4. Preserve live terminal instance across switches where supported by backend model
5. Restore active workspace/session after app relaunch
6. Surface error / awaiting_input / confirmation states without terminal-text guessing

---

## 9. Accessibility and Interaction Notes

- All activity bar items need clear focus state
- Hierarchy rows need hover, active, and focus-visible states
- Status color cannot be the only signal; pair with label or summary where practical
- Terminal metadata should remain readable against dark background
- Placeholder surfaces should not feel dead; they should explain intended capability clearly

---

## 10. Current-Phase Acceptance Criteria

The current frontend shape is acceptable only if all of the following are true:

1. Activity bar exposes all three authoritative top-level surfaces
2. Command surface is fully functional
3. Left navigation is hierarchical, not flat
4. Terminal remains the primary execution surface
5. Queue and Tree surfaces exist as valid, reachable placeholders
6. Status presentation uses backend state, not terminal parsing
7. Visual language matches glass/token rules from `design-language.md`

---

## 11. Suggested Next Implementation Mapping

If implementation starts next, the most likely file-level work will be:

- replace single-purpose app layout with shell + top-level surface switching
- split existing left workspace list into hierarchical navigation components
- preserve and adapt terminal viewport instead of replacing its core behavior
- add queue/tree placeholder surfaces and routing state
- introduce tokenized global design system in renderer styles
