import {
  sqliteTable,
  text,
  integer,
  index,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// 1. Projects
// ---------------------------------------------------------------------------

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  path: text('path').notNull().unique(),
  name: text('name').notNull(),
  defaultSessionType: text('default_session_type'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ---------------------------------------------------------------------------
// 2. Sessions
// ---------------------------------------------------------------------------

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): SQLiteColumn => sessions.id, {
      onDelete: 'set null',
    }),
    createdBySessionId: text('created_by_session_id'),
    type: text('type').notNull(),
    title: text('title'),
    runtimeState: text('runtime_state').notNull().default('created'),
    turnState: text('turn_state').notNull().default('idle'),
    turnOutcome: text('turn_outcome').notNull().default('none'),
    turnEpoch: integer('turn_epoch').notNull().default(0),
    sessionPhase: text('session_phase').notNull().default('ready'),
    blockingReason: text('blocking_reason'),
    failureReason: text('failure_reason'),
    hasUnseenCompletion: integer('has_unseen_completion')
      .notNull()
      .default(0),
    command: text('command'),
    cwd: text('cwd'),
    runtimeExitCode: integer('runtime_exit_code'),
    runtimeExitReason: text('runtime_exit_reason'),
    lastStateSequence: integer('last_state_sequence').notNull().default(0),
    lastSummary: text('last_summary'),
    externalSessionId: text('external_session_id'),
    titleGeneration: text('title_generation'),
    archiveState: text('archive_state').notNull().default('active'),
    recoveryMode: text('recovery_mode').notNull().default('fresh-shell'),
    lastActivatedAt: text('last_activated_at'),
    sortOrder: integer('sort_order').notNull().default(0),
    // Subagent facade
    subagentEpoch: integer('subagent_epoch').notNull().default(0),
    subagentShortName: text('subagent_short_name'),
    subagentName: text('subagent_name'),
    subagentResultSummary: text('subagent_result_summary'),
    subagentInputEpoch: integer('subagent_input_epoch').notNull().default(0),
    subagentLatestInputAt: text('subagent_latest_input_at'),
    subagentLatestInputStateSequence: integer(
      'subagent_latest_input_state_sequence',
    )
      .notNull()
      .default(0),
    subagentResult: text('subagent_result'),
    // Metadata
    createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_sessions_project_archive').on(
      table.projectId,
      table.archiveState,
    ),
    index('idx_sessions_parent').on(table.parentId),
    index('idx_sessions_created_by').on(table.createdBySessionId),
    index('idx_sessions_archive').on(table.archiveState),
  ],
);

// ---------------------------------------------------------------------------
// 3. Session Events
// ---------------------------------------------------------------------------

export const sessionEvents = sqliteTable(
  'session_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    eventVersion: text('event_version').notNull().default('1'),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    intent: text('intent').notNull(),
    source: text('source').notNull(),
    projectId: text('project_id').notNull(),
    correlationId: text('correlation_id'),
    turnEpoch: integer('turn_epoch'),
    payload: text('payload').notNull(),
    evidence: text('evidence'),
    timestamp: text('timestamp').notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_events_session_sequence').on(table.sessionId, table.sequence),
    index('idx_events_intent').on(table.intent),
    index('idx_events_timestamp').on(table.timestamp),
  ],
);

// ---------------------------------------------------------------------------
// 4. Meta Sessions
// ---------------------------------------------------------------------------

export const metaSessions = sqliteTable('meta_sessions', {
  id: text('id').primaryKey(),
  title: text('title'),
  backendSessionType: text('backend_session_type').notNull(),
  backendSessionId: text('backend_session_id'),
  capabilityLevel: integer('capability_level').notNull().default(0),
  status: text('status').notNull().default('created'),
  archived: integer('archived').notNull().default(0),
  inspectorTarget: text('inspector_target'),
  totalWorkSessions: integer('total_work_sessions').notNull().default(0),
  activeWorkSessions: integer('active_work_sessions').notNull().default(0),
  totalProposals: integer('total_proposals').notNull().default(0),
  pendingProposals: integer('pending_proposals').notNull().default(0),
  lastSummary: text('last_summary'),
  lastRiskLevel: text('last_risk_level'),
  lastRiskReason: text('last_risk_reason'),
  lastActivatedAt: text('last_activated_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ---------------------------------------------------------------------------
// 5. Meta Session Proposals
// ---------------------------------------------------------------------------

export const metaSessionProposals = sqliteTable(
  'meta_session_proposals',
  {
    id: text('id').primaryKey(),
    metaSessionId: text('meta_session_id')
      .notNull()
      .references(() => metaSessions.id, { onDelete: 'cascade' }),
    workSessionId: text('work_session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('prompt'),
    presetName: text('preset_name'),
    promptText: text('prompt_text'),
    status: text('status').notNull().default('pending_approval'),
    snapshot: text('snapshot').notNull(),
    riskLevel: text('risk_level'),
    riskReason: text('risk_reason'),
    executionResult: text('execution_result'),
    stalenessReason: text('staleness_reason'),
    approvedAt: text('approved_at'),
    rejectedAt: text('rejected_at'),
    executedAt: text('executed_at'),
    createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_meta_proposals_session').on(table.metaSessionId),
    index('idx_meta_proposals_status').on(table.status),
  ],
);

// ---------------------------------------------------------------------------
// 6. Meta Session Action Logs
// ---------------------------------------------------------------------------

export const metaSessionActionLogs = sqliteTable(
  'meta_session_action_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    metaSessionId: text('meta_session_id')
      .notNull()
      .references(() => metaSessions.id, { onDelete: 'cascade' }),
    proposalId: text('proposal_id').references(() => metaSessionProposals.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    detail: text('detail'),
    createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_meta_logs_session').on(table.metaSessionId),
  ],
);

// ---------------------------------------------------------------------------
// 7. Settings
// ---------------------------------------------------------------------------

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ---------------------------------------------------------------------------
// 8. Session Presence
// ---------------------------------------------------------------------------

export const sessionPresence = sqliteTable('session_presence', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ---------------------------------------------------------------------------
// 9. Session Tokens
// ---------------------------------------------------------------------------

export const sessionTokens = sqliteTable('session_tokens', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// ---------------------------------------------------------------------------
// 10. Server Config
// ---------------------------------------------------------------------------

export const serverConfig = sqliteTable('server_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ---------------------------------------------------------------------------
// 11. Sidebar State
// ---------------------------------------------------------------------------

export const sidebarState = sqliteTable('sidebar_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
