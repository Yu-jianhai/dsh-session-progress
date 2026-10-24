window.__ModuleLoader__.load({
  id: 'dsh-session-progress',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const EVENTS_PATH = '/plugins/dsh-session-progress/events'
    const LOG_PATH = '/plugins/dsh-session-progress/log'
    const CONFIG_PATH = '/plugins/dsh-session-progress/config'
    const STYLE_ATTR = 'data-plugin-css'
    /** Also the key of our `main` panel and the id of our sidebar rail entry. */
    const PANEL_ID = 'dsh-session-progress'
    const PANEL_LABEL = '进度日志'

    /** Plain object the host half fills in with live actions (see `apply`). */
    const api = {
      /** Repaint the band straight from a settings draft, before saving. */
      preview: () => {},
      /**
       * Adopt a look as the committed truth: after a successful save, on
       * reset, and when leaving the settings page with an abandoned draft.
       */
      commit: () => {},
    }

    // #region look
    // The band's paint is swappable: one stylesheet, rewritten whenever the
    // colour / opacity / style settings change. Shape rules stay in BASE_CSS,
    // so every style inherits the same transition and stacking behaviour.
    const LOOK_STYLES = [
      {
        id: 'band',
        label: '渐变横幅',
        hint: '整行填充，右端 10px 渐隐（默认）',
        css: (color, soft) =>
          `inset-block:0;inset-inline-start:0;width:var(--dsp-p,0%);border-radius:inherit;` +
          `background:linear-gradient(90deg,${color} 0%,${color} calc(100% - 10px),${soft} 100%);`,
      },
      {
        id: 'solid',
        label: '纯色实条',
        hint: '整行纯色，右端一条 1px 亮边',
        css: (color) =>
          `inset-block:0;inset-inline-start:0;width:var(--dsp-p,0%);border-radius:inherit;` +
          `background:${color};box-shadow:inset -1px 0 0 rgba(255,255,255,0.55);`,
      },
      {
        id: 'underline',
        label: '底部细线',
        hint: '3px 细线贴底，完全不遮文字',
        css: (color) =>
          `inset-block:auto 3px;inset-inline-start:0;width:var(--dsp-p,0%);border-radius:2px;` +
          `height:3px;background:${color};`,
      },
      {
        id: 'stripe',
        label: '斜纹',
        hint: '45° 斜纹填充，像施工条',
        css: (color) =>
          `inset-block:0;inset-inline-start:0;width:var(--dsp-p,0%);border-radius:inherit;` +
          `background-color:${color};` +
          `background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.28) 0 5px,rgba(255,255,255,0) 5px 10px);`,
      },
      {
        id: 'glow',
        label: '流光',
        hint: '右端一道亮边 + 内侧柔光',
        css: (color, soft) =>
          `inset-block:0;inset-inline-start:0;width:var(--dsp-p,0%);border-radius:inherit;` +
          `background:linear-gradient(90deg,${soft} 0%,${color} 62%,${color} 100%);` +
          `box-shadow:inset -2px 0 0 rgba(255,255,255,0.85), inset -18px 0 14px -12px rgba(255,255,255,0.95);`,
      },
      {
        id: 'segments',
        label: '分段',
        hint: '5 段等宽格子，一格一格往前走',
        css: (color) =>
          `inset-block:0;inset-inline-start:0;width:100%;` +
          `clip-path:inset(0 calc(100% - var(--dsp-p,0%)) 0 0);` +
          `background:repeating-linear-gradient(90deg,${color} 0 calc(20% - 3px),rgba(0,0,0,0) calc(20% - 3px) 20%);`,
      },
    ]

    const LOOK_IDS = LOOK_STYLES.map((style) => style.id)

    function hexToRgb(color) {
      const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(color || ''))
      if (!match) return '144,175,255'
      return [match[1], match[2], match[3]].map((part) => parseInt(part, 16)).join(',')
    }

    /** Declarations for the selected style, with the selected colour baked in. */
    function styleRules(look) {
      const source = look && typeof look === 'object' ? look : {}
      const color = /^#[0-9a-f]{6}$/i.test(String(source.color || '')) ? source.color : '#90AFFF'
      const style = LOOK_IDS.includes(source.style) ? source.style : 'band'
      const pick = LOOK_STYLES.find((item) => item.id === style) || LOOK_STYLES[0]
      const soft = `rgba(${hexToRgb(color)},0.35)`
      return `[data-row-key^="session:"]::after{${pick.css(color, soft)}}`
    }
    // #endregion look

    // Geometry note: every session row is rendered with
    //   <div data-row-key="session:<id>" class="…_sessionRow …">
    // and that row has neither `position` nor `overflow`, so we only have to
    // give it a positioning context. `isolation: isolate` + `z-index: -1`
    // paints the band above the row's own background but below its text,
    // which keeps the title readable without touching any child element.
    const BASE_CSS = `
@property --dsp-p {
  syntax: "<percentage>";
  /* must inherit: the value is set on the row, the band is drawn by ::after */
  inherits: true;
  initial-value: 0%;
}
[data-row-key^="session:"] {
  position: relative;
  isolation: isolate;
}
[data-row-key^="session:"]::after {
  content: "";
  position: absolute;
  z-index: -1;
  pointer-events: none;
  inset-block: 0;
  inset-inline-start: 0;
  /* The paint (background, radius, thickness, clip) comes from the look
     stylesheet below, which the settings can swap at runtime. */
  width: var(--dsp-p, 0%);
  opacity: var(--dsp-o, 0);
  transition:
    --dsp-p 900ms cubic-bezier(0.22, 0.61, 0.36, 1),
    opacity 280ms ease;
}
@media (prefers-reduced-motion: reduce) {
  [data-row-key^="session:"]::after {
    transition: none;
  }
}
.dsp-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsp-error {
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255, 107, 107, 0.12);
  color: #ff8080;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.dsp-empty {
  padding: 14px 10px;
  border: 1px dashed rgba(128, 128, 128, 0.35);
  border-radius: 8px;
  color: var(--dsw-alias-label-tertiary, #888);
}
.dsp-item {
  border: 1px solid rgba(128, 128, 128, 0.22);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* One column per session, left to right: the head names the session, the body
   scrolls its own samples, so several running sessions stay comparable. */
.dsp-columns {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
}
.dsp-column {
  flex: 1 1 300px;
  min-width: 264px;
  max-width: 480px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(128, 128, 128, 0.22);
  border-radius: 10px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1, transparent);
}
/* Inside the full-height rail panel the columns take the remaining height and
   scroll on their own; in the settings card they simply grow with the page. */
.dsp-panel-body > .dsp-columns {
  flex: 1;
  align-items: stretch;
}
.dsp-panel-body > .dsp-columns > .dsp-column {
  max-height: 100%;
}
.dsp-column-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.22);
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.1));
}
.dsp-column-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsp-tokens {
  font-variant-numeric: tabular-nums;
}

.dsp-column-stat {
  flex: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #888);
}
.dsp-column-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}
.dsp-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25) inset;
}
/* ---- history column: closed and interrupted turns ---------------------- */
.dsp-history {
  flex: 0 0 300px;
  max-width: 340px;
  background: rgba(128, 128, 128, 0.06);
}
.dsp-seg {
  border: 1px solid rgba(128, 128, 128, 0.22);
  border-radius: 8px;
  overflow: hidden;
}
.dsp-seg-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  background: rgba(128, 128, 128, 0.08);
}
.dsp-seg-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.dsp-seg-turn {
  flex: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, #888);
}
.dsp-seg-outcome {
  flex: none;
  padding: 0 5px;
  border-radius: 999px;
  border: 1px solid rgba(120, 190, 140, 0.55);
  color: rgb(120, 190, 140);
  font-size: 10px;
  line-height: 15px;
}
.dsp-seg-outcome.interrupted {
  border-color: rgba(255, 183, 94, 0.55);
  color: rgb(255, 183, 94);
}
.dsp-seg-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
}
.dsp-col-note {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, #888);
}
.dsp-seg-more {
  align-self: flex-start;
  padding: 2px 0;
  border: none;
  background: none;
  color: var(--dsw-alias-label-secondary, #b8bec8);
  font-size: 11px;
  cursor: pointer;
}
.dsp-seg-more:hover {
  text-decoration: underline;
}
.dsp-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #888);
}
.dsp-pill {
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #fff);
}
.dsp-pill.ok {
  background: rgba(144, 175, 255, 0.38);
}
.dsp-pill.bad {
  background: rgba(255, 107, 107, 0.32);
}
.dsp-note {
  color: var(--dsw-alias-label-primary, inherit);
}
.dsp-revised {
  padding: 0 5px;
  border-radius: 999px;
  border: 1px solid rgba(255, 183, 94, 0.55);
  color: rgb(255, 183, 94);
  font-size: 10px;
}
.dsp-raw {
  margin: 0;
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(128, 128, 128, 0.1);
}
.dsp-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsp-panel-head {
  flex: none;
  padding: 14px 16px 12px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dsp-panel-title {
  font-size: 14px;
  font-weight: 600;
}
.dsp-panel-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #888);
}
.dsp-panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dsp-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: #90AFFF;
  vertical-align: -1px;
  margin-right: 5px;
}
.dsp-form {
  display: grid;
  grid-template-columns: max-content minmax(160px, 280px);
  gap: 8px 12px;
  align-items: center;
}
.dsp-field {
  display: contents;
}
.dsp-field-label {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #aaa);
}
.dsp-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  font: inherit;
  font-size: 12px;
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.12));
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
  border-radius: 6px;
  outline: none;
}
.dsp-input:focus {
  border-color: #90afff;
}
.dsp-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.dsp-btn {
  height: 28px;
  padding: 0 14px;
  font: inherit;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: #90afff;
  color: #10203d;
  cursor: pointer;
}
.dsp-btn.ghost {
  background: transparent;
  border-color: var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35));
  color: var(--dsw-alias-label-secondary, #aaa);
}
.dsp-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dsp-inline-wrap {
  flex-wrap: wrap;
}
.dsp-color {
  width: 44px;
  padding: 2px;
  cursor: pointer;
}
.dsp-code,
.dsp-range-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #888);
}
.dsp-range {
  flex: 1;
  min-width: 120px;
  height: 28px;
}
.dsp-range-value {
  flex: none;
  width: 36px;
  text-align: right;
}
/* The preview carries the same data-row-key prefix as a real session row, so
   it is painted by exactly the rules the sidebar uses. */
.dsp-preview-row {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 8px;
  border: 1px dashed rgba(128, 128, 128, 0.28);
  border-radius: var(--dsw-radius-md, 8px);
  overflow: hidden;
}
.dsp-preview-title {
  font-size: 13px;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsp-status {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #888);
}
`

    function cssEscape(value) {
      try {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
      } catch {
        /* fall through to the手工 escape */
      }
      return String(value).replace(/["\\]/g, '\\$&')
    }

    const h = React.createElement

    function shortId(id) {
      const text = String(id == null ? '' : id)
      return text.length > 12 ? `${text.slice(0, 8)}…${text.slice(-3)}` : text
    }

    /** 950 → "950", 1240 → "1.2k", 18300 → "18.3k". Compact, mono-friendly. */
    function formatTokens(value) {
      const count = Number(value)
      if (!Number.isFinite(count) || count <= 0) return '0'
      if (count < 1000) return String(Math.round(count))
      if (count < 100000) return `${Math.round(count / 100) / 10}k`
      return `${Math.round(count / 1000)}k`
    }

    function clockOf(iso) {
      try {
        return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false })
      } catch {
        return String(iso == null ? '' : iso)
      }
    }

    /** Read the host's live config (with the model/effort catalog) on mount. */
    function useConfig() {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [tick, setTick] = React.useState(0)

      React.useEffect(() => {
        let alive = true
        fetch(CONFIG_PATH, { cache: 'no-store' })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
          .then((json) => {
            if (!alive) return
            setData(json)
            setError('')
          })
          .catch((failure) => {
            if (alive) setError(failure && failure.message ? failure.message : String(failure))
          })
        return () => {
          alive = false
        }
      }, [tick])

      return { data, error, reload: () => setTick((n) => n + 1) }
    }

    /**
     * One poller for the whole plugin. The rail panel and the settings card
     * both read the log, and two independent three-second timers sent the same
     * twenty-six kilobytes twice over.
     */
    const logStore = {
      subscribers: new Set(),
      limit: 0,
      data: null,
      error: '',
      version: 0,
      timer: null,
      inflight: false,
      lastChangeAt: 0,
    }

    const LOG_POLL_MS = 3000
    const LOG_QUIET_POLL_MS = 12000

    const logNotify = () => {
      for (const subscriber of [...logStore.subscribers]) subscriber()
    }

    const logHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

    const logFetch = async () => {
      if (logStore.inflight || logStore.subscribers.size === 0 || logHidden()) return
      logStore.inflight = true
      try {
        const query = `limit=${logStore.limit || 80}${logStore.version ? `&since=${logStore.version}` : ''}`
        const res = await fetch(`${LOG_PATH}?${query}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        const version = Number(json && json.version)
        if (Number.isFinite(version)) logStore.version = version
        if (!json || json.unchanged !== true) {
          logStore.data = json
          logStore.error = ''
          logStore.lastChangeAt = Date.now()
          logNotify()
        }
      } catch (failure) {
        const message = failure && failure.message ? failure.message : String(failure)
        if (message !== logStore.error) {
          logStore.error = message
          logNotify()
        }
      } finally {
        logStore.inflight = false
      }
    }

    const logSchedule = () => {
      if (logStore.timer) clearTimeout(logStore.timer)
      // Right after a change the next one is likely close; once the log has
      // been quiet for a while, a twelve-second poll is plenty.
      const interval = Date.now() - logStore.lastChangeAt < 45000 ? LOG_POLL_MS : LOG_QUIET_POLL_MS
      logStore.timer = setTimeout(async () => {
        logStore.timer = null
        await logFetch()
        if (logStore.subscribers.size > 0) logSchedule()
      }, interval)
    }

    const logWatchVisibility = () => {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
      document.addEventListener('visibilitychange', () => {
        if (logHidden() || logStore.subscribers.size === 0) return
        logFetch()
      })
    }

    /** Poll the host's sample log; the endpoint is local-only, no auth needed. */
    function useLog(limit) {
      const [, bump] = React.useState(0)

      React.useEffect(() => {
        const subscriber = () => bump((n) => n + 1)
        logStore.subscribers.add(subscriber)
        logStore.limit = Math.max(logStore.limit, Number(limit) || 0)
        if (logStore.subscribers.size === 1) logWatchVisibility()
        logFetch()
        logSchedule()
        return () => {
          logStore.subscribers.delete(subscriber)
          if (logStore.subscribers.size === 0 && logStore.timer) {
            clearTimeout(logStore.timer)
            logStore.timer = null
          }
        }
      }, [limit])

      return { data: logStore.data, error: logStore.error, reload: logFetch }
    }

    function metaLine(data, error) {
      const config = (data && data.config) || {}
      return h(
        'div',
        { className: 'dsp-panel-sub' },
        h('span', null, `判断模型 ${config.provider || '—'}/${config.model || '—'}`),
        h('span', null, `思考强度 ${(data && data.effort) || config.reasoningEffort || '—'}`),
        h('span', null, `每 ${Math.round((Number(config.intervalMs) || 30000) / 1000)} 秒采样`),
        h('span', null, `共 ${(data && data.total) || 0} 次`),
        h(
          'span',
          { title: '已经结束或被中断、收进历史轮的采样数' },
          `历史 ${(data && data.historyTotal) || 0} 条${
            data && data.interruptedTotal > 0 ? `（中断 ${data.interruptedTotal}）` : ''
          }`,
        ),
        h(
          'span',
          { className: 'dsp-tokens', title: '判断模型累计消耗的 token（输入 + 输出）' },
          `消耗 ${formatTokens(data && data.tokens && data.tokens.total)} tokens`,
        ),
        error ? h('span', { className: 'dsp-error' }, `读取失败：${error}`) : null,
      )
    }

    /**
     * Warning for machines whose configured route does not exist. Without it
     * the band would simply never appear and look like a broken plugin.
     */
    function routeWarning(data) {
      if (!data) return null
      if (data.catalogEmpty) {
        return h(
          'div',
          { className: 'dsp-error' },
          '这台机器上还读不到任何可用模型（provider 未配置），采样不会开始。请先在设置 → 模型里配置一个 provider。',
        )
      }
      if (data.routeFallback) {
        const config = data.config || {}
        return h(
          'div',
          { className: 'dsp-error' },
          `原配置的模型在本机不存在，已自动改用 ${config.provider}/${config.model}。可在设置里改成你想要的模型。`,
        )
      }
      return null
    }

    function renderEntry(entry, index) {
      const failed = Boolean(entry.error)
      return h(
        'div',
        { className: 'dsp-item', key: `${entry.at}:${index}` },
        h(
          'div',
          { className: 'dsp-meta' },
          h('span', null, clockOf(entry.at)),
          h(
            'span',
            { className: `dsp-pill ${failed ? 'bad' : 'ok'}` },
            entry.p === null || entry.p === undefined ? '失败' : `${entry.p}%`,
          ),
          entry.note ? h('span', { className: 'dsp-note' }, entry.note) : null,
          entry.revised
            ? h(
                'span',
                {
                  className: 'dsp-revised',
                  title: '用户插嘴后重新评估，这一条允许比上一次低',
                },
                '重估',
              )
            : null,
          h('span', null, `${Math.round((Number(entry.ms) || 0) / 100) / 10}s`),
          entry.tokens ? h('span', null, `${formatTokens(entry.tokens.total)} tok`) : null,
          h('span', null, entry.effort || ''),
          failed ? h('span', null, entry.error) : null,
        ),
        h('pre', { className: 'dsp-raw' }, entry.raw ? entry.raw : '（空输出）'),
      )
    }

    /**
     * Who wins when the host re-broadcasts its saved look while the settings
     * card is previewing an unsaved one? The draft does, until it is committed.
     *
     * `source` is 'preview' (settings card) or 'server' (SSE frame, initial
     * config). Pure, so the policy can be tested without a browser.
     */
    function routeLook(state, incoming, source) {
      const candidate = {
        color: incoming.color,
        opacity: incoming.opacity,
        style: incoming.style,
      }
      const same = (a, b) =>
        !!a &&
        !!b &&
        String(a.color) === String(b.color) &&
        Number(a.opacity) === Number(b.opacity) &&
        String(a.style) === String(b.style)

      if (source === 'preview') {
        return {
          previewing: !same(candidate, state.serverLook),
          serverLook: state.serverLook,
          paint: true,
        }
      }

      // A saved look the draft already matches ends the preview.
      if (state.previewing && !same(candidate, state.painted)) {
        return { previewing: true, serverLook: candidate, paint: false }
      }
      return { previewing: false, serverLook: candidate, paint: true }
    }

    /** Stable colour per session, so one session keeps one dot colour. */
    function hueOf(id) {
      const text = String(id == null ? '' : id)
      let hash = 7
      for (let index = 0; index < text.length; index += 1) {
        hash = (hash * 31 + text.charCodeAt(index)) % 360
      }
      return hash
    }

    /**
     * Newest-first entries in, one group per session out. `title` is the
     * session title when the host saw one, otherwise ''.
     */
    function groupBySession(entries) {
      const groups = new Map()
      for (const entry of entries) {
        const key = String(entry?.sessionId || 'unknown')
        let group = groups.get(key)
        if (!group) {
          group = { id: key, title: '', entries: [] }
          groups.set(key, group)
        }
        if (!group.title && entry?.sessionTitle) group.title = String(entry.sessionTitle)
        group.entries.push(entry)
      }
      // Entries arrive newest-first, so group.entries[0] is that session's
      // latest sample: that is the one the header summarises.
      return [...groups.values()].sort((a, b) => {
        const left = String(a.entries[0]?.at ?? '')
        const right = String(b.entries[0]?.at ?? '')
        return right.localeCompare(left)
      })
    }

    /** How a closed turn ended; only the interrupted one is resumable. */
    const OUTCOME_LABEL = { completed: '完成', interrupted: '中断' }

    /**
     * Closed turns, one block per (session, turn), newest turn first. A turn
     * that was interrupted is kept -- and the next turn of the same session
     * starts from its number -- so the history column shows what is going to be
     * continued, not just what is over.
     */
    function groupHistory(history) {
      const segments = new Map()
      for (const entry of history) {
        const turn = Number(entry && entry.turn) || 0
        const id = String((entry && entry.sessionId) || 'unknown')
        const key = `${id}#${turn}`
        let segment = segments.get(key)
        if (!segment) {
          segment = { key, id, turn, title: '', outcome: '', entries: [], lastP: null }
          segments.set(key, segment)
        }
        if (!segment.title && entry.sessionTitle) segment.title = String(entry.sessionTitle)
        if (!segment.outcome && entry.outcome) segment.outcome = String(entry.outcome)
        segment.entries.push(entry)
      }
      for (const segment of segments.values()) {
        segment.entries.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
        for (let index = segment.entries.length - 1; index >= 0; index -= 1) {
          const value = Number(segment.entries[index].p)
          if (Number.isFinite(value)) {
            segment.lastP = value
            break
          }
        }
      }
      return [...segments.values()].sort((a, b) => {
        const left = String(a.entries[a.entries.length - 1]?.at ?? '')
        const right = String(b.entries[b.entries.length - 1]?.at ?? '')
        return right.localeCompare(left)
      })
    }

    /**
     * One column per session: the head stays put, the samples scroll inside the
     * column, so several running sessions read side by side instead of as one
     * interleaved list.
     */
    function renderColumn(group, groupIndex) {
      const latest = group.entries[0] || {}
      const lastP = latest.p === null || latest.p === undefined ? '—' : `${latest.p}%`
      const title = group.title || shortId(group.id)
      const dotColor = `hsl(${hueOf(group.id)} 72% 62%)`
      return h(
        'section',
        { className: 'dsp-column', key: group.id, 'data-session-id': group.id },
        h(
          'div',
          { className: 'dsp-column-head' },
          h('span', { className: 'dsp-dot', style: { background: dotColor } }),
          h('span', { className: 'dsp-column-title', title: group.title || group.id }, title),
          h(
            'span',
            { className: 'dsp-column-stat' },
            `${lastP} · ${group.entries.length} 次 · ${clockOf(latest.at)}`,
          ),
        ),
        h(
          'div',
          { className: 'dsp-column-body' },
          group.entries.map((entry, index) => renderEntry(entry, `${groupIndex}:${index}`)),
        ),
      )
    }

    /**
     * Columns are ordered by their newest sample, so a sample from another
     * session swaps two of them. The DOM swap is instant, which reads as a
     * jump; FLIP slides each column from where it was to where it now is.
     */
    function useColumnFlip(entries) {
      const ref = React.useRef(null)
      const seen = React.useRef(new Map())
      // The entries array is rebuilt on every poll, but the columns only move
      // when their order changes: measure on order, not on identity.
      const orderKey = entries.map((entry) => (entry && entry.id) || '').join('|')

      React.useLayoutEffect(() => {
        const root = ref.current
        if (!root || !root.children) return
        const reduce =
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const next = new Map()
        for (const node of root.children) {
          const id = node.getAttribute && node.getAttribute('data-session-id')
          if (!id) continue
          const left = node.getBoundingClientRect().left
          next.set(id, left)
          const before = seen.current.get(id)
          if (before === undefined || reduce) continue
          const dx = before - left
          if (Math.abs(dx) < 1) continue
          // Put it back where it was without a transition, commit that frame,
          // then let it travel to its new slot.
          node.style.transition = 'none'
          node.style.transform = `translateX(${dx}px)`
          void node.offsetWidth
          node.style.transition = 'transform 420ms cubic-bezier(.22,.61,.36,1)'
          node.style.transform = 'translateX(0)'
        }
        seen.current = next
      }, [orderKey])

      return ref
    }

    /** One closed turn, collapsible: two samples by default, all of them on demand. */
    function HistorySegment(props) {
      const segment = props.segment
      const [open, setOpen] = React.useState(false)
      const entries = segment.entries || []
      const shown = open ? entries : entries.slice(-2)
      const last = entries[entries.length - 1] || {}
      const pLabel = segment.lastP === null ? '—' : `${segment.lastP}%`
      return h(
        'div',
        { className: 'dsp-seg' },
        h(
          'div',
          { className: 'dsp-seg-head' },
          h('span', { className: 'dsp-dot', style: { background: `hsl(${hueOf(segment.id)} 72% 62%)` } }),
          h(
            'span',
            { className: 'dsp-seg-title', title: segment.title || segment.id },
            segment.title || shortId(segment.id),
          ),
          h('span', { className: 'dsp-seg-turn' }, segment.turn > 0 ? `#${segment.turn}` : ''),
          h(
            'span',
            {
              className: `dsp-seg-outcome ${segment.outcome === 'interrupted' ? 'interrupted' : ''}`,
              title:
                segment.outcome === 'interrupted'
                  ? '这一轮被打断，下一次同会话开跑会从它的进度接着算'
                  : '这一轮正常结束',
            },
            OUTCOME_LABEL[segment.outcome] || '结束',
          ),
        ),
        h(
          'div',
          { className: 'dsp-seg-body' },
          h(
            'div',
            { className: 'dsp-col-note' },
            `${pLabel} · ${entries.length} 次 · ${clockOf(last.at)}`,
          ),
          shown.map((entry, index) => renderEntry(entry, `${segment.key}:${index}`)),
          entries.length > shown.length
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dsp-seg-more',
                  onClick: () => setOpen(true),
                },
                `展开全部 ${entries.length} 条`,
              )
            : null,
        ),
      )
    }

    /** The leftmost column: turns that are over (or were cut short). */
    function renderHistoryColumn(segments) {
      return h(
        'section',
        { className: 'dsp-column dsp-history', key: 'history', 'data-session-id': 'history' },
        h(
          'div',
          { className: 'dsp-column-head' },
          h('span', { className: 'dsp-dot', style: { background: 'rgba(150,155,168,.9)' } }),
          h('span', { className: 'dsp-column-title', title: '已经结束或被中断的轮次' }, '历史轮次'),
          h('span', { className: 'dsp-column-stat' }, `${segments.length} 轮`),
        ),
        h(
          'div',
          { className: 'dsp-column-body' },
          segments.map((segment) => h(HistorySegment, { key: segment.key, segment })),
        ),
      )
    }

    function ColumnList(props) {
      const ref = useColumnFlip(props.entries)
      const segments = groupHistory(props.history || [])
      return h(
        'div',
        { className: 'dsp-columns', ref },
        segments.length > 0 ? renderHistoryColumn(segments) : null,
        groupBySession(props.entries).map(renderColumn),
      )
    }

    /** History first (leftmost), then the live session columns. */
    function renderColumns(entries, history) {
      return h(ColumnList, { entries, history })
    }

    function emptyState(text) {
      return h('div', { className: 'dsp-empty' }, text)
    }

    /** Settings card: interval, model and reasoning effort, plus a save button. */
    function SettingsCard() {
      const { data, error, reload } = useConfig()
      const [draft, setDraft] = React.useState(null)
      const [status, setStatus] = React.useState('')
      /** The last config the host reported, to undo an abandoned draft. */
      const saved = React.useRef(null)

      React.useEffect(() => {
        if (data && data.config) saved.current = data.config
      }, [data])

      React.useEffect(
        () => () => {
          // Leaving without saving must not leave the band painted as a draft.
          if (saved.current) api.commit(saved.current)
        },
        [],
      )

      const config = (data && data.config) || {}
      const models = Array.isArray(data && data.models) ? data.models : []

      React.useEffect(() => {
        if (draft || !data) return
        setDraft({
          seconds: Math.round((Number(config.intervalMs) || 30000) / 1000),
          provider: config.provider || '',
          model: config.model || '',
          effort: config.reasoningEffort || '',
          color: config.color || '#90AFFF',
          opacity: Number(config.opacity) || 0.6,
          style: config.style || 'band',
        })
      }, [
        data,
        draft,
        config.intervalMs,
        config.provider,
        config.model,
        config.reasoningEffort,
        config.color,
        config.opacity,
        config.style,
      ])

      const current = draft || {
        seconds: Math.round((Number(config.intervalMs) || 30000) / 1000),
        provider: config.provider || '',
        model: config.model || '',
        effort: config.reasoningEffort || '',
        color: config.color || '#90AFFF',
        opacity: Number(config.opacity) || 0.6,
        style: config.style || 'band',
      }
      const selectedKey = JSON.stringify([current.provider, current.model])
      const entry = models.find((item) => JSON.stringify([item.provider, item.model]) === selectedKey) || null
      const efforts = entry && Array.isArray(entry.efforts) ? entry.efforts : []

      const save = () => {
        setStatus('保存中…')
        const body = {
          intervalMs: Math.round(Number(current.seconds) * 1000) || 30000,
          provider: current.provider,
          model: current.model,
          reasoningEffort: current.effort,
          color: current.color,
          opacity: Number(current.opacity),
          style: current.style,
        }
        fetch(CONFIG_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then((res) =>
            res.json().then((payload) => {
              if (!res.ok) throw new Error(String(payload && payload.error) || `HTTP ${res.status}`)
              return payload
            }),
          )
          .then((payload) => {
            setDraft(null)
            // Adopt the saved look at once instead of waiting for the next frame.
            if (payload && payload.config) api.commit(payload.config)
            const used = (payload && payload.effectiveEffort) || body.reasoningEffort
            const asked = body.reasoningEffort
            setStatus(used && used !== asked ? `已保存 · ${asked} 不可用，实际用 ${used}` : `已保存 · 实际档位 ${used || '—'}`)
            reload()
          })
          .catch((err) => setStatus(`保存失败：${String((err && err.message) || err)}`))
      }

      const field = (label, control) =>
        h('label', { className: 'dsp-field' }, h('span', { className: 'dsp-field-label' }, label), control)

      return h(
        'div',
        { className: 'dsp-card' },
        h(
          'div',
          { className: 'dsp-panel-sub' },
          h('span', null, '采样设置'),
          error ? h('span', { className: 'dsp-error' }, `读取失败：${error}`) : null,
        ),
        routeWarning(data),
        h(
          'div',
          { className: 'dsp-form' },
          field(
            '更新间隔（秒）',
            h('input', {
              className: 'dsp-input',
              type: 'number',
              min: '5',
              max: '3600',
              step: '5',
              value: String(current.seconds),
              onChange: (event) => setDraft({ ...current, seconds: event.target.value }),
            }),
          ),
          field(
            '模型',
            h(
              'select',
              {
                className: 'dsp-input',
                value: selectedKey,
                onChange: (event) => {
                  let picked = [current.provider, current.model]
                  try {
                    picked = JSON.parse(String(event.target.value))
                  } catch {
                    /* keep current */
                  }
                  const [provider, model] = picked
                  const next = models.find(
                    (item) => item.provider === provider && item.model === model,
                  )
                  const allowed = (next && next.efforts) || []
                  const effort = allowed.includes(current.effort)
                    ? current.effort
                    : allowed[0] || current.effort
                  setDraft({ ...current, provider, model, effort })
                },
              },
              models.length === 0
                ? h('option', { key: 'only', value: selectedKey }, `${current.provider} / ${current.model}`)
                : models.map((item) =>
                    h(
                      'option',
                      { key: JSON.stringify([item.provider, item.model]), value: JSON.stringify([item.provider, item.model]) },
                      item.label || `${item.provider} / ${item.model}`,
                    ),
                  ),
            ),
          ),
          field(
            '思考强度',
            h(
              'select',
              {
                className: 'dsp-input',
                value: current.effort,
                onChange: (event) => setDraft({ ...current, effort: event.target.value }),
              },
              efforts.length === 0
                ? [h('option', { key: 'current', value: current.effort }, current.effort || '（该模型未声明档位）')]
                : efforts.map((id) =>
                    h(
                      'option',
                      { key: id, value: id },
                      entry && entry.defaultEffort === id ? `${id}（默认）` : id,
                    ),
                  ),
            ),
          ),
          field(
            '进度条颜色',
            h(
              'div',
              { className: 'dsp-inline' },
              h('input', {
                className: 'dsp-input dsp-color',
                type: 'color',
                value: /^#[0-9a-f]{6}$/i.test(String(current.color)) ? current.color : '#90AFFF',
                onChange: (event) => {
                  const color = String(event.target.value || '')
                  const next = { ...current, color }
                  setDraft(next)
                  api.preview(next)
                },
              }),
              h('code', { className: 'dsp-code' }, String(current.color || '').toUpperCase()),
            ),
          ),
          field(
            '不透明度',
            h(
              'div',
              { className: 'dsp-inline' },
              h('input', {
                className: 'dsp-range',
                type: 'range',
                min: '0.05',
                max: '1',
                step: '0.05',
                style: {
                  accentColor: /^#[0-9a-f]{6}$/i.test(String(current.color)) ? current.color : '#90AFFF',
                },
                value: String(Number(current.opacity) || 0.6),
                onChange: (event) => {
                  const opacity = Number(event.target.value)
                  const next = { ...current, opacity }
                  setDraft(next)
                  api.preview(next)
                },
              }),
              h('span', { className: 'dsp-range-value' }, `${Math.round((Number(current.opacity) || 0.6) * 100)}%`),
            ),
          ),
          field(
            '进度条样式',
            h(
              'div',
              { className: 'dsp-inline dsp-inline-wrap' },
              h(
                'select',
                {
                  className: 'dsp-input',
                  value: current.style,
                  onChange: (event) => {
                    const style = event.target.value
                    const next = { ...current, style }
                    setDraft(next)
                    api.preview(next)
                  },
                },
                LOOK_STYLES.map((item) =>
                  h('option', { key: item.id, value: item.id }, `${item.label} — ${item.hint}`),
                ),
              ),
            ),
          ),
          field(
            '预览',
            h('div', {
              className: 'dsp-preview-row',
              'data-row-key': 'session:preview',
              style: { '--dsp-p': '62%', '--dsp-o': String(Number(current.opacity) || 0.6) },
            }, h('span', { className: 'dsp-preview-title' }, '侧栏会话行大概长这样')),
          ),
        ),
        h(
          'div',
          { className: 'dsp-actions' },
          h('button', { className: 'dsp-btn', type: 'button', onClick: save }, '保存'),
          h(
            'button',
            {
              className: 'dsp-btn ghost',
              type: 'button',
              onClick: () => {
                setDraft(null)
                setStatus('')
                if (saved.current) api.commit(saved.current)
                reload()
              },
            },
            '重置',
          ),
          h(
            'span',
            { className: 'dsp-status' },
            status ||
              (efforts.length > 0 && !efforts.includes(current.effort)
                ? `${current.effort} 不在该模型的档位里，保存后会自动就近取档`
                : ''),
          ),
        ),
      )
    }

    function SettingsPanel() {
      return h('div', null, h(SettingsCard), h(ProgressLogCard))
    }

    /** Settings-page card: the same log in a compact block. */
    function ProgressLogCard() {
      const { data, error } = useLog(40)
      const entries = Array.isArray(data && data.entries) ? data.entries : []
      const history = Array.isArray(data && data.history) ? data.history : []
      return h(
        'div',
        { className: 'dsp-card' },
        metaLine(data, error),
        routeWarning(data),
        entries.length === 0 && history.length === 0
          ? emptyState('还没有采样记录。让一个会话开始跑任务，第一次采样在开跑约 8 秒后发生。')
          : renderColumns(entries, history),
      )
    }

    /**
     * The left-rail panel (`main` keyed slot, key = PANEL_ID): every sampler
     * answer, raw, newest first.
     */
    function SampleLogPanel() {
      const { data, error } = useLog(120)
      const entries = Array.isArray(data && data.entries) ? data.entries : []
      const history = Array.isArray(data && data.history) ? data.history : []
      return h(
        'div',
        { className: 'dsp-panel' },
        h(
          'div',
          { className: 'dsp-panel-head' },
          h('div', { className: 'dsp-panel-title' }, PANEL_LABEL),
          metaLine(data, error),
          h(
            'div',
            { className: 'dsp-panel-sub' },
            h(
              'span',
              null,
              h('span', {
                className: 'dsp-swatch',
                style: { background: (data && data.config && data.config.color) || '#90AFFF' },
              }),
              (() => {
                const look = (data && data.config) || {}
                const percent = Math.round((Number(look.opacity) || 0.6) * 100)
                return `侧栏色带 ${look.color || '#90AFFF'} · ${percent}% 不透明度`
              })(),
            ),
            h('span', null, '每 3 秒自动刷新'),
          ),
        ),
        h(
          'div',
          { className: 'dsp-panel-body' },
          routeWarning(data),
          entries.length === 0 && history.length === 0
            ? emptyState(
                '还没有采样记录。侧栏会话开始跑任务后，宿主会在开跑约 8 秒后调用一次判断模型，之后每 30 秒一次。',
              )
            : renderColumns(entries, history),
        ),
      )
    }

    /** Rail icon: three ascending bars. The rail slot only renders an icon. */
    function SampleLogIcon(props) {
      const size = (props && Number(props.size)) || 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('rect', { x: 3, y: 14, width: 4, height: 7, rx: 1, fill: 'currentColor', opacity: 0.5 }),
        h('rect', { x: 10, y: 9, width: 4, height: 12, rx: 1, fill: 'currentColor', opacity: 0.75 }),
        h('rect', { x: 17, y: 3, width: 4, height: 18, rx: 1, fill: 'currentColor' }),
      )
    }

    function apply(ctx) {
      let base
      let dynamic
      let theme
      let themeObserver
      let lookSheet
      let source
      /** Last applied look (`{color, opacity, style}`) and its identity. */
      /** What is painted right now, what the host last reported, and whether
       *  the settings card is previewing a draft the host does not know about. */
      const lookState = { painted: null, serverLook: null, previewing: false }
      let lookKey = ''
      const values = new Map()

      /** Resolve the active theme. The harness theme presenter is the authority:
       *  it sets `html[data-ds-theme-source]`, `html{color-scheme}` and
       *  `body[data-ds-dark-theme]`. Everything after that is a fallback for
       *  hosts that apply the palette some other way. */
      const isDarkTheme = () => {
        try {
          const root = document.documentElement
          const body = document.body

          if (body && body.hasAttribute('data-ds-dark-theme')) return true
          const source = root.getAttribute('data-ds-theme-source')
          if (source === 'dark') return true
          if (source === 'light') return false
          const scheme = String(getComputedStyle(root).colorScheme || '').toLowerCase()
          if (scheme.includes('dark')) return true
          if (scheme.includes('light')) return false

          const marks = [
            root.className,
            root.getAttribute('data-theme'),
            root.getAttribute('data-mode'),
            root.getAttribute('data-color-scheme'),
          ]
            .filter(Boolean)
            .join(' ')
          if (/dark/i.test(marks)) return true
          if (/light/i.test(marks)) return false

          const luminance = (value) => {
            const match = /rgba?\(([^)]+)\)/.exec(String(value || ''))
            if (!match) return null
            const parts = match[1]
              .split(/[,\s/]+/)
              .filter(Boolean)
              .map(Number)
            const [r, g, b, a] = parts
            if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null
            const alpha = Number.isFinite(a) ? a : 1
            if (alpha < 0.05) return null
            return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
          }

          for (const element of [body, root]) {
            if (!element) continue
            const level = luminance(getComputedStyle(element).backgroundColor)
            if (level !== null) return level < 0.5
          }
          return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
        } catch {
          return false
        }
      }

      function syncTheme() {
        if (!theme) return
        const dark = isDarkTheme()
        theme.textContent = [
          `.dsp-input{color-scheme:${dark ? 'dark' : 'light'};}`,
          // Theme tokens do the colouring, so the list matches the app in
          // either mode even if the UA scheme guess is wrong.
          '.dsp-input option,.dsp-input optgroup{background-color:var(--dsw-alias-bg-layer-2, #232428);color:var(--dsw-alias-label-primary, #e6e8eb);}',
        ].join('\n')
      }

      try {
        base = document.createElement('style')
        base.setAttribute(STYLE_ATTR, 'dsh-session-progress')
        base.textContent = BASE_CSS

        lookSheet = document.createElement('style')
        lookSheet.setAttribute(STYLE_ATTR, 'dsh-session-progress-look')
        lookSheet.textContent = styleRules(null)

        dynamic = document.createElement('style')
        dynamic.setAttribute(STYLE_ATTR, 'dsh-session-progress-rules')

        // A native <select> popup is painted by the UA from `color-scheme`
        // (which our card does not inherit) plus the option's own background.
        // Left alone, the list comes out white-on-white in the dark theme, so
        // paint it explicitly and follow the theme as it flips.
        theme = document.createElement('style')
        theme.setAttribute(STYLE_ATTR, 'dsh-session-progress-theme')

        // Order matters: `lookSheet` must come after `base` so the style can
        // override the shared shape rules.
        document.head.append(base, lookSheet, dynamic, theme)
        syncTheme()
        try {
          themeObserver = new MutationObserver(syncTheme)
          themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: [
              'class',
              'style',
              'data-theme',
              'data-mode',
              'data-color-scheme',
              'data-ds-theme-source',
            ],
          })
          if (document.body) {
            themeObserver.observe(document.body, {
              attributes: true,
              attributeFilter: ['class', 'style', 'data-ds-dark-theme'],
            })
          }
        } catch {
          /* no MutationObserver: the initial pass is all we get */
        }
      } catch (error) {
        console.error('[dsh-session-progress] failed to inject styles:', error)
      }

      // Frames repeat while nothing moves; rebuilding an identical sheet is
      // pure work, so the last text is compared first.
      let lastCss = ''

      const render = () => {
        if (!dynamic) return
        let css = ''
        for (const [id, value] of values) {
          const p = Math.max(0, Math.min(100, Number(value && value.p) || 0))
          const rawOpacity = value && value.o
          const painted = lookState.painted
          const fallbackOpacity =
            painted && Number.isFinite(Number(painted.opacity)) ? Number(painted.opacity) : 0.6
          const o =
            rawOpacity === undefined
              ? fallbackOpacity
              : Math.max(0, Math.min(1, Number(rawOpacity)))
          css += `[data-row-key="session:${cssEscape(id)}"]{--dsp-p:${p}%;--dsp-o:${o}}\n`
        }
        if (css === lastCss) return
        lastCss = css
        dynamic.textContent = css
      }

      api.preview = (next) => applyLook(next, 'preview')

      /** Adopt a look as saved truth (after a save, a reset, or on unmount). */
      api.commit = (next) => {
        lookState.previewing = false
        if (next && typeof next === 'object') lookState.serverLook = next
        if (lookState.serverLook) applyLook(lookState.serverLook, 'server')
      }

      /** Write the stylesheet for one look, if it differs from what is painted. */
      const paintLook = (next) => {
        const candidate = { color: next.color, opacity: next.opacity, style: next.style }
        const key = `${candidate.color}|${candidate.opacity}|${candidate.style}`
        if (key === lookKey) return
        lookKey = key
        lookState.painted = candidate
        if (lookSheet) lookSheet.textContent = styleRules(candidate)
        render()
      }

      /** Repaint the band when colour / opacity / style change. */
      const applyLook = (next, source) => {
        if (!next || typeof next !== 'object') return
        const routed = routeLook(lookState, next, source)
        lookState.previewing = routed.previewing
        lookState.serverLook = routed.serverLook
        if (routed.paint) paintLook(next)
      }

      // Paint the saved look before the first frame arrives (a fresh page, or
      // an idle app with nothing running, gets no SSE frame at all).
      fetch(CONFIG_PATH, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((payload) => {
          if (payload && payload.config) applyLook(payload.config, 'server')
        })
        .catch(() => {
          /* the settings card surfaces this later if it matters */
        })

      try {
        source = new EventSource(EVENTS_PATH)
        source.addEventListener('message', (event) => {
          try {
            const payload = JSON.parse(event.data)
            if (!payload || payload.type !== 'progress' || !Array.isArray(payload.sessions)) return
            // The host re-broadcasts its saved look every couple of seconds;
            // `routeLook` keeps an unsaved draft from being overwritten.
            if (payload.look) applyLook(payload.look, 'server')
            values.clear()
            for (const item of payload.sessions) {
              if (item && item.id) values.set(String(item.id), item)
            }
            render()
          } catch (error) {
            console.error('[dsh-session-progress] bad frame:', error)
          }
        })
        source.addEventListener('error', () => {
          // EventSource reconnects on its own; keep the last painted values.
        })
      } catch (error) {
        console.error('[dsh-session-progress] failed to open the progress stream:', error)
      }

      if (ctx.slots && typeof ctx.slots.inject === 'function') {
        // 1) The left rail entry. `sidebar.panellist` takes an icon component
        //    plus `id`/`order`/`label`; the SAME id addresses the panel body in
        //    the root-scoped keyed `main` slot. Selecting a `main` key that is
        //    absent throws, so both halves are registered together.
        const registerPanel = function* () {
          yield ctx.slots.register({ name: 'main', key: PANEL_ID }, SampleLogPanel)
        }
        const registerRail = function* () {
          yield ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: () => PANEL_LABEL },
            SampleLogIcon,
          )
        }
        // 2) Settings surfaces, kept as a secondary place to read the same log.
        const registerCard = (slot) => () => {
          try {
            ctx.slots.register(
              {
                name: slot,
                key: PANEL_ID,
                id: PANEL_ID,
                order: 40,
                label: () => PANEL_LABEL,
                inject: () => ({}),
              },
              SettingsPanel,
            )
          } catch (error) {
            console.error(`[dsh-session-progress] cannot register ${slot}:`, error)
          }
        }

        for (const [slot, factory] of [
          ['main', registerPanel],
          ['sidebar.panellist', registerRail],
          ['plugins.bundle.config', registerCard('plugins.bundle.config')],
          ['settings.plugins.tab', registerCard('settings.plugins.tab')],
        ]) {
          try {
            ctx.slots.inject(slot, factory)
          } catch (error) {
            console.error(`[dsh-session-progress] cannot inject ${slot}:`, error)
          }
        }
      }

      if (typeof ctx.effect === 'function') {
        ctx.effect(
          () => () => {
            try {
              source?.close()
            } catch {
              /* already closed */
            }
            try {
              themeObserver?.disconnect()
            } catch {
              /* ignore */
            }
            try {
              base?.remove()
              lookSheet?.remove()
              dynamic?.remove()
              theme?.remove()
            } catch {
              /* head may already be torn down */
            }
            values.clear()
          },
          'dsh-session-progress: stylesheet + progress stream',
        )
      }
    }

    module.exports = {
      name: 'dsh-session-progress-client',
      inject: ['slots'],
      apply,
    }
    return module.exports
  },
})
