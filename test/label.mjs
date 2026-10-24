// The log header must show a name, not a code: title first, then the opening
// request, and only then a short id.
import assert from 'node:assert/strict'
import { labelOf, titleOf } from '../lib/index.js'

const titleEvent = (title) => ({ type: 'session/title', data: { title, messageSeqs: [1], source: 'auto' } })
const userEvent = (content) => ({ type: 'user/message', data: { role: 'user', content } })

const session = (events, id = 'session-a1f523f4-62ac-459a-8027-f17128fd9695') => ({
  id,
  ownEvents: () => events,
})

// 1. A titled session shows its title.
const titled = session([userEvent('随便说点什么'), titleEvent('  侧栏进度条  ')])
assert.equal(titleOf(titled), '侧栏进度条')
assert.equal(labelOf(titled), '侧栏进度条')

// 2. An untitled session (the first sample fires before auto-titling lands)
//    falls back to its opening request, whitespace collapsed and clipped.
const long = '帮我改一下登录页的跳转，顺便看看 EAMS 课表能不能读出来，再想想进度条要怎么排'
const untitled = session([userEvent(`  ${long.replace(/，/g, '，')}  `)])
const label = labelOf(untitled)
assert.ok(label.startsWith('帮我改一下登录页的跳转'), `unexpected label: ${label}`)
assert.ok(label.length <= 41, `label too long: ${label.length}`)
assert.ok(label.endsWith('…'), 'long opening requests must be clipped with an ellipsis')
assert.notEqual(label, 'a1f523f4')

// 3. Block content (the other message shape) works too.
const blocked = session([userEvent([{ type: 'text', text: '把进度条改成竖列' }, { type: 'image' }])])
assert.equal(labelOf(blocked), '把进度条改成竖列 [图片]')

// 4. A whitespace-only title is not a label.
const blankTitle = session([titleEvent('   '), userEvent('看一下这个报错')])
assert.equal(labelOf(blankTitle), '看一下这个报错')

// 5. No events at all: short id, without the `session-` prefix.
const bare = session([])
assert.equal(labelOf(bare), 'a1f523f4')
assert.equal(labelOf({ id: 'session-xyz' }), 'xyz')

// 6. A session whose event access throws must not break the sampler.
const broken = {
  id: 'session-deadbeef-0000',
  ownEvents() {
    throw new Error('boom')
  },
}
assert.equal(labelOf(broken), 'deadbeef')
assert.equal(labelOf(undefined), '')

console.log('label assertions passed')
