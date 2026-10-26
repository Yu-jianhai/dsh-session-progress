// The band's look is data: six styles, one function that turns a look into a
// stylesheet rule. This test runs the SAME source the browser runs, extracted
// between the `#region look` markers, so a broken style cannot ship.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')

const match = /\/\/ #region look([\s\S]*?)\/\/ #endregion look/.exec(source)
assert.ok(match, 'the #region look markers are missing from lib/client.js')
const { LOOK_STYLES, LOOK_IDS, styleRules, sheetCss, hexToRgb, flowDecls } = new Function(
  `${match[1]}; return { LOOK_STYLES, LOOK_IDS, styleRules, sheetCss, hexToRgb, flowDecls }`,
)()

// 1. Every style is complete and unique.
// The sweep's cycle length is a promise to the user ("慢 10.5 秒一圈").
assert.match(flowDecls({ flowSpeed: 'slow' }), /--dsp-flow-duration:10\.5s/, 'slow cycle')
assert.match(flowDecls({ flowSpeed: 'fast' }), /--dsp-flow-duration:3s/, 'fast cycle')
assert.match(flowDecls({}), /--dsp-flow-duration:10\.5s/, 'default cycle is slow')

// The highlight must be clipped to the fill's rounded end, not to a square.
const flowRules = styleRules({ color: '#90AFFF', style: 'underline' })
assert.match(flowRules, /height:3px;border-radius:2px/, 'the underline keeps its own height and radius')

assert.equal(LOOK_STYLES.length, 6, 'six styles are offered')
assert.equal(new Set(LOOK_IDS).size, LOOK_STYLES.length, 'style ids are unique')
for (const style of LOOK_STYLES) {
  assert.ok(style.label && style.hint, `${style.id} needs a label and a hint`)
  const css = styleRules({ color: '#90AFFF', style: style.id })
  assert.ok(css.startsWith('[data-row-key^="session:"]::after{'), 'rules target the row pseudo-element')
  assert.ok(css.includes('#90AFFF'), `${style.id} must paint with the chosen colour`)
  assert.ok(/background/.test(css), `${style.id} must set a background`)
  assert.ok(css.endsWith('}'))
}

// 2. Distinct shapes: the styles must not be near-duplicates.
assert.ok(styleRules({ style: 'band' }).includes('linear-gradient'))
assert.ok(styleRules({ style: 'solid' }).includes('#90AFFF;}'.replace('}', '')))
assert.ok(styleRules({ style: 'underline' }).includes('height:3px'))
assert.ok(styleRules({ style: 'stripe' }).includes('repeating-linear-gradient(45deg'))
assert.ok(styleRules({ style: 'glow' }).includes('box-shadow'))
assert.ok(styleRules({ style: 'segments' }).includes('clip-path'))
// 3b. Surfaces. Each quality is a row in one table, and the two layers have
// to agree: the fill carries the glass when the surface sits *under* the text,
// the surface carries it when it sits *over* the text (the experimental film).
const refract = styleRules({ flowQuality: 'refract' })
const high = styleRules({ flowQuality: 'high' })
const low = styleRules({ flowQuality: 'low' })

// The experimental tier circulates a conic light instead of dragging a streak
// across, and it stays *under* the text: its whole point is motion, so it must
// not smear the title the way the old film did.
assert.match(
  refract,
  /::before\{[^}]*background-image:repeating-linear-gradient[^;]*,repeating-linear-gradient/,
  'the experimental tier paints two bands so they can move against each other',
)
assert.match(
  refract,
  /::before\{[^}]*animation:dsp-cross/,
  'and it is driven by the cross keyframes, not the sweep ones',
)
assert.equal(
  /::before\{[^}]*z-index:1/.test(refract),
  false,
  'the light stays under the text so the title never gets smeared',
)
assert.equal(
  /::before\{[^}]*filter:url\(#/.test(refract),
  false,
  'the experimental tier does not need an SVG filter at all',
)
assert.equal(
  /::after\{[^}]*backdrop-filter/.test(refract),
  false,
  'nothing on this tier distorts what is under the band',
)
assert.match(
  refract,
  /::after\{[^}]*box-shadow:inset 1px -1px 1px/,
  'the fill carries the embossed glass edge',
)

// 3c. Nothing may paint outside the band. A CSS filter is allowed to draw past
// the border box, and border-radius does not clip it -- so the surface layer
// carries a constant clip-path shaped like the fill. It does not animate, which
// is what keeps it from reintroducing the width/clip desync of 0.11.0.
const baseCss = readBaseCss()
assert.match(
  baseCss,
  /\[data-row-key\^="session:"\]::before \{[^}]*clip-path: inset\(0 round var\(--dsw-radius-md, 8px\)\)/,
  'the surface layer is clipped to the rounded band shape',
)
assert.match(
  styleRules({ style: 'underline' }),
  /::before\{[^}]*clip-path:inset\(0 round 2px\)/,
  'the 3px underline clips to its own shorter shape',
)
// The keyframes are generated from the same period constant as the gradients,
// so they cannot drift apart: one period along the 100deg axis is 268.073px
// across the row, and both directions use that one number.
const crossSheet = sheetCss({ flowQuality: 'refract' })
assert.match(
  crossSheet,
  /@keyframes dsp-cross\{from\{background-position:0 0,0 0\}to\{background-position:268\.073px 0,-268\.073px 0\}\}/,
  'the two bands travel one whole period in opposite directions',
)
assert.match(
  sheetCss({ flowQuality: 'low' }),
  /@keyframes dsp-drift\{from\{background-position:0 0,0 0\}to\{background-position:268\.073px 0,268\.073px 0\}\}/,
  'the plain sweep moves both layers forward by the same period',
)
// Two motions, two endpoints each: the distance is written once per keyframe
// pair and nowhere else -- the gradients use the 264px period, not the travel.
assert.equal(
  (crossSheet.match(/268\.073px/g) || []).length,
  4,
  'the travel distance lives in the two generated keyframe pairs only',
)

assert.match(high, /::after\{[^}]*backdrop-filter:blur/, 'high softens the backdrop from the fill')
assert.match(high, /::before\{[^}]*filter:url\(#dsp-water\)/, 'high wobbles the surface itself too')
assert.equal(/::before\{[^}]*z-index:1/.test(high), false, 'high stays under the text')

assert.equal(low.includes('filter:url('), false, 'low stays flat')
assert.equal(low.includes('backdrop-filter'), false, 'low has no glass at all')
assert.match(low, /::before\{[^}]*background-image:repeating-linear-gradient/, 'low still moves')

assert.ok(
  styleRules({ style: 'segments' }).includes('width:100%'),
  'segments must clip a full-width layer, otherwise the 20% grid would shrink with the fill',
)

// 3. Colour handling.
assert.equal(hexToRgb('#FF8800'), '255,136,0')
assert.equal(hexToRgb('nope'), '144,175,255', 'a broken colour falls back to the default blue')
assert.ok(styleRules({ color: '#FF8800', style: 'band' }).includes('rgba(255,136,0,0.35)'))
assert.ok(
  styleRules({ color: '#ff8800', style: 'band' }).includes('#ff8800'),
  'the exact value the picker produced is used',
)

// 4. Nothing invalid can reach the stylesheet.
for (const bad of [null, undefined, {}, { color: 'red' }, { color: '#12345' }, { style: 'nope' }, { color: 123 }]) {
  const css = styleRules(bad)
  assert.ok(css.includes('#90AFFF'), `bad look ${JSON.stringify(bad)} must fall back to the default`)
  assert.ok(css.includes('linear-gradient'), 'a bad style falls back to `band`')
  // `url(#dsp-water)` is a same-document SVG filter reference and is fine;
  // an external or script url is not.
  assert.ok(!/\burl\((?!\s*['\"]?#)/i.test(css), 'no external url() in the stylesheet')
  assert.ok(!/expression|javascript:/i.test(css), 'no script vectors in the stylesheet')
}

// ---- preview vs saved: the host must not stomp an unsaved draft ----------
// The host re-broadcasts its saved look on every frame (every ~2s), so a
// preview that is not protected snaps back to the saved style. `routeLook`
// is that protection, extracted from the real source.
function sliceFn(name) {
  const marker = `function ${name}(`
  const at = source.indexOf(marker)
  if (at < 0) throw new Error(`lib/client.js no longer defines ${name}()`)
  const next = source.indexOf('\n    function ', at + marker.length)
  return source.slice(at, next < 0 ? source.length : next)
}
const { routeLook } = new Function(`${sliceFn('routeLook')}; return { routeLook }`)()

const band = { color: '#90AFFF', opacity: 0.6, style: 'band' }
const glow = { color: '#FF8800', opacity: 0.35, style: 'glow' }
let state = { painted: null, serverLook: null, previewing: false }
const step = (incoming, kind) => {
  const routed = routeLook(state, incoming, kind)
  state = { painted: routed.paint ? incoming : state.painted, serverLook: routed.serverLook, previewing: routed.previewing }
  return routed
}

// 1. The first saved look is painted.
let routed = step(band, 'server')
assert.equal(routed.paint, true, 'the saved look is painted on the first frame')
assert.equal(state.previewing, false)

// 2. A draft repaints immediately.
routed = step(glow, 'preview')
assert.equal(routed.paint, true, 'a preview must be visible at once')
assert.equal(state.previewing, true, 'a draft that differs from the saved look is a preview')

// 3. THE BUG: the host's next frame carries the old saved look. It must not win.
routed = step(band, 'server')
assert.equal(routed.paint, false, 'a saved look must not overwrite an unsaved preview')
assert.equal(state.previewing, true, 'the preview is still live after the frame')
assert.deepEqual(state.serverLook, band, 'the frame is still remembered as the saved look')
assert.deepEqual(state.painted, glow, 'the draft stays painted')

// 4. Previewing the saved look itself ends the preview.
routed = step(band, 'preview')
assert.equal(state.previewing, false, 'an unchanged draft is not a preview')
assert.equal(routed.paint, true)

// 5. Someone saves the same style from another window: the preview is over.
state = { painted: glow, serverLook: band, previewing: true }
routed = step(glow, 'server')
assert.equal(routed.paint, true, 'a saved look equal to the draft takes over')
assert.equal(state.previewing, false)

// 6. After a commit the frames win again.
state = { painted: glow, serverLook: glow, previewing: false }
routed = step(band, 'server')
assert.equal(routed.paint, true, 'a committed look follows the host again')

// 7. Opacity arrives as a string from JSON in some paths.
assert.equal(
  routeLook({ painted: band, serverLook: band, previewing: false }, { ...band, opacity: '0.6' }, 'server').paint,
  true,
)

// ---- 实验 · 彩虹走马灯：只换填充的漆，不改形状 ----------------------------
const rainbow = styleRules({ color: '#90AFFF', style: 'band', flowQuality: 'low', rainbow: true, flow: true, flowSpeed: 'normal' })
const plain = styleRules({ color: '#90AFFF', style: 'band', flowQuality: 'low', flow: true })
assert.match(rainbow, /::after\{[^}]*repeating-linear-gradient\(100deg,#ff5f6d/, 'the fill becomes a rainbow')
assert.match(rainbow, /::after\{[^}]*animation:dsp-rainbow 4\.4s linear infinite/, 'and it walks at the chosen speed')
assert.match(rainbow, /::after\{[^}]*width:var\(--dsp-p,0%\)/, 'the shape is still driven by progress')
assert.match(rainbow, /::after\{[^}]*box-shadow:inset 0 0 0 100px rgba\(0,0,0,0\.12\)/, 'a scrim keeps the text readable over the bright stops')
assert.doesNotMatch(plain, /ff5f6d/, 'off by default')
// Continuous hues, not six hard bands: even stops let the browser interpolate.
assert.match(rainbow, /#ffa14f 24\.0px/, 'the hues are evenly spaced so they can blend')
assert.doesNotMatch(rainbow, /#ff5f6d 0 24px/, 'no hard-edged band stops any more')
// The bloom rides on the surface layer, screened so it reads as light.
assert.match(rainbow, /::before\{[^}]*background-image:repeating-linear-gradient\(100deg,#ff5f6d/, 'the surface glows with the same hues')
assert.match(rainbow, /::before\{[^}]*mix-blend-mode:screen/, 'the bloom adds light instead of milking the band')
assert.match(rainbow, /::before\{[^}]*filter:blur\(6px\)/, 'the bloom is a blurred copy')

const still = styleRules({ color: '#90AFFF', style: 'band', flowQuality: 'low', rainbow: true, flow: false })
assert.doesNotMatch(still, /animation:dsp-rainbow/, 'turning motion off leaves a still rainbow')
assert.match(sheetCss({ color: '#90AFFF', style: 'band', flowQuality: 'low', rainbow: true }), /@keyframes dsp-rainbow\{from\{background-position:0 0\}to\{background-position:170\.592px 0\}\}/, 'the marquee keyframes are generated with the travel')

// A saved rainbow is a different paint, so the next server frame must repaint.
const baseLook = { color: '#90AFFF', opacity: 0.7, style: 'band', flow: true, flowSpeed: 'slow', flowQuality: 'low', rainbow: false }
const painted = { painted: baseLook, serverLook: baseLook, previewing: false }
const rainbowFrame = routeLook(painted, { ...baseLook, rainbow: true }, 'server')
assert.equal(rainbowFrame.paint, true, 'a frame that only flips the rainbow still repaints')

console.log('look assertions passed')

// The base sheet lives outside the look region, so it is read straight from the
// module source instead of being evaluated.
function readBaseCss() {
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('const BASE_CSS = ') + 'const BASE_CSS = '.length
  assert.ok(start > 0, 'BASE_CSS is findable in the module source')
  const open = source.indexOf(String.fromCharCode(96), start)
  const close = source.indexOf(String.fromCharCode(96), open + 1)
  return source.slice(open, close)
}
