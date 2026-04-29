---
date: 2026-04-29
topic: evolver official standard flow
status: completed
mode: context-gathering
sources: 5
---

## Context Report: Evolver Official Standard Flow

### Why This Was Gathered
To answer what the upstream Evolver "standard flow" actually is, and whether that flow requires Evolver itself to execute another full round.

### Summary
Upstream Evolver's default flow is: scan logs and memory, select a Gene/Capsule, emit a GEP prompt, and record an `EvolutionEvent`. In standalone mode it stops there: it prints text and exits.

If you want changes to be accepted and hardened, upstream adds a later `review -> solidify` phase. That phase can execute validation commands from the selected Gene, but it is not the same thing as Evolver autonomously running another full agent task loop.

### Key Findings
- Upstream quick start defines a single run as `evolver`, review mode as `evolver --review`, and loop mode as `evolver --loop`.
- A successful first run is explicitly described as selecting a Gene/Capsule and printing a GEP prompt to stdout.
- Upstream states clearly: "Evolver is a prompt generator, not a code patcher."
- In standalone mode, nothing is executed automatically from the generated prompt.
- The only documented command-executing core path is `solidify.js`, which runs whitelisted validation commands.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| quick-start modes are `evolver`, `evolver --review`, `evolver --loop` | upstream README | `research/upstreams/evolver/README.md:96` |
| a successful first run ends with printing a GEP prompt and writing an `EvolutionEvent` | upstream README | `research/upstreams/evolver/README.md:106` |
| upstream says Evolver is a prompt generator, not a code patcher | upstream README | `research/upstreams/evolver/README.md:157` |
| standalone mode only prints prompt text to stdout and exits | upstream README | `research/upstreams/evolver/README.md:173` |
| in review mode, you first `run` to produce changes, then `review`, then optionally `review --approve` to run solidify | upstream index | `research/upstreams/evolver/index.js:735` |
| `review --approve` explicitly runs `solidify(...)` | upstream index | `research/upstreams/evolver/index.js:812` |
| the component that executes shell commands is `src/gep/solidify.js` for validation | upstream README | `research/upstreams/evolver/README.md:430` |

### Direct Answer
- Official standard flow does **not** require Evolver to run another full autonomous agent round after every recall or prompt emission.
- Official standard flow **does** include an optional later execution phase called `solidify`, where Evolver runs validation commands from the selected Gene.
- If Evolver is embedded in a host runtime, the host may consume Evolver's stdout directives and trigger follow-up work, but that execution belongs to the host runtime, not to Evolver standalone itself.

### Risks / Unknowns
- "Standard flow" here refers to upstream CLI behavior, not every custom integration.
- Network worker/validator modes add more execution surfaces, but those are not the default local single-run path.

## Context Handoff: Evolver Official Standard Flow

Start here: `research/2026-04-29-evolver-official-standard-flow.md`

Context only. Use the saved report as the source of truth.
