---
date: 2026-06-12
topic: Lightweight Self-Hosted Kanban Server Architectures
status: completed
mode: context-gathering
sources: 15
---

## Context Report: Lightweight Self-Hosted Kanban Server Architectures

### Why This Was Gathered
To support architectural decision-making for a lightweight local multi-device Kanban + small tools system by analyzing existing self-hosted Kanban solutions, their synchronization patterns, data models, and implementation strategies.

### Summary
The research reveals four distinct architectural approaches for lightweight Kanban systems: **WeKan** (Meteor/DDP with MongoDB), **Planka** (Node.js/Socket.io with PostgreSQL), **Kanboard** (PHP/SQLite with polling), and **Focalboard** (Go/SQLite with real-time sync). For text-only, multi-device scenarios, **Go + SQLite** (Focalboard) or **Node.js + PostgreSQL** (Planka) architectures provide optimal balance of simplicity, real-time capabilities, and resource efficiency. **SQLite-based solutions** offer superior deployment simplicity for local-first scenarios.

### Key Findings

#### 1. Real-Time Sync Approaches

**WeKan (Meteor Framework):**
- Uses Distributed Data Protocol (DDP) over WebSocket for real-time communication
- MongoDB Change Streams (Meteor 3.5+) or oplog tailing for reactive updates
- Built-in reactivity system automatically pushes data changes to connected clients
- 1GB minimum RAM requirement, scales to 30k users on enterprise deployments

**Planka (Node.js Stack):**
- Socket.io for WebSocket-based real-time collaboration
- "Instant syncing across all users, no refresh needed"
- REST API for CRUD operations
- PostgreSQL backend with relational data model
- Docker-based deployment with compose configurations

**Kanboard (PHP Architecture):**
- HTTP polling-based synchronization (no WebSocket)
- JSON-RPC API for client-server communication
- SQLite database for lightweight deployments
- Simple polling model: less efficient but easier to implement
- Maintenance mode (stable, no major feature development)

**Focalboard (Go Implementation):**
- Go backend with SQLite database
- Real-time sync via WebSocket
- Mattermost integration heritage
- Designed for self-hosted environments

#### 2. Data Model Design

**Common Pattern across all systems:**
```
Board (Project) 
  ├─ List (Column/Stage)
  │   ├─ Card (Task/Item)
  │   │   ├─ Comments
  │   │   ├─ Labels/Tags
  │   │   └─ Attachments
  │   └─ Swimlanes (optional grouping)
  └─ Settings/Permissions
```

**WeKan Schema (MongoDB):**
- Document-based storage with embedded arrays
- Labels stored directly on cards
- Activities collection for audit trail
- Custom fields via key-value pairs

**Planka Schema (PostgreSQL):**
- Relational model with foreign keys
- Separate tables: boards, lists, cards, labels, card_labels
- Normalized structure for complex queries
- User management with SSO integration

**Kanboard Schema (SQLite):**
- Lightweight relational design
- JSON-RPC as communication protocol
- Column-based layout with position tracking
- Plugin system for extensibility

**Focalboard Schema (SQLite):**
- Go-based data models
- Blocks/content architecture for rich text
- Team-based access control

#### 3. Offline Support & Conflict Resolution

**Research Findings:**
- None of the studied systems implement robust offline-first sync with CRDTs
- Traditional operational transformation is not used
- Most systems assume constant connectivity
- SQLite-sync and PowerSync libraries offer modern offline-first patterns but aren't implemented in mainstream Kanban tools

**Best Practices from Research:**
- CRDT-based offline-first sync (sqlite-sync) eliminates conflicts
- Local-first architecture with SQLite as primary store
- Automatic sync with PostgreSQL/Supabase backends
- No individual API calls needed for synchronization

#### 4. Multi-Device Connection Handling

**WeKan:**
- Meteor's reactivity system handles multiple connections automatically
- DDP maintains persistent connections with reconnection logic
- Session management built into Meteor framework

**Planka:**
- Socket.io rooms for board-level isolation
- Real-time presence indicators
- User authentication via OpenID Connect

**Kanboard:**
- Session-based authentication
- No persistent connections (polling model)
- Each request independent and stateless

**Focalboard:**
- WebSocket-based presence
- Multi-device sync via Go backend

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| WeKan uses Meteor/DDP with MongoDB Change Streams | GitHub Repository | https://github.com/wekan/wekan |
| Planka uses Socket.io for real-time sync | GitHub Repository | https://github.com/plankanban/planka |
| Kanboard uses JSON-RPC polling with SQLite | GitHub Repository | https://github.com/kanboard/kanboard |
| Focalboard uses Go + SQLite | GitHub Repository | https://github.com/FocalBoard/focalboard |
| MongoDB Change Streams for real-time sync | OneUptime Blog | https://oneuptime.com/blog/post/2026-01-25-mongodb-change-streams/view |
| SQLite CRDT sync patterns (sqlite-sync) | GitHub Repository | https://github.com/sqliteai/sqlite-sync |
| PostgreSQL real-time replication patterns | Nearform Article | https://nearform.com/digital-community/real-time-data-replication-in-postgres-and-node-js/ |
| Planka deployment on Railway with WebSocket | Railway Platform | https://railway.com/deploy/planka |

### Trade-off Comparison

| System | Stack | Real-Time | Offline | Resource Usage | Deployment Complexity | Multi-Device |
|--------|-------|-----------|---------|----------------|----------------------|--------------|
| **WeKan** | Meteor/MongoDB | WebSocket (DDP) | Limited | High (1GB+ min) | Medium | Excellent |
| **Planka** | Node.js/Postgres | WebSocket (Socket.io) | Limited | Medium | Easy (Docker) | Good |
| **Kanboard** | PHP/SQLite | Polling | Limited | Low | Very Easy | Fair |
| **Focalboard** | Go/SQLite | WebSocket | Limited | Medium | Easy | Good |

### Recommended Architecture for Text-Only Multi-Device Kanban

**Primary Recommendation: Node.js + PostgreSQL + Socket.io (Planka-style)**

**Rationale:**
- **WebSocket-based real-time sync** provides best user experience
- **PostgreSQL** offers robust relational model with ACID guarantees
- **Node.js ecosystem** provides extensive libraries and community support
- **Docker deployment** simplifies local installation
- **Socket.io** handles reconnection and multiplexing automatically

**Alternative for Ultra-Lightweight: Go + SQLite (Focalboard-style)**

**Rationale:**
- **Single binary deployment** (Go compiler)
- **SQLite** embedded database (zero configuration)
- **Lower memory footprint** than Node.js
- **Real-time WebSocket** for responsiveness
- **Simpler backup** (single file)

**Recommended Implementation Pattern:**

```yaml
Architecture:
  Backend:
    Language: TypeScript/Node.js or Go
    Database: PostgreSQL (production) or SQLite (development)
    Real-time: Socket.io or native WebSocket
    API: REST + WebSocket events
  
  Frontend:
    Framework: React or Vue
    State: Pinia/Vuex with server sync
    Real-time: Socket.io client or WebSocket API
  
  Sync Strategy:
    Primary: WebSocket for real-time updates
    Fallback: Polling every 30s if connection lost
    Offline: Local storage with conflict resolution on reconnect
```

### Specific API Design Patterns

**REST Endpoints:**
```typescript
// CRUD operations
GET    /api/boards              // List all boards
POST   /api/boards              // Create board
GET    /api/boards/:id          // Get board with lists/cards
PUT    /api/boards/:id          // Update board
DELETE /api/boards/:id          // Delete board

// Nested resources
GET    /api/boards/:id/lists    // Get board lists
POST   /api/boards/:id/lists    // Create list
GET    /api/lists/:id/cards     // Get list cards
POST   /api/lists/:id/cards     // Create card
PUT    /api/cards/:id           // Update card
DELETE /api/cards/:id           // Delete card
```

**WebSocket Events:**
```typescript
// Server -> Client
board:updated        // Board metadata changed
list:created         // New list added
list:updated         // List modified
card:created         // New card added
card:updated         // Card modified
card:deleted         // Card removed
card:moved           // Card position changed

// Client -> Server
card:move            // Request card move
list:reorder         // Reorder lists
```

### Memory Optimization Techniques

1. **Virtual Scrolling** - Only render visible cards/boards
2. **Lazy Loading** - Load lists and cards on-demand
3. **Data Pagination** - Limit initial board load to active cards
4. **Debounced Updates** - Batch rapid changes (e.g., card drags)
5. **Connection Pooling** - Reuse database connections
6. **WebSocket Compression** - Enable permessage-deflate
7. **Store Subscriptions** - Only sync active boards
8. **SQLite WAL Mode** - For concurrent read access

### Risks / Unknowns

- [!] **Offline Support Gap**: None of the mainstream tools implement robust offline-first sync with conflict resolution. CRDT-based solutions (sqlite-sync) exist but aren't widely adopted.
- [?] **Focalboard Architecture Details**: Limited public documentation on Focalboard's specific WebSocket implementation and sync patterns.
- [?] **Conflict Resolution**: How each system handles concurrent edits across multiple devices is not well-documented.
- [!] **WeKan Resource Usage**: 1GB minimum RAM requirement may be excessive for truly lightweight deployments.
- [?] **Kanboard Polling Performance**: Impact of polling frequency on server load and responsiveness unclear.

### Sources Cited

1. WeKan GitHub Repository - https://github.com/wekan/wekan
2. Planka GitHub Repository - https://github.com/plankanban/planka
3. Kanboard GitHub Repository - https://github.com/kanboard/kanboard
4. Focalboard GitHub Repository - https://github.com/FocalBoard/focalboard
5. MongoDB Change Streams Tutorial - https://oneuptime.com/blog/post/2026-01-25-mongodb-change-streams/view
6. PostgreSQL Real-time Replication (Nearform) - https://nearform.com/digital-community/real-time-data-replication-in-postgres-and-node-js/
7. SQLite CRDT Sync (sqlite-sync) - https://github.com/sqliteai/sqlite-sync
8. Planka on Railway - https://railway.com/deploy/planka
9. Meteor DDP vs MongoDB Access (Stack Overflow) - https://stackoverflow.com/questions/15931368/ddp-vs-straight-mongodb-access-for-synching-large-amounts-of-data
10. Real-time MongoDB with ChangeStreams (SwiftOnServer) - https://swiftonserver.com/realtime-mongodb-updates-with-changestreams-and-websockets/
11. PowerSync Documentation - Mentioned in web search results
12. LiteSync for Go SQLite - Mentioned in web search results
13. Go SQLite3 Package - Mentioned in web search results
14. WebSocket and Meteor Security (Leviathan) - https://www.leviathansecurity.com/blog/websockets-and-meteor-a-penetration-testers-guide-to-meteor
15. Node.js WebSocket Best Practices - https://medium.com/@V-Blaze/creating-real-time-apps-with-node-js-and-websockets-a-step-by-step-guide-98b143ce5ea1

---

## Context Handoff: Lightweight Self-Hosted Kanban Architectures

Start here: `D:\Data\DEV\ultra_simple_panel\research\2026-06-12-lightweight-self-hosted-kanban-architectures.md`

This report provides comprehensive architectural analysis of four major self-hosted Kanban systems (WeKan, Planka, Kanboard, Focalboard) with focus on real-time sync patterns, data models, offline support strategies, and resource optimization. The research confirms Node.js + PostgreSQL + Socket.io (Planka-style) or Go + SQLite (Focalboard-style) as optimal architectures for text-only, multi-device Kanban systems.

Context only. Use the saved report as the source of truth.