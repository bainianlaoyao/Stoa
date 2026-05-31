---
date: 2026-05-28
topic: tabicl5m-evo verification baseline and quality gate
status: completed
mode: context-gathering
sources: 8
---

## Context Report: tabicl5m-evo Verification Baseline

### Why This Was Gathered
Integration agents working in `D:\Data\DEV\tabicl5m_evo` need the exact verification commands, acceptance layers, and current boundary state before touching code.

### Summary
The repo is a Python (`uv` toolchain) + Vue (`dashboard-vue/`) clean-room rewrite. Verification is **5-layered** (static, unit, contract, E2E probe, integration-boundary probe) and mandated by `AGENTS.md` + `docs/rewrite/execution/acceptance-standard.md`. No CI pipelines exist yet (no `.github/`, no `Makefile`). All verification is agent-run via CLI. There are 296 test files and 112 fixtures currently in place.

### Key Findings

#### 1. Mandatory Python Verification Commands

| Command | Purpose | When Required |
|---------|---------|---------------|
| `uv run ruff check <changed-files>` | Lint | Every code-bearing task |
| `uv run ruff format --check <changed-files>` | Format check | Every code-bearing task |
| `uv run pytest <targeted-tests> -q` | Unit/integration tests | Every logic-bearing task |
| `uv run pytest tests/contracts/test_import_boundaries.py -q` | Import boundary enforcement | When touching `contracts/`, registrars, runners, or cross-plan seams |

#### 2. Mandatory Frontend Verification Commands

| Command | Purpose | When Required |
|---------|---------|---------------|
| `cd dashboard-vue && npm install` | Dependency install | Before frontend build |
| `cd dashboard-vue && npm run build` | Build verification | Any `dashboard-vue/` change |

No frontend lint/test commands are defined in `dashboard-vue/package.json` (only `dev`, `build`, `preview` scripts).

#### 3. Acceptance Layers (Per acceptance-standard.md)

| Layer | Scope | Required For |
|-------|-------|--------------|
| A: Static | Ruff lint + format + import boundary | Every code-bearing task |
| B: Unit | Happy path + failure modes + edge cases | Every logic-bearing task |
| C: Contract | Schema/protocol/registrar validation | Tasks touching public contracts, schemas, registrars, identity/selector/durable-write seams |
| D: Business E2E | Synthetic but business-semantic probes | Business logic engines |
| E: Integration boundary | Fake downstream consumer probes | Providers, runners, registrars, execution entrypoints |

**Critical rule**: No task may be declared complete by unit tests alone. The acceptance layer profile depends on task type (see task-acceptance-matrix.md lines 91-100).

#### 4. Current Repo State

- **296 test files** under `tests/`
- **112 fixture files** under `fixtures/`
- **No CI/CD pipelines** — verification is agent-driven via CLI commands
- **No `Makefile`** or top-level `scripts/` directory
- `pyproject.toml` defines: `pytest>=9.0.3` (dev dep), `ruff` config (line-length 100, py311)
- Import boundary matrix exists at `docs/rewrite/execution/import-boundary-matrix.md`
- Task acceptance matrix covers all bundles across foundation, prediction, strategy, backtest, broker, live, evidence, operator, composition, cutover, and finish plans

#### 5. Release Gate Infrastructure

- Gate registry: `fixtures/release_gates/_meta/gate_registry.json` (file does not yet exist on disk)
- Closeout packages: `*_closeout_package.json` patterns referenced but not yet present
- Frozen contract corpus: `fixtures/frozen_contract_corpus/corpus_manifest.json` (directory structure exists with some corpus fixtures)

#### 6. Mandatory Cross-Plan Acceptance Packs

Four cross-plan packs must be implemented before `finish`:
- **X1**: Shared Strategy Cross-Path Pack (plans 10, 20, 30, 50)
- **X2**: Broker Branch Scenario Pack (plans 40, 50)
- **X3**: Research Evidence Guard Pack (plans 30, 60)
- **X4**: Config Truth-Source Integrity Pack (plans 00, 80, 85, 90)

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Default verification commands | AGENTS.md | `AGENTS.md:62-68` |
| Frontend commands | AGENTS.md | `AGENTS.md:96-110` |
| Import boundary test trigger | AGENTS.md | `AGENTS.md:46-56` |
| 5-layer acceptance structure | acceptance-standard.md | `docs/rewrite/execution/acceptance-standard.md:1-185` |
| Task-type to acceptance-layer mapping | acceptance-standard.md | `docs/rewrite/execution/acceptance-standard.md:91-100` |
| Bundle-level acceptance matrix | task-acceptance-matrix.md | `docs/rewrite/execution/task-acceptance-matrix.md` (full file) |
| Execution topology and plan ordering | README.md | `docs/rewrite/execution/README.md:1-129` |
| Python toolchain config | pyproject.toml | `pyproject.toml` (full file) |
| Frontend package config | package.json | `dashboard-vue/package.json` (full file) |
| 296 test files, 112 fixtures | File system scan | `tests/`, `fixtures/` |
| No CI/Makefile/scripts | File system scan | Repo root |

### Risks / Unknowns

- **[!] No CI/CD** — verification depends entirely on agent discipline. Easy to skip layers.
- **[!] Gate registry not yet materialized** — `fixtures/release_gates/_meta/gate_registry.json` is referenced but doesn't exist on disk. Release-gate flows may be incomplete.
- **[!] No frontend linting** — `dashboard-vue/package.json` has no lint/test scripts; only `build` exists as a verification gate.
- **[?] Pytest configuration uses `-ra`** — this shows all test outcomes by default. May produce verbose output for large suites. Targeted test selection (`<targeted-tests>`) is preferred over full-suite runs.
- **[?] numba/numpy dependency** — `numba>=0.61.0` is a heavy dependency. Tests importing numba-compiled modules may be slow or platform-sensitive (JIT compilation on first run).

### Expensive / Environment-Sensitive Steps

1. **Full pytest suite** — 296 test files; many involve fixture I/O and potentially numba JIT compilation. Prefer targeted test selection.
2. **Backtest acceptance tests** — References to real-data acceptance and parity comparison tests suggest potentially long-running computations.
3. **Numba JIT** — First import of numba-decorated functions triggers compilation; subsequent runs are faster but cold starts are expensive.
4. **Durable-write tests** — These involve file I/O simulation and corruption recovery, may be slower than pure unit tests.
