// Renders the log panel with a real snapshot so the layout can be looked at
// without opening DSH (the panel needs a live host otherwise).
//   node dev/gen-panel.mjs && open dev/panel.html
import fs from 'node:fs'
import path from 'node:path'

const here = import.meta.dirname
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')
const start = source.indexOf('const BASE_CSS = `')
const cssStart = source.indexOf('`', start) + 1
const cssEnd = source.indexOf('`;', cssStart)
const base = source.slice(cssStart, cssEnd)

const data = JSON.parse(fs.readFileSync(path.join(here, 'panel-data.json'), 'utf8'))
const esc = (value) =>
  String(value == null ? '' : value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
const clock = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false })
  } catch {
    return String(iso)
  }
}

const groups = new Map()
for (const entry of data.entries.concat(data.history)) {
  const key = `${entry.sessionId}`
  if (!groups.has(key)) groups.set(key, { id: key, title: entry.sessionTitle || '', entries: [] })
  groups.get(key).entries.push(entry)
}
const columns = [...groups.values()].slice(0, 2)

function row(entry, open) {
  const before = Number(entry.prev)
  const now = Number(entry.p)
  const has = Number.isFinite(before) && Number.isFinite(now) && now !== before
  const delta = has ? now - before : 0
  const ms = Math.round((Number(entry.ms) || 0) / 100) / 10
  return `<div class="dsp-row"><button type="button" class="dsp-row-line" aria-expanded="${open}">
    <span class="dsp-row-time">${esc(clock(entry.at))}</span>
    <span class="dsp-row-p">${entry.p == null ? '—' : entry.p + '%'}</span>
    <span class="dsp-row-delta ${delta > 0 ? 'up' : 'down'}">${has ? (delta > 0 ? '+' + delta : delta) : ''}</span>
    <span class="dsp-row-note">${esc(entry.note || '（没写阶段名）')}</span>
    ${entry.revised ? '<span class="dsp-revised">重估</span>' : ''}
    <span class="dsp-row-ms">${ms}s</span>
  </button>${
    open
      ? `<div class="dsp-row-detail">
    <div class="dsp-detail-meta">
      <span>${esc(entry.model)}</span><span>强度 ${esc(entry.effort)}</span>
      <span>${entry.tokens ? entry.tokens.input + ' in / ' + entry.tokens.output + ' out / ' + entry.tokens.cacheRead + ' cache' : ''}</span>
    </div>
    <pre class="dsp-raw">${esc(entry.raw || '（空输出）')}</pre></div>`
      : ''
  }</div>`
}

const column = (group, index) => {
  const latest = group.entries[0] || {}
  return `<section class="dsp-column">
    <div class="dsp-column-head">
      <span class="dsp-dot" style="background:hsl(${(index * 67 + 20) % 360} 72% 62%)"></span>
      <span class="dsp-column-title">${esc(group.title || group.id)}</span>
      <span class="dsp-column-stat">${latest.p == null ? '—' : latest.p + '%'} · ${group.entries.length} 次 · ${esc(clock(latest.at))}</span>
    </div>
    <div class="dsp-column-body">${group.entries.slice(0, 9).map((entry, i) => row(entry, index === 0 && i === 1)).join('')}</div>
  </section>`
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>log panel</title>
<style>
  ${base}
  body { margin: 0; padding: 18px; background: #17181c; color: #e6e8eb; font: 13px/1.5 system-ui, "Segoe UI", sans-serif; }
  .dsp-panel { height: 620px; width: 1180px; border: 1px solid rgba(128,128,128,.22); border-radius: 12px; padding: 14px; box-sizing: border-box; }
</style>
<div class="dsp-panel">
  <div class="dsp-panel-head">
    <div class="dsp-panel-title">进度日志</div>
    <div class="dsp-panel-sub">
      <span class="dsp-sub-group">deepseek-account/deepseek-flash · 强度 off · 每 30 秒</span>
      <span class="dsp-sub-group">本轮 2 次 · 历史 583（中断 2）</span>
      <span class="dsp-sub-group dsp-tokens">1.1M tok</span>
    </div>
  </div>
  <div class="dsp-panel-body">
    <div class="dsp-columns">
      ${columns.map(column).join('')}
    </div>
  </div>
</div>
<script>
window.__probe = () => ({
  rows: document.querySelectorAll('.dsp-row').length,
  rowHeights: [...document.querySelectorAll('.dsp-row')].slice(0, 4).map((n) => Math.round(n.getBoundingClientRect().height)),
  noteLines: [...document.querySelectorAll('.dsp-row-note')].slice(0, 4).map((n) => n.scrollWidth > n.clientWidth + 1),
  detail: document.querySelectorAll('.dsp-row-detail').length,
});
<\/script>`

fs.writeFileSync(path.join(here, 'panel.html'), html)
console.log(`wrote dev/panel.html ${html.length} bytes, ${data.entries.length} active / ${data.history.length} history`)
