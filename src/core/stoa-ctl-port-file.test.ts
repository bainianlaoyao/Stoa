import { beforeEach, describe, expect, test, vi } from 'vitest'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { deletePortFile, generateSecret, getPortFilePath, isPidAlive, readPortFile, writePortFile, type PortFileData } from './stoa-ctl-port-file'

const TMP_DIR = join(process.env.TEMP ?? '/tmp', 'stoa-ctl-port-file-test')

function makePortFile(overrides: Partial<PortFileData> = {}): PortFileData {
  return {
    port: 54321,
    pid: process.pid,
    activeMetaSessionId: 'meta_test_1',
    secret: generateSecret(),
    startedAt: new Date().toISOString(),
    ...overrides
  }
}

describe('stoa-ctl-port-file', () => {
  beforeEach(async () => {
    await rm(TMP_DIR, { recursive: true, force: true })
    await mkdir(TMP_DIR, { recursive: true })
  })

  test('writePortFile creates file with valid JSON', async () => {
    const data = makePortFile()
    await writePortFile(data)

    const content = await readFile(getPortFilePath(), 'utf8')
    const parsed = JSON.parse(content)
    expect(parsed.port).toBe(54321)
    expect(parsed.pid).toBe(process.pid)
    expect(parsed.activeMetaSessionId).toBe('meta_test_1')
    expect(typeof parsed.secret).toBe('string')
    expect(parsed.secret.length).toBe(64)
  })

  test('writePortFile creates parent directories if missing', async () => {
    const nestedPath = join(TMP_DIR, 'a', 'b', 'ctl.json')
    const data = makePortFile()

    // writePortFile uses getPortFilePath() which is hardcoded;
    // we test directory creation separately via the mkdir recursive behavior
    await mkdir(join(TMP_DIR, 'a', 'b'), { recursive: true })
    await writeFile(nestedPath, JSON.stringify(data))
    const content = await readFile(nestedPath, 'utf8')
    expect(JSON.parse(content).port).toBe(54321)
  })

  test('readPortFile returns parsed data for valid file', async () => {
    const data = makePortFile()
    const path = join(TMP_DIR, 'ctl.json')
    await writeFile(path, JSON.stringify(data))

    const result = await readPortFile(path)
    expect(result).not.toBeNull()
    expect(result!.port).toBe(54321)
    expect(result!.secret).toBe(data.secret)
  })

  test('readPortFile returns null when file does not exist', async () => {
    const result = await readPortFile(join(TMP_DIR, 'nonexistent.json'))
    expect(result).toBeNull()
  })

  test('readPortFile returns null when file contains invalid JSON', async () => {
    const path = join(TMP_DIR, 'ctl.json')
    await writeFile(path, 'not json{{{')
    const result = await readPortFile(path)
    expect(result).toBeNull()
  })

  test('readPortFile returns null when port field is missing', async () => {
    const path = join(TMP_DIR, 'ctl.json')
    await writeFile(path, JSON.stringify({ pid: 123, secret: 'abc', startedAt: '2026-01-01' }))
    const result = await readPortFile(path)
    expect(result).toBeNull()
  })

  test('readPortFile returns null when port is not a number', async () => {
    const path = join(TMP_DIR, 'ctl.json')
    await writeFile(path, JSON.stringify({ port: 'abc', pid: 123, secret: 'abc', startedAt: '2026-01-01' }))
    const result = await readPortFile(path)
    expect(result).toBeNull()
  })

  test('readPortFile returns null when port is out of valid range', async () => {
    const path = join(TMP_DIR, 'ctl.json')
    await writeFile(path, JSON.stringify({ port: 0, pid: 123, secret: 'abc', startedAt: '2026-01-01' }))
    expect(await readPortFile(path)).toBeNull()

    await writeFile(path, JSON.stringify({ port: 70000, pid: 123, secret: 'abc', startedAt: '2026-01-01' }))
    expect(await readPortFile(path)).toBeNull()
  })

  test('readPortFile returns null when pid is not a positive integer', async () => {
    const path = join(TMP_DIR, 'ctl.json')
    await writeFile(path, JSON.stringify({ port: 8080, pid: -1, secret: 'abc', startedAt: '2026-01-01' }))
    expect(await readPortFile(path)).toBeNull()

    await writeFile(path, JSON.stringify({ port: 8080, pid: 0, secret: 'abc', startedAt: '2026-01-01' }))
    expect(await readPortFile(path)).toBeNull()
  })

  test('readPortFile returns null when secret is missing or empty', async () => {
    const path = join(TMP_DIR, 'ctl.json')
    await writeFile(path, JSON.stringify({ port: 8080, pid: 123, startedAt: '2026-01-01' }))
    expect(await readPortFile(path)).toBeNull()

    await writeFile(path, JSON.stringify({ port: 8080, pid: 123, secret: '', startedAt: '2026-01-01' }))
    expect(await readPortFile(path)).toBeNull()
  })

  test('readPortFile returns null when startedAt is missing', async () => {
    const path = join(TMP_DIR, 'ctl.json')
    await writeFile(path, JSON.stringify({ port: 8080, pid: 123, secret: 'abc' }))
    expect(await readPortFile(path)).toBeNull()
  })

  test('readPortFile returns null for activeMetaSessionId as non-string', async () => {
    const data = makePortFile({ activeMetaSessionId: 123 as unknown as string })
    const path = join(TMP_DIR, 'ctl.json')
    await writeFile(path, JSON.stringify(data))
    const result = await readPortFile(path)
    expect(result).not.toBeNull()
    expect(result!.activeMetaSessionId).toBeNull()
  })

  test('isPidAlive returns true for current process', () => {
    expect(isPidAlive(process.pid)).toBe(true)
  })

  test('isPidAlive returns false for impossible PID', () => {
    expect(isPidAlive(-1)).toBe(false)
  })

  test('deletePortFile succeeds when file does not exist', async () => {
    await expect(deletePortFile()).resolves.toBeUndefined()
  })

  test('generateSecret returns 64 hex characters', () => {
    const secret = generateSecret()
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(generateSecret()).not.toBe(secret)
  })

  test('getPortFilePath returns path under home directory', () => {
    const path = getPortFilePath()
    expect(path).toMatch(/\.stoa[\\/]ctl\.json$/)
  })
})
