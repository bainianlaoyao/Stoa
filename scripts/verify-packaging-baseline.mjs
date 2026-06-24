import { resolveDefaultReleaseDir, verifyPackagingBaseline } from './packaging-artifacts.mjs'

const platform = process.env.STOA_PACKAGE_PLATFORM ?? process.argv.find((arg) => arg.startsWith('--platform='))?.slice('--platform='.length) ?? process.platform
const releaseDir = await resolveDefaultReleaseDir()

const result = await verifyPackagingBaseline({
  releaseDir,
  platform,
  productName: 'Stoa',
  packageName: 'stoa'
})

console.log(
  `Packaging baseline verified for ${result.platform}: ${result.artifactName}, ${result.metadataName}, and ${result.executablePath} exist in ${releaseDir}.`
)
