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
const { LOOK_STYLES, LOOK_IDS, styleRules, hexToRgb } = new Function(
  `${match[1]}; return { LOOK_STYLES, LOOK_IDS, styleRules, hexToRgb }`,
)()

// 1. Every style is complete and unique.
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
  assert.ok(!/\burl\(|expression|javascript:/i.test(css), 'no injection vectors in the stylesheet')
}

console.log('look assertions passed')
