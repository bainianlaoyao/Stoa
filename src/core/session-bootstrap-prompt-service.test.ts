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

  test('contains "metadata is not content" rule', () => {
    const prompt = service.getPrompt('claude-code')
    const lower = prompt.toLowerCase()
    expect(lower).toContain('metadata is not content')
  })
})
