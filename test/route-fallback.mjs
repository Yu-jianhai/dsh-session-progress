// Route resolution on a machine that is NOT this one.
//
// The shipped default is deepseek-account/deepseek-flash. Another user may have
// a different account or vendor, and forcing a route that does not exist would
// make the band silently never appear. This test drives two such machines:
//   1. a catalog that exists but does not contain the default route,
//   2. a catalog that is empty (no provider configured at all).
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

if (!process.env.DSP_STATE_FILE) {
  process.env.DSP_STATE_FILE = path.join(os.tmpdir(), `dsp-route-${process.pid}.json`)
}

const { apply } = await import('../lib/index.js')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A minimal harness that answers the endpoints this plugin registers. */
function makeHarness({ models, onStream }) {
  const routes = new Map()
  const handlers = {}
  const cleanups = []
  const calls = []
  const messages = [
    { role: 'user', content: '把进度条做出来' },
    { role: 'assistant', content: '先看侧栏的行结构' },
  ]
  const session = { id: 'session-1', seq: 2, deriveMessages: () => messages }
  const llm = {
    listProviders: async () => [...new Set(models.map((item) => item.provider))],
    listModels: async (provider) => models.filter((item) => item.provider === provider).map((item) => ({ id: item.model, reasoning: { efforts: [{ id: 'low' }] } })),
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }] } }),
    async *stream(options) {
      calls.push(options)
      onStream(options)
      yield { type: 'text-delta', index: 0, text: '{"p": 30, "note":"读代码"}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const ctx = {
    on(name, fn) { handlers[name] = fn },
    get(name) { return name === 'llm' ? llm : undefined },
    sessions: { get: (id) => (id === 'session-1' ? session : null), list: () => [session] },
    inject(names, factory) {
      factory({
        effect(fn) { cleanups.push(fn()) },
        webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path) } },
      })
    },
    effect(fn) { cleanups.push(fn()) },
  }
  const call = (url) =>
    new Promise((resolve) => {
      const chunks = []
      const res = {
        writeHead(status) { this.status = status },
        end(body) { if (body) chunks.push(body); resolve(JSON.parse(chunks.join('') || 'null')) },
        write() {},
      }
      routes.get(url.split('?')[0])({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:8080' }, url, on() {} }, res)
    })
  return { ctx, handlers, call, calls, cleanups }
}

// ---- 1. catalog exists, default route does not -------------------------------
{
  const harness = makeHarness({
    models: [
      { provider: 'moonshot', model: 'kimi-k2-turbo' },
      { provider: 'moonshot', model: 'kimi-mini' },
    ],
    onStream: () => {},
  })
  apply(harness.ctx, { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'off', firstDelayMs: 20, intervalMs: 60000 })
  harness.handlers['session/event']({ id: 'session-1' }, { type: 'turn/start', data: { turn: 1 } })
  await sleep(350)

  const config = await harness.call('/plugins/dsh-session-progress/config')
  console.log('fallback config  =', JSON.stringify({ provider: config.config.provider, model: config.config.model, routeFallback: config.routeFallback, catalogEmpty: config.catalogEmpty }))
  if (config.routeFallback !== true) throw new Error('expected routeFallback on a machine without the default route')
  if (config.config.provider !== 'moonshot') throw new Error(`expected provider moonshot, got ${config.config.provider}`)
  if (config.config.model !== 'kimi-mini') throw new Error(`expected the cheap model kimi-mini, got ${config.config.model}`)
  if (harness.calls.length !== 1) throw new Error(`expected exactly 1 sample, got ${harness.calls.length}`)
  if (harness.calls[0].provider !== 'moonshot') throw new Error('the stream call must use the resolved route')

  const log = await harness.call('/plugins/dsh-session-progress/log')
  console.log('fallback log[0]  =', JSON.stringify({ model: log.entries[0].model, p: log.entries[0].p }))
  if (log.entries[0].model !== 'moonshot/kimi-mini') throw new Error('the log must name the route that actually ran')
  for (const cleanup of harness.cleanups) { try { cleanup() } catch {} }
}

// ---- 2. no catalog at all ---------------------------------------------------
{
  const harness = makeHarness({ models: [], onStream: () => {} })
  apply(harness.ctx, { provider: 'deepseek-account', model: 'deepseek-flash', firstDelayMs: 20, intervalMs: 60000 })
  harness.handlers['session/event']({ id: 'session-1' }, { type: 'turn/start', data: { turn: 1 } })
  await sleep(350)

  const config = await harness.call('/plugins/dsh-session-progress/config')
  console.log('empty catalog    =', JSON.stringify({ catalogEmpty: config.catalogEmpty, routeFallback: config.routeFallback }))
  if (config.catalogEmpty !== true) throw new Error('an empty catalog must be reported, not guessed around')
  if (harness.calls.length !== 0) throw new Error('no model call may happen without a route')

  const snapshot = await harness.call('/plugins/dsh-session-progress/snapshot')
  console.log('empty snapshot   =', JSON.stringify(snapshot.sessions))
  for (const cleanup of harness.cleanups) { try { cleanup() } catch {} }
}

try { fs.unlinkSync(process.env.DSP_STATE_FILE) } catch {}
console.log('\nroute resolution assertions passed')
