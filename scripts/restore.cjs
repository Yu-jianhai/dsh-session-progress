#!/usr/bin/env node
// Put a snapshot back. This is the "crash fast, recover faster" half of the
// pair: it restores exactly the files recorded in the snapshot's manifest and
// removes files this repository no longer has (so a half-finished refactor that
// added a file also gets rolled back).
//
//   node scripts/restore.cjs latest
//   node scripts/restore.cjs 20261026-061500-pre-refract
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const backups = path.join(root, 'backups')
const want = process.argv[2]

if (!want) {
  const all = fs.existsSync(backups)
    ? fs.readdirSync(backups).filter((name) => fs.existsSync(path.join(backups, name, 'manifest.json'))).sort()
    : []
  console.log('usage: node scripts/restore.cjs <snapshot|latest>')
  console.log('available snapshots:')
  for (const name of all) console.log('  ' + name)
  if (all.length === 0) console.log('  (none — run `node scripts/snapshot.cjs <label>` first)')
  process.exit(1)
}

const names = fs
  .readdirSync(backups)
  .filter((name) => fs.existsSync(path.join(backups, name, 'manifest.json')))
  .sort()
const chosen = want === 'latest' ? names[names.length - 1] : names.find((name) => name === want || name.endsWith('-' + want))
if (!chosen) {
  console.error(`no snapshot matches "${want}"`)
  process.exit(1)
}

const source = path.join(backups, chosen)
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'))

// Files that the snapshot owns: whatever the manifest lists.
const owned = new Set(manifest.files.map((item) => item.path))

let written = 0
let removed = 0
let verified = 0
for (const item of manifest.files) {
  const from = path.join(source, item.path)
  const to = path.join(root, item.path)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  const body = fs.readFileSync(to)
  const sha256 = crypto.createHash('sha256').update(body).digest('hex')
  if (sha256 === item.sha256) verified += 1
  else console.error(`  ! checksum mismatch after copy: ${item.path}`)
  written += 1
}

// Anything the snapshot does not own, inside the directories it does own, was
// created after the snapshot was taken: drop it, otherwise a half-finished
// change survives the rollback.
const SCAN = ['lib', 'test', 'dev']
for (const dir of SCAN) {
  const base = path.join(root, dir)
  if (!fs.existsSync(base)) continue
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      const rel = path.relative(root, full).split(path.sep).join('/')
      if (entry.isDirectory()) walk(full)
      else if (!owned.has(rel)) {
        fs.unlinkSync(full)
        console.log(`  - removed ${rel}`)
        removed += 1
      }
    }
  }
  walk(base)
}

console.log(`restored backups/${chosen}`)
console.log(`  ${written} files written, ${verified} checksums verified, ${removed} stray files removed`)
console.log(`  snapshot from version ${manifest.version}, rev ${manifest.gitRev || '(no git)'}`)
console.log('  next: npm test && npm run check')
