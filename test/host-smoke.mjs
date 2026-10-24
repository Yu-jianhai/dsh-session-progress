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
    yield { type: 'text-delta', index: 0, text: '{"p": 42, ' }
    yield { type: 'text-delta', index: 0, text: '"note":"改接口"}' }
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

for (const cleanup of cleanups) { try { cleanup() } catch {} }
if (ownStateFile) { try { fs.unlinkSync(process.env.DSP_STATE_FILE) } catch {} }

console.log('\nall assertions passed')

