import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

const MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

export interface FinalBundleCapture {
  bundleName: string
  note: string
  images: string[]
}

export interface FinalBundleMaterializeResult {
  capturedBundles: string[]
  writtenFiles: string[]
}

export async function materializeCapturedBundles(input: {
  assetsDir: string
  captures: FinalBundleCapture[]
  bundleFilter?: string | null
}): Promise<FinalBundleMaterializeResult> {
  const knownBundles = await listKnownPromoBundles(input.assetsDir)
  const captures = input.bundleFilter
    ? input.captures.filter((capture) => capture.bundleName === input.bundleFilter)
    : input.captures

  const capturedBundles: string[] = []
  const writtenFiles: string[] = []

  for (const capture of captures) {
    if (!knownBundles.has(capture.bundleName)) {
      throw new Error(`Unknown bundle: ${capture.bundleName}`)
    }

    const bundleDir = join(input.assetsDir, capture.bundleName)
    await removeExistingBundleMedia(bundleDir)
    await mkdir(bundleDir, { recursive: true })
    await writeFile(join(bundleDir, 'index.md'), `${capture.note.trim()}\n`, 'utf8')

    for (const [index, imagePath] of capture.images.entries()) {
      const extension = extname(imagePath).toLowerCase() || '.png'
      const fileName = `${String(index + 1).padStart(2, '0')}${extension}`
      const destination = join(bundleDir, fileName)
      await cp(imagePath, destination, { force: true })
      writtenFiles.push(`automation/promo/assets/${capture.bundleName}/${fileName}`)
    }

    capturedBundles.push(capture.bundleName)
  }

  return {
    capturedBundles,
    writtenFiles
  }
}

async function listKnownPromoBundles(assetsDir: string): Promise<Set<string>> {
  if (!existsSync(assetsDir)) {
    return new Set()
  }

  const entries = await readdir(assetsDir, { withFileTypes: true })
  return new Set(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== 'generated' && entry.name !== 'manual')
      .map((entry) => entry.name)
  )
}

async function removeExistingBundleMedia(bundleDir: string): Promise<void> {
  if (!existsSync(bundleDir)) {
    return
  }

  const entries = await readdir(bundleDir, { withFileTypes: true })
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) {
      return
    }

    if (!MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      return
    }

    await rm(join(bundleDir, entry.name), { force: true })
  }))
}
