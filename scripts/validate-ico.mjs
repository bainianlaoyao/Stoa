import { readFile } from 'node:fs/promises'

const expectedSizes = [16, 24, 32, 48, 64, 128, 256]

function readPngSize(buffer) {
  const pngSignature = '89504e470d0a1a0a'
  if (buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    return null
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25]
  }
}

function readBmpSize(buffer) {
  if (buffer.length < 16) {
    return null
  }

  const headerSize = buffer.readUInt32LE(0)
  if (headerSize < 40) {
    return null
  }

  return {
    width: buffer.readInt32LE(4),
    height: Math.abs(buffer.readInt32LE(8)) / 2,
    bitsPerPixel: buffer.readUInt16LE(14)
  }
}

function hasAlpha(entryBuffer, bitCount) {
  const pngInfo = readPngSize(entryBuffer)
  if (pngInfo) {
    return pngInfo.colorType === 4 || pngInfo.colorType === 6
  }

  const bmpInfo = readBmpSize(entryBuffer)
  if (bmpInfo) {
    return Math.max(bitCount, bmpInfo.bitsPerPixel) >= 32
  }

  return false
}

async function main() {
  const icoPath = process.argv[2] ?? 'build/icons/icon.ico'
  const buffer = await readFile(icoPath)

  const reserved = buffer.readUInt16LE(0)
  const type = buffer.readUInt16LE(2)
  const count = buffer.readUInt16LE(4)

  if (reserved !== 0 || type !== 1) {
    throw new Error(`Invalid ICO header in ${icoPath}`)
  }

  const entries = []
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16
    const width = buffer[offset] || 256
    const height = buffer[offset + 1] || 256
    const bitCount = buffer.readUInt16LE(offset + 6)
    const bytesInRes = buffer.readUInt32LE(offset + 8)
    const imageOffset = buffer.readUInt32LE(offset + 12)
    const entryBuffer = buffer.subarray(imageOffset, imageOffset + bytesInRes)
    const pngInfo = readPngSize(entryBuffer)
    const bmpInfo = pngInfo ? null : readBmpSize(entryBuffer)

    entries.push({
      width,
      height,
      bitCount,
      bytesInRes,
      imageOffset,
      storage: pngInfo ? 'png' : 'bmp',
      parsedWidth: pngInfo?.width ?? bmpInfo?.width ?? width,
      parsedHeight: pngInfo?.height ?? bmpInfo?.height ?? height,
      alpha: hasAlpha(entryBuffer, bitCount)
    })
  }

  const entrySizes = entries.map((entry) => entry.width).sort((a, b) => a - b)
  const uniqueSizes = [...new Set(entrySizes)]
  if (uniqueSizes.length !== expectedSizes.length || uniqueSizes.some((size, index) => size !== expectedSizes[index])) {
    throw new Error(`Unexpected icon sizes in ${icoPath}: ${uniqueSizes.join(', ')}`)
  }

  for (const entry of entries) {
    if (entry.width !== entry.height || entry.parsedWidth !== entry.parsedHeight || entry.width !== entry.parsedWidth) {
      throw new Error(`Non-square entry detected in ${icoPath}: ${JSON.stringify(entry)}`)
    }

    if (!entry.alpha) {
      throw new Error(`Entry ${entry.width}x${entry.height} in ${icoPath} does not advertise alpha support`)
    }
  }

  console.log(JSON.stringify({ icoPath, entries }, null, 2))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
