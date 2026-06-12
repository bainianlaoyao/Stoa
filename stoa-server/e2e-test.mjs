/**
 * Stoa Server E2E Test — starts real HTTP server, exercises full API surface.
 * Run: node stoa-server/e2e-test.mjs
 */
import { spawn } from 'node:child_process'
import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createServer } from 'node:net'

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

async function waitForServer(port, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/v1/discovery`)
      if (res.ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`Server did not start within ${timeout}ms`)
}

const DB_PATH = join(homedir(), '.stoa', 'e2e-test.db')

async function main() {
  // Clean previous test DB
  for (const f of [DB_PATH, DB_PATH + '-shm', DB_PATH + '-wal']) {
    try { unlinkSync(f) } catch {}
  }

  const port = await getFreePort()
  console.log(`Starting server on port ${port}...`)

  const proc = spawn('node', ['dist/index.cjs', '--port', String(port)], {
    cwd: new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, STOA_DB_PATH: DB_PATH }
  })

  proc.stdout.on('data', d => process.stdout.write(`[sr] ${d}`))
  proc.stderr.on('data', d => process.stderr.write(`[sr:err] ${d}`))

  let passed = 0, failed = 0, total = 0

  function check(name, expected, actual) {
    total++
    if (expected === actual) {
      console.log(`  ✅ ${name}`)
      passed++
    } else {
      console.log(`  ❌ ${name} (expected: ${expected}, got: ${actual})`)
      failed++
    }
  }

  try {
    await waitForServer(port)

    const AUTH = { Authorization: 'Bearer stoa-dev-token' }
    const JSON_HEADER = { ...AUTH, 'Content-Type': 'application/json' }
    const BASE = `http://localhost:${port}`

    // 1. Discovery
    console.log('\n--- 1. Discovery ---')
    let res = await fetch(`${BASE}/api/v1/discovery`)
    let body = await res.json()
    check('discovery status 200', 200, res.status)
    check('discovery ok', true, body.ok)
    check('discovery name', 'stoa', body.data.name)

    // 2. Health (no auth)
    console.log('\n--- 2. Health ---')
    res = await fetch(`${BASE}/ctl/health`)
    check('health no-auth → 401', 401, res.status)
    res = await fetch(`${BASE}/ctl/health`, { headers: AUTH })
    body = await res.json()
    check('health auth → 200', 200, res.status)
    check('health ok', true, body.ok)
    check('health status', 'healthy', body.data.status)

    // 3. Bootstrap (empty)
    console.log('\n--- 3. Bootstrap (empty) ---')
    res = await fetch(`${BASE}/api/v1/bootstrap`, { headers: AUTH })
    body = await res.json()
    check('bootstrap ok', true, body.ok)
    check('bootstrap empty projects', 0, body.data.projects.length)
    check('bootstrap empty sessions', 0, body.data.sessions.length)

    // 4. Create Project
    console.log('\n--- 4. Create Project ---')
    res = await fetch(`${BASE}/api/v1/projects`, {
      method: 'POST', headers: JSON_HEADER,
      body: JSON.stringify({ path: 'C:/tmp/e2e-test-project', name: 'E2E Test' })
    })
    body = await res.json()
    check('create-project ok', true, body.ok)
    const projectId = body.data.id
    check('create-project has id', true, projectId?.startsWith('project_'))
    check('create-project name', 'E2E Test', body.data.name)

    // 5. Create Session
    console.log('\n--- 5. Create Session ---')
    res = await fetch(`${BASE}/api/v1/sessions`, {
      method: 'POST', headers: JSON_HEADER,
      body: JSON.stringify({ projectId, type: 'shell' })
    })
    body = await res.json()
    check('create-session ok', true, body.ok)
    const sessionId = body.data.id
    check('create-session has id', true, sessionId?.startsWith('session_'))
    check('create-session type', 'shell', body.data.type)
    check('create-session state', 'created', body.data.runtimeState)

    // 6. Set Active Project
    console.log('\n--- 6. Set Active ---')
    res = await fetch(`${BASE}/api/v1/projects/${projectId}/active`, {
      method: 'PUT', headers: AUTH
    })
    body = await res.json()
    check('set-active ok', true, body.ok)

    // 7. Bootstrap (with data)
    console.log('\n--- 7. Bootstrap (with data) ---')
    res = await fetch(`${BASE}/api/v1/bootstrap`, { headers: AUTH })
    body = await res.json()
    check('bootstrap has 1 project', 1, body.data.projects.length)
    check('bootstrap has 1 session', 1, body.data.sessions.length)
    check('bootstrap active project set', true, body.data.activeProjectId === projectId)
    check('bootstrap project name', 'E2E Test', body.data.projects[0].name)
    check('bootstrap session title', 'shell-1', body.data.sessions[0].title)

    // 8. Settings
    console.log('\n--- 8. Settings ---')
    res = await fetch(`${BASE}/api/v1/settings`, { headers: AUTH })
    body = await res.json()
    check('settings ok', true, body.ok)
    check('settings stoaCtlEnabled', false, body.data.stoaCtlEnabled)
    check('settings stoaServerEnabled', false, body.data.stoaServerEnabled)

    // 9. Settings set + round-trip
    console.log('\n--- 9. Settings round-trip ---')
    res = await fetch(`${BASE}/api/v1/settings/stoaCtlEnabled`, {
      method: 'PUT', headers: JSON_HEADER,
      body: JSON.stringify({ key: 'stoaCtlEnabled', value: true })
    })
    body = await res.json()
    check('set-setting ok', true, body.ok)

    res = await fetch(`${BASE}/api/v1/settings`, { headers: AUTH })
    body = await res.json()
    check('settings stoaCtlEnabled now true', true, body.data.stoaCtlEnabled)

    // 10. Sidebar
    console.log('\n--- 10. Sidebar ---')
    res = await fetch(`${BASE}/api/v1/sidebar`, { headers: AUTH })
    body = await res.json()
    check('sidebar ok', true, body.ok)
    check('sidebar has data', true, typeof body.data === 'object')

    // 11. Observability
    console.log('\n--- 11. Observability ---')
    res = await fetch(`${BASE}/api/v1/observability/app`, { headers: AUTH })
    body = await res.json()
    check('observability ok', true, body.ok)

    // 12. Meta Sessions
    console.log('\n--- 12. Meta Sessions ---')
    res = await fetch(`${BASE}/api/v1/meta-sessions/bootstrap`, { headers: AUTH })
    body = await res.json()
    check('meta-sessions ok', true, body.ok)

    // 13. List Sessions
    console.log('\n--- 13. List Sessions ---')
    res = await fetch(`${BASE}/api/v1/sessions?projectId=${projectId}`, { headers: AUTH })
    body = await res.json()
    check('list-sessions ok', true, body.ok)
    check('list-sessions count', 1, body.data.length)

    // 14. Archive Session
    console.log('\n--- 14. Archive Session ---')
    res = await fetch(`${BASE}/api/v1/sessions/${sessionId}/archive`, {
      method: 'PUT', headers: AUTH
    })
    body = await res.json()
    check('archive-session ok', true, body.ok)

    // 15. Delete Project
    console.log('\n--- 15. Delete Project ---')
    res = await fetch(`${BASE}/api/v1/projects/${projectId}`, {
      method: 'DELETE', headers: AUTH
    })
    body = await res.json()
    check('delete-project ok', true, body.ok)

    // 16. Final bootstrap (empty again)
    console.log('\n--- 16. Final Bootstrap ---')
    res = await fetch(`${BASE}/api/v1/bootstrap`, { headers: AUTH })
    body = await res.json()
    check('final bootstrap ok', true, body.ok)
    check('final bootstrap empty projects', 0, body.data.projects.length)
    check('final bootstrap empty sessions', 0, body.data.sessions.length)
    check('final bootstrap no active project', true, body.data.activeProjectId === null)

  } finally {
    proc.kill('SIGTERM')
    // Clean test DB
    for (const f of [DB_PATH, DB_PATH + '-shm', DB_PATH + '-wal']) {
      try { unlinkSync(f) } catch {}
    }
  }

  console.log(`\n${'='.repeat(50)}`)
  console.log(`  RESULTS: ${passed}/${total} passed, ${failed} failed`)
  console.log(`${'='.repeat(50)}`)

  if (failed > 0) process.exit(1)
}

main().catch(e => {
  console.error('E2E test error:', e)
  process.exit(1)
})
