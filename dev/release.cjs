/**
 * Create a GitHub release with the house stamp on top.
 *
 *   GH_TOKEN=$(printf 'protocol=https
host=github.com

' | git credential fill  *     | sed -n 's/^password=//p') node dev/release.cjs v0.4.3 "标题" notes.md
 *
 * Every published surface carries the same one-liner at the top: this script,
 * README, and the repo description. Keep them in sync by hand if you change it.
 */
const fs = require('fs')

const STAMP = '<sub>大鲸鱼在线写插件</sub>'
const REPO = 'Yu-jianhai/dsh-session-progress'

const request = (method, path, body) =>
  fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-session-progress',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

const main = async () => {
  const [tag, name, file] = process.argv.slice(2)
  if (!tag || !name || !file) {
    console.error('usage: node dev/release.cjs <tag> <title> <notes-file>')
    process.exit(2)
  }
  if (!process.env.GH_TOKEN) {
    console.error('GH_TOKEN is not set')
    process.exit(2)
  }
  const fresh = fs.readFileSync(file, 'utf8').trim()
  const body = fresh.startsWith(STAMP) ? fresh : `${STAMP}

${fresh}`
  const res = await request('POST', `/repos/${REPO}/releases`, {
    tag_name: tag,
    name,
    body,
    draft: false,
    prerelease: false,
  })
  const payload = await res.json()
  if (!res.ok) {
    console.error(res.status, JSON.stringify(payload).slice(0, 400))
    process.exit(1)
  }
  console.log(payload.html_url)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
