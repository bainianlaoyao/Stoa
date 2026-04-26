import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cli = require.resolve('electron-builder/out/cli/cli.js')
const args = ['--config', 'electron-builder.yml', ...process.argv.slice(2)]
const env = {
  ...process.env,
  GH_OWNER: process.env.GH_OWNER || 'local-dev',
  GH_REPO: process.env.GH_REPO || 'stoa-local'
}

const result = spawnSync(process.execPath, [cli, ...args], {
  stdio: 'inherit',
  env
})

process.exit(result.status ?? 1)
