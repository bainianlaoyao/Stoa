import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AppSettings } from '@shared/project-session'
import { SessionTitleGenerator } from './session-title-generator'

const baseSettings: AppSettings['titleGeneration'] = {
  enabled: true,
  apiKey: 'sk-title',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5.4-mini'
}

describe('SessionTitleGenerator', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('returns null when title generation is disabled', async () => {
    const generator = new SessionTitleGenerator({
      fetchImpl: vi.fn()
    })

    const result = await generator.generateTitle({
      settings: {
        ...baseSettings,
        enabled: false
      },
      projectName: 'alpha',
      sessionType: 'codex',
      prompt: 'fix session restore race',
      assistantSnippet: 'I fixed the race and added tests.'
    })

    expect(result).toBeNull()
  })

  test('returns null when API key is missing', async () => {
    const fetchImpl = vi.fn()
    const generator = new SessionTitleGenerator({ fetchImpl })

    const result = await generator.generateTitle({
      settings: {
        ...baseSettings,
        apiKey: ''
      },
      projectName: 'alpha',
      sessionType: 'claude-code',
      prompt: 'stabilize the provider hook handshake',
      assistantSnippet: 'The handshake now persists the resolved session id.'
    })

    expect(result).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('sends an OpenAI Responses API request and trims the returned title', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: '  Fix Provider Hook Handshake  '
      })
    })
    const generator = new SessionTitleGenerator({ fetchImpl })

    const result = await generator.generateTitle({
      settings: baseSettings,
      projectName: 'alpha',
      sessionType: 'codex',
      prompt: 'stabilize the provider hook handshake for the first turn',
      assistantSnippet: 'The handshake now persists the resolved session id before resume.'
    })

    expect(result).toBe('Fix Provider Hook Handshake')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          authorization: 'Bearer sk-title'
        }),
        body: expect.any(String)
      })
    )

    const requestBody = JSON.parse(fetchImpl.mock.calls[0]![1].body as string) as {
      model: string
      input: string
      text: { format: { type: string } }
    }
    expect(requestBody.model).toBe('gpt-5.4-mini')
    expect(requestBody.input).toContain('Project: alpha')
    expect(requestBody.input).toContain('Session provider: codex')
    expect(requestBody.input).toContain('User prompt: stabilize the provider hook handshake for the first turn')
    expect(requestBody.input).toContain('Assistant summary: The handshake now persists the resolved session id before resume.')
    expect(requestBody.text.format.type).toBe('text')
  })

  test('falls back to structured output content when output_text is absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'Investigate PTY Cleanup'
              }
            ]
          }
        ]
      })
    })
    const generator = new SessionTitleGenerator({ fetchImpl })

    const result = await generator.generateTitle({
      settings: baseSettings,
      projectName: 'alpha',
      sessionType: 'opencode',
      prompt: 'investigate pty cleanup ordering',
      assistantSnippet: null
    })

    expect(result).toBe('Investigate PTY Cleanup')
  })

  test('throws when the API response is not ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"unauthorized"}'
    })
    const generator = new SessionTitleGenerator({ fetchImpl })

    await expect(generator.generateTitle({
      settings: baseSettings,
      projectName: 'alpha',
      sessionType: 'claude-code',
      prompt: 'rename the session',
      assistantSnippet: 'Unauthorized response example.'
    })).rejects.toThrow('Title generation failed with status 401')
  })
})
