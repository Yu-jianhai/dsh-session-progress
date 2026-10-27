/**
 * Every slot component, rendered for real.
 *
 * The panel and the settings card used to be checked only by "does the file
 * parse" and "does the CSS text look right" — and a single `data.active` on a
 * null payload blanked both of them in production. This mounts each component
 * the way React would (walking the returned element tree), first with the empty
 * state a fresh host delivers, then with a full payload.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const fixture = {
  version: 12,
  config: {
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    reasoningEffort: 'off',
    intervalMs: 30000,
    color: '#90AFFF',
    opacity: 0.7,
    style: 'glow',
    flow: true,
    flowSpeed: 'slow',
    flowQuality: 'medium',
  },
  effort: 'off',
  total: 9,
  active: 3,
  historyTotal: 6,
  interruptedTotal: 1,
  tokens: { input: 900, output: 120, cacheRead: 0, cacheWrite: 0, total: 1020, samples: 3 },
  entries: [
    {
      turn: 2,
      phase: 'active',
      outcome: '',
      at: '2026-10-26T05:56:33.000Z',
      sessionId: 'session-723cb8f8-a585-4ed2-b191-28b37462f15e',
      sessionTitle: '每分钟进度条插件方案',
      model: 'deepseek-account/deepseek-flash',
      effort: 'off',
      ms: 953,
      p: 45,
      prev: 40,
      note: '改渲染逻辑',
      raw: '{"p":45,"note":"改渲染逻辑"}',
      tokens: { input: 165, output: 10, cacheRead: 256, cacheWrite: 0, total: 431 },
      revised: true,
      error: '',
    },
    {
      turn: 2,
      phase: 'active',
      outcome: '',
      at: '2026-10-26T05:56:02.000Z',
      sessionId: 'session-bili',
      sessionTitle: '安装 dsh-bili-whale 插件',
      model: 'deepseek-account/deepseek-flash',
      effort: 'off',
      ms: 700,
      p: 20,
      prev: 25,
      note: '排查登录脚本',
      raw: '{"p":20,"note":"排查登录脚本"}',
      tokens: { input: 100, output: 8, cacheRead: 0, cacheWrite: 0, total: 108 },
      revised: false,
      error: '',
    },
  ],
  history: [
    {
      turn: 1,
      phase: 'closed',
      outcome: 'interrupted',
      at: '2026-10-26T05:20:00.000Z',
      sessionId: 'session-723cb8f8-a585-4ed2-b191-28b37462f15e',
      sessionTitle: '每分钟进度条插件方案',
      model: 'deepseek-account/deepseek-flash',
      effort: 'off',
      ms: 810,
      p: 62,
      prev: 60,
      note: '写样式',
      raw: '{"p":62,"note":"写样式"}',
      tokens: { input: 80, output: 6, cacheRead: 0, cacheWrite: 0, total: 86 },
      revised: false,
      error: '',
    },
  ],
}

// --- the browser surface client.js expects -----------------------------------
const sheets = []
const styleNode = () => ({
  attrs: {},
  textContent: '',
  setAttribute(name, value) {
    this.attrs[name] = value
  },
  remove() {},
})
const bodyChildren = []
globalThis.window = globalThis
globalThis.document = {
  visibilityState: 'visible',
  head: { append: (...nodes) => sheets.push(...nodes) },
  body: {
    appendChild: (node) => bodyChildren.push(node) || node,
    append: (...nodes) => bodyChildren.push(...nodes),
    hasAttribute: () => false,
  },
  createElement: (tag) => Object.assign(styleNode(), { tagName: tag }),
  createElementNS: (ns, tag) =>
    Object.assign(styleNode(), { tagName: tag, children: [], style: {}, attrs: {} }),
  getElementById: () => null,
  addEventListener() {},
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
globalThis.CSS = { escape: (value) => String(value) }
globalThis.EventSource = class {
  addEventListener() {}
  close() {}
}

let served = null
globalThis.fetch = async () => ({ ok: true, json: async () => served })

// --- the React slice the module needs ----------------------------------------
const React = {
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: (fn) => {
    fn()
  },
  useLayoutEffect: (fn) => {
    fn()
  },
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol('fragment'),
}
const requireStub = (id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require(${id})`)
}

let api = null
globalThis.__ModuleLoader__ = {
  load({ factory }) {
    api = factory(requireStub)
  },
}
await import(`${pathToFileURL(path.resolve('lib/client.js')).href}?render=${Date.now()}`)

const registrations = []
api.apply({
  effect(fn) {
    fn()
  },
  slots: {
    inject(name, callback) {
      const result = callback()
      if (result && typeof result.next === 'function') {
        while (!result.next().done) {
          /* generators register on each step */
        }
      }
    },
    register(spec, component) {
      registrations.push({ spec, component })
      return () => {}
    },
  },
})

assert.equal(registrations.length >= 4, true, 'all four slots are registered')

/** Walk an element tree, calling function components the way React would. */
function render(component) {
  const seenNodes = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (typeof node.type === 'function') {
      walk(node.type(node.props || {}))
      return
    }
    if (typeof node.type === 'string') seenNodes.push(node)
    ;(node.children || []).forEach(walk)
  }
  walk(React.createElement(component, {}))
  return seenNodes
}

// 1) The empty state a freshly started host delivers. This is the one that broke.
for (const { spec, component } of registrations) {
  assert.doesNotThrow(() => render(component), `${spec.name} renders before any sample lands`)
}

// 2) A full payload: rows, the history column and the delta badges all exist.
served = fixture
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// First pass kicks off the fetch; the store holds the payload after it settles.
for (const { component } of registrations) render(component)
await sleep(60)
const classes = new Set()
for (const { component } of registrations) {
  const nodes = render(component)
  for (const node of nodes) {
    for (const name of String(node.props.className || '').split(/\s+/)) {
      if (name) classes.add(name)
    }
  }
}
for (const name of ['dsp-panel-sub', 'dsp-columns', 'dsp-row-line', 'dsp-history', 'dsp-seg']) {
  assert.equal(classes.has(name), true, `${name} is rendered once data arrives`)
}

// 3) The settings card is a signpost, not a second copy of the log. If rows
// ever come back here the two lists drift apart again, so it is asserted.
assert.equal(classes.has('dsp-loglink'), true, 'the settings card offers a link to the log')
const settingsOnly = new Set()
const settingsRegistration = registrations.find((item) => item.spec.name === 'plugins.bundle.config')
for (const node of render(settingsRegistration.component)) {
  for (const name of String(node.props.className || '').split(/\s+/)) {
    if (name) settingsOnly.add(name)
  }
}
assert.equal(settingsOnly.has('dsp-loglink'), true, 'the settings slot renders the link card')
assert.equal(settingsOnly.has('dsp-row-line'), false, 'the settings slot no longer renders log rows')
assert.equal(settingsOnly.has('dsp-columns'), false, 'nor the two-column log layout')

assert.equal(sheets.length >= 3, true, 'the base, look and dynamic stylesheets are injected')

// 4) The panel skin comes from the host config and defaults to the grouped
//    layout. If the class stops following `panelStyle`, the switch in settings
//    becomes a no-op that still claims to work.
assert.equal(classes.has('dsp-skin-apple'), true, 'a config without panelStyle draws the apple skin')
assert.equal(classes.has('dsp-skin-classic'), false, 'and not the classic one')

served = { ...fixture, config: { ...(fixture.config || {}), panelStyle: 'classic' } }
const panelRegistration = registrations.find((item) => item.spec.name === 'main')
await sleep(60)
const classicClasses = new Set()
for (const node of render(panelRegistration.component)) {
  for (const name of String(node.props.className || '').split(/\s+/)) {
    if (name) classicClasses.add(name)
  }
}
assert.equal(classicClasses.has('dsp-skin-classic'), true, 'panelStyle: classic switches the skin')
assert.equal(classicClasses.has('dsp-skin-apple'), false, 'and the apple class goes away')

// 4) The preview must repaint on the flow controls too. `paintLook` once keyed
// only on colour/opacity/style, so switching the tier (or its speed, or the
// on/off switch) changed nothing until the next SSE frame — the preview looked
// stuck. Fire the real onChange of the quality select and read the sheet back.
const lookSheet = () => sheets.find((node) => node.attrs && node.attrs['data-plugin-css'] === 'dsh-session-progress-look')
assert.ok(lookSheet(), 'the look sheet is injected')
assert.equal(
  /dsp-refract/.test(lookSheet().textContent),
  false,
  'the fixture starts on the medium tier',
)
const settingsNodes = render(registrations.find((item) => item.spec.name === 'plugins.bundle.config').component)
const flatten = (children) =>
  (children || []).flatMap((child) => (Array.isArray(child) ? flatten(child) : [child]))
const qualitySelect = settingsNodes.find(
  (node) =>
    node.type === 'select' &&
    flatten(node.children).some((child) => child && child.props && child.props.value === 'refract'),
)
assert.ok(qualitySelect, 'the quality select is rendered')
qualitySelect.props.onChange({ target: { value: 'refract' } })
assert.match(
  lookSheet().textContent,
  /::before\{[^}]*animation:dsp-cross/,
  'switching to the experimental tier repaints the sheet immediately',
)
assert.match(
  lookSheet().textContent,
  /::after\{[^}]*box-shadow:inset 1px -1px 1px/,
  'and the glassy edge comes with it',
)

// 5) The visible-band cap is a real control, not a hard-coded three.
const capSelect = settingsNodes.find(
  (node) =>
    node.type === 'select' &&
    flatten(node.children).some((child) => child && child.props && child.props.value === '10'),
)
assert.ok(capSelect, 'the settings card offers a "how many bands at once" select')
assert.ok(
  flatten(capSelect.children).some((child) => child && child.props && child.props.value === '1'),
  'and it goes all the way down to a single band',
)

// 6) Saving must show what the host stored, not re-derive from a stale config.
const labels = []
for (const node of render(registrations.find((item) => item.spec.name === 'plugins.bundle.config').component)) {
  const walk = (item) => {
    if (typeof item === 'string') {
      labels.push(item)
      return
    }
    if (Array.isArray(item)) {
      item.forEach(walk)
      return
    }
    if (!item || typeof item !== 'object') return
    if (Array.isArray(item.children)) item.children.forEach(walk)
    if (typeof item.children === 'string') labels.push(item.children)
    if (item.props && typeof item.props.children === 'string') labels.push(item.props.children)
  }
  walk(node)
}
assert.ok(labels.includes('恢复默认'), 'the card offers a restore-defaults action')
const clientSource = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
assert.match(
  clientSource,
  /setDraft\(draftFrom\(payload\.config\)\)/,
  'a save adopts the config the host returned',
)

// 7) The rainbow switch is a paint change: ticking it must reach the sheet now.
const rainbowBox = settingsNodes.find(
  (node) => node.type === 'input' && node.props && node.props.type === 'checkbox' && node.props.checked === false,
)
assert.ok(rainbowBox, 'the settings card offers the experimental rainbow checkbox')
rainbowBox.props.onChange({ target: { checked: true } })
assert.match(
  lookSheet().textContent,
  /::after\{[^}]*repeating-linear-gradient\(100deg,#ff5f6d/,
  'ticking it repaints the fill without waiting for a frame',
)

// 8) Picking a colour (including from the OS eyedropper) must reach the sheet.
const colourBox = settingsNodes.find(
  (node) => node.type === 'input' && node.props && node.props.type === 'color',
)
assert.ok(colourBox, 'the settings card offers a colour picker')
colourBox.props.onChange({ target: { value: '#12ab34' } })
assert.match(lookSheet().textContent, /#12AB34|#12ab34/i, 'a picked colour repaints the band')
// The picker can hand back rgb() (the eyedropper inside the dialog does), so the
// card has to normalise it instead of silently keeping the old colour.
colourBox.props.onChange({ target: { value: 'rgb(18, 171, 52)' } })
assert.match(lookSheet().textContent, /#12AB34/i, 'an rgb() result from the picker is normalised to hex')

// 9) The settings card is a door to the rail panel. The host faces differ
// between shells, so the opener has to try `layout.selectPanel`, then
// `panels.selectPanel`, then `layout.select` — and report the reason instead of
// swallowing the click.
for (const path_ of ['layout.selectPanel', 'panels.selectPanel', 'layout.select', "ctx.get('layout')" === '' ? '' : "face('layout')"]) {
  if (!path_) continue
  assert.ok(clientSource.includes(path_), `the opener still tries ${path_}`)
}
assert.ok(clientSource.includes('这个外壳没有提供切换面板的接口'), 'a shell without a layout face is named')
assert.ok(clientSource.includes('打不开：'), 'the card shows the failure instead of going quiet')
assert.ok(clientSource.includes('.dsp-loglink-inline'), 'and it falls back to a few rows right there')

// 10) Every column carries a drag handle, so the history column can be widened
// without touching the session columns next to it.
const panelNodes = render(registrations.find((entry) => entry.spec.name === 'main').component)
const gutters = panelNodes.filter((node) => node.props && node.props.className === 'dsp-gutter')
const columns = panelNodes.filter(
  (node) => node.props && typeof node.props.className === 'string' && /dsp-column/.test(node.props.className),
)
assert.ok(gutters.length >= columns.length, 'each column has a separator to its right')
assert.equal(
  gutters.filter((node) => node.props.title && node.props.title.includes('拖动')).length,
  gutters.length,
  'the separators say how they work',
)

console.log('render assertions passed')
// The store schedules its next poll, which would keep the runner alive forever.
process.exit(0)
