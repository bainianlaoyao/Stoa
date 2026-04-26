import { access, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const PLATFORM_ALIASES = new Map([
  ['win', 'win32'],
  ['windows', 'win32'],
  ['win32', 'win32'],
  ['mac', 'darwin'],
  ['macos', 'darwin'],
  ['darwin', 'darwin'],
  ['linux', 'linux']
])

const ARTIFACT_EXTENSIONS = {
  win32: ['.exe'],
  darwin: ['.dmg', '.zip'],
  linux: ['.AppImage', '.deb', '.rpm', '.tar.gz']
}

export function normalizePlatform(platform = process.platform) {
  const normalized = String(platform).trim().toLowerCase()
  const resolved = PLATFORM_ALIASES.get(normalized)
  if (!resolved) {
    throw new Error(`Unsupported packaging platform: ${platform}`)
  }
  return resolved
}

export function resolveBuilderPlatform(platform = process.platform) {
  const normalized = normalizePlatform(platform)
  if (normalized === 'win32') return 'win'
  if (normalized === 'darwin') return 'mac'
  return 'linux'
}

export function resolveReleaseMetadataName(platform = process.platform) {
  const normalized = normalizePlatform(platform)
  if (normalized === 'win32') return 'latest.yml'
  if (normalized === 'darwin') return 'latest-mac.yml'
  return 'latest-linux.yml'
}

export function executableDirectory(executablePath) {
  return dirname(executablePath)
}

function parseYamlScalar(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function normalizeArtifactName(value) {
  return value.toLowerCase().replace(/[\s_-]+/g, '')
}

function hasAllowedExtension(name, platform) {
  return ARTIFACT_EXTENSIONS[platform].some((extension) => name.endsWith(extension))
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function findFirstExisting(paths) {
  for (const candidate of paths) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }
  return null
}

async function findMacExecutable(releaseDir, productName) {
  const appRoots = [
    join(releaseDir, 'mac', `${productName}.app`),
    join(releaseDir, 'mac-arm64', `${productName}.app`),
    join(releaseDir, `${productName}.app`)
  ]

  for (const appRoot of appRoots) {
    const macOsDir = join(appRoot, 'Contents', 'MacOS')
    const entries = await readdir(macOsDir, { withFileTypes: true }).catch(() => [])
    const executable = entries.find((entry) => entry.isFile())
    if (executable) {
      return join(macOsDir, executable.name)
    }
  }

  return null
}

async function findLinuxExecutable(releaseDir, productName, packageName) {
  const unpackedDir = join(releaseDir, 'linux-unpacked')
  const preferred = await findFirstExisting([
    join(unpackedDir, packageName),
    join(unpackedDir, productName),
    join(unpackedDir, productName.toLowerCase())
  ])
  if (preferred) {
    return preferred
  }

  const entries = await readdir(unpackedDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }

    const candidate = join(unpackedDir, entry.name)
    const candidateStat = await stat(candidate).catch(() => null)
    if (candidateStat && (candidateStat.mode & 0o111) !== 0) {
      return candidate
    }
  }

  return null
}

export async function resolvePackagedExecutable(options = {}) {
  const releaseDir = options.releaseDir ?? join(process.cwd(), 'release')
  const platform = normalizePlatform(options.platform)
  const productName = options.productName ?? 'Stoa'
  const packageName = options.packageName ?? 'stoa'

  if (platform === 'win32') {
    const winDir = join(releaseDir, 'win-unpacked')
    const entries = await readdir(winDir, { withFileTypes: true }).catch(() => [])
    const executable = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    if (!executable) {
      throw new Error(`No packaged Windows executable found in ${winDir}.`)
    }
    return join(winDir, executable.name)
  }

  if (platform === 'darwin') {
    const executable = await findMacExecutable(releaseDir, productName)
    if (!executable) {
      throw new Error(`No packaged macOS app executable found in ${releaseDir}.`)
    }
    return executable
  }

  const executable = await findLinuxExecutable(releaseDir, productName, packageName)
  if (!executable) {
    throw new Error(`No packaged Linux executable found in ${join(releaseDir, 'linux-unpacked')}.`)
  }
  return executable
}

async function findArtifact(releaseDir, platform, artifactName, expectedSize) {
  const entries = await readdir(releaseDir, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  const normalizedExpected = normalizeArtifactName(artifactName)

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }

    const name = entry.name
    if (!hasAllowedExtension(name, platform)) {
      continue
    }

    if (normalizeArtifactName(name) === normalizedExpected) {
      return name
    }

    if (expectedSize !== null) {
      const entryStat = await stat(join(releaseDir, name)).catch(() => null)
      if (entryStat?.size === expectedSize) {
        return name
      }
    }
  }

  throw new Error(`Expected a ${resolveBuilderPlatform(platform)} artifact matching ${artifactName} in ${releaseDir}. Found files: ${files.join(', ')}`)
}

export async function verifyPackagingBaseline(options = {}) {
  const releaseDir = options.releaseDir ?? join(process.cwd(), 'release')
  const platform = normalizePlatform(options.platform)
  const metadataName = resolveReleaseMetadataName(platform)
  const metadataPath = join(releaseDir, metadataName)

  await access(releaseDir)
  const executablePath = await resolvePackagedExecutable({
    releaseDir,
    platform,
    productName: options.productName ?? 'Stoa',
    packageName: options.packageName ?? 'stoa'
  })
  await access(metadataPath)

  const metadata = await readFile(metadataPath, 'utf8')
  const artifactPathMatch = metadata.match(/^path:\s*(.+)$/m)
  const artifactSizeMatch = metadata.match(/^\s*size:\s*(\d+)$/m)

  if (!artifactPathMatch) {
    throw new Error(`${join('release', metadataName)} is missing a top-level "path" entry.`)
  }

  const artifactName = parseYamlScalar(artifactPathMatch[1])
  if (!hasAllowedExtension(artifactName, platform)) {
    throw new Error(`${join('release', metadataName)} path references an unsupported ${resolveBuilderPlatform(platform)} artifact: ${artifactName}`)
  }

  const expectedSize = artifactSizeMatch ? Number(artifactSizeMatch[1]) : null
  const matchedArtifact = await findArtifact(releaseDir, platform, basename(artifactName), expectedSize)
  if (expectedSize !== null) {
    const matchedArtifactStat = await stat(join(releaseDir, matchedArtifact))
    if (matchedArtifactStat.size !== expectedSize) {
      throw new Error(`Artifact ${matchedArtifact} size ${matchedArtifactStat.size} does not match ${metadataName} size ${expectedSize}.`)
    }
  }

  if (platform === 'win32') {
    await access(join(releaseDir, `${matchedArtifact}.blockmap`))
  }

  if (!metadata.includes('files:')) {
    throw new Error(`${join('release', metadataName)} is missing the files manifest required by electron-updater.`)
  }

  return {
    platform,
    metadataName,
    artifactName: matchedArtifact,
    executablePath
  }
}
