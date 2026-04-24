import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export function getLogFilePath(): string {
  return join(homedir(), '.stoa', 'logs', 'app.log')
}

export function getUpdateLogFilePath(): string {
  return join(homedir(), '.stoa', 'logs', 'update.log')
}

async function writeLogEntry(message: string, filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, `${new Date().toISOString()} ${message}\n`, 'utf-8')
}

export async function writeAppLog(message: string, filePath = getLogFilePath()): Promise<void> {
  await writeLogEntry(message, filePath)
}

export async function writeUpdateLog(message: string, filePath = getUpdateLogFilePath()): Promise<void> {
  await writeLogEntry(message, filePath)
}
