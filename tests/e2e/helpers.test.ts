import { describe, expect, test } from 'vitest'
import { createSeededManager, createTestGlobalStatePath, createTestWorkspace } from './helpers'

describe('E2E helpers', () => {
  test('createSeededManager maps seeded sessions to seeded projects via stable projectRef', async () => {
    const globalStatePath = await createTestGlobalStatePath()
    const alphaPath = await createTestWorkspace('seed-alpha-')
    const betaPath = await createTestWorkspace('seed-beta-')

    const manager = await createSeededManager({
      globalStatePath,
      projects: [
        { ref: 'alpha', path: alphaPath, name: 'Alpha' },
        { ref: 'beta', path: betaPath, name: 'Beta' }
      ],
      sessions: [
        { projectRef: 'beta', type: 'shell', title: 'Beta shell' }
      ]
    })

    const snapshot = manager.snapshot()
    const betaProject = snapshot.projects.find(project => project.name === 'Beta')

    expect(betaProject).toBeDefined()
    expect(snapshot.sessions).toHaveLength(1)
    expect(snapshot.sessions[0]!.projectId).toBe(betaProject!.id)
  })
})
