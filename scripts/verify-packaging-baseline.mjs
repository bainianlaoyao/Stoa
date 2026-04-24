import { access, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const releaseDir = join(root, 'release')
const unpackedExecutable = join(releaseDir, 'win-unpacked', 'Stoa.exe')
const latestYmlPath = join(releaseDir, 'latest.yml')

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

await access(releaseDir)
await access(unpackedExecutable)
await access(latestYmlPath)

const latestYml = await readFile(latestYmlPath, 'utf8')
const installerPathMatch = latestYml.match(/^path:\s*(.+)$/m)
const installerSizeMatch = latestYml.match(/^\s*size:\s*(\d+)$/m)

if (!installerPathMatch) {
  throw new Error('release/latest.yml is missing a top-level "path" entry for the Windows installer.')
}

const installerName = parseYamlScalar(installerPathMatch[1])
if (!installerName.toLowerCase().endsWith('.exe')) {
  throw new Error(`release/latest.yml path must reference an installer .exe, received: ${installerName}`)
}

const releaseEntries = await readdir(releaseDir, { withFileTypes: true })
const releaseFiles = releaseEntries.filter((entry) => entry.isFile()).map((entry) => entry.name)
const installerCandidates = releaseEntries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
const expectedInstallerSize = installerSizeMatch ? Number(installerSizeMatch[1]) : null
const matchedInstaller = installerCandidates.find((entry) => {
  const normalizedEntry = normalizeArtifactName(entry.name)
  const normalizedExpected = normalizeArtifactName(installerName)
  if (normalizedEntry === normalizedExpected) {
    return true
  }

  return expectedInstallerSize !== null && entry.name.toLowerCase().includes('setup') && 'size' in entry && entry.size === expectedInstallerSize
})

if (!matchedInstaller) {
  throw new Error(`Expected an NSIS installer matching ${installerName} in release/. Found files: ${releaseFiles.join(', ')}`)
}

const blockmapPath = join(releaseDir, `${matchedInstaller.name}.blockmap`)
await access(blockmapPath)

if (!latestYml.includes('files:')) {
  throw new Error('release/latest.yml is missing the files manifest required by electron-updater.')
}

console.log(
  `Packaging baseline verified: ${matchedInstaller.name}, ${matchedInstaller.name}.blockmap, latest.yml, and win-unpacked/Stoa.exe exist in release/.`
)
