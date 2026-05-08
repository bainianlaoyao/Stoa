import { describe, it, expect } from 'vitest'
import { stripAnsi } from './ansi-stripper'

describe('stripAnsi', () => {
  it('passes through plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world')
  })

  it('removes CSI color codes', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[0m')).toBe('green')
  })

  it('removes CSI style codes (bold, underline)', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[0m')).toBe('bold')
  })

  it('removes 256-color and RGB codes', () => {
    expect(stripAnsi('\x1b[38;5;196mred\x1b[0m')).toBe('red')
    expect(stripAnsi('\x1b[38;2;255;0;0mred\x1b[0m')).toBe('red')
  })

  it('removes cursor movement codes', () => {
    expect(stripAnsi('\x1b[2J\x1b[H')).toBe('')
  })

  it('removes OSC title codes', () => {
    expect(stripAnsi('\x1b]0;window-title\x07')).toBe('')
  })

  it('handles mixed ANSI and real text', () => {
    const input = '\x1b[32;1mSuccess\x1b[0m: file \x1b[36mreadme.md\x1b[0m written'
    expect(stripAnsi(input)).toBe('Success: file readme.md written')
  })

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('')
  })

  it('preserves newlines', () => {
    expect(stripAnsi('line1\nline2\r\nline3')).toBe('line1\nline2\r\nline3')
  })

  it('removes carriage-return-only progress lines', () => {
    // Some terminal output uses \r to overwrite the same line
    const input = 'downloading 0%\rdownloading 50%\rdownloading 100%'
    // Keep only the last "frame" — split by \r, take last non-empty
    expect(stripAnsi(input)).toBe('downloading 100%')
  })
})
