// Dev probe for the flowing highlight: real BASE_CSS against real row markup.
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
const css = source.match(/const BASE_CSS = `([\s\S]*?)`\n/)[1]

const row = (id, p, note) => `
  <div class="row" role="treeitem" data-row-key="session:${id}" style="--dsp-p:${p}%;--dsp-o:0.6">
    <span class="slot"></span>
    <span class="title">${note}</span>
    <span class="time">3 分钟前</span>
  </div>`

const html = `<!doctype html>
<meta charset="utf-8">
<title>flow probe</title>
<style>
  body { margin: 0; padding: 24px; background: #17181c; color: #e6e8eb; font: 14px system-ui, sans-serif; }
  ${css}
  .row { display: flex; align-items: center; height: 32px; padding: 0 8px; gap: 0;
         border-radius: 8px; color: #e6e8eb; margin-bottom: 8px; width: 320px; }
  .slot { width: 16px; height: 20px; flex: none; }
  .title { flex: 1; margin: 0 6px 0 4px; font-size: 14px; }
  .time { font-size: 10px; color: #888; flex: none; }
</style>
${row('flow-a', 62, '流动的高光')}
${row('flow-b', 18, '很短的填充')}
${row('flow-c', 100, '满格')}
<script>
  window.__probe = () => [...document.querySelectorAll('.row')].map((node) => {
    const before = getComputedStyle(node, '::before')
    const after = getComputedStyle(node, '::after')
    return {
      key: node.dataset.rowKey,
      height: Math.round(node.getBoundingClientRect().height),
      sheenAnimation: before.animationName,
      sheenDuration: before.animationDuration,
      sheenIterations: before.animationIterationCount,
      sheenClip: before.clipPath,
      sheenZ: before.zIndex,
      sheenBg: before.backgroundImage.slice(0, 46),
      fillZ: after.zIndex,
      fillWidth: after.width,
    }
  })
</script>
`
fs.writeFileSync(path.join(import.meta.dirname, 'flow.html'), html)
console.log('wrote dev/flow.html', html.length, 'bytes')
