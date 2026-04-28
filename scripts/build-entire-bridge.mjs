import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const bridgeDir = join(repoRoot, 'tools', 'entire-bridge')
const binaryName = process.platform === 'win32' ? 'entire-bridge.exe' : 'entire-bridge'
const outputPath = join(repoRoot, 'out', 'tools', 'entire-bridge', binaryName)
const goBinary = resolveGoBinary()
const modes = new Set(process.argv.slice(2))
const shouldTest = modes.size === 0 || modes.has('--test')
const shouldBuild = modes.size === 0 || modes.has('--build')

function runGo(args) {
  const result = spawnSync(goBinary, args, {
    cwd: bridgeDir,
    stdio: 'inherit',
    env: process.env
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function resolveGoBinary() {
  if (process.env.GO_BINARY) {
    return process.env.GO_BINARY
  }

  const pathProbe = spawnSync('go', ['version'], { stdio: 'ignore' })
  if (!pathProbe.error && pathProbe.status === 0) {
    return 'go'
  }

  if (process.platform === 'win32') {
    const tempDir = process.env.TEMP || process.env.TMP
    if (tempDir) {
      const candidates = [
        join(tempDir, 'go1.26.2.windows-amd64', 'go', 'bin', 'go.exe'),
        join(tempDir, 'go1.26.0.windows-amd64', 'go', 'bin', 'go.exe')
      ]
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return candidate
        }
      }
    }
  }

  return 'go'
}

if (shouldTest) {
  runGo(['test', './...'])
}

if (shouldBuild) {
  mkdirSync(dirname(outputPath), { recursive: true })
  runGo(['build', '-trimpath', '-o', outputPath, '.'])
}
