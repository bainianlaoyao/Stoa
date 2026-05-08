// src/core/context/types.ts

/** A provider-neutral turn extracted from a session transcript. */
export interface NormalizedTurn {
  role: 'user' | 'assistant'
  /** Human-readable text content, stripped of all markup and ANSI. */
  text: string
  /** Tool call summaries (name + short preview), optional. */
  toolCalls?: ToolCallSummary[]
  /** Unix epoch milliseconds, used for chronological ordering. */
  timestamp: number
}

export interface ToolCallSummary {
  /** Tool name, e.g. "Glob", "shell_command", "websearch". */
  name: string
  /** JSON preview of tool input, truncated to 120 chars. */
  inputPreview: string
  /** Plain-text preview of tool output, truncated to 200 chars. */
  outputPreview?: string
}

export interface FullTextExportOptions {
  /** Max output characters. Infinity = no limit. */
  maxChars?: number
  /** Base64-encoded byte offset for pagination. */
  cursor?: string
  /** Include thinking/reasoning blocks. Default: false. */
  includeThinking: boolean
  /** Include tool input/output details. Default: false. */
  includeToolDetails: boolean
}

export interface FullTextExportResult {
  /** The plain-text output. */
  text: string
  /** Base64-encoded cursor for the next page, if truncated. */
  nextCursor?: string
  /** Whether output was cut short by maxChars. */
  truncated: boolean
  /** Total number of turns in the full (un-paginated) result. */
  totalTurns: number
}
