import { describe, expect, test } from 'vitest'
import { SessionBootstrapPromptService } from './session-bootstrap-prompt-service'

describe('SessionBootstrapPromptService', () => {
  const service = new SessionBootstrapPromptService()

  test('returns a non-empty bootstrap prompt for root session', () => {
    const prompt = service.getPrompt('claude-code')
    expect(prompt.length).toBeGreaterThan(0)
  })

  test('returns a non-empty bootstrap prompt for child session', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    expect(prompt.length).toBeGreaterThan(0)
  })

  test('does NOT contain "meta session" wording in root prompt', () => {
    const prompt = service.getPrompt('codex')
    const lower = prompt.toLowerCase()
    expect(lower).not.toContain('meta session')
    expect(lower).not.toContain('meta-session')
  })

  test('does NOT contain "meta session" wording in child prompt', () => {
    const prompt = service.getPrompt('codex', { isChild: true })
    const lower = prompt.toLowerCase()
    expect(lower).not.toContain('meta session')
    expect(lower).not.toContain('meta-session')
  })

  test('mentions tree-local visibility in root prompt', () => {
    const prompt = service.getPrompt('opencode')
    const lower = prompt.toLowerCase()
    expect(lower).toMatch(/visibility|visible/)
  })

  test('mentions tree-local visibility in child prompt', () => {
    const prompt = service.getPrompt('opencode', { isChild: true })
    const lower = prompt.toLowerCase()
    expect(lower).toMatch(/visibility|visible/)
  })

  test('mentions stoa-ctl session commands in root prompt', () => {
    const prompt = service.getPrompt('shell')
    const lower = prompt.toLowerCase()
    expect(lower).toMatch(/stoa-ctl.*session/)
  })

  test('root prompt does NOT contain "session prompt"', () => {
    const prompt = service.getPrompt('claude-code')
    const lower = prompt.toLowerCase()
    expect(lower).not.toContain('session prompt')
  })

  test('child prompt does NOT contain "session prompt"', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    const lower = prompt.toLowerCase()
    expect(lower).not.toContain('session prompt')
  })

  test('root prompt does NOT contain "--prompt"', () => {
    const prompt = service.getPrompt('claude-code')
    expect(prompt).not.toContain('--prompt')
  })

  test('child prompt does NOT contain "--prompt"', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    expect(prompt).not.toContain('--prompt')
  })

  test('root prompt does NOT contain "--artifact"', () => {
    const prompt = service.getPrompt('claude-code')
    expect(prompt).not.toContain('--artifact')
  })

  test('child prompt does NOT contain "--artifact"', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    expect(prompt).not.toContain('--artifact')
  })

  // ── Root prompt: subagent commands ──

  test('root prompt contains subagent dispatch', () => {
    const prompt = service.getPrompt('claude-code')
    const lower = prompt.toLowerCase()
    expect(lower).toContain('subagent dispatch')
  })

  test('root prompt contains subagent list', () => {
    const prompt = service.getPrompt('claude-code')
    const lower = prompt.toLowerCase()
    expect(lower).toContain('subagent list')
  })

  test('root prompt contains subagent wait', () => {
    const prompt = service.getPrompt('claude-code')
    const lower = prompt.toLowerCase()
    expect(lower).toContain('subagent wait')
  })

  test('root prompt contains subagent input', () => {
    const prompt = service.getPrompt('claude-code')
    const lower = prompt.toLowerCase()
    expect(lower).toContain('subagent input')
  })

  test('root prompt contains subagent stop', () => {
    const prompt = service.getPrompt('claude-code')
    const lower = prompt.toLowerCase()
    expect(lower).toContain('subagent stop')
  })

  test('root prompt does NOT contain subagent result', () => {
    const prompt = service.getPrompt('claude-code')
    const lower = prompt.toLowerCase()
    expect(lower).not.toContain('subagent result')
  })

  test('root prompt uses session input (not session prompt)', () => {
    const prompt = service.getPrompt('claude-code')
    expect(prompt).toContain('session input')
  })

  test('root prompt uses --text|--file|--stdin for input', () => {
    const prompt = service.getPrompt('claude-code')
    expect(prompt).toContain('--text')
    expect(prompt).toContain('--file')
    expect(prompt).toContain('--stdin')
  })

  test('root prompt mentions wait protocol for dispatched subagents', () => {
    const prompt = service.getPrompt('claude-code')
    const lower = prompt.toLowerCase()
    expect(lower).toContain('subagent wait')
    expect(lower).toContain('collect the result')
  })

  // ── Child prompt: subagent result ──

  test('child prompt contains subagent result', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    const lower = prompt.toLowerCase()
    expect(lower).toContain('subagent result')
  })

  test('child prompt teaches how to submit result with status and text', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    expect(prompt).toContain('subagent result --status completed')
    expect(prompt).toContain('--text')
  })

  test('child prompt mentions --file and --stdin for result', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    expect(prompt).toContain('--file')
    expect(prompt).toContain('--stdin')
  })

  test('child prompt explains result statuses', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    const lower = prompt.toLowerCase()
    expect(lower).toContain('completed')
    expect(lower).toContain('failed')
    expect(lower).toContain('blocked')
    expect(lower).toContain('cancelled')
  })

  test('child prompt says result body should be natural language or Markdown', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    const lower = prompt.toLowerCase()
    expect(lower).toMatch(/natural language|markdown/)
  })

  test('child prompt explains blocked decisions use Markdown', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    expect(prompt).toContain('blocked')
    expect(prompt).toMatch(/--status blocked/)
  })

  test('child prompt mentions large artifacts should use file paths', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    const lower = prompt.toLowerCase()
    expect(lower).toMatch(/file path|write.*disk|write them to disk/)
  })

  test('child prompt can dispatch own subagents', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    const lower = prompt.toLowerCase()
    expect(lower).toContain('subagent dispatch')
  })

  test('child prompt clarifies result always submits for self', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    const lower = prompt.toLowerCase()
    expect(lower).toMatch(/your result|always submits your result/)
  })

  // ── Shared checks ──

  test('root prompt contains "metadata is not content" rule', () => {
    const prompt = service.getPrompt('claude-code')
    const lower = prompt.toLowerCase()
    expect(lower).toContain('metadata is not content')
  })

  test('child prompt contains "metadata is not content" rule', () => {
    const prompt = service.getPrompt('claude-code', { isChild: true })
    const lower = prompt.toLowerCase()
    expect(lower).toContain('metadata is not content')
  })
})
