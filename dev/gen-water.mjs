// Compares the four flow qualities side by side with the real paint.
//   node dev/gen-water.mjs && open dev/water.html
import fs from 'node:fs'
import path from 'node:path'

const here = import.meta.dirname
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')
const cssStart = source.indexOf('const BASE_CSS = `') + 'const BASE_CSS = `'.length
const base = source.slice(cssStart, source.indexOf('`', cssStart))

const lookStart = source.indexOf('// #region look')
const lookEnd = source.indexOf('// #endregion look')
const lookBody = source.slice(lookStart, lookEnd)
  .replace(/\/\/ [^\n]*\n/g, '\n')

const factory = new Function(`${lookBody}; return { styleRules, sheetCss, MOTION_CSS, FLOW_QUALITIES, FLOW_SPEEDS }`)
const look = factory()
const waterStart = source.indexOf('const WATER_SVG = [')
const waterEnd = source.indexOf("].join('')", waterStart) + "].join('')".length
const water = new Function(`${source.slice(waterStart, waterEnd)}; return WATER_SVG`)()

// Labels come from the same table the settings dropdown uses, so a preview can
// never drift from what people actually see in the menu.
const cases = look.FLOW_QUALITIES.map((item) => [item.id, item.label])
cases.push(['rainbow', '实验 · 彩虹走马灯（叠在「低」档表面上）'])

// One extra row shows the experimental rainbow, since it is a paint switch
// rather than a surface tier and would otherwise have no preview at all.
const rows = cases
  .map(
    ([quality, label]) => `
  <div class="case">
    <div class="cap">${label}</div>
    <div class="row" data-row-key="session:${quality}" style="--dsp-p:78%;--dsp-o:0.7">
      <span class="title">${label}</span>
      <span class="time">3 分钟前</span>
    </div>
  </div>`,
  )
  .join('')

// Same four, magnified 2.6x, so the wobble can actually be judged on screen.
const zoomed = cases
  .map(
    ([quality, label]) => `
  <div class="case" style="zoom:2.6">
    <div class="cap">${label}</div>
    <div class="row" data-row-key="session:${quality}" style="--dsp-p:78%;--dsp-o:0.7">
      <span class="title">${label}</span>
      <span class="time">3 分钟前</span>
    </div>
  </div>`,
  )
  .join('')

const QUALITY_OF = (key) => (key === 'rainbow' ? 'low' : key)
const rules = cases
  .map(([key]) => look.styleRules({
    color: '#90AFFF',
    opacity: 0.7,
    style: 'band',
    flow: true,
    flowSpeed: 'normal',
    flowQuality: QUALITY_OF(key),
    rainbow: key === 'rainbow',
  }).replaceAll('[data-row-key^="session:"]', `[data-row-key="session:${key}"]`))
  .join('\n')


const html = `<!doctype html>
<meta charset="utf-8">
<title>flow quality</title>
<style>
  ${base}
  ${look.MOTION_CSS}
  body { margin: 0; padding: 20px; background: #17181c; color: #e6e8eb; font: 13px/1.5 system-ui, "Segoe UI", sans-serif; }
  .case { margin-bottom: 18px; display: inline-block; margin-right: 26px; vertical-align: top; }
  .cap { font-size: 12px; color: #9aa3b2; margin-bottom: 6px; }
  .row, .row::after, .row::before { animation-play-state: paused; }
  .row { width: 280px; }
  .row .title { position: relative; z-index: 1; font-size: 13px; }
  .row .time { position: relative; z-index: 1; margin-left: auto; font-size: 10px; color: #9aa3b2; }
  ${rules}
</style>
<svg aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${water}</svg>
${rows}
${zoomed}
<script>
window.__probe = () => [...document.querySelectorAll('.row')].map((r) => {
  const before = getComputedStyle(r, '::before');
  return {
    key: r.dataset.rowKey,
    filter: before.filter,
    backdrop: before.backdropFilter || before.webkitBackdropFilter,
    animation: before.animationName + ' ' + before.animationDuration,
    opacity: before.opacity,
  };
});
</script>`

fs.writeFileSync(path.join(here, 'water.html'), html)
console.log(`wrote dev/water.html ${html.length} bytes`)
