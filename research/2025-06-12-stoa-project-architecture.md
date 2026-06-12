---
date: 2025-06-12
topic: stoa-project-architecture
status: completed
mode: context-gathering
sources: 45+
---

# Context Report: Stoa Project Architecture

## Why This Was Gathered
To understand the overall architecture of the Stoa project for implementing new features and making architectural decisions. This provides a comprehensive overview of the system's structure, data flow, and technology stack.

## Summary
Stoa is an Electron-based application with a clear three-tier architecture: Main Process (backend), Renderer Process (frontend), and Core Business Logic (shared). The application uses Vue 3 + Pinia for the frontend, Express for HTTP services, better-sqlite3 for data persistence, and implements a sophisticated session management system with multiple runtime providers (shell, OpenCode, Codex, Claude Code).

## Technology Stack

### Core Technologies
- **Electron**: v37.4.0 - Desktop framework
- **Vue**: v3.5.22 - Frontend framework with Composition API
- **Pinia**: v3.0.3 - State management
- **TypeScript**: v5.9.3 - Primary language
- **Vite**: v7.1.7 - Build tool for renderer process
- **Electron Vite**: v4.0.0 - Electron-specific build tooling

### Data & Persistence
- **better-sqlite3**: v12.9.0 - Database persistence
- **Express**: v5.1.0 - HTTP server for webhook/control APIs
- **node-pty**: v1.1.0 - Terminal emulation

### Additional Key Libraries
- **xterm**: v6.1.0-beta.216 - Terminal UI
- **electron-updater**: v6.8.3 - Auto-update support
- **vue-i18n**: v11.3.2 - Internationalization

## Architectural Overview

### Three-Process Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Main Process                          │
│  - Business Logic (src/core/)                               │
│  - IPC Handlers (src/main/)                                 │
│  - HTTP Services (Express)                                 │
│  - Data Persistence (state-store)                           │
│  - Process Management (pty-host, session-runtime)          │
└─────────────────────────────────────────────────────────────┘
                              ↕ IPC
┌─────────────────────────────────────────────────────────────┐
│                       Preload Script                         │
│  - Context Bridge (src/preload/index.ts)                    │
│  - API Surface Definition                                    │
│  - Security Boundary                                         │
└─────────────────────────────────────────────────────────────┘
                              ↕ window.stoa
┌─────────────────────────────────────────────────────────────┐
│                      Renderer Process                        │
│  - Vue 3 App (src/renderer/)                                 │
│  - Pinia Stores (src/renderer/stores/)                       │
│  - UI Components (src/renderer/components/)                  │
│  - Terminal UI (xterm.js)                                   │
└─────────────────────────────────────────────────────────────┘
```

### Module Organization

#### Main Process (src/main/)
**Entry Point**: `index.ts` (1800+ lines)

**Key Modules**:
- `session-runtime-controller.ts` - Session lifecycle management
- `session-event-bridge.ts` - Event routing to renderer
- `session-input-router.ts` - Input routing to sessions
- `observability-sync.ts` - State synchronization
- `update-service.ts` - Auto-update handling
- `sidebar-fs-handlers.ts` - File system operations
- `sidebar-git-handlers.ts` - Git operations

#### Core Business Logic (src/core/)
**17,736 lines of TypeScript** across 80+ modules

**Key Categories**:

**Session Management**:
- `project-session-manager.ts` (39,959 bytes) - Project/session CRUD operations
- `session-runtime.ts` - Runtime state machine
- `session-supervisor.ts` (13,473 bytes) - Hierarchical session management
- `session-control-server.ts` (21,477 bytes) - HTTP control API
- `subagent-supervisor.ts` (30,950 bytes) - Subagent coordination

**Data Persistence**:
- `state-store.ts` (16,883 bytes) - JSON file persistence
- `sidebar-state-store.ts` - Sidebar state persistence

**Network Services**:
- `webhook-server.ts` (14,846 bytes) - Event ingestion API
- `session-control-server.ts` - Control plane API
- `meta-session-control-server.ts` - Meta-session API

**Memory & Context**:
- `memory/` directory with 11 modules for context management
- `context/` directory with 9 modules for text processing

**Observability**:
- `observability-service.ts` - State projection
- `observation-store.ts` - Event storage

#### Renderer Process (src/renderer/)
**Key Components**:

**App Structure**:
- `app/App.vue` - Root component
- `components/AppShell.vue` - Layout shell

**Pinia Stores** (7 stores):
- `stores/workspaces.ts` (17,784 bytes) - Main workspace state
- `stores/settings.ts` - Application settings
- `stores/sidebar.ts` - UI state
- `stores/git.ts` - Git state
- `stores/memory-notifications.ts` - Notification handling
- `stores/observability-view-models.ts` - State projections
- `stores/update.ts` - Update state

**Component Architecture**:
- 20+ Vue components organized by feature
- Composition API with `<script setup>` pattern
- TypeScript throughout

## Data Persistence Architecture

### Storage Locations

**Global State**:
- Path: `~/.stoa/global.json`
- Schema: `PersistedGlobalStateV4`
- Contains: Projects list, global settings, active pointers

**Project Sessions**:
- Path: `<project-path>/.stoa/sessions.json`
- Schema: `PersistedProjectSessions`
- Contains: Session history per project

**State Store Module** (`src/core/state-store.ts`):
- **Lines**: 16,883 bytes
- **Responsibilities**:
  - JSON read/write operations
  - Error handling with transient error detection
  - Schema validation
  - Migration support

**State Format**:
```typescript
interface PersistedGlobalStateV4 {
  version: 4
  active_project_id: string | null
  active_session_id: string | null
  projects: PersistedProject[]
  settings: AppSettings
}
```

### Data Models

**Core Types** (`src/shared/project-session.ts`):
- `SessionType`: 'shell' | 'opencode' | 'codex' | 'claude-code'
- `SessionPhase`: 'ready' | 'running' | 'blocked' | 'complete' | 'failure'
- `SessionRuntimeState`: 'created' | 'starting' | 'alive' | 'exited' | 'failed_to_start'
- `TurnState`: 'idle' | 'running'
- `TurnOutcome`: 'none' | 'completed' | 'interrupted' | 'cancelled' | 'failed'

**Key Models**:
- `BootstrapState` - Application state snapshot
- `SessionSummary` - Session metadata
- `ProjectSummary` - Project metadata
- `SessionGraphEvent` - State transition events
- `SessionStatePatchEvent` - Incremental state updates

## IPC Communication Architecture

### Channel Definitions
**File**: `src/core/ipc-channels.ts` (3,287 bytes)

**50+ IPC Channels** organized by domain:

**Project Management**:
- `project:bootstrap` - Initial state load
- `project:create` - Create new project
- `project:delete` - Delete project
- `project:set-active` - Switch active project

**Session Management**:
- `session:create` - Create new session
- `session:set-active` - Switch active session
- `session:terminal-replay` - Terminal history
- `session:input` - Send input to session
- `session:archive` - Archive session
- `session:restart` - Restart session

**Observability**:
- `observability:get-session-presence` - Get session state
- `observability:get-project-observability` - Get project state
- `observability:list-session-events` - Event history

**File System & Git**:
- `fs:*` - 10 file system operations
- `git:*` - 15 git operations

### Preload Script
**File**: `src/preload/index.ts`

**Pattern**: Context bridge with typed API
```typescript
const api = {
  async getBootstrapState() { ... },
  async createProject(request) { ... },
  async createSession(request) { ... },
  // ... 40+ methods
}
contextBridge.exposeInMainWorld('stoa', api)
```

**Security**:
- Explicit API surface (no raw ipcRenderer exposure)
- Type-safe contract
- Windows build number handling

## Network Services Architecture

### Webhook Server
**File**: `src/core/webhook-server.ts` (14,846 bytes)

**Purpose**: Ingest events from external agents/providers

**Key Features**:
- Express HTTP server
- Hook authorization with secret validation
- Event validation (150+ lines of validation logic)
- Support for multiple providers (Claude Code, Codex, OpenCode)
- Hook event adaptation

**Validated Events**:
- `runtime.created`, `runtime.starting`, `runtime.alive`
- `agent.turn_started`, `agent.tool_started`, `agent.turn_completed`
- `agent.permission_requested`, `agent.permission_resolved`
- Memory notifications

### Session Control Server
**File**: `src/core/session-control-server.ts` (21,477 bytes)

**Purpose**: Control plane for session operations

**Endpoints**:
- Session CRUD operations
- Subagent management (create, list, wait for result)
- Input routing
- Hierarchical session operations

**Authentication**:
- Secret-based authentication for local user
- Session token-based authentication for sessions
- Caller identity resolution

### Meta Session Control Server
**File**: `src/core/meta-session-control-server.ts` (21,847 bytes)

**Purpose**: Meta-session orchestration

**Features**:
- Proposal submission
- Inspector targeting
- Command dispatch
- Context assembly

## Session Management Architecture

### Session Hierarchy
```
Project
├── Session (root)
│   ├── Subagent Session (child)
│   │   └── Grandchild Session
│   └── Subagent Session (sibling)
└── Session (sibling)
```

**Session Supervisor** (`src/core/session-supervisor.ts`):
- Manages hierarchical relationships
- Handles parent-child lifecycle
- Session tree operations
- Authorization checks

**Subagent Supervisor** (`src/core/subagent-supervisor.ts` - 30,950 bytes):
- Short name allocation
- Result waiting
- State management
- Turn coordination

### Runtime Providers
**Supported Types**:
- `shell` - Terminal sessions via node-pty
- `opencode` - VS Code integration
- `codex` - Codex provider
- `claude-code` - Claude Code integration

**Provider Descriptors**: `src/shared/provider-descriptors.ts`

## Frontend Architecture

### Vue 3 + Pinia Pattern

**Store Architecture** (`src/renderer/stores/`):
- **workspaces.ts** (17,784 bytes) - Main application state
- **settings.ts** - User preferences
- **sidebar.ts** - UI state
- **git.ts** - Git state

**Key Patterns**:
```typescript
export const useWorkspaceStore = defineStore('workspaces', () => {
  // State
  const projectHierarchy = ref<ProjectHierarchyNode[]>([])

  // Actions
  async function hydrate() { ... }

  // Computed
  const activeProject = computed(() => ...)

  return { projectHierarchy, activeProject, hydrate }
})
```

### Component Architecture

**Component Organization**:
- `app/` - Application shell
- `components/command/` - Command surface
- `components/archive/` - Archive management
- `components/update/` - Update UI

**Component Pattern**:
- Composition API with `<script setup>`
- TypeScript throughout
- Reactive stores via Pinia
- Event-based communication

## Build & Packaging Architecture

### Build Configuration
**File**: `electron.vite.config.ts`

**Three Build Targets**:
1. **Main Process**: CommonJS target (entry: `src/main/index.ts`)
2. **Preload**: CommonJS target (entry: `src/preload/index.ts`)
3. **Renderer**: ES modules (entry: `src/renderer/index.html`)

**Plugins**:
- `externalizeDepsPlugin` - Node.js externalization
- `vue()` - Vue SFC compilation
- `tailwindcss()` - CSS processing
- `VueI18nPlugin` - i18n compilation

### Packaging Configuration
**File**: `electron-builder.yml`

**Build Artifacts**:
- NSIS installer (Windows)
- Portable executable (Windows)
- GitHub release integration

**Resource Handling**:
- `asarUnpack`: node-pty, entire-bridge, stoa-ctl
- `extraResources`: Vendored evolver upstream

**Build Scripts**:
- `npm run build` - Electron-vite build
- `npm run package` - Electron-builder packaging
- `npm run package:release` - GitHub release

## Key Architectural Patterns

### 1. Event-Driven State Machine
**Session State Management**:
- State reducer pattern (`session-state-reducer.ts`)
- Event sourcing (`SessionGraphEvent`)
- Incremental updates (`SessionStatePatchEvent`)
- State projection for UI

### 2. Hierarchical Session Management
**Parent-Child Relationships**:
- Session supervisor maintains tree
- Subagent supervisor coordinates execution
- Event cascading through hierarchy
- Lifecycle dependencies

### 3. Multi-Provider Integration
**Provider Abstraction**:
- Provider descriptors (`provider-descriptors.ts`)
- Path resolution (`provider-path-resolver.ts`)
- Command building
- Environment setup

### 4. Network Service Mesh
**Service Composition**:
- Webhook server (event ingestion)
- Session control server (control plane)
- Meta-session control server (orchestration)
- Coordinated operation on different ports

### 5. Reactive Frontend
**Reactivity Chain**:
- IPC event → Store action → Computed property → UI update
- Bidirectional data flow
- Optimistic updates
- Error boundary handling

## Data Flow Diagrams

### Session Creation Flow
```
Renderer (UI)              IPC              Main Process
     │                      │                    │
     │ createSession()       │                    │
     ├─────────────────────>│                    │
     │                      │ create session    │
     │                      │──────────────────>│
     │                      │                    │ persist to state
     │                      │<──────────────────┤
     │                      │                    │
     │<─────────────────────┤                    │
     │ update UI             │                    │
```

### Event Flow
```
External Provider          Webhook Server     State Manager
     │                          │                   │
     │ HTTP POST                │                   │
     ├────────────────────────>│                   │
     │                          │ validate          │
     │                          │ adapt event      │
     │                          │──────────────────>│
     │                          │                   │ update state
     │                          │<──────────────────┤
     │ 200 OK                   │ broadcast IPC     │
     │<─────────────────────────┤                   │
     │                          │──────────────────>│ Renderer
```

### State Synchronization
```
Main Process            IPC            Renderer Stores
     │                     │                   │
     │ state change        │                   │
     │────────────────────>│                   │
     │                     │ hydrate()         │
     │                     │──────────────────>│
     │                     │                   │ computed updates
     │                     │<──────────────────┤
     │                     │ UI updates         │
```

## Module Responsibility Matrix

### Core Layer (src/core/)

| Module | Responsibility | Lines | Key Operations |
|--------|---------------|-------|----------------|
| `project-session-manager.ts` | Project/session CRUD | 39,959B | create, delete, setActive, recovery |
| `session-runtime.ts` | Session lifecycle | 7,174B | spawn, monitor, cleanup |
| `session-supervisor.ts` | Hierarchy management | 13,473B | parent-child, tree operations |
| `subagent-supervisor.ts` | Subagent coordination | 30,950B | create, wait, result retrieval |
| `webhook-server.ts` | Event ingestion | 14,846B | HTTP POST, validation, adaptation |
| `session-control-server.ts` | Control API | 21,477B | session CRUD, subagent ops |
| `state-store.ts` | Persistence | 16,883B | read/write JSON, error handling |
| `observability-service.ts` | State projection | 6,826B | snapshot generation |
| `pty-host.ts` | Terminal emulation | 5,741B | spawn PTY, write/resize |
| `session-title-generator.ts` | Title generation | 4,510B | LLM-based naming |

### Main Process Layer (src/main/)

| Module | Responsibility | Lines | Key Operations |
|--------|---------------|-------|----------------|
| `index.ts` | Entry point | 1,800+ | App bootstrap, IPC registration |
| `session-runtime-controller.ts` | Runtime orchestration | - | Lifecycle management |
| `session-event-bridge.ts` | Event routing | - | Main→Renderer events |
| `session-input-router.ts` | Input routing | - | Renderer→Main input |
| `sidebar-fs-handlers.ts` | File operations | - | FS IPC handlers |
| `sidebar-git-handlers.ts` | Git operations | - | Git IPC handlers |

### Renderer Layer (src/renderer/)

| Module | Responsibility | Lines | Key Operations |
|--------|---------------|-------|----------------|
| `stores/workspaces.ts` | Main state | 17,784B | hydrate, hierarchy, computed |
| `stores/settings.ts` | Settings | 7,637B | get/set, detection |
| `stores/sidebar.ts` | UI state | 4,070B | visibility, layout |
| `components/AppShell.vue` | Layout | - | Shell structure |
| `components/command/` | UI components | - | User interaction |

## Risk Areas & Unknowns

### Identified Risks
1. **Complex State Management**: Multiple state stores (global, per-project, runtime) require careful synchronization
2. **Hierarchical Session Lifecycle**: Parent-child dependencies need robust cleanup
3. **Event Ordering**: Event-driven architecture requires careful handling of race conditions
4. **Error Recovery**: Transient errors in state reads require retry logic
5. **Memory Management**: Long-running sessions need memory monitoring

### Unknowns (Require Further Investigation)
1. **Migration Strategy**: How schema migrations are handled for state files
2. **Performance**: Scalability limits for session hierarchies
3. **Error Recovery**: Specific retry strategies for transient failures
4. **Testing Coverage**: E2E test completeness for complex flows
5. **Deployment Strategy**: Production update deployment process

## File Locations Reference

### Key Files
- **Main Entry**: `src/main/index.ts`
- **IPC Channels**: `src/core/ipc-channels.ts`
- **State Store**: `src/core/state-store.ts`
- **Session Manager**: `src/core/project-session-manager.ts`
- **Webhook Server**: `src/core/webhook-server.ts`
- **Control Server**: `src/core/session-control-server.ts`
- **Preload**: `src/preload/index.ts`
- **Renderer App**: `src/renderer/app/App.vue`
- **Main Store**: `src/renderer/stores/workspaces.ts`
- **Build Config**: `electron.vite.config.ts`
- **Package Config**: `electron-builder.yml`
- **Type Definitions**: `src/shared/project-session.ts`

### Test Files
- Unit tests: `src/**/*.test.ts`
- E2E tests: `tests/e2e/*.test.ts`
- Generated tests: `tests/generated/*.spec.ts`
- Behavior coverage: `testing/generators/behavior-coverage.test.ts`

## Conclusion

Stoa implements a sophisticated Electron application with clear separation of concerns:

1. **Main Process**: Heavy business logic, state management, network services
2. **Renderer Process**: Pure UI with Vue 3 + Pinia, minimal business logic
3. **Core Layer**: Shared domain logic, data models, utilities

The architecture supports:
- Multi-provider session management
- Hierarchical session relationships
- Event-driven state updates
- Network service coordination
- Robust data persistence

This provides a solid foundation for implementing new features while maintaining architectural consistency.
