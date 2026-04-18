import { access } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const requiredFiles = [
  join(root, 'out', 'main', 'index.js'),
  join(root, 'out', 'preload', 'index.mjs'),
  join(root, 'out', 'renderer', 'index.html')
]

for (const file of requiredFiles) {
  await access(file)
}

console.log('Packaging baseline verified: Electron main, preload, and renderer build artifacts exist.')
