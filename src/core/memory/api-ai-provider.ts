import { request } from 'node:https'
import type { DistillationResponse, ReviewDecision, SemanticSessionSummary } from '@shared/memory-runtime'
import type {
  CliAiBaseRequest,
  StructuredResponseContract
} from './cli-ai-schemas'
import {
  distillationResponseContract,
  reviewDecisionResponseContract,
  semanticSessionSummaryResponseContract
} from './cli-ai-schemas'

export interface ApiAiProviderConfig {
  apiBaseUrl: string
  apiKey: string
  model: string
  timeoutMs?: number
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

async function httpsPostJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<{ ok: boolean; status: number; body: string }> {
  const parsedUrl = new URL(url)
  const payload = JSON.stringify(body)

  return await new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8')
          })
        })
        res.on('error', reject)
      }
    )

    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error(`AI API request timed out after ${timeoutMs}ms`))
    })
    req.write(payload)
    req.end()
  })
}

export class ApiAiProvider {
  private readonly apiBaseUrl: string
  private readonly apiKey: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(config: ApiAiProviderConfig) {
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, '')
    this.apiKey = config.apiKey
    this.model = config.model
    this.timeoutMs = config.timeoutMs ?? 120_000
  }

  async summarizeSession(request: CliAiBaseRequest): Promise<SemanticSessionSummary> {
    return await this.runStructuredRequest(request, semanticSessionSummaryResponseContract)
  }

  async review(request: CliAiBaseRequest): Promise<ReviewDecision> {
    return await this.runStructuredRequest(request, reviewDecisionResponseContract)
  }

  async distill(request: CliAiBaseRequest): Promise<DistillationResponse> {
    return await this.runStructuredRequest(request, distillationResponseContract)
  }

  private async runStructuredRequest<TResponse>(
    request: CliAiBaseRequest,
    contract: StructuredResponseContract<TResponse>
  ): Promise<TResponse> {
    const timeoutMs = request.timeoutMs ?? this.timeoutMs
    const result = await httpsPostJson(
      `${this.apiBaseUrl}/chat/completions`,
      {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      {
        model: this.model,
        messages: [
          { role: 'system', content: buildSystemPrompt(contract.schema) },
          { role: 'user', content: request.prompt }
        ],
        temperature: 0
      },
      timeoutMs
    )

    if (!result.ok) {
      throw new Error(`AI API request failed (${result.status}): ${result.body.slice(0, 500)}`)
    }

    let data: ChatCompletionResponse
    try {
      data = JSON.parse(result.body) as ChatCompletionResponse
    } catch {
      throw new Error(`AI API returned invalid JSON: ${result.body.slice(0, 300)}`)
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('AI API returned empty response content')
    }

    const jsonStr = extractJson(content)

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      throw new Error(`AI API returned invalid JSON: ${jsonStr.slice(0, 300)}`)
    }

    return contract.parse(contract.stripUnknownKeys(parsed))
  }
}

function buildSystemPrompt(schema: unknown): string {
  return [
    'You are a structured data extraction assistant.',
    'Always respond with valid JSON matching the following JSON Schema exactly.',
    'Do not include any text outside the JSON object.',
    '',
    '```json',
    JSON.stringify(schema, null, 2),
    '```'
  ].join('\n')
}

export function resolveApiAiProviderConfig(overrides?: {
  apiBaseUrl?: string
  apiKey?: string
  model?: string
}): ApiAiProviderConfig {
  const apiKey = overrides?.apiKey ?? process.env.STOA_AI_API_KEY ?? ''
  const apiBaseUrl = overrides?.apiBaseUrl ?? process.env.STOA_AI_API_BASE ?? 'https://api.minimaxi.com/v1'
  const model = overrides?.model ?? process.env.STOA_AI_MODEL ?? 'MiniMax-M2.7'

  if (!apiKey) {
    throw new Error('STOA_AI_API_KEY environment variable is required for API-based AI provider')
  }

  return { apiBaseUrl, apiKey, model }
}

function extractJson(content: string): string {
  const searchFrom = resolveThinkSectionEnd(content)
  const start = content.indexOf('{', searchFrom)
  if (start < 0) {
    const fallbackStart = content.indexOf('{')
    if (fallbackStart < 0) return content
    return extractBalancedBraces(content, fallbackStart)
  }
  return extractBalancedBraces(content, start)
}

function extractBalancedBraces(content: string, start: number): string {
  let depth = 0
  for (let i = start; i < content.length; i++) {
    if (content[i] === '{') depth++
    else if (content[i] === '}') depth--
    if (depth === 0) return content.slice(start, i + 1)
  }
  return content.slice(start)
}

function resolveThinkSectionEnd(content: string): number {
  const thinkTagMatches = [...content.matchAll(/<\/thinkk?>/g)]
  if (thinkTagMatches.length === 0) {
    return 0
  }

  const lastMatch = thinkTagMatches[thinkTagMatches.length - 1]
  if (!lastMatch || lastMatch.index === undefined) {
    return 0
  }

  return lastMatch.index + lastMatch[0].length
}
