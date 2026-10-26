#!/usr/bin/env node
// Take a snapshot of everything worth restoring: the two source files, the
// tests, the preview generators, the docs and the manifest. node_modules is
// deliberately left out — it is reproducible with `pnpm install` and would make
// every snapshot hundreds of megabytes.
//
//   node scripts/snapshot.cjs <label>
//
// Snapshots land in backups/<stamp>-<label>/ with a manifest.json that records
// the git revision, the package version and a sha256 per file, so a restore can
// tell whether anything was partially written.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const label = (process.argv[2] || 'manual').replace(/[^a-zA-Z0-9._-]+/g, '-')

const WANTED = [
  'lib',
  'test',
  'dev',
  'locale',
  'package.json',
  'cordis.patch.yml',
  'AGENTS.md',
  'ARCHITECTURE.md',
  'PROBLEMS.md',
  'README.md',
  'LICENSE',
]

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
const target = path.join(root, 'backups', `${stamp}-${label}`)

function hashes(base) {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'backups' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const body = fs.readFileSync(full)
        out.push({
          path: path.relative(base, full).split(path.sep).join('/'),
          bytes: body.length,
          sha256: crypto.createHash('sha256').update(body).digest('hex'),
        })
      }
    }
  }
  walk(base)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

// copy
fs.mkdirSync(target, { recursive: true })
for (const item of WANTED) {
  const from = path.join(root, item)
  if (!fs.existsSync(from)) continue
  fs.cpSync(from, path.join(target, item), { recursive: true })
}

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const manifest = {
  label,
  createdAt: new Date().toISOString(),
  version,
  gitRev: git(['rev-parse', '--short', 'HEAD']),
  gitBranch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  gitDirty: git(['status', '--porcelain']) !== '',
  files: hashes(target),
}
fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const total = manifest.files.reduce((sum, item) => sum + item.bytes, 0)
console.log(`snapshot: backups/${path.basename(target)}`)
console.log(`  version ${version}  rev ${manifest.gitRev || '(no git)'}${manifest.gitDirty ? ' (dirty)' : ''}`)
console.log(`  ${manifest.files.length} files, ${(total / 1024).toFixed(1)} kB`)
console.log('  restore with: node scripts/restore.cjs ' + path.basename(target))
