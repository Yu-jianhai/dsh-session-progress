import assert from 'node:assert/strict'

import { buildContext, describeTurn } from '../lib/index.js'

/** A session stand-in: `deriveMessages` is all `buildContext` asks for. */
const sessionOf = (messages) => ({ deriveMessages: () => messages })

const user = (text) => ({ role: 'user', content: [{ type: 'text', text }] })
const say = (text) => ({ role: 'assistant', content: [{ type: 'text', text }] })
const call = (name, args) => ({ role: 'assistant', content: [{ type: 'tool-call', name, arguments: args }] })
const tool = (text) => ({ role: 'tool', content: [{ type: 'text', text }] })

/* 1. tool calls carry their arguments now */
{
  const long = 'x'.repeat(600)
  const built = buildContext(
    sessionOf([user('把进度日志的 WB 列接上'), call('Bash', { command: 'npm test', cwd: 'E:/w' }), say(long)]),
    4000,
    Date.now() - 90_000,
  )
  assert.ok(built, 'context should be built')
  assert.match(built.text, /\[调用工具 Bash\]/, 'tool name survives')
  assert.match(built.text, /npm test/, 'the command itself survives')
}

/* 2. the opening ask is never the thing that gets clipped away */
{
  const messages = [user('给我把设置页的取色管修好')]
  for (let i = 0; i < 40; i += 1) {
    messages.push(call('Bash', { command: `echo step ${i}` }))
    messages.push(tool('ok'))
    messages.push(say(`第 ${i} 步做完了，继续。${'细节'.repeat(80)}`))
  }
  const built = buildContext(sessionOf(messages), 1500, Date.now() - 600_000)
  assert.ok(built, 'context should be built')
  assert.match(built.text, /【本轮目标】给我把设置页的取色管修好/, 'ask survives truncation')
  assert.match(built.text, /【最近记录】/, 'activity section is present')
  assert.ok(built.text.length <= 1500 + 64, `context stays near the budget (${built.text.length})`)
}

/* 3. the digest is the hard evidence, not prose */
{
  const rest = [call('Read', {}), call('Bash', {}), call('Bash', {}), tool('Error: command failed with exit code 1')]
  const digest = describeTurn(rest, Date.now() - 125_000, Date.now())
  assert.match(digest, /本轮已进行 2 分/, 'elapsed time is stated')
  assert.match(digest, /已调用工具 3 次/, 'tool count is stated')
  assert.match(digest, /Bash×2/, 'repeated tools are collapsed with a count')
  assert.match(digest, /带着报错字样/, 'a failing last tool is named')
}

/* 4. a quiet turn says so instead of inventing activity */
{
  const quiet = describeTurn([say('等你想好再继续')], 0, Date.now())
  assert.match(quiet, /还没有调用工具/, 'no tools is stated plainly')
  assert.doesNotMatch(quiet, /已进行/, 'without a start time the clock is not invented')
  assert.doesNotMatch(quiet, /报错字样/, 'a turn with no tool result claims no error')

  const clean = describeTurn(
    [call('Read', {}), tool('file contents look fine')],
    Date.now() - 5_000,
    Date.now(),
  )
  assert.match(clean, /没有明显的报错字样/, 'a clean last result is not called an error')
}

/* 5. degenerate inputs stay quiet */
{
  assert.equal(buildContext(sessionOf([]), 4000, 0), null)
  assert.equal(buildContext({}, 4000, 0), null)
  const built = buildContext(sessionOf([user('只有一句话')]), 4000, 0)
  assert.ok(built && built.text.includes('只有一句话'))
  assert.ok(built.stats.includes('还没有调用工具'))
}

console.log('context assertions passed')
