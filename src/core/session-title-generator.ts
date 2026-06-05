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
      `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.model,
          messages: buildMessages(input)
        })
      }
    )

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Title generation failed with status ${response.status}${detail ? `: ${detail}` : ''}`)
    }

    const payload = await response.json() as {
      choices?: Array<{
        message?: {
          content?: unknown
        }
      }>
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

function buildMessages(input: GenerateTitleInput): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: 'Generate a short, specific title that describes the actual work done in this session. Use 3 to 8 words. Focus on WHAT was done — the specific change, feature, or fix — not the project name. Avoid generic verbs like "implement", "enhance", "update" alone; always pair verbs with specifics. No quotes, no trailing punctuation.\n\nGood examples:\n- "Fix PTY host disposal race condition"\n- "Animate sidebar collapse with CSS transition"\n- "Extract design tokens into shared theme"\n- "Resolve bootstrap prompt fallback logic"\n\nBad examples (too vague, avoid):\n- "Implement project-name"\n- "Enhanced session manager"\n- "Update settings"'
    },
    {
      role: 'user',
      content: buildUserPrompt(input)
    }
  ]
}

function buildUserPrompt(input: GenerateTitleInput): string {
  const promptLine = input.prompt?.trim() ? `User prompt: ${input.prompt.trim()}` : 'User prompt: unavailable'
  const assistantLine = input.assistantSnippet?.trim()
    ? `Assistant summary: ${input.assistantSnippet.trim()}`
    : 'Assistant summary: unavailable'

  return [promptLine, assistantLine].join('\n')
}

function extractResponseText(payload: {
  choices?: Array<{
    message?: {
      content?: unknown
    }
  }>
  output_text?: unknown
  output?: Array<{
    type?: string
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}): string | null {
  const choiceText = extractChoiceText(payload.choices)
  if (choiceText) {
    return choiceText
  }

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

function extractChoiceText(
  choices: Array<{
    message?: {
      content?: unknown
    }
  }> | undefined
): string | null {
  const content = choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim()) {
    return content
  }

  if (!Array.isArray(content)) {
    return null
  }

  for (const part of content) {
    if (typeof part === 'string' && part.trim()) {
      return part
    }
    if (
      typeof part === 'object'
      && part !== null
      && 'text' in part
      && typeof part.text === 'string'
      && part.text.trim()
    ) {
      return part.text
    }
  }

  return null
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().replace(/[.。!！?？]+$/u, '')
}
