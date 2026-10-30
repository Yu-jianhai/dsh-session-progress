// Replay a real turn from the log through the detector and print what it would
// have said after each sample. Evidence, not a test: it uses the dump written by
// scripts/dump-session.cjs.
import fs from 'node:fs'
import { trackStall, LOOP_WINDOW } from '../lib/index.js'

const sid = process.argv[2] || 'session-c4a02aff-ab8e-4a9b-bc76-95e20bc33e9f'
const file = process.argv[3] || '.git/log-dump.json'
const dump = JSON.parse(fs.readFileSync(file, 'utf8'))
const rows = [...(dump.entries || []), ...(dump.history || [])]
  .filter((entry) => entry.sessionId === sid)
  .sort((a, b) => String(a.at).localeCompare(String(b.at)))

const window = []
for (const row of rows) {
  if (!Number.isFinite(Number(row.p))) continue
  window.push({ p: Number(row.p), note: row.note || '', at: Date.parse(row.at) })
  while (window.length > LOOP_WINDOW) window.shift()
  const verdict = trackStall(window, Date.parse(row.at))
  const stall = verdict.stall
  console.log(
    String(row.at).slice(11, 19),
    String(row.p).padStart(3),
    (stall ? `${stall.level}/${stall.reason}` : '—').padEnd(13),
    `turns=${stall?.turns ?? 0}`.padEnd(9),
    `churn=${stall?.churn ?? 0}`.padEnd(9),
    (row.note || '').slice(0, 24),
  )
}
