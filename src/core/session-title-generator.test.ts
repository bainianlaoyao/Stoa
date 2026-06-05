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

  test('sends a chat completions request and trims the returned title', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '  Fix Provider Hook Handshake  '
            }
          }
        ]
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
      'https://api.openai.com/v1/chat/completions',
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
      messages: Array<{ role: string; content: string }>
    }
    expect(requestBody.model).toBe('gpt-5.4-mini')
    expect(requestBody.messages).toEqual([
      {
        role: 'system',
        content: 'Generate a short, specific title that describes the actual work done in this session. Use 3 to 8 words. Focus on WHAT was done — the specific change, feature, or fix — not the project name. Avoid generic verbs like "implement", "enhance", "update" alone; always pair verbs with specifics. No quotes, no trailing punctuation.\n\nGood examples:\n- "Fix PTY host disposal race condition"\n- "Animate sidebar collapse with CSS transition"\n- "Extract design tokens into shared theme"\n- "Resolve bootstrap prompt fallback logic"\n\nBad examples (too vague, avoid):\n- "Implement project-name"\n- "Enhanced session manager"\n- "Update settings"'
      },
      {
        role: 'user',
        content: [
          'User prompt: stabilize the provider hook handshake for the first turn',
          'Assistant summary: The handshake now persists the resolved session id before resume.'
        ].join('\n')
      }
    ])
  })

  test('falls back to structured message content arrays when message content is not a string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: [
                {
                  type: 'text',
                  text: 'Investigate PTY Cleanup'
                }
              ]
            }
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

  test('falls back to Responses-style output_text for providers that still return it', async () => {
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
