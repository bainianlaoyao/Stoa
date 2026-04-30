import { describe, expect, test } from 'vitest'
import { createNoOpEngineAdapter, createNoOpTurnMaintenanceGateway } from './evolver-engine-adapter'

describe('EvolverEngineAdapter', () => {
  test('no-op adapter returns null from warmStart', async () => {
    const adapter = createNoOpEngineAdapter()
    const result = await adapter.warmStart({
      projectRoot: '/test',
      consumer: 'claude-code',
      stoaSessionId: 'session_1'
    })
    expect(result).toBeNull()
  })

  test('no-op adapter returns null from recall', async () => {
    const adapter = createNoOpEngineAdapter()
    const result = await adapter.recall({
      projectRoot: '/test',
      consumer: 'claude-code',
      stoaSessionId: 'session_1',
      taskText: 'hello'
    })
    expect(result).toBeNull()
  })

  test('no-op adapter returns void from observeWrite', async () => {
    const adapter = createNoOpEngineAdapter()
    const result = await adapter.observeWrite({
      projectRoot: '/test',
      stoaSessionId: 'session_1',
      evidenceRefs: []
    })
    expect(result).toBeUndefined()
  })

  test('no-op adapter has empty repoRoot', () => {
    const adapter = createNoOpEngineAdapter()
    expect(adapter.repoRoot).toBe('')
  })
})

describe('NoOpTurnMaintenanceGateway', () => {
  test('processTurn returns a no-op jobId', async () => {
    const gateway = createNoOpTurnMaintenanceGateway()
    const result = await gateway.processTurn({
      projectRoot: '/test',
      stoaSessionId: 'session_1',
      turnId: 'turn_1',
      evidenceRefs: []
    })
    expect(result).toEqual({ jobId: 'job_turn_1_noop' })
  })

  test('prepareReview returns null', async () => {
    const gateway = createNoOpTurnMaintenanceGateway()
    const result = await gateway.prepareReview({
      projectRoot: '/test',
      stoaSessionId: 'session_1',
      turnId: 'turn_1'
    })
    expect(result).toBeNull()
  })

  test('prepareSolidify returns null', async () => {
    const gateway = createNoOpTurnMaintenanceGateway()
    const result = await gateway.prepareSolidify({
      projectRoot: '/test',
      stoaSessionId: 'session_1',
      turnId: 'turn_1'
    })
    expect(result).toBeNull()
  })

  test('prepareDistill returns null', async () => {
    const gateway = createNoOpTurnMaintenanceGateway()
    const result = await gateway.prepareDistill({
      projectRoot: '/test',
      stoaSessionId: 'session_1',
      turnId: 'turn_1'
    })
    expect(result).toBeNull()
  })
})
