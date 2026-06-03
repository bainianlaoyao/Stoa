import { describe, expect, test } from 'vitest'
import { SessionBootstrapPromptService } from './session-bootstrap-prompt-service'

describe('SessionBootstrapPromptService', () => {
  const service = new SessionBootstrapPromptService()

  test('returns a non-empty bootstrap prompt', () => {
    const prompt = service.getPrompt('claude-code')
    expect(prompt.length).toBeGreaterThan(0)
  })

  test('does NOT contain "meta session" wording', () => {
    const prompt = service.getPrompt('codex')
    const lower = prompt.toLowerCase()
    expect(lower).not.toContain('meta session')
    expect(lower).not.toContain('meta-session')
  })

  test('mentions tree-local visibility', () => {
    const prompt = service.getPrompt('opencode')
    const lower = prompt.toLowerCase()
    expect(lower).toMatch(/visibility|visible/)
  })

  test('mentions stoa-ctl session commands', () => {
    const prompt = service.getPrompt('shell')
    const lower = prompt.toLowerCase()
    expect(lower).toMatch(/stoa-ctl.*session/)
  })

  test('teaches parent sessions to wait for dispatched child work', () => {
    const prompt = service.getPrompt('codex')
    const lower = prompt.toLowerCase()
    expect(lower).toContain('session prompt')
    expect(lower).toContain('only means the prompt was delivered')
    expect(lower).toContain('session wait')
    expect(lower).toContain('--timeout <seconds>')
    expect(lower).toContain('output.text')
    expect(lower).toContain('stdout/stderr')
    expect(lower).toContain('parent recovers child work by pulling')
    expect(lower).toContain('report`, or `output`')
    expect(lower).toContain('if `wait` times out')
    expect(lower).toContain('session status <childid>')
    expect(lower).toContain('session output <childid>')
  })

  test('teaches child sessions how to return durable results', () => {
    const prompt = service.getPrompt('claude-code')
    const lower = prompt.toLowerCase()
    expect(lower).toContain('summary / evidence / changes or findings / verification / blockers / next steps')
    expect(lower).toContain('250000')
    expect(lower).toContain('write files and mention their paths')
  })

  test('contains "metadata is not content" rule', () => {
    const prompt = service.getPrompt('claude-code')
    const lower = prompt.toLowerCase()
    expect(lower).toContain('metadata is not content')
  })
})
