import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { parseOpenCodeSession } from './opencode-parser'

// OpenCode schema — matches real opencode.db
function createTestDB(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      data TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      data TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
  `)
  return db
}

const SESSION_ID = 'ses_test123'

function seedSession(db: Database.Database): void {
  db.prepare(`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
    VALUES (?, 'proj1', 'test', '/tmp', 'Test', '1', 1000, 2000)`).run(SESSION_ID)

  // User message with text part
  db.prepare(`INSERT INTO message (id, session_id, data, time_created, time_updated)
    VALUES (?, ?, '{"role":"user","time":{"created":1100}}', 1100, 1100)`)
    .run('msg_u1', SESSION_ID)
  db.prepare(`INSERT INTO part (id, message_id, session_id, data, time_created, time_updated)
    VALUES ('prt_u1', 'msg_u1', ?, '{"type":"text","text":"Fix the bug"}', 1100, 1100)`)
    .run(SESSION_ID)

  // Assistant message with reasoning + text + tool
  db.prepare(`INSERT INTO message (id, session_id, data, time_created, time_updated)
    VALUES (?, ?, '{"role":"assistant","time":{"created":1200,"completed":1300}}', 1200, 1300)`)
    .run('msg_a1', SESSION_ID)

  db.prepare(`INSERT INTO part (id, message_id, session_id, data, time_created, time_updated)
    VALUES ('prt_a1_reasoning', 'msg_a1', ?, '{"type":"reasoning","text":"Let me check the error."}', 1210, 1210)`)
    .run(SESSION_ID)
  db.prepare(`INSERT INTO part (id, message_id, session_id, data, time_created, time_updated)
    VALUES ('prt_a1_text', 'msg_a1', ?, '{"type":"text","text":"Found the issue."}', 1220, 1220)`)
    .run(SESSION_ID)
  db.prepare(`INSERT INTO part (id, message_id, session_id, data, time_created, time_updated)
    VALUES ('prt_a1_tool', 'msg_a1', ?, '{"type":"tool","tool":"Bash","state":{"status":"completed","input":{"command":"ls"},"output":"file1.ts\\nfile2.ts"}}', 1230, 1230)`)
    .run(SESSION_ID)
}

describe('parseOpenCodeSession', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDB()
    seedSession(db)
  })

  afterEach(() => {
    db.close()
  })

  it('yields user and assistant turns', () => {
    const turns = [...parseOpenCodeSession(db, SESSION_ID, { includeThinking: false })]
    const roles = turns.map(t => t.role)
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
  })

  it('user turn contains text content', () => {
    const turns = [...parseOpenCodeSession(db, SESSION_ID, { includeThinking: false })]
    const user = turns.find(t => t.role === 'user')
    expect(user?.text).toContain('Fix the bug')
  })

  it('assistant turn includes text and toolCall', () => {
    const turns = [...parseOpenCodeSession(db, SESSION_ID, { includeThinking: false })]
    const assistant = turns.find(t => t.role === 'assistant')
    expect(assistant?.text).toContain('Found the issue.')
    expect(assistant?.toolCalls?.[0]?.name).toBe('Bash')
  })

  it('includeThinking=false skips reasoning parts', () => {
    const turns = [...parseOpenCodeSession(db, SESSION_ID, { includeThinking: false })]
    const assistant = turns.find(t => t.role === 'assistant')
    expect(assistant?.text).not.toContain('Let me check the error')
  })

  it('includeThinking=true includes reasoning parts', () => {
    const turns = [...parseOpenCodeSession(db, SESSION_ID, { includeThinking: true })]
    const assistant = turns.find(t => t.role === 'assistant')
    expect(assistant?.text).toContain('Let me check the error')
    expect(assistant?.text).toContain('Found the issue.')
  })

  it('handles empty session', () => {
    const turns = [...parseOpenCodeSession(db, 'ses_nonexistent', { includeThinking: false })]
    expect(turns).toEqual([])
  })

  it('tool calls have input and output previews', () => {
    const turns = [...parseOpenCodeSession(db, SESSION_ID, { includeThinking: false })]
    const assistant = turns.find(t => t.role === 'assistant')
    const tc = assistant?.toolCalls?.[0]
    expect(tc?.inputPreview).toBeTruthy()
    expect(tc?.outputPreview).toContain('file1.ts')
  })
})
