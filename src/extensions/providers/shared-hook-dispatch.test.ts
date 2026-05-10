import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  HOOK_CONTRACT_VERSION,
  buildSharedHookArtifacts,
  runSharedHookDispatch
} from './shared-hook-dispatch'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.allSettled(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function createTempRuntimeRoot(prefix: string): Promise<string> {
  const runtimeRoot = await createTempDir(prefix)
  await writeFile(join(runtimeRoot, '.keep'), '', 'utf8')
  return runtimeRoot
}

async function appendManagedLease(
  runtimeRoot: string,
  overrides: Partial<Record<string, unknown>> = {}
): Promise<string> {
  const leasePath = join(runtimeRoot, 'hook-leases', `${String(overrides.sessionId ?? 'session-1')}.json`)
  await mkdir(join(runtimeRoot, 'hook-leases'), { recursive: true })
  await writeFile(leasePath, `${JSON.stringify({
    version: 1,
    sessionId: 'session-1',
    projectId: 'project-1',
    provider: 'codex',
    leaseState: 'active',
    ownerInstanceId: 'instance-a',
    generation: 1,
    webhookBaseUrl: 'http://127.0.0.1:43127',
    sessionSecret: 'secret-1',
    createdAt: '2026-05-10T12:00:00.000Z',
    updatedAt: '2026-05-10T12:00:00.000Z',
    heartbeatAt: '2026-05-10T12:00:00.000Z',
    expiresAt: '2099-05-10T12:00:20.000Z',
    commitLockNonce: 'nonce-1',
    commitToken: 'token-1',
    ...overrides
  }, null, 2)}\n`, 'utf8')
  return leasePath
}

async function readFailureJournal(runtimeRoot: string): Promise<Array<Record<string, unknown>>> {
  const content = await readFile(join(runtimeRoot, 'hook-delivery-failures.ndjson'), 'utf8')
  return content
    .trim()
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('shared-hook-dispatch', () => {
  test('buildSharedHookArtifacts returns the stable dispatcher contract files', () => {
    const artifacts = buildSharedHookArtifacts()
    const paths = artifacts.map((artifact) => artifact.relativePath).sort()

    expect(paths).toEqual([
      '.stoa/hook-contract.json',
      '.stoa/hook-dispatch',
      '.stoa/hook-dispatch.cmd',
      '.stoa/hook-dispatch.mjs'
    ])
    expect(artifacts.find((artifact) => artifact.relativePath === '.stoa/hook-contract.json')?.content).toContain(
      `"contractVersion": ${HOOK_CONTRACT_VERSION}`
    )
    expect(artifacts.find((artifact) => artifact.relativePath === '.stoa/hook-dispatch')).toMatchObject({
      mode: 0o755
    })
    expect(artifacts.find((artifact) => artifact.relativePath === '.stoa/hook-dispatch.mjs')?.content).not.toContain(
      '../src/extensions/providers/shared-hook-dispatch.ts'
    )
  })

  test('dispatcher resolves target endpoint from the lease at invocation time', async () => {
    const workspaceDir = await createTempDir('stoa-shared-dispatch-')
    const leasePath = join(workspaceDir, 'session-1.json')
    await writeFile(leasePath, `${JSON.stringify({
      version: 1,
      sessionId: 'session-1',
      projectId: 'project-1',
      provider: 'codex',
      leaseState: 'active',
      ownerInstanceId: 'instance-a',
      generation: 1,
      webhookBaseUrl: 'http://127.0.0.1:0',
      sessionSecret: 'secret-1',
      createdAt: '2026-05-10T12:00:00.000Z',
      updatedAt: '2026-05-10T12:00:00.000Z',
      heartbeatAt: '2026-05-10T12:00:00.000Z',
      expiresAt: '2099-05-10T12:00:20.000Z',
      commitLockNonce: 'nonce-1',
      commitToken: 'token-1'
    }, null, 2)}\n`, 'utf8')

    const observedRequests: Array<{ url: string; headers: Record<string, string>; body: string }> = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        observedRequests.push({
          url: request.url ?? '',
          headers: {
            'x-stoa-session-id': String(request.headers['x-stoa-session-id'] ?? ''),
            'x-stoa-project-id': String(request.headers['x-stoa-project-id'] ?? ''),
            'x-stoa-secret': String(request.headers['x-stoa-secret'] ?? '')
          },
          body: Buffer.concat(chunks).toString('utf8')
        })
        response.statusCode = 204
        response.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))

    try {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Server address is unavailable.')
      }

      await writeFile(leasePath, `${JSON.stringify({
        version: 1,
        sessionId: 'session-1',
        projectId: 'project-1',
        provider: 'codex',
        leaseState: 'active',
        ownerInstanceId: 'instance-a',
        generation: 1,
        webhookBaseUrl: `http://127.0.0.1:${address.port}`,
        sessionSecret: 'secret-1',
        createdAt: '2026-05-10T12:00:00.000Z',
        updatedAt: '2026-05-10T12:00:00.000Z',
        heartbeatAt: '2026-05-10T12:00:00.000Z',
        expiresAt: '2099-05-10T12:00:20.000Z',
        commitLockNonce: 'nonce-1',
        commitToken: 'token-1'
      }, null, 2)}\n`, 'utf8')

      const result = await runSharedHookDispatch({
        provider: 'codex',
        hookEventName: 'Stop',
        stdinText: JSON.stringify({ hook_event_name: 'Stop' }),
        env: {
          STOA_HOOK_LEASE_PATH: leasePath
        }
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(observedRequests).toHaveLength(1)
      expect(observedRequests[0]).toMatchObject({
        url: '/hooks/codex',
        headers: {
          'x-stoa-session-id': 'session-1',
          'x-stoa-project-id': 'project-1',
          'x-stoa-secret': 'secret-1'
        }
      })
      expect(JSON.parse(observedRequests[0]!.body)).toMatchObject({
        hook_event_name: 'Stop'
      })
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  test('dispatcher exits quietly for unmanaged invocations without lease context', async () => {
    const result = await runSharedHookDispatch({
      provider: 'claude-code',
      hookEventName: 'SessionStart',
      stdinText: '{}',
      env: {}
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  test('managed dispatch journals an expired lease instead of treating it as a silent success', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-shared-dispatch-expired-')
    const leasePath = await appendManagedLease(runtimeRoot, {
      expiresAt: '2020-05-10T12:00:20.000Z'
    })

    const result = await runSharedHookDispatch({
      provider: 'codex',
      hookEventName: 'Stop',
      stdinText: JSON.stringify({ hook_event_name: 'Stop' }),
      env: {
        STOA_HOOK_LEASE_PATH: leasePath,
        STOA_HOOK_MANAGED: '1',
        STOA_HOOK_SESSION_ID: 'session-1',
        STOA_HOOK_PROJECT_ID: 'project-1',
        STOA_HOOK_PROVIDER: 'codex',
        STOA_HOOK_SPAWN_OWNER_INSTANCE_ID: 'instance-a',
        STOA_HOOK_SPAWN_GENERATION: '1'
      }
    })

    expect(result).toEqual({
      exitCode: 0,
      stdout: '',
      stderr: ''
    })
    await expect(readFailureJournal(runtimeRoot)).resolves.toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        projectId: 'project-1',
        ownerInstanceId: 'instance-a',
        generation: 1,
        provider: 'codex',
        failureClass: 'lease_expired',
        metadataSource: 'lease'
      })
    ])
  })

  test('managed dispatch journals transport failures instead of crashing the hook process', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-shared-dispatch-transport-')
    const server = createServer((_request, response) => {
      response.statusCode = 204
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Server address is unavailable.')
    }
    const closedPort = address.port
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))

    const leasePath = await appendManagedLease(runtimeRoot, {
      webhookBaseUrl: `http://127.0.0.1:${closedPort}`
    })

    const result = await runSharedHookDispatch({
      provider: 'codex',
      hookEventName: 'Stop',
      stdinText: JSON.stringify({ hook_event_name: 'Stop' }),
      env: {
        STOA_HOOK_LEASE_PATH: leasePath,
        STOA_HOOK_MANAGED: '1',
        STOA_HOOK_SESSION_ID: 'session-1',
        STOA_HOOK_PROJECT_ID: 'project-1',
        STOA_HOOK_PROVIDER: 'codex',
        STOA_HOOK_SPAWN_OWNER_INSTANCE_ID: 'instance-a',
        STOA_HOOK_SPAWN_GENERATION: '1'
      }
    })

    expect(result).toEqual({
      exitCode: 0,
      stdout: '',
      stderr: ''
    })
    await expect(readFailureJournal(runtimeRoot)).resolves.toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        projectId: 'project-1',
        ownerInstanceId: 'instance-a',
        generation: 1,
        provider: 'codex',
        failureClass: 'target_unreachable',
        metadataSource: 'lease'
      })
    ])
  })

  test('managed dispatch journals lease-parse failures using managed marker metadata', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-shared-dispatch-invalid-')
    const leasePath = join(runtimeRoot, 'hook-leases', 'session-1.json')
    await mkdir(join(runtimeRoot, 'hook-leases'), { recursive: true })
    await writeFile(leasePath, '{not-json}\n', 'utf8')

    const result = await runSharedHookDispatch({
      provider: 'codex',
      hookEventName: 'Stop',
      stdinText: JSON.stringify({ hook_event_name: 'Stop' }),
      env: {
        STOA_HOOK_LEASE_PATH: leasePath,
        STOA_HOOK_MANAGED: '1',
        STOA_HOOK_SESSION_ID: 'session-1',
        STOA_HOOK_PROJECT_ID: 'project-1',
        STOA_HOOK_PROVIDER: 'codex',
        STOA_HOOK_SPAWN_OWNER_INSTANCE_ID: 'instance-z',
        STOA_HOOK_SPAWN_GENERATION: '7'
      }
    })

    expect(result).toEqual({
      exitCode: 0,
      stdout: '',
      stderr: ''
    })
    await expect(readFailureJournal(runtimeRoot)).resolves.toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        projectId: 'project-1',
        ownerInstanceId: 'instance-z',
        generation: 7,
        provider: 'codex',
        failureClass: 'lease_invalid',
        metadataSource: 'managed-marker'
      })
    ])
  })

  test('managed dispatch rejects stale spawn provenance after lease reclaim', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-shared-dispatch-stale-spawn-')
    const leasePath = await appendManagedLease(runtimeRoot, {
      ownerInstanceId: 'instance-new',
      generation: 5,
      sessionSecret: 'secret-new'
    })

    const result = await runSharedHookDispatch({
      provider: 'codex',
      hookEventName: 'Stop',
      stdinText: JSON.stringify({ hook_event_name: 'Stop' }),
      env: {
        STOA_HOOK_LEASE_PATH: leasePath,
        STOA_HOOK_MANAGED: '1',
        STOA_HOOK_SESSION_ID: 'session-1',
        STOA_HOOK_PROJECT_ID: 'project-1',
        STOA_HOOK_PROVIDER: 'codex',
        STOA_HOOK_SPAWN_OWNER_INSTANCE_ID: 'instance-old',
        STOA_HOOK_SPAWN_GENERATION: '4'
      }
    })

    expect(result).toEqual({
      exitCode: 0,
      stdout: '',
      stderr: ''
    })
    await expect(readFailureJournal(runtimeRoot)).resolves.toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        projectId: 'project-1',
        ownerInstanceId: 'instance-new',
        generation: 5,
        provider: 'codex',
        failureClass: 'stale_spawn_provenance',
        metadataSource: 'lease'
      })
    ])
  })

})
