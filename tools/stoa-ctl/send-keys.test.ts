import { describe, expect, test } from 'vitest'
import { parseSendKeysTokens } from './send-keys'

describe('parseSendKeysTokens', () => {
  test('treats plain tokens as literal characters and appends named Enter', () => {
    expect(parseSendKeysTokens(['1', 'Enter'])).toBe('1\r')
    expect(parseSendKeysTokens(['hello', 'Enter'])).toBe('hello\r')
  })

  test('maps arrow and control key names to terminal sequences', () => {
    expect(parseSendKeysTokens(['Up', 'C-c'])).toBe('\u001b[A\u0003')
    expect(parseSendKeysTokens(['Left', 'Right'])).toBe('\u001b[D\u001b[C')
  })

  test('leaves unsupported control-style tokens as literal text', () => {
    expect(parseSendKeysTokens(['C-foo'])).toBe('C-foo')
  })

  test('supports meta prefix by prepending escape to the base token sequence', () => {
    expect(parseSendKeysTokens(['M-x'])).toBe('\u001bx')
    expect(parseSendKeysTokens(['M-Enter'])).toBe('\u001b\r')
  })

  test('disables key-name parsing in literal mode', () => {
    expect(parseSendKeysTokens(['Enter'], { literal: true })).toBe('Enter')
    expect(parseSendKeysTokens(['C-c', 'Up'], { literal: true })).toBe('C-cUp')
  })
})
