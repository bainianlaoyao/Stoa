import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const TEST_TEMP_ROOT = resolve(process.env.VIBECODING_TEST_TMPDIR ?? join(process.cwd(), '.tmp', 'tests'))

export function getTestTempRoot(): string {
  return TEST_TEMP_ROOT
}

export async function createTestTempDir(prefix: string): Promise<string> {
  await mkdir(TEST_TEMP_ROOT, { recursive: true })
  return await mkdtemp(join(TEST_TEMP_ROOT, prefix))
}
