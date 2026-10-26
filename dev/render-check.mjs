import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const source = fs.readFileSync(path.resolve('lib/client.js'), 'utf8')

// --- minimal DOM -------------------------------------------------------------
const sheets = []
const makeStyle = () => {
  const node = {
    attrs: {},
    textContent: '',
    setAttribute(name, value) {
      node.attrs[name] = value
    },
    remove() {},
  }
  return node
}
const bodyChildren = []
globalThis.window = globalThis
globalThis.document = {
  visibilityState: 'visible',
  head: { append: (...nodes) => sheets.push(...nodes) },
  body: {
    appendChild: (node) => {
      bodyChildren.push(node)
      return node
    },
    append: (...nodes) => bodyChildren.push(...nodes),
    hasAttribute: () => false,
  },
  createElement: (tag) => (tag === 'style' ? makeStyle() : { ...makeStyle(), tagName: tag }),
  createElementNS: (ns, tag) => ({ ...makeStyle(), tagName: tag, children: [] }),
  addEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  documentElement: { style: {} },
}
globalThis.getComputedStyle = () => ({ colorScheme: 'dark', backgroundColor: 'rgb(20, 21, 24)' })
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
globalThis.EventSource = class {
  constructor() {}
  addEventListener() {}
  close() {}
}
globalThis.CSS = { escape: (value) => String(value) }

// --- data straight from the running host -------------------------------------
const port = process.argv[2] || '64716'
const payload = await fetch(`http://127.0.0.1:${port}/plugins/dsh-session-progress/log?limit=120`).then((r) => r.json())
globalThis.fetch = async () => ({ ok: true, json: async () => payload })

// --- React stub that really walks the tree -----------------------------------
const hookCalls = []
const React = {
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: (fn) => {
    hookCalls.push('effect')
  },
  useLayoutEffect: (fn) => {
    hookCalls.push('layout')
  },
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol('fragment'),
}

const registrations = []
const requireStub = (id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require(${id})`)
}

let moduleExports = null
globalThis.__ModuleLoader__ = {
  load({ factory }) {
    moduleExports = factory(requireStub)
  },
}

await import(`${pathToFileURL(path.resolve('lib/client.js')).href}?render=${Date.now()}`)

const ctx = {
  effect(fn) {
    fn()
  },
  slots: {
    inject(name, callback) {
      try {
        const result = callback()
        if (result && typeof result.next === 'function') {
          while (!result.next().done) {
            /* generators register on each step */
          }
        }
      } catch (error) {
        console.log(`FAIL  inject(${name}): ${error && error.message}`)
      }
    },
    register(spec, component) {
      registrations.push({ spec, component })
      return () => {}
    },
  },
}
moduleExports.apply(ctx)

// Walk an element tree, invoking function components the way React would.
function walk(node, depth = 0) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, depth)
    return
  }
  if (typeof node.type === 'function') {
    const out = node.type(node.props || {})
    walk(out, depth + 1)
    return
  }
  for (const child of node.children || []) walk(child, depth + 1)
}

const seen = new Set()
for (const { spec, component } of registrations) {
  const label = `${spec.name}${spec.key ? `#${spec.key}` : ''}${spec.id ? `#${spec.id}` : ''}`
  if (!component || seen.has(label)) continue
  seen.add(label)
  try {
    walk(React.createElement(component, {}))
    console.log(`ok    ${label}`)
  } catch (error) {
    console.log(`FAIL  ${label}\n      ${error && error.message}`)
    console.log(String(error && error.stack).split('\n').slice(0, 6).join('\n'))
  }
}
console.log('registrations:', registrations.map((r) => r.spec.name).join(', '))
