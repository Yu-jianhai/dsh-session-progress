// Smoke test for the host half: fake ctx + fake llm, then read /log back.
// Writes its saved-config assertions to a throwaway file so a plain `npm test`
// never touches the real ~/.dsh/session-progress.config.json.
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import assert from 'node:assert/strict'

const ownStateFile = !process.env.DSP_STATE_FILE
if (ownStateFile) {
  process.env.DSP_STATE_FILE = path.join(os.tmpdir(), `dsp-smoke-${process.pid}.json`)
}

const { apply } = await import('../lib/index.js')

const cleanups = []
const handlers = {}
const routes = new Map()

const messages = [
  { role: 'system', content: 'you are an agent' },
  { role: 'user', content: '把 side bar 的进度条做出来' },
  { role: 'assistant', content: [{ type: 'reasoning', text: '想想' }, { type: 'text', text: '我先看看 Rows.module.css' }, { type: 'tool-call', id: 'c1', name: 'grep', arguments: '{"pattern":"sessionRow"}' }] },
  { role: 'tool', content: [{ type: 'text', text: '.wnFoaW_sessionRow{...}' }] },
]

// A session with a title, so the log can be grouped per session on screen.
const titleEvent = { type: 'session/title', data: { title: '侧栏进度条', messageSeqs: [2], source: 'auto' } }

const fakeSession = { id: 'session-1', seq: 4, deriveMessages: () => messages, ownEvents: () => [titleEvent] }

let seenOptions = null
let lastPrompt = ''
let calls = 0
let gate = null
const replies = []
const fakeLlm = {
  // The model catalog is the source of truth (it lists `off`); resolveModelInfo
  // advertises a smaller set on purpose, so the test proves which one wins.
  listProviders: async () => ['deepseek-account'],
  listModels: async () => [
    { id: 'deepseek-flash', reasoning: { efforts: ['off', 'low', 'high', 'max'], defaultEffort: 'high' } },
  ],
  resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'minimal' }, { id: 'low' }, { id: 'high' }], defaultEffort: 'high' } }),
  async *stream(options) {
    seenOptions = options
    calls += 1
    if (gate) await gate
    const reply = replies.length > 0 ? replies.shift() : '{"p": 42, "note":"改接口"}'
    lastPrompt = options.messages?.[0]?.content?.[0]?.text ?? ''
    yield { type: 'text-delta', index: 0, text: reply.slice(0, 12) }
    yield { type: 'text-delta', index: 0, text: reply.slice(12) }
    yield { type: 'usage', usage: { inputTokens: 812, outputTokens: 24, cacheReadTokens: 100, cacheWriteTokens: 0 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}

const ctx = {
  on(name, fn) { handlers[name] = fn },
  get(name) { return name === 'llm' ? fakeLlm : undefined },
  sessions: { get: (id) => (id === 'session-1' ? fakeSession : null), list: () => [fakeSession] },
  inject(names, factory) {
    factory({ effect(fn) { cleanups.push(fn()) }, webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path) } } })
  },
  effect(fn) { cleanups.push(fn()) },
}

apply(ctx, { firstDelayMs: 30, intervalMs: 60000 })

const call = (path) => new Promise((resolve) => {
  const chunks = []
  const res = {
    writeHead(status) { this.status = status },
    end(body) { if (body) chunks.push(body); resolve({ status: this.status, body: chunks.join('') }) },
    write() {},
  }
  routes.get(path)({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:8080' }, url: path, on() {} }, res)
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

handlers['session/event']({ id: 'session-1' }, { type: 'turn/start', data: { turn: 1 } })
await sleep(400)

const snapshot = JSON.parse((await call('/plugins/dsh-session-progress/snapshot')).body)
const log = JSON.parse((await call('/plugins/dsh-session-progress/log')).body)
const debug = JSON.parse((await call('/plugins/dsh-session-progress/debug')).body)

console.log('snapshot.sessions =', JSON.stringify(snapshot.sessions))
console.log('log.entries[0]    =', JSON.stringify(log.entries[0]))
console.log('debug.effort      =', debug.effort, '| samplers =', debug.samplers)
console.log('llm saw effort    =', seenOptions && seenOptions.reasoningEffort, '| maxTokens =', seenOptions && seenOptions.maxTokens)
console.log('prompt head       =', JSON.stringify((seenOptions.messages[0].content[0].text || '').slice(0, 120)))

// ---- what the model said ------------------------------------------------
// The model is told to answer with one line of JSON; the bar must come from it.
assert.equal(snapshot.sessions.length, 1, 'one painted session while a turn runs')
assert.equal(snapshot.sessions[0].id, 'session-1')
assert.equal(snapshot.sessions[0].p, 42, 'progress comes from the model JSON')
assert.ok(snapshot.sessions[0].o > 0 && snapshot.sessions[0].o <= 1, 'opacity is a 0..1 factor')
assert.equal(log.entries.length, 1, 'every sample is logged')
assert.equal(log.entries[0].note, '改接口')
assert.equal(log.entries[0].raw.trim(), '{"p": 42, "note":"改接口"}', 'the raw output is kept verbatim')
// The panel groups by session; without the title every session looks the same.
assert.equal(log.entries[0].sessionTitle, '侧栏进度条', 'the session title travels with the sample')

// ---- token accounting ----------------------------------------------------
assert.deepEqual(
  log.entries[0].tokens,
  { input: 812, output: 24, cacheRead: 100, cacheWrite: 0, total: 936 },
  'the adapter usage travels with the sample',
)
assert.equal(log.tokens.total, 936, 'the header total is the sum over every sample')
assert.equal(log.tokens.samples, 1, 'only samples that reported usage are counted')
assert.equal(log.tokens.input, 812)

// ---- effort resolution ---------------------------------------------------
// listModels() advertises `off`; resolveModelInfo() disagrees on purpose.
// The catalog wins, so the requested effort reaches the adapter untouched.
assert.equal(debug.effort, 'off', 'the model catalog is the effort source of truth')
assert.equal(seenOptions.reasoningEffort, 'off', 'no silent downgrade when the catalog offers it')
assert.equal(seenOptions.temperature, 0)
assert.ok(seenOptions.maxTokens > 0 && seenOptions.maxTokens <= 200, 'samples stay short')

// turn ends -> 100 -> fade -> entry disappears
handlers['session/event']({ id: 'session-1' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
await sleep(60)
const afterEnd = JSON.parse((await call('/plugins/dsh-session-progress/snapshot')).body)
await sleep(1400)
const afterFade = JSON.parse((await call('/plugins/dsh-session-progress/snapshot')).body)
console.log('right after end  =', JSON.stringify(afterEnd.sessions))
console.log('after fade+drop  =', JSON.stringify(afterFade.sessions))

// ---- turn lifecycle -----------------------------------------------------
assert.equal(afterEnd.sessions.length, 1, 'the bar survives long enough to be seen at 100')
assert.equal(afterEnd.sessions[0].p, 100, 'turn/end tops the bar out')
assert.deepEqual(afterFade.sessions, [], 'the bar disappears after the fade')

// ---- settings endpoint ----------------------------------------------------
const CONFIG = '/plugins/dsh-session-progress/config'
const getConfig = () => call(CONFIG)

function postConfig(body) {
  return new Promise((resolve) => {
    const chunks = []
    let status = 0
    const res = {
      writeHead(code) { status = code },
      end(text) { if (text) chunks.push(text); resolve({ status, body: chunks.join('') }) },
      write() {},
    }
    const listeners = {}
    const req = {
      method: 'POST',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:8080' },
      url: CONFIG,
      destroy() {},
      on(event, fn) { (listeners[event] || (listeners[event] = [])).push(fn) },
    }
    routes.get(CONFIG)(req, res)
    setTimeout(() => {
      for (const fn of listeners.data || []) fn(Buffer.from(JSON.stringify(body)))
      for (const fn of listeners.end || []) fn()
    }, 5)
  })
}

const cfg0 = JSON.parse((await getConfig()).body)
console.log('config GET      =', JSON.stringify(cfg0.config))
const saved = JSON.parse(
  (
    await postConfig({
      intervalMs: 45000,
      interjectDelayMs: 200,
      reasoningEffort: 'minimal',
      maxSessions: 99,
      color: '#FF8800',
      opacity: 0.35,
      style: 'glow',
    })
  ).body,
)
console.log('config POST     =', saved.config.intervalMs, 'ms /', saved.config.reasoningEffort, '/ maxSessions', saved.config.maxSessions)
const reread = JSON.parse((await getConfig()).body)
console.log('persisted again =', reread.config.intervalMs, 'ms /', reread.config.reasoningEffort)
console.log('state file      =', reread.stateFile)

// ---- settings round-trip -------------------------------------------------
assert.equal(cfg0.config.intervalMs, 60000, 'the caller config is the starting point')
assert.equal(saved.config.intervalMs, 45000)
assert.equal(saved.config.maxSessions, 10, 'out-of-range input is clamped to [1, 10]')
assert.equal(reread.config.intervalMs, 45000, 'a POST survives a restart')
assert.equal(reread.config.reasoningEffort, 'minimal')
assert.equal(saved.config.color, '#FF8800', 'a hex colour is accepted and normalised to upper case')
assert.equal(saved.config.opacity, 0.35)
assert.equal(saved.config.style, 'glow', 'a known look style is accepted')
assert.equal(cfg0.config.color, '#90AFFF', 'the default colour is the requested blue')
assert.equal(cfg0.config.style, 'band')
assert.equal(cfg0.config.flow, true, 'the flow is on by default')
assert.equal(cfg0.config.flowSpeed, 'slow', 'default speed is the slow one')
assert.equal(cfg0.config.flowQuality, 'medium', 'default quality is the water texture')

// ---- look settings are validated, never trusted --------------------------
const dirty = JSON.parse(
  (
    await postConfig({
      color: 'javascript:alert(1)',
      opacity: 9,
      style: 'not-a-style',
    })
  ).body,
)
assert.equal(dirty.config.color, '#FF8800', 'a non-hex colour keeps the previous one')
assert.equal(dirty.config.opacity, 1, 'opacity is clamped into [0.05, 1]')
assert.equal(dirty.config.style, 'glow', 'an unknown style keeps the previous one')

// ---- flow settings are validated too -------------------------------------
const flowOn = JSON.parse(
  (await postConfig({ flow: false, flowSpeed: 'warp', flowQuality: 'ultra' })).body,
)
assert.equal(flowOn.config.flow, false, 'the switch is stored')
assert.equal(flowOn.config.flowSpeed, 'slow', 'an unknown speed keeps the previous one')
assert.equal(flowOn.config.flowQuality, 'medium', 'an unknown quality keeps the previous one')
const flowSet = JSON.parse((await postConfig({ flowSpeed: 'fast', flowQuality: 'high' })).body)
assert.equal(flowSet.config.flowSpeed, 'fast')
assert.equal(flowSet.config.flowQuality, 'high')
const lookFrame = JSON.parse((await call('/plugins/dsh-session-progress/snapshot')).body)
assert.ok(lookFrame, 'snapshot still answers')

// ---- 插嘴：允许已画出的进度回退 ------------------------------------------
replies.push('{"p": 45, "note": "改接口"}', '{"p": 20, "note": "按新要求重估"}')
handlers['session/event']({ id: 'session-1' }, { type: 'turn/start', data: { turn: 2 } })
await sleep(500)

const jump = JSON.parse((await call('/plugins/dsh-session-progress/snapshot')).body)
assert.equal(jump.sessions.find((item) => item.id === 'session-1').p, 45, 'a normal sample sets the bar')
assert.doesNotMatch(lastPrompt, /用户在你工作途中补充了新的要求/)

// The user speaks mid-turn: the remaining work just got bigger.
handlers['session/event'](
  { id: 'session-1' },
  { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '顺便把颜色也改成绿色' }] } },
)
await sleep(700)

const rejump = JSON.parse((await call('/plugins/dsh-session-progress/snapshot')).body)
assert.equal(
  rejump.sessions.find((item) => item.id === 'session-1').p,
  20,
  'after an interjection the estimate may move backwards',
)
assert.match(lastPrompt, /用户在你工作途中补充了新的要求/, 'the sampler is told why it may revise')
// Since 0.8 the previous estimate travels with the prompt, not just a warning:
// the model is asked to judge the direction itself.
assert.match(lastPrompt, /当前进度：45%/, 'the prompt carries the number from last time')
assert.match(lastPrompt, /当时阶段是「改接口」/, 'and the stage it named then')
assert.match(lastPrompt, /进度可以往上，也可以往下/, 'the model is told either direction is allowed')

const revisedLog = JSON.parse((await call('/plugins/dsh-session-progress/log')).body)
assert.equal(revisedLog.entries[0].p, 20)
assert.equal(revisedLog.entries[0].revised, true, 'the log marks the revised estimate')
assert.equal(
  revisedLog.entries.filter((item) => item.revised).length,
  1,
  'only the post-interjection sample is marked',
)

// ---- 同屏数量：帧里带 limit，最多就那么几条 --------------------------------
const capConfig = JSON.parse((await postConfig({ maxSessions: 2 })).body)
assert.equal(capConfig.config.maxSessions, 2, 'the visible-band cap is configurable')
const capped = JSON.parse((await call('/plugins/dsh-session-progress/snapshot')).body)
assert.equal(capped.limit, 2, 'the frame announces the cap so the client can honour it')
assert.ok(
  !Array.isArray(capped.sessions) || capped.sessions.length <= 2,
  'the frame never carries more bands than the cap',
)

// A message on an idle session is a new turn, not an interjection.
handlers['session/event']({ id: 'session-1' }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
await sleep(50)
assert.doesNotThrow(() =>
  handlers['session/event']({ id: 'session-1' }, { type: 'user/message', data: { role: 'user' } }),
)

// ---- 同一会话不并发：慢调用期间不叠第二发 --------------------------------
let release = () => {}
gate = new Promise((resolve) => { release = resolve })
calls = 0
replies.push('{"p": 30, "note": "慢调用"}')
handlers['session/event']({ id: 'session-1' }, { type: 'turn/start', data: { turn: 3 } })
await sleep(400)
assert.equal(calls, 1, 'the first sample is in flight')

handlers['session/event']({ id: 'session-1' }, { type: 'user/message', data: { role: 'user' } })
await sleep(600)
assert.equal(calls, 1, 'a beat that lands while a call is out does not start a second one')

release()
gate = null
await sleep(600)
assert.equal(calls, 1, 'the in-flight call finishing does not fire a duplicate')
const slow = JSON.parse((await call('/plugins/dsh-session-progress/snapshot')).body)
assert.equal(slow.sessions.find((item) => item.id === 'session-1').p, 30, 'the slow call still lands')

// ---- 恢复默认：宿主那份 DEFAULT_CONFIG 才是唯一副本 ------------------------
await postConfig({ color: '#FF8800', style: 'underline', opacity: 0.4, intervalMs: 9000, maxSessions: 7 })
const restored = JSON.parse((await postConfig({ reset: true })).body)
assert.equal(restored.config.color, '#90AFFF', 'reset puts the colour back')
assert.equal(restored.config.style, 'band', 'and the style')
assert.equal(restored.config.intervalMs, 30000, 'and the interval')
assert.equal(restored.config.maxSessions, 3, 'and the visible-band count')
assert.equal(restored.config.rainbow, false, 'and the experimental rainbow is off again')
const rainbowOn = JSON.parse((await postConfig({ rainbow: true })).body)
assert.equal(rainbowOn.config.rainbow, true, 'the rainbow switch saves')
assert.equal(
  JSON.parse((await call('/plugins/dsh-session-progress/snapshot')).body).look.rainbow,
  true,
  'and travels with every frame so the band repaints at once',
)

for (const cleanup of cleanups) { try { cleanup() } catch {} }
if (ownStateFile) { try { fs.unlinkSync(process.env.DSP_STATE_FILE) } catch {} }

console.log('\nall assertions passed')

