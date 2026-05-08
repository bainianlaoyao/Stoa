const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '')
}

export function trimTextToMaxChars(
  input: string,
  maxChars: number
): { text: string; truncated: boolean } {
  if (input.length <= maxChars) {
    return { text: input, truncated: false }
  }

  return {
    text: input.slice(input.length - maxChars),
    truncated: true
  }
}

export function appendSection(lines: string[], label: string, value: string | null | undefined): void {
  if (!value) {
    return
  }

  const normalized = value.trim()
  if (!normalized) {
    return
  }

  lines.push(`[${label}]`)
  lines.push(normalized)
  lines.push('')
}
