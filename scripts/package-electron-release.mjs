import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronBuilderCli = require.resolve('electron-builder/out/cli/cli.js')
const appVersion = require('../package.json').version
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = join(repoRoot, 'release')
const stagingDir = join(repoRoot, '.tmp', 'release-staging')

const builderArgs = [
  '--config',
  'electron-builder.yml',
  `-c.directories.output=${stagingDir}`,
  ...process.argv.slice(2),
]
const builderEnv = {
  ...process.env,
  GH_OWNER: process.env.GH_OWNER || 'local-dev',
  GH_REPO: process.env.GH_REPO || 'stoa-local',
  STOA_RELEASE_DIR: stagingDir,
}

function resolvePnpmCli() {
  const fromWhere = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['pnpm'], {
    encoding: 'utf8',
  })
  const firstMatch = fromWhere.stdout?.split(/\r?\n/).find(Boolean)
  if (firstMatch) {
    return resolve(dirname(firstMatch), 'node_modules/pnpm/bin/pnpm.cjs')
  }

  return null
}

const pnpmCli = resolvePnpmCli()
if (!pnpmCli) {
  console.error('Unable to resolve pnpm CLI. Run this packaging script through an environment with pnpm on PATH.')
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
  if (result.error) {
    console.error(`Failed to spawn ${command}: ${result.error.message}`)
  }
  return result
}

function syncPublishArtifacts() {
  mkdirSync(releaseDir, { recursive: true })
  const versionMarker = `${appVersion}-`
  const filesToSync = readdirSync(stagingDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        name === 'latest.yml' ||
        name === 'latest-mac.yml' ||
        name === 'latest-linux.yml' ||
        name.includes(versionMarker)
    )

  for (const fileName of filesToSync) {
    copyFileSync(join(stagingDir, fileName), join(releaseDir, fileName))
  }
}

rmSync(stagingDir, { recursive: true, force: true })

const rebuildForElectron = run(process.execPath, [pnpmCli, 'run', 'rebuild:native'])
let exitCode = rebuildForElectron.status ?? 1

if (exitCode === 0) {
  const packaged = spawnSync(process.execPath, [electronBuilderCli, ...builderArgs], {
    stdio: 'inherit',
    env: builderEnv,
  })
  exitCode = packaged.status ?? 1
  if (exitCode === 0 && existsSync(stagingDir)) {
    syncPublishArtifacts()
  }
}

const restoredNodeAbi = run(process.execPath, [pnpmCli, 'rebuild', 'better-sqlite3'])
if ((restoredNodeAbi.status ?? 1) !== 0 && exitCode === 0) {
  exitCode = restoredNodeAbi.status ?? 1
}

process.exit(exitCode)
