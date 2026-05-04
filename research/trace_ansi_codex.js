// trace-ansi-codex.js
import fs from 'node:fs'
import path from 'node:path'
import pty from 'node-pty'

const command = process.argv[2] || (process.platform === 'win32' ? 'codex.cmd' : 'codex')
const args = process.argv.slice(3)

const logPath = path.resolve(process.cwd(), 'codex-vscode.raw.ansi.log')
const statsPath = path.resolve(process.cwd(), 'codex-vscode.ansi-stats.json')

const stats = {
  altEnter1049: 0,
  altExit1049: 0,
  syncStart2026: 0,
  syncEnd2026: 0,
  ed2: 0,
  ed3: 0,
  cursorH: 0,
  eraseLine: 0,
  resetScrollRegion: 0,
  reverseIndex: 0,
  bracketedPasteOn: 0,
  bracketedPasteOff: 0,
  mouseSgrOn: 0,
  mouseSgrOff: 0
}

function countMatches(input, regex) {
  const matches = input.match(regex)
  return matches ? matches.length : 0
}

function collectStats(scan) {
  stats.altEnter1049 += countMatches(scan, /\x1b\[\?1049h/g)
  stats.altExit1049 += countMatches(scan, /\x1b\[\?1049l/g)
  stats.syncStart2026 += countMatches(scan, /\x1b\[\?2026h/g)
  stats.syncEnd2026 += countMatches(scan, /\x1b\[\?2026l/g)
  stats.ed2 += countMatches(scan, /\x1b\[2J/g)
  stats.ed3 += countMatches(scan, /\x1b\[3J/g)
  stats.cursorH += countMatches(scan, /\x1b\[[0-9;]*H/g)
  stats.eraseLine += countMatches(scan, /\x1b\[K/g)
  stats.resetScrollRegion += countMatches(scan, /\x1b\[r/g)
  stats.reverseIndex += countMatches(scan, /\x1bM/g)
  stats.bracketedPasteOn += countMatches(scan, /\x1b\[\?2004h/g)
  stats.bracketedPasteOff += countMatches(scan, /\x1b\[\?2004l/g)
  stats.mouseSgrOn += countMatches(scan, /\x1b\[\?1006h/g)
  stats.mouseSgrOff += countMatches(scan, /\x1b\[\?1006l/g)
}

let scanBuffer = ''

function inspect(data) {
  scanBuffer += data

  // 留一小段尾巴，避免 ANSI 序列跨 chunk 被漏算
  const keep = 128
  const scan =
    scanBuffer.length > keep
      ? scanBuffer.slice(0, scanBuffer.length - keep)
      : ''

  if (!scan) {
    return
  }

  collectStats(scan)
  scanBuffer = scanBuffer.slice(scanBuffer.length - keep)
}

function flushRemaining() {
  collectStats(scanBuffer)
}

const rawLog = fs.createWriteStream(logPath, { flags: 'w' })

const term = pty.spawn(command, args, {
  name: 'xterm-256color',
  cols: process.stdout.columns || 120,
  rows: process.stdout.rows || 30,
  cwd: process.cwd(),
  env: {
    ...process.env,
    TERM: process.env.TERM || 'xterm-256color',
    COLORTERM: process.env.COLORTERM || 'truecolor'
  }
})

term.onData((data) => {
  rawLog.write(data)
  inspect(data)
  process.stdout.write(data)
})

term.onExit(({ exitCode }) => {
  flushRemaining()
  rawLog.end()

  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2))

  process.stderr.write('\n\n=== ANSI stats ===\n')
  process.stderr.write(JSON.stringify(stats, null, 2))
  process.stderr.write(`\n\nraw log: ${logPath}\nstats: ${statsPath}\n`)

  process.exit(exitCode ?? 0)
})

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
}

process.stdin.resume()

process.stdin.on('data', (buf) => {
  // Ctrl+] 退出 wrapper，避免 Codex 卡住时不好退出
  if (buf.length === 1 && buf[0] === 0x1d) {
    term.kill()
    return
  }

  term.write(buf.toString('utf8'))
})

process.stdout.on('resize', () => {
  term.resize(process.stdout.columns || 120, process.stdout.rows || 30)
})
