// Idle cost.
//
// The plugin is meant to sit in a sidebar for hours. Its steady-state traffic
// used to be a full history every three seconds plus a frame every two, most of
// it describing the exact same thing. These assertions pin the three places
// where "nothing changed" must cost nothing:
//   1. `/log?since=N` answers with a version line, not the log;
//   2. `/events` does not resend a frame that did not change;
//   3. the file on disk keeps a clipped `raw`, while memory keeps the full one.
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

if (!process.env.DSP_STATE_FILE) {
  process.env.DSP_STATE_FILE = path.join(os.tmpdir(), `dsp-perf-${process.pid}.json`)
}

const { apply, titleOf } = await import('../lib/index.js')

const LOG_FILE = process.env.DSP_STATE_FILE.replace(/\.json$/i, '') + '.log.json'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const LONG_RAW = `{"p": 55, "note":"${'长'.repeat(600)}"}`

const fakeSession = {
  id: 'session-p',
  seq: 2,
  deriveMessages: () => [{ role: 'user', content: '把空转的开销压掉' }],
  ownEvents: () => [{ type: 'session/title', data: { title: '性能', messageSeqs: [1], source: 'auto' } }],
}

let reply = '{"p": 30, "note":"先看流量"}'
const fakeLlm = {
  listProviders: async () => ['deepseek-account'],
  listModels: async () => [{ id: 'deepseek-flash', reasoning: { efforts: ['off', 'low'], defaultEffort: 'low' } }],
  resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'off' }, { id: 'low' }], defaultEffort: 'low' } }),
  async *stream() {
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}

function makeCtx() {
  const handlers = {}
  const routes = new Map()
  const ctx = {
    on(name, fn) {
      handlers[name] = fn
    },
    get(name) {
      return name === 'llm' ? fakeLlm : undefined
    },
    sessions: { get: (id) => (id === fakeSession.id ? fakeSession : null), list: () => [fakeSession] },
    inject(names, factory) {
      factory({
        effect(fn) {
          fn()
        },
        webServer: {
          register(route) {
            routes.set(route.path, route.handler)
            return () => routes.delete(route.path)
          },
        },
      })
    },
    effect(fn) {
      fn()
    },
  }
  return { ctx, handlers, routes }
}

const call = (routes, handlerPath) =>
  new Promise((resolve) => {
    const chunks = []
    const res = {
      writeHead(status) {
        this.status = status
      },
      end(body) {
        if (body) chunks.push(body)
        resolve({ status: this.status, body: chunks.join('') })
      },
      write() {},
    }
    routes.get(handlerPath.split('?')[0])(
      { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:8080' }, url: handlerPath, on() {} },
      res,
    )
  })

const log = async (routes, query = 'limit=50') => JSON.parse((await call(routes, `/plugins/dsh-session-progress/log?${query}`)).body)

const postConfig = (routes, body) =>
  new Promise((resolve) => {
    const chunks = []
    let status = 0
    const res = {
      writeHead(code) {
        status = code
      },
      end(text) {
        if (text) chunks.push(text)
        resolve({ status, body: chunks.join('') })
      },
      write() {},
    }
    const listeners = {}
    const req = {
      method: 'POST',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:8080' },
      url: '/plugins/dsh-session-progress/config',
      destroy() {},
      on(event, fn) {
        ;(listeners[event] || (listeners[event] = [])).push(fn)
      },
    }
    routes.get('/plugins/dsh-session-progress/config')(req, res)
    setTimeout(() => {
      for (const fn of listeners.data || []) fn(Buffer.from(JSON.stringify(body)))
      for (const fn of listeners.end || []) fn()
    }, 5)
  })

// ---- 1) a poll that changes nothing costs a line ---------------------------
{
  const { ctx, handlers, routes } = makeCtx()
  apply(ctx, { firstDelayMs: 20, intervalMs: 60000 })

  handlers['session/event'](fakeSession, { type: 'turn/start', data: { turn: 1 } })
  await sleep(260)

  const full = await log(routes)
  assert.ok(Number.isFinite(full.version), 'the log response carries a version')
  assert.equal(full.entries.length, 1, 'the sample is there')
  const stamp = full.version

  const idle = await log(routes, `limit=50&since=${stamp}`)
  assert.equal(idle.unchanged, true, 'an unchanged log answers `unchanged`')
  assert.equal(idle.entries, undefined, 'and does not resend the entries')
  assert.ok(idle.tokens && Number.isFinite(idle.tokens.total), 'the header total still travels')
  assert.ok(idle.version === stamp, 'the version is unchanged')

  // A new sample must invalidate the stamp.
  reply = '{"p": 44, "note":"再采一次"}'
  handlers['agent/inbox/inserted']({ agent: { id: fakeSession.id }, message: {} })
  await sleep(2800) // interjection delay is 2500
  const after = await log(routes, `limit=50&since=${stamp}`)
  assert.equal(after.unchanged, undefined, 'a new sample returns the log')
  assert.ok(after.version > stamp, 'and a newer version')
  assert.ok(after.entries.length >= 1)

  // ---- 2) an unchanged frame is not resent --------------------------------
  const frames = []
  const sseRes = {
    writeHead() {},
    write(chunk) {
      if (chunk.startsWith('data: ')) frames.push(chunk.slice(6).trim())
    },
    end() {},
  }
  routes.get('/plugins/dsh-session-progress/events')(
    { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:8080' }, url: '/plugins/dsh-session-progress/events', on() {} },
    sseRes,
  )
  assert.equal(frames.length, 1, 'a new subscriber gets the current frame at once')

  await sleep(2300) // one paint tick, nothing changed
  assert.equal(frames.length, 1, 'an idle tick sends no frame')

  // A settings change alters the look, so the next frame really is different.
  await postConfig(routes, { opacity: 0.42 })
  await sleep(1000)
  assert.ok(frames.length >= 2, 'a real change sends a frame')
  assert.match(frames[frames.length - 1], /"opacity":0\.42/)
  const sent = frames.length
  await sleep(2300)
  assert.equal(frames.length, sent, 'and then silence again')

  // ---- 3) disk keeps a clipped raw, memory keeps the whole one -------------
  reply = LONG_RAW
  handlers['session/event'](fakeSession, { type: 'turn/start', data: { turn: 2 } })
  await sleep(350)
  const withRaw = await log(routes, 'limit=50')
  const live = withRaw.entries[0]
  assert.ok(live.raw.length > 500, 'memory keeps the full model output')

  await sleep(1400) // persistence is debounced by 1.2s
  const onDisk = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'))
  const row = onDisk.entries.filter((entry) => entry.sessionId === fakeSession.id && entry.raw).pop()
  assert.ok(row, 'the log file holds the sample')
  assert.ok(row.raw.startsWith('{"p": 55'), 'the long sample is the one on disk')
  assert.equal(row.raw.length, 400, 'the file keeps only the first 400 characters')
}

// ---- 4) the title lookup is memoized per (session, seq) -------------------
{
  let calls = 0
  const session = {
    id: 'session-cache',
    seq: 7,
    ownEvents() {
      calls += 1
      return [{ type: 'session/title', data: { title: '缓存' } }]
    },
  }
  assert.equal(titleOf(session), '缓存')
  assert.equal(titleOf(session), '缓存')
  assert.equal(calls, 1, 'the second lookup hits the cache')

  session.seq = 8
  assert.equal(titleOf(session), '缓存')
  assert.equal(calls, 2, 'a new seq re-reads the log')
}

try {
  fs.unlinkSync(LOG_FILE)
} catch {
  /* nothing to clean */
}
try {
  fs.unlinkSync(process.env.DSP_STATE_FILE)
} catch {
  /* nothing to clean */
}

// ---- 5) the endpoint counts hits, so a frozen panel can be diagnosed -----
{
  const { ctx: diagCtx, handlers: diagHandlers, routes: diagRoutes } = makeCtx()
  apply(diagCtx, { firstDelayMs: 20, intervalMs: 60000 })
  diagHandlers['session/event'](fakeSession, { type: 'turn/start', data: { turn: 1 } })
  await sleep(200)

  const logUrl = '/plugins/dsh-session-progress/log?limit=5&client=test-client&beat=3&applied=1'
  await call(diagRoutes, logUrl)
  const after = JSON.parse((await call(diagRoutes, '/plugins/dsh-session-progress/debug')).body)
  assert.ok(after.logHits >= 1, 'the endpoint counts its hits')
  assert.ok(after.logHitAt, 'the endpoint remembers the last hit')
  const reporter = (after.logApply || []).find((item) => item.tag === 'test-client')
  assert.ok(reporter, 'a client that asks is remembered')
  assert.equal(reporter.beat, 3)
  assert.equal(reporter.applied, 1)
}

// 5) History ships whole rows, one page at a time. 0.20.1 trimmed them down to
//    the fields the column draws and the detail panel broke: `ms` showed "0s"
//    and the expanded body was empty. The fix is a cursor, not a thinner row.
{
  const { ctx, handlers, routes } = makeCtx()
  apply(ctx, { firstDelayMs: 10, intervalMs: 60000, seedP: 0 })
  handlers['session/event'](fakeSession, { type: 'turn/start', data: { turn: 1 } })
  await sleep(220)
  handlers['session/event'](fakeSession, { type: 'turn/end', data: { turn: 1 } })
  await sleep(60)

  const payload = await log(routes, 'limit=20')
  assert.ok(payload.history.length >= 1, 'closed turns come back with the first paint')
  const row = payload.history[0]
  // The five fields the detail panel actually renders.
  for (const key of ['at', 'sessionId', 'turn', 'p', 'note', 'outcome', 'ms', 'model', 'effort']) {
    assert.ok(key in row, `history rows keep ${key}`)
  }
  assert.equal(typeof row.ms, 'number', 'the duration is a number, not undefined')
  assert.ok(row.raw === undefined || typeof row.raw === 'string', 'raw survives when present')
  assert.equal(payload.historyMore, false, 'one turn does not need a second page')

  const paged = await log(routes, 'limit=20&historyLimit=1')
  assert.equal(paged.history.length, 1, 'historyLimit caps the page')
  assert.equal(typeof paged.historyCursor, 'string', 'and hands back a cursor to continue from')
  assert.equal(paged.historyMore, false, 'a single row is the whole page')

  const off = await log(routes, 'limit=20&history=0')
  assert.equal(off.history.length, 0, 'history=0 still opts out')
  assert.ok(off.historyTotal >= 1, 'but the count stays available')
}

console.log('perf contract assertions passed')
