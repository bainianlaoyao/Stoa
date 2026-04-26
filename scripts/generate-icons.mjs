import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const svgPath = resolve(rootDir, 'build/icons/icon-source.svg')
const svgBuffer = readFileSync(svgPath)

const sizes = [16, 24, 32, 48, 64, 128, 256]

async function generatePngs() {
  const largePng = await sharp(svgBuffer).resize(1024, 1024).png().toBuffer()
  writeFileSync(resolve(rootDir, 'build/icons/icon.png'), largePng)
  console.log('  icon.png (1024x1024)')

  for (const size of sizes) {
    const png = await sharp(svgBuffer).resize(size, size).png().toBuffer()
    writeFileSync(resolve(rootDir, `build/icons/icon-${size}.png`), png)
    console.log(`  icon-${size}.png`)
  }
}

async function generateIco() {
  const png16 = await sharp(svgBuffer).resize(16, 16).png().toBuffer()
  const png32 = await sharp(svgBuffer).resize(32, 32).png().toBuffer()
  const png48 = await sharp(svgBuffer).resize(48, 48).png().toBuffer()
  const png256 = await sharp(svgBuffer).resize(256, 256).png().toBuffer()

  const images = [
    { width: 16, height: 16, data: png16 },
    { width: 32, height: 32, data: png32 },
    { width: 48, height: 48, data: png48 },
    { width: 256, height: 256, data: png256 },
  ]

  const headerSize = 6
  const dirEntrySize = 16
  const dirSize = dirEntrySize * images.length
  let dataOffset = headerSize + dirSize

  const dirEntries = []
  for (const img of images) {
    dirEntries.push({
      width: img.width === 256 ? 0 : img.width,
      height: img.height === 256 ? 0 : img.height,
      size: img.data.length,
      offset: dataOffset,
      data: img.data,
    })
    dataOffset += img.data.length
  }

  const totalSize = dataOffset
  const buf = Buffer.alloc(totalSize)
  let pos = 0

  buf.writeUInt16LE(0, pos); pos += 2
  buf.writeUInt16LE(1, pos); pos += 2
  buf.writeUInt16LE(images.length, pos); pos += 2

  for (const entry of dirEntries) {
    buf.writeUInt8(entry.width, pos); pos += 1
    buf.writeUInt8(entry.height, pos); pos += 1
    buf.writeUInt8(0, pos); pos += 1
    buf.writeUInt8(0, pos); pos += 1
    buf.writeUInt16LE(1, pos); pos += 2
    buf.writeUInt16LE(32, pos); pos += 2
    buf.writeUInt32LE(entry.size, pos); pos += 4
    buf.writeUInt32LE(entry.offset, pos); pos += 4
  }

  for (const entry of dirEntries) {
    entry.data.copy(buf, pos)
    pos += entry.data.length
  }

  writeFileSync(resolve(rootDir, 'build/icons/icon.ico'), buf)
  console.log('  icon.ico')
}

async function generateRendererAssets() {
  const symbolSvg = readFileSync(resolve(rootDir, 'src/renderer/assets/brand/stoa-symbol.svg'))

  const flatPng = await sharp(symbolSvg).resize(64, 64).png().toBuffer()
  const outDir = resolve(rootDir, 'src/renderer/assets/icons')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'Stoa-flat.png'), flatPng)
  writeFileSync(resolve(outDir, 'Stoa-glass.png'), flatPng)
  console.log('  Stoa-flat.png')
  console.log('  Stoa-glass.png')
}

console.log('Generating icon assets from icon-source.svg ...')
await generatePngs()
await generateIco()
await generateRendererAssets()
console.log('Done.')
