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
  inset-block: 0;
  inset-inline-start: 0;
  width: var(--dsp-p, 0%);
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    #90AFFF 0%,
    #90AFFF calc(100% - 10px),
    rgba(144, 175, 255, 0.35) 100%
  );
  opacity: var(--dsp-o, 0);
  pointer-events: none;
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

    /** Poll the host's sample log; the endpoint is local-only, no auth needed. */
    function useLog(limit) {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        let alive = true
        let timer = null
        const load = async () => {
          try {
            const res = await fetch(`${LOG_PATH}?limit=${limit}`, { cache: 'no-store' })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const json = await res.json()
            if (alive) {
              setData(json)
              setError('')
            }
          } catch (failure) {
            if (alive) setError(failure && failure.message ? failure.message : String(failure))
          }
          if (alive) timer = setTimeout(load, 3000)
        }
        load()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [limit])

      return { data, error }
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
          h('span', null, `${Math.round((Number(entry.ms) || 0) / 100) / 10}s`),
          h('span', null, entry.effort || ''),
          failed ? h('span', null, entry.error) : null,
        ),
        h('pre', { className: 'dsp-raw' }, entry.raw ? entry.raw : '（空输出）'),
      )
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
        { className: 'dsp-column', key: group.id },
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

    /** The session columns, left to right, most recently sampled first. */
    function renderColumns(entries) {
      return h('div', { className: 'dsp-columns' }, groupBySession(entries).map(renderColumn))
    }

    function emptyState(text) {
      return h('div', { className: 'dsp-empty' }, text)
    }

    /** Settings card: interval, model and reasoning effort, plus a save button. */
    function SettingsCard() {
      const { data, error, reload } = useConfig()
      const [draft, setDraft] = React.useState(null)
      const [status, setStatus] = React.useState('')

      const config = (data && data.config) || {}
      const models = Array.isArray(data && data.models) ? data.models : []

      React.useEffect(() => {
        if (draft || !data) return
        setDraft({
          seconds: Math.round((Number(config.intervalMs) || 30000) / 1000),
          provider: config.provider || '',
          model: config.model || '',
          effort: config.reasoningEffort || '',
        })
      }, [data, draft, config.intervalMs, config.provider, config.model, config.reasoningEffort])

      const current = draft || {
        seconds: Math.round((Number(config.intervalMs) || 30000) / 1000),
        provider: config.provider || '',
        model: config.model || '',
        effort: config.reasoningEffort || '',
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
      return h(
        'div',
        { className: 'dsp-card' },
        metaLine(data, error),
        routeWarning(data),
        entries.length === 0
          ? emptyState('还没有采样记录。让一个会话开始跑任务，第一次采样在开跑约 8 秒后发生。')
          : renderColumns(entries),
      )
    }

    /**
     * The left-rail panel (`main` keyed slot, key = PANEL_ID): every sampler
     * answer, raw, newest first.
     */
    function SampleLogPanel() {
      const { data, error } = useLog(120)
      const entries = Array.isArray(data && data.entries) ? data.entries : []
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
            h('span', null, h('span', { className: 'dsp-swatch' }), '侧栏色带 #90AFFF · 60% 不透明度'),
            h('span', null, '每 3 秒自动刷新'),
          ),
        ),
        h(
          'div',
          { className: 'dsp-panel-body' },
          routeWarning(data),
          entries.length === 0
            ? emptyState(
                '还没有采样记录。侧栏会话开始跑任务后，宿主会在开跑约 8 秒后调用一次判断模型，之后每 30 秒一次。',
              )
            : renderColumns(entries),
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
      let source
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

        dynamic = document.createElement('style')
        dynamic.setAttribute(STYLE_ATTR, 'dsh-session-progress-rules')

        // A native <select> popup is painted by the UA from `color-scheme`
        // (which our card does not inherit) plus the option's own background.
        // Left alone, the list comes out white-on-white in the dark theme, so
        // paint it explicitly and follow the theme as it flips.
        theme = document.createElement('style')
        theme.setAttribute(STYLE_ATTR, 'dsh-session-progress-theme')

        document.head.append(base, dynamic, theme)
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

      const render = () => {
        if (!dynamic) return
        let css = ''
        for (const [id, value] of values) {
          const p = Math.max(0, Math.min(100, Number(value && value.p) || 0))
          const rawOpacity = value && value.o
          const o = rawOpacity === undefined ? 0.6 : Math.max(0, Math.min(1, Number(rawOpacity)))
          css += `[data-row-key="session:${cssEscape(id)}"]{--dsp-p:${p}%;--dsp-o:${o}}\n`
        }
        dynamic.textContent = css
      }

      try {
        source = new EventSource(EVENTS_PATH)
        source.addEventListener('message', (event) => {
          try {
            const payload = JSON.parse(event.data)
            if (!payload || payload.type !== 'progress' || !Array.isArray(payload.sessions)) return
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
