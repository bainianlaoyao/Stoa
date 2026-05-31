import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface PortFileData {
  port: number
  pid: number
  secret: string
  startedAt: string
}

export function getPortFilePath(): string {
  return join(homedir(), '.stoa', 'ctl.json')
}

export function generateSecret(): string {
  return randomBytes(32).toString('hex')
}

export async function writePortFile(data: PortFileData): Promise<void> {
  const filePath = getPortFilePath()
  const dir = join(homedir(), '.stoa')
  await mkdir(dir, { recursive: true })
  await writeFile(filePath, JSON.stringify(data), { mode: 0o600 })
}

export async function readPortFile(filePath?: string): Promise<PortFileData | null> {
  const path = filePath ?? getPortFilePath()
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const data = parsed as Record<string, unknown>

  if (typeof data.port !== 'number' || !Number.isInteger(data.port) || data.port < 1 || data.port > 65535) return null
  if (typeof data.pid !== 'number' || !Number.isInteger(data.pid) || data.pid < 1) return null
  if (typeof data.secret !== 'string' || data.secret.length === 0) return null
  if (typeof data.startedAt !== 'string') return null

  return {
    port: data.port,
    pid: data.pid,
    secret: data.secret,
    startedAt: data.startedAt
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function deletePortFile(): Promise<void> {
  try {
    await unlink(getPortFilePath())
  } catch {
    // file may not exist
  }
}
