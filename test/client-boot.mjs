/**
 * Boots the browser half against a stub DOM and drives real SSE frames.
 *
 * The band is painted entirely by `render()` writing `--dsp-p` into the
 * dynamic stylesheet, and the frame handler swallows exceptions -- so a
 * single undefined identifier inside `render()` makes the band vanish with
 * no visible error. Only running the factory catches that class of bug.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const sheets = []
const errors = []

const makeStyle = (tag) => ({
  tag,
  attrs: {},
  style: {},
  textContent: '',
  setAttribute(name, value) {
    this.attrs[name] = value
  },
  remove() {
    const index = sheets.indexOf(this)
    if (index >= 0) sheets.splice(index, 1)
  },
  appendChild() {},
})

const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect() {},
  useLayoutEffect() {},
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
}

const streamHandlers = new Map()
let constructed = 0

class EventSourceStub {
  constructor(url) {
    this.url = url
    constructed += 1
  }

  addEventListener(name, handler) {
    streamHandlers.set(name, handler)
  }

  close() {}
}

globalThis.window = globalThis
globalThis.document = {
  createElement: (tag) => makeStyle(tag),
  head: {
    append(...nodes) {
      sheets.push(...nodes)
    },
    appendChild(node) {
      sheets.push(node)
    },
  },
  body: {},
  documentElement: { style: {}, attributes: [] },
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
}
globalThis.getComputedStyle = () => ({
  colorScheme: 'dark',
  backgroundColor: 'rgb(23, 24, 28)',
})
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}
globalThis.matchMedia = () => ({
  matches: true,
  addEventListener() {},
  removeEventListener() {},
})
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    config: { color: '#90AFFF', opacity: 0.6, style: 'band', intervalMs: 30000 },
    effort: 'off',
    total: 0,
    entries: [],
  }),
})
globalThis.EventSource = EventSourceStub
const realError = console.error
console.error = (...args) => {
  errors.push(args.map(String).join(' '))
  realError(...args)
}

let clientModule = null
globalThis.__ModuleLoader__ = {
  load({ factory }) {
    clientModule = factory((name) => (name === 'react' ? ReactStub : {}))
  },
}

const moduleUrl = pathToFileURL(
  path.join(import.meta.dirname, '..', 'lib', 'client.js'),
).href
await import(moduleUrl)

assert.ok(clientModule, 'the factory ran and exported a module')
assert.equal(clientModule.name, 'dsh-session-progress-client')

const injected = []
const cleanups = []
const ctx = {
  effect(fn) {
    const cleanup = fn()
    cleanups.push(cleanup)
    return cleanup
  },
  slots: {
    inject(name) {
      injected.push(name)
    },
    register() {
      return () => {}
    },
  },
}

clientModule.apply(ctx)

const sheetOf = (suffix) => sheets.find((item) => item.attrs['data-plugin-css'] === suffix)
const base = sheetOf('dsh-session-progress')
const lookSheet = sheetOf('dsh-session-progress-look')
const dynamic = sheetOf('dsh-session-progress-rules')
const theme = sheetOf('dsh-session-progress-theme')

assert.ok(base, 'base stylesheet injected')
assert.ok(lookSheet, 'look stylesheet injected')
assert.ok(dynamic, 'dynamic stylesheet injected')
assert.ok(theme, 'theme stylesheet injected')
assert.ok(sheets.indexOf(base) < sheets.indexOf(lookSheet), 'look sheet comes after base')
assert.match(lookSheet.textContent, /#90AFFF/i, 'look sheet painted the default colour at boot')
assert.equal(constructed, 1, 'one progress stream opened')
assert.ok(injected.includes('sidebar.panellist'), 'rail entry registered')
assert.ok(injected.includes('main'), 'panel body registered')

// The initial /config fetch paints the saved look before any frame arrives.
await new Promise((resolve) => setTimeout(resolve, 0))
assert.match(lookSheet.textContent, /#90AFFF/i)

// A frame carrying one running session must reach the dynamic sheet. With a
// ReferenceError inside render() this stays empty and the band disappears.
const emit = (payload) => {
  const handler = streamHandlers.get('message')
  assert.ok(handler, 'message handler attached')
  handler({ data: JSON.stringify(payload) })
}

emit({
  type: 'progress',
  sessions: [{ id: 'session-abc-123', p: 62, o: 0.6 }],
  look: { color: '#90AFFF', opacity: 0.6, style: 'band' },
})

assert.equal(errors.length, 0, `frame handled without errors, got: ${errors.join(' | ')}`)
assert.match(dynamic.textContent, /--dsp-p:62%/, 'painted the session progress')
assert.match(dynamic.textContent, /--dsp-o:0\.6/, 'painted the opacity')

// A host broadcast of a different look repaints the band.
emit({
  type: 'progress',
  sessions: [{ id: 'session-abc-123', p: 62, o: 0.5 }],
  look: { color: '#FF8800', opacity: 0.5, style: 'glow' },
})
assert.match(lookSheet.textContent, /#FF8800/, 'broadcast look applied')
assert.match(lookSheet.textContent, /box-shadow/, 'glow style applied')

// An unsaved preview survives the next broadcast (the 0.4.1 regression is
// covered directly in test/look.mjs; here we only need the empty-frame path).
emit({ type: 'progress', sessions: [], look: { color: '#FF8800', opacity: 0.5, style: 'glow' } })
assert.equal(dynamic.textContent, '', 'empty frame clears every rule')

for (const cleanup of cleanups) {
  if (typeof cleanup === 'function') cleanup()
}
assert.equal(sheets.length, 0, 'cleanup removed every stylesheet')

console.error = realError
console.log('client boot assertions passed')
