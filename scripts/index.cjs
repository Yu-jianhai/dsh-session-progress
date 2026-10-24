#!/usr/bin/env node
/**
 * Rebuild the symbol index in ARCHITECTURE.md.
 *
 * The map is only useful if its line numbers are true, and hand-maintaining
 * line numbers is a guarantee they will rot. Every declaration that matters is
 * a top-level or one-level-nested `function` / `const x = (...) =>`, which is
 * cheap to recover with a regex -- so the generated block is line-accurate and
 * the prose around it stays hand-written.
 *
 *   node scripts/index.cjs           # rewrite the block
 *   node scripts/index.cjs --check   # exit 1 when the block is stale
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DOC = path.join(ROOT, 'ARCHITECTURE.md')
const FILES = [
  { file: 'lib/index.js', scope: 'host' },
  { file: 'lib/client.js', scope: 'client' },
]
const BEGIN = '<!-- INDEX:BEGIN -->'
const END = '<!-- INDEX:END -->'

/** Indentation -> where in the module the declaration lives. */
const ZONES = {
  '0': 'module',
  '2': 'apply',
  '4': 'factory',
}

/**
 * Declaration shapes worth listing: real functions and real exports. A bare
 * `const x = (anything)` is a value, not a function -- listing those turned the
 * index into noise (`turn`, `count` came from clamping expressions).
 */
function classify(text) {
  const fn = /^(\s*)(?:export\s+)?(?:async\s+)?function\s+(\w+)/.exec(text)
  if (fn) return { indent: fn[1].length, name: fn[2], kind: 'function' }
  const arrow = /^(\s*)(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/.exec(text)
  if (arrow) return { indent: arrow[1].length, name: arrow[2], kind: 'const fn' }
  const single = /^(\s*)(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?([\w$]+)\s*=>/.exec(text)
  if (single) return { indent: single[1].length, name: single[2], kind: 'const fn' }
  const exported = /^(\s*)export\s+const\s+(\w+)\s*=/.exec(text)
  if (exported) return { indent: exported[1].length, name: exported[2], kind: 'const' }
  return null
}

function scan(entry) {
  const file = path.join(ROOT, entry.file)
  const lines = fs.readFileSync(file, 'utf8').split(String.fromCharCode(10))
  const out = []
  lines.forEach((text, index) => {
    const hit = classify(text)
    if (!hit) return
    const zone = ZONES[String(hit.indent)]
    if (!zone) return
    if (out.some((row) => row.name === hit.name && row.zone === zone)) return
    out.push({ name: hit.name, kind: hit.kind, zone, line: index + 1, file: entry.file, scope: entry.scope })
  })
  return out
}

function render(rows) {
  const head = [
    '| 文件 | 行 | 符号 | 位置 | 类型 |',
    '|---|---|---|---|---|',
  ]
  const body = rows.map(
    (row) => `| \`${row.file}\` | ${row.line} | \`${row.name}\` | ${row.zone} | ${row.kind} |`,
  )
  return [...head, ...body].join('\n')
}

const rows = FILES.flatMap(scan)
const block = render(rows)
const doc = fs.readFileSync(DOC, 'utf8')
const start = doc.indexOf(BEGIN)
const stop = doc.indexOf(END)
if (start < 0 || stop < 0 || stop < start) {
  console.error(`ARCHITECTURE.md is missing the ${BEGIN} / ${END} markers`)
  process.exit(2)
}

const next = `${doc.slice(0, start + BEGIN.length)}\n${block}\n${doc.slice(stop)}`
if (process.argv.includes('--check')) {
  if (next !== doc) {
    console.error('ARCHITECTURE.md symbol index is stale: run `node scripts/index.cjs`')
    process.exit(1)
  }
  console.log(`symbol index up to date (${rows.length} symbols)`)
} else {
  fs.writeFileSync(DOC, next, 'utf8')
  console.log(`indexed ${rows.length} symbols across ${FILES.length} files`)
}
