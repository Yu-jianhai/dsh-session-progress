// Turn lifecycle: live samples become history when the turn ends, an
// interrupted turn stays resumable, and the log survives a restart.
//
// Three things are easy to get wrong here and none of them show up in the UI on
// the first try: closing the wrong samples, resuming from a completed turn, and
// reloading a file whose entries were still 'active'.
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-history-'))
process.env.DSP_STATE_FILE = path.join(dir, 'config.json')
process.env.DSP_LOG_FILE = path.join(dir, 'log.json')

const { apply } = await import('../lib/index.js')

const fakeSession = {
  id: 'session-h',
  seq: 2,
  deriveMessages: () => [{ role: 'user', content: '把历史轮做出来' }],
  ownEvents: () => [{ type: 'session/title', data: { title: '历史轮', messageSeqs: [1], source: 'auto' } }],
}

let reply = '{"p": 42, "note":"写历史列"}'
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
  const cleanups = []
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
          cleanups.push(fn())
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
      cleanups.push(fn())
    },
  }
  return { ctx, handlers, routes, cleanups }
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

const log = async (routes, limit = 50) => JSON.parse((await call(routes, `/plugins/dsh-session-progress/log?limit=${limit}`)).body)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---- 1) a live turn samples, then turn/end freezes it as 'completed' --------
{
  const { ctx, handlers, routes, cleanups } = makeCtx()
  apply(ctx, { firstDelayMs: 20, intervalMs: 60000 })

  handlers['session/event'](fakeSession, { type: 'turn/start', data: { turn: 1 } })
  await sleep(220)
  let data = await log(routes)
  assert.equal(data.entries.length, 1, 'live sample is listed as an active entry')
  assert.equal(data.entries[0].p, 42)
  assert.equal(data.entries[0].turn, 1, 'the sample remembers its turn')
  assert.equal(data.entries[0].phase, 'active')
  assert.equal(data.history.length, 0)

  handlers['session/event'](fakeSession, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  await sleep(1600) // the write is debounced by 1.2s
  data = await log(routes)
  assert.equal(data.entries.length, 0, 'nothing live after turn/end')
  assert.equal(data.history.length, 1)
  assert.equal(data.history[0].outcome, 'completed')
  assert.equal(data.historyTotal, 1)
  assert.equal(data.interruptedTotal, 0)

  // ---- 2) a turn that never closes is interrupted and resumes ------------
  // turn 2 runs and samples 42%, then turn 3 opens on top of it without a
  // turn/end: that is exactly the "stopped mid-task" case.
  handlers['session/event'](fakeSession, { type: 'turn/start', data: { turn: 2 } })
  await sleep(220)
  handlers['session/event'](fakeSession, { type: 'turn/start', data: { turn: 3 } })

  // Read synchronously, before the new turn's first sample can land: the band
  // must already sit at the interrupted turn's number, not at zero.
  const snapshot = JSON.parse((await call(routes, '/plugins/dsh-session-progress/snapshot')).body)
  const painted = snapshot.sessions.find((session) => session.id === fakeSession.id)
  assert.ok(painted, 'the resumed turn keeps a band')
  assert.equal(painted.p, 42, 'the resumed turn starts where the interrupted one stopped')

  data = await log(routes)
  assert.ok(
    data.history.some((entry) => entry.outcome === 'interrupted'),
    'the abandoned turn is kept as interrupted history',
  )
  assert.ok(data.interruptedTotal >= 1)
  assert.ok(
    data.history.every((entry) => entry.phase === 'closed'),
    'history only ever holds closed entries',
  )

  // ---- 3) the file on disk really holds it ---------------------------------
  await sleep(1400) // persistence is debounced by 1.2s
  const saved = JSON.parse(fs.readFileSync(process.env.DSP_LOG_FILE, 'utf8'))
  assert.ok(saved.entries.length >= 2)
  assert.ok(saved.entries.every((entry) => ['active', 'closed'].includes(entry.phase)))
  assert.ok(saved.entries.some((entry) => entry.outcome === 'interrupted'))

  for (const cleanup of cleanups) cleanup()
}

// ---- 4) a restart turns leftovers into interrupted history, resumable ------
{
  // Simulate a process that died mid-turn: an entry still marked active.
  const saved = JSON.parse(fs.readFileSync(process.env.DSP_LOG_FILE, 'utf8'))
  saved.entries.push({
    at: new Date().toISOString(),
    sessionId: 'session-dead',
    turn: 7,
    phase: 'active',
    outcome: '',
    p: 68,
    note: '做到一半',
    sessionTitle: '被中断的会话',
  })
  fs.writeFileSync(process.env.DSP_LOG_FILE, JSON.stringify(saved))

  const { ctx, handlers, routes } = makeCtx()
  const fresh = await import(`${pathToFileURL(path.resolve('lib/index.js')).href}?boot=${Date.now()}`)
  fresh.apply(ctx, { firstDelayMs: 20, intervalMs: 60000 })

  const data = await log(routes)
  const reloaded = data.history.find((entry) => entry.sessionId === 'session-dead')
  assert.ok(reloaded, 'the leftover entry is still there after boot')
  assert.equal(reloaded.phase, 'closed')
  assert.equal(reloaded.outcome, 'interrupted')
  assert.equal(data.interruptedTotal >= 1, true)

  const debug = JSON.parse((await call(routes, '/plugins/dsh-session-progress/debug')).body)
  const resume = new Map(debug.resumeP || [])
  assert.equal(resume.get('session-dead'), 68, 'the resume point is the last number the turn reached')
}

// ---- a turn that dies without a turn/end must not linger as "active" ------
{
  const { ctx, handlers, routes } = makeCtx()
  ctx.sessions.list = () => [fakeSession]
  const fresh = await import(`${pathToFileURL(path.resolve('lib/index.js')).href}?reap=${Date.now()}`)
  fresh.apply(ctx, { firstDelayMs: 20, intervalMs: 60000 })

  handlers['session/event'](fakeSession, { type: 'turn/start', data: { turn: 1 } })
  await sleep(260)
  const before = await log(routes)
  assert.ok((before.entries || []).length > 0, 'the sample is live while the turn runs')

  // The conversation is closed: no turn/end ever lands, only agent/disposed.
  handlers['agent/disposed']({ agent: { id: fakeSession.id } })

  const after = await log(routes)
  const live = (after.entries || []).filter((entry) => entry.sessionId === fakeSession.id)
  assert.equal(live.length, 0, 'a disposed turn is out of the live list right away')
  const reaped = (after.history || []).find((entry) => entry.sessionId === fakeSession.id)
  assert.ok(reaped, 'it lands in history instead of vanishing')
  assert.equal(reaped.phase, 'closed')
  assert.equal(reaped.outcome, 'interrupted')
}

fs.rmSync(dir, { recursive: true, force: true })
console.log('history assertions passed')
