import type { SessionType, TitleGenerationSettings } from '@shared/project-session'

interface GenerateTitleInput {
  settings: TitleGenerationSettings
  projectName: string
  sessionType: SessionType
  prompt: string | null
  assistantSnippet: string | null
}

interface SessionTitleGeneratorOptions {
  fetchImpl?: typeof fetch
}

export class SessionTitleGenerator {
  private readonly fetchImpl: typeof fetch

  constructor(options: SessionTitleGeneratorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async generateTitle(input: GenerateTitleInput): Promise<string | null> {
    const settings = input.settings
    if (!settings.enabled || !settings.apiKey.trim()) {
      return null
    }

    const response = await this.fetchImpl(
      `${settings.baseUrl.replace(/\/+$/, '')}/responses`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.model,
          input: buildPrompt(input),
          text: {
            format: {
              type: 'text'
            }
          }
        })
      }
    )

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Title generation failed with status ${response.status}${detail ? `: ${detail}` : ''}`)
    }

    const payload = await response.json() as {
      output_text?: unknown
      output?: Array<{
        type?: string
        content?: Array<{
          type?: string
          text?: string
        }>
      }>
    }

    const title = extractResponseText(payload)?.trim()
    return title ? normalizeTitle(title) : null
  }
}

function buildPrompt(input: GenerateTitleInput): string {
  const promptLine = input.prompt?.trim() ? `User prompt: ${input.prompt.trim()}` : 'User prompt: unavailable'
  const assistantLine = input.assistantSnippet?.trim()
    ? `Assistant summary: ${input.assistantSnippet.trim()}`
    : 'Assistant summary: unavailable'

  return [
    'Generate a concise work-session title.',
    'Requirements: 2 to 5 words, imperative or task-focused, no quotes, no trailing punctuation.',
    `Project: ${input.projectName}`,
    `Session provider: ${input.sessionType}`,
    promptLine,
    assistantLine,
    'Return only the title text.'
  ].join('\n')
}

function extractResponseText(payload: {
  output_text?: unknown
  output?: Array<{
    type?: string
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}): string | null {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text
  }

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) {
        return content.text
      }
    }
  }

  return null
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().replace(/[.。!！?？]+$/u, '')
}
