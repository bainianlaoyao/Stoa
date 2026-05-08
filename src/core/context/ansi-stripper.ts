// src/core/context/ansi-stripper.ts

// Matches all common ANSI escape sequences:
// - CSI (Control Sequence Introducer): \x1b[ ... (letter)
// - OSC (Operating System Command): \x1b] ... (\x07 or \x1b\\)
// - Any other 2-byte escape: \x1b (one char)
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b\][^\x1b]*\x1b\\|\x1b[^[\]].?/g

export function stripAnsi(raw: string): string {
  const noEscapes = raw.replace(ANSI_RE, '')

  // Handle \r-only progress overwrites: keep the last frame
  // Split on standalone \r (not \r\n), take the last segment
  const lines = noEscapes.split(/(?!\r\n)\r/)
  if (lines.length <= 1) return noEscapes

  // For each group of \r-separated segments within a logical line,
  // keep only the last non-empty segment
  return lines[lines.length - 1] ?? ''
}
