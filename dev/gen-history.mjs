// Rebuilds dev/history-scroll.html from the real stylesheet, so the scroll
// behaviour we measure here is the behaviour the plugin ships.
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
const css = source.match(/const BASE_CSS = `([\s\S]*?)`\n/)[1]

const segment = (index, turn, outcome, rows) => `
  <section class="dsp-seg">
    <div class="dsp-seg-head">
      <span class="dsp-dot" style="background:hsl(${(index * 47) % 360} 70% 62%)"></span>
      <span class="dsp-seg-title">历史里的第 ${index} 条会话</span>
      <span class="dsp-seg-turn">#${turn}</span>
      <span class="dsp-seg-outcome ${outcome === 'interrupted' ? 'interrupted' : ''}">${outcome === 'interrupted' ? '中断' : '完成'}</span>
    </div>
    <div class="dsp-seg-body">
      ${Array.from({ length: rows }, (_, i) => `<div class="dsp-row"><span class="dsp-at">10:${String(i).padStart(2, '0')}</span><span class="dsp-p">${40 + i}%</span><span class="dsp-note">第 ${i + 1} 次采样，阶段名在这里</span></div>`).join('\n')}
    </div>
  </section>`

const html = `<!doctype html>
<meta charset="utf-8">
<title>history column scroll probe</title>
<style>
  body { margin: 0; background: #17181c; color: #e6e8eb; font: 13px/1.5 system-ui, sans-serif; }
  ${css}
  .dsp-panel { display: flex; flex-direction: column; height: 640px; width: 1200px; }
  .dsp-panel-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: hidden; }
</style>
<div class="dsp-panel">
  <div class="dsp-panel-body">
    <div class="dsp-columns" id="columns">
      <section class="dsp-column dsp-history" data-session-id="history">
        <div class="dsp-column-head"><span class="dsp-column-title">历史轮次</span><span class="dsp-column-stat">12 轮</span></div>
        <div class="dsp-column-body" id="historyBody">
          ${Array.from({ length: 12 }, (_, i) => segment(i + 1, i + 1, i % 3 === 0 ? 'interrupted' : 'completed', 3)).join('\n')}
        </div>
      </section>
      <section class="dsp-column" data-session-id="a">
        <div class="dsp-column-head"><span class="dsp-column-title">正在跑的会话 A</span><span class="dsp-column-stat">62%</span></div>
        <div class="dsp-column-body" id="bodyA">
          ${Array.from({ length: 20 }, (_, i) => `<div class="dsp-row"><span class="dsp-at">10:${String(i).padStart(2, '0')}</span><span class="dsp-p">${i * 3}%</span><span class="dsp-note">采样 ${i}</span></div>`).join('\n')}
        </div>
      </section>
    </div>
  </div>
</div>
<script>
  window.__probe = () => {
    const read = (id) => {
      const node = document.getElementById(id)
      const column = node.closest('.dsp-column')
      return {
        id,
        columnHeight: Math.round(column.getBoundingClientRect().height),
        columnMaxHeight: getComputedStyle(column).maxHeight,
        columnOverflow: getComputedStyle(column).overflow,
        bodyClient: node.clientHeight,
        bodyScroll: node.scrollHeight,
        scrollable: node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY !== 'visible',
        overflowY: getComputedStyle(node).overflowY,
      }
    }
    return { history: read('historyBody'), active: read('bodyA') }
  }
</script>
`
fs.writeFileSync(path.join(import.meta.dirname, 'history-scroll.html'), html)
console.log('wrote dev/history-scroll.html', html.length, 'bytes')
