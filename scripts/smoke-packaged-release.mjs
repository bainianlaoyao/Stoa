import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executableDirectory, resolvePackagedExecutable as findPackagedExecutable } from './packaging-artifacts.mjs'

const root = process.cwd()
const releaseDir = join(root, 'release')
const platform = process.env.STOA_PACKAGE_PLATFORM ?? process.argv.find((arg) => arg.startsWith('--platform='))?.slice('--platform='.length) ?? process.platform
const packagedEvolverDir = join(releaseDir, 'win-unpacked', 'resources', 'evolver')
const stateDir = join(tmpdir(), `stoa-packaged-smoke-${randomUUID()}`)
const projectDir = join(stateDir, 'workspace')
const smokeFile = join(stateDir, 'packaged-smoke.jsonl')
const smokeMarker = `__STOA_PACKAGED_SMOKE_${Date.now()}__`
let smokeRequestPath = null
let smokeProbePath = null

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requireFile(filePath, description) {
  try {
    await access(filePath)
  } catch {
    throw new Error(`Missing packaged ${description} at ${filePath}`)
  }
}

function parseSmokeRecords(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function readSmokeRecords() {
  try {
    return parseSmokeRecords(await readFile(smokeFile, 'utf8'))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

async function waitForPackagedSmoke(child, timeoutMs = 90_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs
  let lastRecords = []

  while (Date.now() < deadline) {
    lastRecords = await readSmokeRecords()
    const failedRecord = lastRecords.find((record) => record.step === 'failed')
    if (failedRecord) {
      throw new Error(`Packaged smoke failed: ${failedRecord.message ?? 'unknown error'}`)
    }

    const completedRecord = lastRecords.find((record) => record.step === 'completed')
    if (completedRecord) {
      return lastRecords
    }

    if (child.exitCode !== null) {
      throw new Error(`Packaged app exited early with code ${child.exitCode}.`)
    }

    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for packaged smoke completion. Last records: ${JSON.stringify(lastRecords)}`)
}

async function resolvePackagedSmokeExecutable() {
  await access(releaseDir)
  return await findPackagedExecutable({
    releaseDir,
    platform,
    productName: 'Stoa',
    packageName: 'stoa'
  })
}

async function verifyPackagedEvolver() {
  await requireFile(join(packagedEvolverDir, 'index.js'), 'Evolver entrypoint')
  await requireFile(join(packagedEvolverDir, 'package.json'), 'Evolver package manifest')
}

async function terminateChild(child) {
  if (child.exitCode !== null || child.pid === undefined) {
    return
  }

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true
      })
      killer.once('exit', () => resolve())
      killer.once('error', () => resolve())
    })
    return
  }

  child.kill('SIGKILL')
}

let child
let stdout = ''
let stderr = ''

try {
  const packagedExecutable = await resolvePackagedSmokeExecutable()
  const packagedExecutableDir = executableDirectory(packagedExecutable)
  smokeRequestPath = join(packagedExecutableDir, 'stoa-packaged-smoke-request.json')
  smokeProbePath = join(packagedExecutableDir, 'stoa-packaged-smoke-probe.log')
  await verifyPackagedEvolver()
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    smokeRequestPath,
    JSON.stringify({
      smokeFile,
      projectDir,
      marker: smokeMarker,
      stateDir
    }, null, 2),
    'utf8'
  )

  const {
    STOA_EVOLVER_REPO_ROOT: _ignoredStoaEvolverRepoRoot,
    ...spawnEnv
  } = process.env

  child = spawn(packagedExecutable, [
    `--stoa-packaged-smoke-file=${smokeFile}`,
    `--stoa-packaged-smoke-project-dir=${projectDir}`,
    `--stoa-packaged-smoke-marker=${smokeMarker}`
  ], {
    cwd: stateDir,
    env: {
      ...spawnEnv,
      VIBECODING_STATE_DIR: stateDir,
      STOA_PACKAGED_SMOKE_FILE: smokeFile,
      STOA_PACKAGED_SMOKE_PROJECT_DIR: projectDir,
      STOA_PACKAGED_SMOKE_MARKER: smokeMarker
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })

  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk) => {
    stdout += chunk
  })

  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk) => {
    stderr += chunk
  })

  const records = await waitForPackagedSmoke(child)
  await sleep(1_000)
  await terminateChild(child)

  const sessionLiveRecord = records.find((record) => record.step === 'session-live')
  const markerRecord = records.find((record) => record.step === 'terminal-marker-observed')
  const claudeHookRecord = records.find((record) => record.step === 'claude-session-start-hook-verified')
  if (!claudeHookRecord) {
    throw new Error(`Packaged smoke never recorded claude-session-start-hook-verified. Records: ${JSON.stringify(records)}`)
  }
  console.log(
    `Packaged release smoke verified: ${packagedExecutable} booted, reached ${sessionLiveRecord?.status ?? 'live'} session state, observed ${markerRecord?.marker ?? smokeMarker}, and executed the Claude SessionStart memory hook.`
  )
} catch (error) {
  const records = await readSmokeRecords().catch(() => [])
  const probeSummary =
    smokeProbePath
      ? await readFile(smokeProbePath, 'utf8')
        .then((content) => (content.trim().length > 0 ? `\nProbe log:\n${content}` : ''))
        .catch(() => '')
      : ''
  const recordSummary = records.length > 0 ? `\nSmoke records: ${JSON.stringify(records)}` : ''
  const stdoutSummary = stdout ? `\nstdout:\n${stdout}` : ''
  const stderrSummary = stderr ? `\nstderr:\n${stderr}` : ''
  throw new Error(`${error instanceof Error ? error.message : String(error)}${probeSummary}${recordSummary}${stdoutSummary}${stderrSummary}`)
} finally {
  if (child) {
    await terminateChild(child)
  }

  await rm(stateDir, { recursive: true, force: true })
  if (smokeRequestPath) {
    await rm(smokeRequestPath, { force: true })
  }
  if (smokeProbePath) {
    await rm(smokeProbePath, { force: true })
  }
}
