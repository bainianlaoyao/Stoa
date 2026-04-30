import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function collectSourceFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = []
  const skipDirs = new Set(['node_modules', 'dist', '.git', '.nuxt', '.output', 'out'])

  function walk(current: string): void {
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) {
          walk(join(current, entry.name))
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (extensions.includes(ext)) {
          results.push(join(current, entry.name))
        }
      }
    }
  }

  walk(dir)
  return results
}

function readSrc(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

function hasPatchedSurfaceImport(content: string): string | null {
  // Pattern 1: require() or import from src/stoa/
  const stoaImportPattern = /(?:require\(|from\s+|import\()\s*['"][^'"]*\/stoa\/[^'"]*['"]/
  if (stoaImportPattern.test(content)) {
    const match = content.match(stoaImportPattern)
    return `Import of patched src/stoa/ surface: ${match?.[0]}`
  }

  // Pattern 2: require() or import of hostBridge, host-bridge as an evolver import
  const hostBridgeImportPattern = /(?:require\(|from\s+|import\()\s*['"][^'"]*(?:hostBridge|host-bridge)['"]/
  if (hostBridgeImportPattern.test(content)) {
    const match = content.match(hostBridgeImportPattern)
    return `Import of hostBridge/host-bridge: ${match?.[0]}`
  }

  // Pattern 3: require() or import of publishContext, publish-context as an evolver import
  const publishContextImportPattern = /(?:require\(|from\s+|import\()\s*['"][^'"]*(?:publishContext|publish-context)['"]/
  if (publishContextImportPattern.test(content)) {
    const match = content.match(publishContextImportPattern)
    return `Import of publishContext/publish-context: ${match?.[0]}`
  }

  // Pattern 4: forbidden action names as CLI dispatch strings
  // state-summary, trace-turn, explain-recall, get-asset
  const forbiddenActionPatterns = [
    /['"]state-summary['"]/,
    /['"]trace-turn['"]/,
    /['"]explain-recall['"]/,
    /['"]get-asset['"]/,
  ]
  for (const pattern of forbiddenActionPatterns) {
    if (pattern.test(content)) {
      const match = content.match(pattern)
      return `Reference to forbidden patched action surface: ${match?.[0]}`
    }
  }

  return null
}

describe('Upstream Boundary Guard', () => {
  const scannedDirs = [
    { name: 'src/', path: join(root, 'src') },
    { name: 'scripts/', path: join(root, 'scripts') },
  ]

  const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']

  const allFiles: Array<{ relPath: string; fullPath: string }> = []
  for (const dir of scannedDirs) {
    try {
      statSync(dir.path)
      const files = collectSourceFiles(dir.path, sourceExtensions)
      for (const f of files) {
        allFiles.push({ relPath: relative(root, f), fullPath: f })
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  it('scanned at least one source file', () => {
    expect(allFiles.length, 'Expected to find source files in src/ and scripts/').toBeGreaterThan(0)
  })

  it('no Stoa source file imports from patched src/stoa/ surface', () => {
    // Files scheduled for deletion in later tasks (Task 3 and Task 4)
    // still reference patched surfaces. They are tracked as known violations
    // and excluded until their deletion task lands.
    const scheduledForDeletion = new Set([
      'src/core/memory/evolver-client.ts',
      'src/core/memory/evolver-client.test.ts',
      'src/core/memory/stoa-evolver-bridge.ts',
      'src/core/memory/stoa-evolver-bridge.test.ts',
      'src/core/memory/host-bridge-cli.test.ts',
      'src/core/memory/command-runner.ts',
      'src/core/memory/command-runner.test.ts',
      'src/core/memory/evolver-publish-context.test.ts',
    ])

    const violations: Array<{ file: string; detail: string }> = []

    for (const { relPath, fullPath } of allFiles) {
      if (relPath.includes('upstream-boundary-guard.test.ts')) continue
      const normalizedRelPath = relPath.replace(/\\/g, '/')
      if (scheduledForDeletion.has(normalizedRelPath)) continue

      const content = readSrc(fullPath)
      const violation = hasPatchedSurfaceImport(content)
      if (violation) {
        violations.push({ file: relPath, detail: violation })
      }
    }

    expect(
      violations,
      `Found patched surface imports in Stoa source files:\n${
        violations.map(v => `  ${v.file}: ${v.detail}`).join('\n')
      }`
    ).toHaveLength(0)
  })

  it('bundled-evolver.ts does not export resolveBundledEvolverCli', () => {
    const bundledEvolverPath = join(root, 'src', 'core', 'memory', 'bundled-evolver.ts')
    const content = readSrc(bundledEvolverPath)

    expect(content, 'bundled-evolver.ts must exist').toBeTruthy()
    expect(content).not.toContain('resolveBundledEvolverCli')
    expect(content).not.toContain('isElectronRuntime')
  })

  it('bundled-evolver.ts does not export CLI-shaped return types', () => {
    const bundledEvolverPath = join(root, 'src', 'core', 'memory', 'bundled-evolver.ts')
    const content = readSrc(bundledEvolverPath)

    expect(content).not.toContain('argsPrefix')
    expect(content).not.toContain('ELECTRON_RUN_AS_NODE')
  })
})
