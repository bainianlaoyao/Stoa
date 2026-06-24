import process from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { rebuild } from '@electron/rebuild'

const require = createRequire(import.meta.url)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const builderConfig = readFileSync(resolve(repoRoot, 'electron-builder.yml'), 'utf8')
const configuredElectronVersion = builderConfig.match(/^electronVersion:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1]
const electronVersion = configuredElectronVersion ?? require('electron/package.json').version
const nativeModules = ['better-sqlite3']

console.log(
  `Rebuilding native modules for Electron ${electronVersion} (${process.platform}-${process.arch}): ${nativeModules.join(', ')}`
)

try {
  await rebuild({
    buildPath: repoRoot,
    electronVersion,
    arch: process.arch,
    force: true,
    onlyModules: nativeModules,
  })

  console.log('Native module rebuild complete.')
} catch (error) {
  console.error('Native module rebuild failed.')
  console.error(error)
  process.exitCode = 1
}
