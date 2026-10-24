// Builds dev/styles.html from the REAL client source: the `#region look` block
// and BASE_CSS are extracted as-is, so the gallery cannot drift from what ships.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')

const region = /\/\/ #region look([\s\S]*?)\/\/ #endregion look/.exec(source)
if (!region) throw new Error('#region look not found')
const { LOOK_STYLES, styleRules } = new Function(
  `${region[1]}; return { LOOK_STYLES, styleRules }`,
)()

const base = /const BASE_CSS = `([\s\S]*?)`\n/.exec(source)
if (!base) throw new Error('BASE_CSS not found')

const COLORS = ['#90AFFF', '#FF8800', '#5AD6A0']
const STEPS = [35, 62, 92]

const scoped = (style, color, scope) =>
  styleRules({ style, color }).replace(/\[data-row-key\^="session:"\]/g, `${scope} [data-row-key^="session:"]`)

const row = (percent, opacity, title) =>
  `<div class="row" data-row-key="session:demo" style="--dsp-p:${percent}%;--dsp-o:${opacity}">
     <span class="slot"></span><span class="title">${title}</span><span class="time">3 分钟前</span>
   </div>`

const section = (style) => {
  const variants = COLORS.map(
    (color, index) =>
      `<div data-color="${index}">${row(62, 0.6, `颜色 <code>${color}</code>`)}</div>`,
  ).join('')
  return `<section class="style-block" data-preview-style="${style.id}">
    <h2>${style.label} <code>${style.id}</code></h2>
    <p class="hint">${style.hint}</p>
    <div class="steps">${STEPS.map((p) => row(p, 0.6, `进度 ${p}%`)).join('')}</div>
    <div class="alphas">${STEPS.map((p) => row(62, p / 100, `不透明度 ${p}%`)).join('')}</div>
    <div class="colors">${variants}</div>
  </section>`
}

const css = [
  base[1],
  '.row{display:flex;align-items:center;gap:6px;height:32px;padding:0 8px;margin:4px 0;',
  'border-radius:8px;color:#e6e8eb;font:14px/20px system-ui,sans-serif}',
  '.row .slot{width:16px;height:20px;flex:none}',
  '.row .title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.row .time{flex:none;font-size:10px;line-height:16px;color:#8a8f98}',
  'body{margin:0;padding:24px 28px;background:#17181c;color:#e6e8eb;font:13px/1.6 system-ui,sans-serif}',
  'h1{font-size:16px;margin:0 0 4px}',
  'h2{font-size:13px;margin:0;color:#cfd3d8}',
  'h2 code,.row code{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#8a8f98}',
  '.hint{margin:2px 0 8px;color:#8a8f98;font-size:12px}',
  '.style-block{padding:14px 0 18px;border-bottom:1px solid rgba(128,128,128,.18)}',
  '.steps,.alphas,.colors{display:flex;flex-direction:column;gap:2px}',
  '.legend{color:#8a8f98;font-size:12px;margin:0 0 16px}',
  LOOK_STYLES.map((style) =>
    scoped(style.id, '#90AFFF', `[data-preview-style="${style.id}"]`),
  ).join('\n'),
  // colour variants: the wrapper carries the colour index, so the row inside it
  // must be matched as a descendant, not as a compound selector.
  COLORS.map((color, index) =>
    LOOK_STYLES.map((style) =>
      scoped(style.id, color, `[data-preview-style="${style.id}"] [data-color="${index}"]`),
    ).join('\n'),
  ).join('\n'),
].join('\n')

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>进度条样式一览</title><style>${css}</style></head>
<body>
<h1>进度条样式一览</h1>
<p class="legend">这 6 种都能在「设置 → 插件 → 会话进度条」里直接选，颜色和不透明度也在那里调。
下面每一段用同样的三种进度（35 / 62 / 92）、三种不透明度、三种颜色各示范一次。</p>
${LOOK_STYLES.map(section).join('\n')}
<script>
window.__probe = () => [...document.querySelectorAll('.style-block')].map((block) => {
  const id = block.dataset.previewStyle
  const row = block.querySelector('.steps .row')
  const after = getComputedStyle(row, '::after')
  return {
    id,
    width: after.width,
    background: after.backgroundImage !== 'none' ? after.backgroundImage : after.backgroundColor,
    borderRadius: after.borderTopLeftRadius + ' / ' + after.borderTopRightRadius,
    clipPath: after.clipPath,
    height: after.height,
  }
})
<\/script>
</body></html>`

const out = path.join(here, 'styles.html')
fs.writeFileSync(out, html)
console.log('wrote', out, html.length, 'bytes')
