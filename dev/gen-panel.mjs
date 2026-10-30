// Renders the log panel with a real snapshot so the layout can be looked at
// without opening DSH (the panel needs a live host otherwise).
//   node dev/gen-panel.mjs && open dev/panel.html
import fs from 'node:fs'
import path from 'node:path'

const here = import.meta.dirname
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')
const cssStart = source.indexOf('const BASE_CSS = `') + 'const BASE_CSS = `'.length
const base = source.slice(cssStart, source.indexOf('`', cssStart))

const data = JSON.parse(fs.readFileSync(path.join(here, 'panel-data.json'), 'utf8'))
// The fixture has no warning in it; stamp one so the preview shows the badge
// the host would produce after four flat samples.
const withWarning = (payload) => {
  const live = (payload && payload.entries) || []
  if (live.length > 1) {
    live[1].stall = { level: 'warn', count: 4, since: Date.now(), note: live[1].note || '', failure: true }
  }
  return payload
}
withWarning(data)
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

// One row carries a loop warning so the preview shows the badge too.
function rowLabel(entry) {
  if (!entry.stall) return ''
  return entry.stall.level === 'stuck' ? '卡住' : '停滞'
}

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
    ${entry.stall ? `<span class="dsp-stall ${entry.stall.level === 'stuck' ? 'stuck' : 'warn'}">${rowLabel(entry)}</span>` : ''}
    <span class="dsp-row-ms">${ms}s</span>
    <span class="dsp-row-caret${open ? ' open' : ''}">›</span>
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

function spark(entries, hue) {
  const points = entries
    .slice(0, 24)
    .map((entry) => (Number.isFinite(Number(entry.p)) ? Number(entry.p) : null))
    .reverse()
    .filter((value) => value !== null)
  if (points.length < 2) return ''
  const w = 60
  const hgt = 18
  const step = w / (points.length - 1)
  const path = points
    .map((v, i) => `${(i * step).toFixed(1)},${(hgt - 2 - (v / 100) * (hgt - 4)).toFixed(1)}`)
    .join(' ')
  return `<svg class="dsp-spark" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><polyline points="${path}" fill="none" stroke="hsl(${hue} 72% 62%)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`
}

const hueOf = (text) => {
  let hash = 7
  for (let i = 0; i < String(text).length; i += 1) hash = (hash * 31 + String(text).charCodeAt(i)) % 360
  return hash
}

const column = (group, index) => {
  const latest = group.entries[0] || {}
  const hue = hueOf(group.id)
  return `<section class="dsp-column" style="--dsp-tint: hsla(${hue}, 58%, 56%, 0.15)">
    <div class="dsp-column-head">
      <div class="dsp-column-head-top">
        <span class="dsp-dot" style="background:hsl(${hue} 72% 62%)"></span>
        <span class="dsp-column-title">${esc(group.title || group.id)}</span>
        ${group.entries.slice(0, 3).some((item) => item && item.stall)
          ? `<span class="dsp-stall dsp-stall-chip ${
              group.entries.slice(0, 3).some((item) => item && item.stall && item.stall.level === 'stuck')
                ? 'stuck'
                : 'warn'
            }">${
              group.entries.slice(0, 3).some((item) => item && item.stall && item.stall.level === 'stuck')
                ? '卡住'
                : '停滞'
            }</span>`
          : ''}
      </div>
      <div class="dsp-column-head-sub">
        <span class="dsp-column-stat">${latest.p == null ? '—' : latest.p + '%'} · ${group.entries.length} 次</span>
        <span class="dsp-column-time">${esc(clock(latest.at))}</span>
        ${spark(group.entries, hue)}
      </div>
    </div>
    <div class="dsp-column-body">${group.entries.slice(0, 9).map((entry, i) => row(entry, index === 0 && i === 1)).join('')}<button class="dsp-btn dsp-btn-xs dsp-history-more" type="button">再看 40 轮</button></div>
  </section>`
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>log panel</title>
<style>
  ${base}
  body { margin: 0; padding: 18px; background: #17181c; color: #e6e8eb; font: 13px/1.5 system-ui, "Segoe UI", sans-serif; }
  .dsp-panel { height: 560px; width: 1180px; border: 1px solid rgba(128,128,128,.22); border-radius: 12px; padding: 14px; box-sizing: border-box; }
  .cap { margin: 10px 0 6px; font: 600 12px/1.4 ui-monospace, monospace; color: #8b93a1; }
  .dsp-skin-apple { padding: 0; }
</style>
<h2 class="cap">新 · 分组卡片（apple）</h2>
<div class="dsp-panel dsp-skin-apple" data-skin="apple">
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

<h2 class="cap">旧 · 紧凑列表（classic）</h2>
<div class="dsp-panel dsp-skin-classic" data-skin="classic">
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
  skins: [...document.querySelectorAll('[data-skin]')].map((n) => [n.dataset.skin, getComputedStyle(n).backgroundColor, n.querySelector('.dsp-column') ? getComputedStyle(n.querySelector('.dsp-column')).borderRadius : null]),
  rows: document.querySelectorAll('.dsp-row').length,
  rowHeights: [...document.querySelectorAll('.dsp-row')].slice(0, 4).map((n) => Math.round(n.getBoundingClientRect().height)),
  noteLines: [...document.querySelectorAll('.dsp-row-note')].slice(0, 4).map((n) => n.scrollWidth > n.clientWidth + 1),
  detail: document.querySelectorAll('.dsp-row-detail').length,
});
<\/script>`

fs.writeFileSync(path.join(here, 'panel.html'), html)
console.log(`wrote dev/panel.html ${html.length} bytes, ${data.entries.length} active / ${data.history.length} history`)
