import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(rootDir, '..')
const buildRoot = resolve(repoRoot, '.tmp', 'experiment-runner-build')

const aliasRoots = new Map([
  ['@core', join(buildRoot, 'src', 'core')],
  ['@shared', join(buildRoot, 'src', 'shared')],
  ['@extensions', join(buildRoot, 'src', 'extensions')]
])

const JS_IMPORT_RE = /((?:from|import)\s*\(?\s*["'])(\.\.?\/[^"')]+)(["'])/g

function needsJsExtension(specifier) {
  if (!specifier.startsWith('.')) {
    return false
  }
  return !/\.(?:[cm]?js|json|node)$/i.test(specifier)
}

async function rewriteRelativeImports(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const targetPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await rewriteRelativeImports(targetPath)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) {
      continue
    }

    const source = await readFile(targetPath, 'utf8')
    const next = source.replace(JS_IMPORT_RE, (full, prefix, specifier, suffix) => {
      if (!needsJsExtension(specifier)) {
        return full
      }
      return `${prefix}${specifier}.js${suffix}`
    })
    if (next !== source) {
      await writeFile(targetPath, next, 'utf8')
    }
  }
}

async function collectJsFiles(dir) {
  const files = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const targetPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectJsFiles(targetPath))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(targetPath)
    }
  }
  return files
}

function parseAliasSpecifier(specifier) {
  const segments = specifier.split('/')
  if (segments.length < 2 || !specifier.startsWith('@')) {
    return null
  }

  const alias = segments[0]
  const packageName = segments.length > 2 ? `${segments[0]}/${segments[1]}` : specifier
  const packageSegments = packageName.split('/').slice(1)

  return {
    alias,
    packageName,
    sourcePath: join(aliasRoots.get(alias) ?? '', ...packageSegments)
  }
}

async function buildExportsMap(packageDir) {
  const exportsMap = {}
  const files = await collectJsFiles(packageDir)
  for (const filePath of files) {
    const relativePath = relative(packageDir, filePath).split(sep).join('/')
    const exportTarget = `./${relativePath}`
    const withoutExtension = relativePath.slice(0, -'.js'.length)
    exportsMap[`./${withoutExtension}`] = exportTarget
    if (relativePath === 'index.js') {
      exportsMap['.'] = exportTarget
      continue
    }
    if (relativePath.endsWith('/index.js')) {
      const directoryExport = `./${relativePath.slice(0, -'/index.js'.length)}`
      exportsMap[directoryExport] = exportTarget
    }
  }
  return exportsMap
}

async function resolveSourcePath(sourcePath) {
  const directStat = await stat(sourcePath).catch(() => null)
  if (directStat) {
    return sourcePath
  }

  const jsPath = `${sourcePath}.js`
  const jsStat = await stat(jsPath).catch(() => null)
  if (jsStat) {
    return jsPath
  }

  return null
}

async function writeAliasPackage(packageName, sourcePath) {
  const packageDir = join(buildRoot, 'node_modules', packageName)
  await mkdir(packageDir, { recursive: true })
  const sourceStat = await stat(sourcePath)
  if (sourceStat.isDirectory()) {
    await cp(sourcePath, packageDir, { recursive: true, force: true })
  } else {
    await cp(dirname(sourcePath), packageDir, { recursive: true, force: true })
  }
  const exportsMap = await buildExportsMap(packageDir)
  if (!sourceStat.isDirectory()) {
    exportsMap['.'] = `./${basename(sourcePath)}`
  }
  await writeFile(
    join(packageDir, 'package.json'),
    `${JSON.stringify({
      name: packageName,
      type: 'module',
      exports: exportsMap
    }, null, 2)}\n`,
    'utf8'
  )
}

const buildStat = await stat(buildRoot).catch(() => null)
if (!buildStat?.isDirectory()) {
  throw new Error(`Experiment runner build root was not found: ${buildRoot}`)
}

await rm(join(buildRoot, 'node_modules'), { recursive: true, force: true })
await rewriteRelativeImports(buildRoot)

const packageRoots = new Map()
for (const filePath of await collectJsFiles(buildRoot)) {
  const source = await readFile(filePath, 'utf8')
  for (const match of source.matchAll(/['"](@(?:core|shared|extensions)\/[^'"]+)['"]/g)) {
    const parsed = parseAliasSpecifier(match[1])
    if (parsed) {
      packageRoots.set(parsed.packageName, parsed.sourcePath)
    }
  }
}

for (const [packageName, sourcePath] of packageRoots) {
  const resolvedSourcePath = await resolveSourcePath(sourcePath)
  if (!resolvedSourcePath) {
    continue
  }
  await writeAliasPackage(packageName, resolvedSourcePath)
}
