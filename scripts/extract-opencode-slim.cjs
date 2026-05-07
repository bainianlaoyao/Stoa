const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

const dbPath = path.join(process.env.USERPROFILE, '.local', 'share', 'opencode', 'opencode.db')
const outputDir = path.join('C:\\Users\\30280\\AppData\\Local\\Temp\\opencode', 'full-extraction', 'slim')
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

const db = new Database(dbPath, { readonly: true })

const topSession = db.prepare(`
  SELECT s.id, s.title, COUNT(m.id) as msg_count
  FROM session s JOIN message m ON m.session_id = s.id
  GROUP BY s.id ORDER BY msg_count DESC LIMIT 1
`).get()
console.log(`Session: ${topSession.id} ("${topSession.title}", ${topSession.msg_count} messages)`)

const messages = db.prepare(`
  SELECT m.id, m.data FROM message m WHERE m.session_id = ? ORDER BY m.time_created
`).all(topSession.id)

const parts = db.prepare(`
  SELECT p.id, p.message_id, p.data FROM part p WHERE p.session_id = ? ORDER BY p.time_created
`).all(topSession.id)

const partsByMsg = new Map()
for (const p of parts) {
  if (!partsByMsg.has(p.message_id)) partsByMsg.set(p.message_id, [])
  partsByMsg.get(p.message_id).push(p)
}

const slimLines = []
let userTurns = 0, asstTurns = 0

for (const msg of messages) {
  let msgData
  try { msgData = JSON.parse(msg.data) } catch { continue }
  const role = msgData.role
  if (role !== 'user' && role !== 'assistant') continue

  const msgParts = partsByMsg.get(msg.id) || []
  const textParts = []

  for (const p of msgParts) {
    let pData
    try { pData = JSON.parse(p.data) } catch { continue }
    if (pData.type === 'text' && pData.text) textParts.push(pData.text)
  }

  if (textParts.length > 0) {
    const header = role === 'user' ? '[User]' : '[Assistant]'
    const text = textParts.join('\n')
    if (text.trim()) {
      slimLines.push(`${header}\n${text}`)
      if (role === 'user') userTurns++; else asstTurns++
    }
  }
}

const slimText = slimLines.join('\n\n')
fs.writeFileSync(path.join(outputDir, 'opencode-slim.txt'), slimText, 'utf8')
console.log(`OpenCode slim: ${userTurns + asstTurns} text turns (${userTurns} user, ${asstTurns} assistant), ${(slimText.length / 1024).toFixed(1)}KB`)
console.log(`File: ${path.join(outputDir, 'opencode-slim.txt')}`)

db.close()
