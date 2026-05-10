import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const entryPath = join(repoRoot, 'tools', 'stoa-ctl', 'index.ts')
const outputPath = join(repoRoot, 'out', 'tools', 'stoa-ctl', 'index.mjs')

const source = await readFile(entryPath, 'utf8')
const shebangMatch = source.match(/^#!.*\r?\n/)
const shebang = shebangMatch?.[0] ?? ''
const body = shebangMatch ? source.slice(shebang.length) : source

const transpiled = ts.transpileModule(body, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true
  },
  fileName: entryPath
})

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${shebang}${transpiled.outputText}`, 'utf8')
