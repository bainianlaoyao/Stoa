import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { mkdir, rename, stat } from 'node:fs/promises'
import { get } from 'node:https'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

export const GO_TOOLCHAIN_VERSION = '1.26.2'

const GO_ARCHIVE_CHECKSUMS = {
  'darwin-amd64': 'bc3f1500d9968c36d705442d90ba91addf9271665033748b82532682e90a7966',
  'darwin-arm64': '32af1522bf3e3ff3975864780a429cc0b41d190ec7bf90faa661d6d64566e7af',
  'linux-amd64': '990e6b4bbba816dc3ee129eaeaf4b42f17c2800b88a2166c265ac1a200262282',
  'linux-arm64': 'c958a1fe1b361391db163a485e21f5f228142d6f8b584f6bef89b26f66dc5b23',
  'windows-amd64': '98eb3570bade15cb826b0909338df6cc6d2cf590bc39c471142002db3832b708'
}

function goOS(platform) {
  if (platform === 'win32') {
    return 'windows'
  }
  if (platform === 'darwin' || platform === 'linux') {
    return platform
  }
  throw new Error(`unsupported platform for managed Go toolchain: ${platform}`)
}

function goArch(arch) {
  if (arch === 'x64') {
    return 'amd64'
  }
  if (arch === 'arm64') {
    return 'arm64'
  }
  throw new Error(`unsupported architecture for managed Go toolchain: ${arch}`)
}

export function goArchiveForPlatform(platform = process.platform, arch = process.arch) {
  const osName = goOS(platform)
  const archName = goArch(arch)
  const key = `${osName}-${archName}`
  const checksum = GO_ARCHIVE_CHECKSUMS[key]
  if (!checksum) {
    throw new Error(`no managed Go checksum is declared for ${key}`)
  }
  const extension = osName === 'windows' ? 'zip' : 'tar.gz'
  return {
    osName,
    archName,
    key,
    checksum,
    fileName: `go${GO_TOOLCHAIN_VERSION}.${key}.${extension}`,
    url: `https://go.dev/dl/go${GO_TOOLCHAIN_VERSION}.${key}.${extension}`
  }
}

export function managedGoRoot({ cacheRoot, platform = process.platform, arch = process.arch } = {}) {
  const archive = goArchiveForPlatform(platform, arch)
  return join(cacheRoot, `go${GO_TOOLCHAIN_VERSION}.${archive.key}`)
}

export function managedGoBinaryPath({ cacheRoot, platform = process.platform, arch = process.arch } = {}) {
  const binaryName = platform === 'win32' ? 'go.exe' : 'go'
  return join(managedGoRoot({ cacheRoot, platform, arch }), 'go', 'bin', binaryName)
}

export function resolveGoBinary({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  cacheRoot,
  existsSync: exists = existsSync,
  spawnSync: spawn = spawnSync
} = {}) {
  if (env.GO_BINARY && env.GO_BINARY.trim().length > 0) {
    return env.GO_BINARY
  }

  const pathProbe = spawn('go', ['version'], { stdio: 'ignore' })
  if (!pathProbe.error && pathProbe.status === 0) {
    return 'go'
  }

  const managed = managedGoBinaryPath({ cacheRoot, platform, arch })
  if (exists(managed)) {
    return managed
  }

  return null
}

export async function ensureGoBinary({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  cacheRoot
} = {}) {
  const resolved = resolveGoBinary({ env, platform, arch, cacheRoot })
  if (resolved) {
    return resolved
  }

  const archive = goArchiveForPlatform(platform, arch)
  const root = managedGoRoot({ cacheRoot, platform, arch })
  const binary = managedGoBinaryPath({ cacheRoot, platform, arch })
  const archivePath = join(cacheRoot, archive.fileName)
  const stagingRoot = `${root}.tmp-${process.pid}-${Date.now()}`

  await mkdir(cacheRoot, { recursive: true })
  await ensureGoArchive({ archive, archivePath })

  rmIfExists(stagingRoot)
  await mkdir(stagingRoot, { recursive: true })
  extractArchive(archivePath, stagingRoot, platform)

  rmIfExists(root)
  await rename(stagingRoot, root)

  await stat(binary)
  return binary
}

export async function ensureGoArchive({
  archive,
  archivePath,
  existsSync: exists = existsSync,
  verifySha256: verify = verifySha256,
  downloadFile: download = downloadFile,
  rmIfExists: removeIfExists = rmIfExists
}) {
  if (exists(archivePath)) {
    try {
      await verify(archivePath, archive.checksum)
      return archivePath
    } catch {
      removeIfExists(archivePath)
    }
  }

  await download(archive.url, archivePath)
  await verify(archivePath, archive.checksum)
  return archivePath
}

async function downloadFile(url, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true })
  const tempPath = `${outputPath}.download-${process.pid}-${Date.now()}`
  await downloadToPath(url, tempPath)
  rmIfExists(outputPath)
  await rename(tempPath, outputPath)
}

async function downloadToPath(url, outputPath) {
  await new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        downloadToPath(response.headers.location, outputPath).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`failed to download ${url}: HTTP ${response.statusCode}`))
        return
      }

      const file = createWriteStream(outputPath)
      response.pipe(file)
      file.on('finish', () => {
        file.close(resolve)
      })
      file.on('error', reject)
    })
    request.on('error', reject)
  })
}

async function verifySha256(filePath, expected) {
  const { createReadStream } = await import('node:fs')
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  const actual = hash.digest('hex')
  if (actual !== expected) {
    throw new Error(`Go archive checksum mismatch for ${filePath}: ${actual} !== ${expected}`)
  }
}

function extractArchive(archivePath, destination, platform) {
  const command = platform === 'win32' ? 'powershell.exe' : 'tar'
  const args = platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive', '-LiteralPath', archivePath, '-DestinationPath', destination]
    : ['-xzf', archivePath, '-C', destination]

  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed while extracting managed Go toolchain`)
  }
}

function rmIfExists(path) {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true })
  }
}
