import { dirname, join, resolve } from 'node:path'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const entryPath = join(repoRoot, 'tools', 'stoa-ctl', 'index.ts')
const outputDir = join(repoRoot, 'out', 'tools', 'stoa-ctl')

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`)
])

await build({
  configFile: false,
  publicDir: false,
  resolve: {
    alias: {
      '@core': resolve(repoRoot, 'src/core'),
      '@shared': resolve(repoRoot, 'src/shared'),
      '@extensions': resolve(repoRoot, 'src/extensions')
    }
  },
  build: {
    emptyOutDir: false,
    minify: false,
    outDir: outputDir,
    target: 'node22',
    lib: {
      entry: entryPath,
      formats: ['es'],
      fileName: () => 'index.mjs'
    },
    rollupOptions: {
      external: (id) => nodeBuiltins.has(id)
    }
  }
})
