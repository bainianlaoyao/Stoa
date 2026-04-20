import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export function getLogFilePath(): string {
  return join(homedir(), '.vibecoding', 'logs', 'app.log')
}

export async function writeAppLog(message: string, filePath = getLogFilePath()): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, `${new Date().toISOString()} ${message}\n`, 'utf-8')
}
