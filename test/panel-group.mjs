// The left-rail log groups samples per session. These helpers are pure, so the
// test pulls them straight out of lib/client.js and exercises the real source
// (a rename or a reshuffle breaks the test instead of the panel).
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

function sliceFn(name) {
  const marker = `function ${name}(`
  const at = source.indexOf(marker)
  if (at < 0) throw new Error(`lib/client.js no longer defines ${name}()`)
  const next = source.indexOf('\n    function ', at + marker.length)
  return source.slice(at, next < 0 ? source.length : next)
}

const helpers = new Function(
  `${['shortId', 'clockOf', 'formatTokens', 'hueOf', 'groupBySession'].map(sliceFn).join('\n')}
   return { shortId, hueOf, groupBySession, formatTokens }`,
)()

const entry = (sessionId, at, p, sessionTitle) => ({ sessionId, at, p, sessionTitle: sessionTitle || '', note: 'n' + p })

// Newest first, interleaved: b, a, b, a
const entries = [
  entry('session-b', '2026-10-25T02:00:30.000Z', 60, '第二个会话'),
  entry('session-a', '2026-10-25T02:00:20.000Z', 40, '侧栏进度条'),
  entry('session-b', '2026-10-25T02:00:10.000Z', 30, ''),
  entry('session-a', '2026-10-25T02:00:00.000Z', 20, ''),
]

const groups = helpers.groupBySession(entries)
console.log('groups =', groups.map((g) => `${g.title || helpers.shortId(g.id)}@${g.entries[0].p}%x${g.entries.length}`).join(' | '))

if (groups.length !== 2) throw new Error(`expected 2 session groups, got ${groups.length}`)
// The session sampled most recently comes first.
if (groups[0].id !== 'session-b') throw new Error('the most recently sampled session must sort first')
if (groups[1].id !== 'session-a') throw new Error('second group is the other session')
// A title seen on ANY entry of the group names the group (older samples may predate it).
if (groups[0].title !== '第二个会话') throw new Error('group title comes from its titled entry')
if (groups[1].title !== '侧栏进度条') throw new Error('a title on the newest entry wins')
// Order inside the group is preserved: newest first.
if (groups[1].entries.map((item) => item.p).join(',') !== '40,20') throw new Error('entries keep their newest-first order')

// Untitled session still distinguishes itself through the short id.
const untitled = helpers.groupBySession([entry('session-c', '2026-10-25T02:01:00.000Z', 10, '')])
console.log('untitled head =', helpers.shortId(untitled[0].id))
if (untitled[0].title !== '') throw new Error('no title must stay empty, not become a guess')

// Colour is stable per session and always a valid hue.
const hue = helpers.hueOf('session-a')
if (hue !== helpers.hueOf('session-a')) throw new Error('hue must be stable per session')
if (!(hue >= 0 && hue < 360)) throw new Error('hue must be a valid 0..359 angle')
if (hue === helpers.hueOf('session-b')) throw new Error('different sessions should differ in colour')

// An empty log is the empty state, not a crash.
if (helpers.groupBySession([]).length !== 0) throw new Error('no entries means no groups')

// Token totals in the header use the same compact form everywhere.
const tokenCases = [
  [0, '0'],
  [24, '24'],
  [950, '950'],
  [936, '936'],
  [1240, '1.2k'],
  [18300, '18.3k'],
  [120000, '120k'],
  [null, '0'],
  ['nope', '0'],
]
for (const [input, expected] of tokenCases) {
  const actual = helpers.formatTokens(input)
  if (actual !== expected) throw new Error(`formatTokens(${String(input)}) = ${actual}, expected ${expected}`)
}
if (!/^[0-9.]+k?$/.test(helpers.formatTokens(9800))) throw new Error('token counts must stay short for the header')

console.log('\npanel grouping assertions passed')
