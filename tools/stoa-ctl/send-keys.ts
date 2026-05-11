const NAMED_KEY_SEQUENCES = new Map<string, string>([
  ['enter', '\r'],
  ['tab', '\t'],
  ['space', ' '],
  ['escape', '\u001b'],
  ['esc', '\u001b'],
  ['backspace', '\u007f'],
  ['bspace', '\u007f'],
  ['delete', '\u001b[3~'],
  ['dc', '\u001b[3~'],
  ['up', '\u001b[A'],
  ['down', '\u001b[B'],
  ['right', '\u001b[C'],
  ['left', '\u001b[D'],
  ['home', '\u001b[H'],
  ['end', '\u001b[F'],
  ['pageup', '\u001b[5~'],
  ['ppage', '\u001b[5~'],
  ['pagedown', '\u001b[6~'],
  ['npage', '\u001b[6~'],
  ['insert', '\u001b[2~'],
  ['ic', '\u001b[2~'],
  ['btab', '\u001b[Z']
])

interface ParseSendKeysOptions {
  literal?: boolean
}

export function parseSendKeysTokens(tokens: string[], options: ParseSendKeysOptions = {}): string {
  if (options.literal) {
    return tokens.join('')
  }

  return tokens.map(parseToken).join('')
}

function parseToken(token: string): string {
  if (!token) {
    return ''
  }

  const named = NAMED_KEY_SEQUENCES.get(token.toLowerCase())
  if (named !== undefined) {
    return named
  }

  if (token.startsWith('C-') || token.startsWith('c-')) {
    return parseControlToken(token)
  }

  if (token.startsWith('M-') || token.startsWith('m-')) {
    const base = token.slice(2)
    if (!base) {
      return token
    }
    return `\u001b${parseToken(base)}`
  }

  return token
}

function parseControlToken(token: string): string {
  const base = token.slice(2)
  if (base.length !== 1) {
    return token
  }

  if (base === '?') {
    return '\u007f'
  }

  const code = base.toUpperCase().charCodeAt(0)
  if (code >= 0x40 && code <= 0x5f) {
    return String.fromCharCode(code & 0x1f)
  }

  return token
}
