import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(import.meta.dirname, '..')
const outputDir = join(repoRoot, 'out', 'tools', 'stoa-ctl')
const outputPath = join(outputDir, 'index.mjs')

describe('build-stoa-ctl', () => {
  test('produces a packaged CLI module that Node can import directly', async () => {
    await rm(outputDir, { recursive: true, force: true })

    await execFileAsync(process.execPath, ['scripts/build-stoa-ctl.mjs'], {
      cwd: repoRoot
    })

    const moduleUrl = `${pathToFileURL(outputPath).href}?t=${Date.now()}`
    const builtModule = await import(moduleUrl)

    expect(typeof builtModule.run).toBe('function')
    expect(builtModule.USAGE_TEXT).toContain('session input <sessionId>')
    expect(builtModule.USAGE_TEXT).not.toContain('session prompt')
  })
})
