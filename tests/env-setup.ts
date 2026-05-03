import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const envTestPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.test')
if (existsSync(envTestPath)) {
  for (const line of readFileSync(envTestPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex < 0) continue
    const key = trimmed.slice(0, eqIndex).trim()
    if (!(key in process.env)) {
      process.env[key] = trimmed.slice(eqIndex + 1).trim()
    }
  }
}
