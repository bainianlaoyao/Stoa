import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, test, vi } from 'vitest'

interface MockHttpsResponse {
  status: number
  body: string
}

interface RequestObservation {
  options: Record<string, unknown>
  payload: string
  timeoutMs: number | null
}

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unmock('node:https')
  delete process.env.STOA_AI_API_KEY
  delete process.env.STOA_AI_API_BASE
  delete process.env.STOA_AI_MODEL
})

describe('ApiAiProvider', () => {
  test('posts the expected chat completion payload and strips unknown keys from summarized output', async () => {
    const observed: RequestObservation[] = []
    const { ApiAiProvider } = await loadModuleWithMockedHttps(
      {
        status: 200,
        body: JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  '<think>I should not leak this reasoning.</think>',
                  '{"summary":"Use uv for Python environments.","outcome":"success","lessons":["Prefer uv."],"extra":"ignore me"}'
                ].join('\n')
              }
            }
          ]
        })
      },
      observed
    )

    const provider = new ApiAiProvider({
      apiBaseUrl: 'https://api.example.com/v1/',
      apiKey: 'secret-key',
      model: 'MiniMax-M2.7',
      timeoutMs: 45_000
    })

    await expect(provider.summarizeSession({
      cwd: process.cwd(),
      prompt: 'Summarize this session.'
    })).resolves.toEqual({
      summary: 'Use uv for Python environments.',
      outcome: 'success',
      lessons: ['Prefer uv.']
    })

    expect(observed).toHaveLength(1)
    expect(observed[0]?.timeoutMs).toBe(45_000)
    expect(observed[0]?.options).toMatchObject({
      hostname: 'api.example.com',
      path: '/v1/chat/completions',
      method: 'POST'
    })
    expect(observed[0]?.options.headers).toMatchObject({
      Authorization: 'Bearer secret-key',
      'Content-Type': 'application/json'
    })

    const payload = JSON.parse(observed[0]!.payload) as Record<string, unknown>
    expect(payload).toMatchObject({
      model: 'MiniMax-M2.7',
      temperature: 0
    })
    expect(payload.messages).toEqual([
      {
        role: 'system',
        content: expect.stringContaining('"summary"')
      },
      {
        role: 'user',
        content: 'Summarize this session.'
      }
    ])
  })

  test('normalizes object responseText payloads into JSON strings', async () => {
    const { ApiAiProvider } = await loadModuleWithMockedHttps({
      status: 200,
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: '{"responseText":{"type":"Gene","id":"gene_uv_pref"}}'
            }
          }
        ]
      })
    })

    const provider = new ApiAiProvider({
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey: 'secret-key',
      model: 'MiniMax-M2.7'
    })

    await expect(provider.distill({
      cwd: process.cwd(),
      prompt: 'Distill this session.'
    })).resolves.toEqual({
      responseText: '{"type":"Gene","id":"gene_uv_pref"}'
    })
  })

  test('resolves API config from overrides and environment variables', async () => {
    process.env.STOA_AI_API_KEY = 'env-key'
    process.env.STOA_AI_API_BASE = 'https://env.example.com/v1'
    process.env.STOA_AI_MODEL = 'env-model'

    const { resolveApiAiProviderConfig } = await import('./api-ai-provider')

    expect(resolveApiAiProviderConfig()).toEqual({
      apiBaseUrl: 'https://env.example.com/v1',
      apiKey: 'env-key',
      model: 'env-model'
    })
    expect(resolveApiAiProviderConfig({
      apiBaseUrl: 'https://override.example.com/v2',
      apiKey: 'override-key',
      model: 'override-model'
    })).toEqual({
      apiBaseUrl: 'https://override.example.com/v2',
      apiKey: 'override-key',
      model: 'override-model'
    })
  })
})

async function loadModuleWithMockedHttps(
  response: MockHttpsResponse,
  observed: RequestObservation[] = []
) {
  vi.doMock('node:https', () => ({
    default: {
      request: (
        options: Record<string, unknown>,
        callback: (responseEmitter: EventEmitter & { statusCode?: number }) => void
      ) => {
        let payload = ''
        let timeoutMs: number | null = null

        const requestEmitter = new EventEmitter() as EventEmitter & {
          write: (chunk: string | Buffer) => void
          end: () => void
          setTimeout: (ms: number, handler: () => void) => void
          destroy: () => void
        }

        requestEmitter.write = (chunk: string | Buffer) => {
          payload += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        }
        requestEmitter.setTimeout = (ms: number, _handler: () => void) => {
          timeoutMs = ms
        }
        requestEmitter.destroy = () => {}
        requestEmitter.end = () => {
          observed.push({ options, payload, timeoutMs })

          const responseEmitter = new EventEmitter() as EventEmitter & { statusCode?: number }
          responseEmitter.statusCode = response.status
          callback(responseEmitter)
          responseEmitter.emit('data', Buffer.from(response.body, 'utf8'))
          responseEmitter.emit('end')
        }

        return requestEmitter
      }
    },
    request: (
      options: Record<string, unknown>,
      callback: (responseEmitter: EventEmitter & { statusCode?: number }) => void
    ) => {
      let payload = ''
      let timeoutMs: number | null = null

      const requestEmitter = new EventEmitter() as EventEmitter & {
        write: (chunk: string | Buffer) => void
        end: () => void
        setTimeout: (ms: number, handler: () => void) => void
        destroy: () => void
      }

      requestEmitter.write = (chunk: string | Buffer) => {
        payload += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      }
      requestEmitter.setTimeout = (ms: number, _handler: () => void) => {
        timeoutMs = ms
      }
      requestEmitter.destroy = () => {}
      requestEmitter.end = () => {
        observed.push({ options, payload, timeoutMs })

        const responseEmitter = new EventEmitter() as EventEmitter & { statusCode?: number }
        responseEmitter.statusCode = response.status
        callback(responseEmitter)
        responseEmitter.emit('data', Buffer.from(response.body, 'utf8'))
        responseEmitter.emit('end')
      }

      return requestEmitter
    }
  }))

  return await import('./api-ai-provider')
}
