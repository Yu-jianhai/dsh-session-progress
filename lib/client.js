window.__ModuleLoader__.load({
  id: 'dsh-session-progress',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const EVENTS_PATH = '/plugins/dsh-session-progress/events'
    const LOG_PATH = '/plugins/dsh-session-progress/log'
    // Bumped whenever the browser half changes shape, so the host can tell
    // "the user restarted" from "the webview served a cached module".
    const CLIENT_TAG = '0.11.0-flow6'
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

    /** How far the flow is allowed to go. `off` is the same as switching it off. */
    const FLOW_QUALITIES = [
      { id: 'high', label: '高级', hint: '水面波纹 + 光学扭曲（真实感最强，最费 GPU）' },
      { id: 'medium', label: '中等', hint: '水面波纹，不做扭曲' },
      { id: 'low', label: '低', hint: '扁平高光，和 0.9 一样' },
      { id: 'off', label: '关', hint: '完全不画高光' },
    ]
    const FLOW_QUALITY_IDS = FLOW_QUALITIES.map((item) => item.id)

    const FLOW_SPEEDS = [
      { id: 'slow', label: '慢', hint: '6.4 秒一圈' },
      { id: 'normal', label: '标准', hint: '3.6 秒一圈' },
      { id: 'fast', label: '快', hint: '1.8 秒一圈' },
    ]
    const FLOW_SPEED_IDS = FLOW_SPEEDS.map((item) => item.id)
    const FLOW_DURATION = { slow: '6.4s', normal: '3.6s', fast: '1.8s' }

    /**
     * Declarations for the flowing highlight.
     *
     * `medium` and `high` both run the `#dsp-water` filter: turbulence displaces
     * the highlight's own pixels, so its edges wobble like a water surface being
     * dragged along. `high` adds a backdrop filter on top, which is the only CSS
     * hook that can bend what is *under* the highlight (the fill and the row
     * background behind it) instead of the highlight itself.
     */
    function flowDecls(look) {
      const source = look && typeof look === 'object' ? look : {}
      const quality = FLOW_QUALITY_IDS.includes(source.flowQuality) ? source.flowQuality : 'medium'
      const speed = FLOW_SPEED_IDS.includes(source.flowSpeed) ? source.flowSpeed : 'slow'
      if (source.flow === false || quality === 'off') return 'animation:none;opacity:0;'
      const decls = [`--dsp-flow-duration:${FLOW_DURATION[speed]};`]
      if (quality === 'medium' || quality === 'high') decls.push('filter:url(#dsp-water);')
      if (quality === 'high') decls.push('backdrop-filter:blur(1.6px) saturate(1.45) brightness(1.06);')
      return decls.join('')
    }

    /** Declarations for the selected style, with the selected colour baked in. */
    function styleRules(look) {
      const source = look && typeof look === 'object' ? look : {}
      const color = /^#[0-9a-f]{6}$/i.test(String(source.color || '')) ? source.color : '#90AFFF'
      const style = LOOK_IDS.includes(source.style) ? source.style : 'band'
      const pick = LOOK_STYLES.find((item) => item.id === style) || LOOK_STYLES[0]
      const soft = `rgba(${hexToRgb(color)},0.35)`
      const decls = [flowDecls(source)]
      // Most styles fill the row, so the flowing highlight (drawn by ::before
      // in BASE_CSS) is already the right shape. The 3px underline is the one
      // exception: a full-height sweep would hang above the line.
      if (pick.id === 'underline') decls.push('inset-block:auto 3px;height:3px;border-radius:2px;')
      return `[data-row-key^="session:"]::after{${pick.css(color, soft)}}[data-row-key^="session:"]::before{${decls.join('')}}`
    }

    /**
     * The water filter itself. Kept as real SVG because CSS cannot displace
     * pixels by noise: `filter: url(#dsp-water)` is the only way to get those
     * wobbly edges without drawing every frame in canvas.
     */
    const WATER_SVG = [
      '<defs><filter id="dsp-water" x="-25%" y="-25%" width="150%" height="150%"',
      ' color-interpolation-filters="sRGB">',
      // Wide, slow waves (low baseFrequency) with a big displacement: on a 32px
      // tall row a small scale is invisible, which is what the first attempt got.
      '<feTurbulence type="fractalNoise" baseFrequency="0.006 0.022" numOctaves="2" seed="7" result="warp"/>',
      '<feDisplacementMap in="SourceGraphic" in2="warp" scale="18" xChannelSelector="R" yChannelSelector="G"/>',
      '<feGaussianBlur stdDeviation="0.45"/>',
      '</filter></defs>',
    ].join('')

    function ensureWaterFilter() {
      if (typeof document === 'undefined') return null
      if (typeof document.createElementNS !== 'function') return null
      if (document.getElementById('dsp-water')) return null
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('id', 'dsp-water-defs')
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('data-plugin-css', 'dsh-session-progress-water')
      svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
      svg.innerHTML = WATER_SVG
      if (document.body) document.body.appendChild(svg)
      return svg
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
  z-index: -2;
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
/* A highlight that keeps travelling inside the filled part, so a band that has
   not moved for half a minute still looks alive. It rides on ::before rather
   than ::after because the fill already owns ::after; z-index -1 puts it over
   the fill (-2) and both stay under the row's text.

   The pattern is periodic and the animation shifts it by exactly one period, so
   the loop has no seam and no dead time: something is always crossing the band,
   regardless of how wide the band happens to be. */
[data-row-key^="session:"]::before {
  content: "";
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 100%;
  border-radius: inherit;
  z-index: -1;
  pointer-events: none;
  clip-path: inset(0 calc(100% - var(--dsp-p, 0%)) 0 0);
  /* A dark tail followed by a bright edge: the tail is what makes the sweep
     readable on a light fill like #90AFFF (white alone washes out), the edge is
     what makes it readable on a dark one. Period 122px along the 100deg axis,
     i.e. 123.9px across the row -- the keyframes move by exactly that much. */
  background-image: repeating-linear-gradient(
    100deg,
    rgba(0, 0, 0, 0) 0px,
    rgba(0, 0, 0, 0.2) 44px,
    rgba(255, 255, 255, 0.95) 54px,
    rgba(255, 255, 255, 0) 64px,
    rgba(0, 0, 0, 0) 122px
  );
  background-repeat: repeat;
  /* duration comes from the look sheet so the speed setting can change it */
  animation: dsp-flow var(--dsp-flow-duration, 3.6s) linear infinite;
  /* the highlight fades in and out with the band, never on its own */
  opacity: var(--dsp-o, 0);
  transition:
    clip-path 900ms cubic-bezier(0.22, 0.61, 0.36, 1),
    opacity 280ms ease;
}
@keyframes dsp-flow {
  from {
    background-position: 0 0;
  }
  to {
    background-position: 123.9px 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-row-key^="session:"]::after {
    transition: none;
  }
  [data-row-key^="session:"]::before {
    animation: none;
    transition: none;
    opacity: 0;
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
/* One sample is one line. The bordered box, the eight-field meta row that
   wrapped onto three lines and the raw JSON under every sample were most of the
   noise: the technical detail now lives one click away. */
.dsp-row {
  display: flex;
  flex-direction: column;
}
.dsp-row + .dsp-row {
  border-top: 1px solid rgba(128, 128, 128, 0.12);
}
.dsp-row-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 4px 5px;
  border: none;
  border-radius: 5px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsp-row-line:hover {
  background: rgba(128, 128, 128, 0.1);
}
.dsp-row-time {
  flex: none;
  width: 56px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, #888);
  font-variant-numeric: tabular-nums;
}
.dsp-row-p {
  flex: none;
  width: 34px;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  font-weight: 700;
  color: var(--dsw-alias-label-primary, #fff);
  font-variant-numeric: tabular-nums;
}
.dsp-row-p.bad {
  color: #ff8080;
}
.dsp-row-delta {
  flex: none;
  width: 26px;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.dsp-row-delta.up {
  color: rgb(126, 202, 158);
}
.dsp-row-delta.down {
  color: rgb(255, 168, 120);
}
.dsp-row-note {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsp-row.failed .dsp-row-note {
  color: #ff8080;
}
.dsp-row-ms {
  flex: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, #888);
  font-variant-numeric: tabular-nums;
}
.dsp-row-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 5px 6px;
  padding: 6px 8px;
  border-left: 2px solid rgba(144, 175, 255, 0.45);
  border-radius: 0 6px 6px 0;
  background: rgba(128, 128, 128, 0.08);
}
.dsp-detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, #888);
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
.dsp-sub-group {
  white-space: nowrap;
}
.dsp-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.dsp-switch input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--dsw-alias-accent, #90AFFF);
  cursor: pointer;
}
.dsp-hint {
  color: var(--dsw-alias-label-tertiary, #888);
  font-size: 11px;
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
  gap: 2px;
  padding: 6px 6px 8px;
}
/* A column body is a flex container with a definite height once the panel gives
   it one, so its children shrink to fit instead of overflowing -- which means
   the history column silently squashed twelve turns into 39px each and never
   grew a scrollbar. Nothing in a column may shrink. */
.dsp-column-body > *,
.dsp-seg-body > * {
  flex: none;
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
  gap: 2px;
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
.dsp-delta {
  padding: 0 5px;
  border-radius: 999px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.dsp-delta.up {
  color: rgb(126, 202, 158);
  background: rgba(126, 202, 158, 0.14);
}
.dsp-delta.down {
  color: rgb(255, 168, 120);
  background: rgba(255, 168, 120, 0.14);
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
        fetch(`${CONFIG_PATH}?client=${CLIENT_TAG}`, { cache: 'no-store' })
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
        const query = `limit=${logStore.limit || 80}${logStore.version ? `&since=${logStore.version}` : ''}&client=${CLIENT_TAG}`
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

    /**
     * The panel header used to be six loose spans that wrapped onto two ragged
     * lines. Three short groups read as one sentence instead.
     */
    function metaLine(data, error) {
      const config = (data && data.config) || {}
      const model = `${config.provider || '—'}/${config.model || '—'}`
      const effort = (data && data.effort) || config.reasoningEffort || '—'
      const interval = Math.round((Number(config.intervalMs) || 30000) / 1000)
      const total = (data && data.total) || 0
      const historyTotal = (data && data.historyTotal) || 0
      const interrupted = (data && data.interruptedTotal) || 0
      return h(
        'div',
        { className: 'dsp-panel-sub' },
        h('span', { className: 'dsp-sub-group' }, `${model} · 强度 ${effort} · 每 ${interval} 秒`),
        h(
          'span',
          { className: 'dsp-sub-group' },
          `本轮 ${total} 次 · 历史 ${historyTotal}${
            interrupted > 0 ? `（中断 ${interrupted}）` : ''
          }`,
        ),
        h(
          'span',
          { className: 'dsp-sub-group dsp-tokens', title: '判断模型累计消耗的 token' },
          `${formatTokens(data && data.tokens && data.tokens.total)} tok`,
        ),
        error ? h('span', { className: 'dsp-sub-group dsp-error' }, `读取失败：${error}`) : null,
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

    /**
     * One sample, collapsed to a single line. Clicking it opens the technical
     * detail: model, effort, token split and the model's raw answer. The raw
     * answer used to be printed under every row, which is what made the log
     * read as a wall of JSON.
     */
    function LogRow(props) {
      const entry = props.entry
      const [open, setOpen] = React.useState(false)
      const failed = Boolean(entry.error)
      const before = Number(entry.prev)
      const now = Number(entry.p)
      const hasDelta =
        Number.isFinite(before) &&
        Number.isFinite(now) &&
        entry.prev !== undefined &&
        entry.p !== null &&
        now !== before
      const delta = hasDelta ? now - before : 0
      const seconds = Math.round((Number(entry.ms) || 0) / 100) / 10
      const tokens = entry.tokens
      return h(
        'div',
        { className: `dsp-row${failed ? ' failed' : ''}` },
        h(
          'button',
          {
            type: 'button',
            className: 'dsp-row-line',
            onClick: () => setOpen((value) => !value),
            title: failed ? String(entry.error) : String(entry.note || ''),
            'aria-expanded': open ? 'true' : 'false',
          },
          h('span', { className: 'dsp-row-time' }, clockOf(entry.at)),
          h(
            'span',
            { className: `dsp-row-p${failed ? ' bad' : ''}` },
            entry.p === null || entry.p === undefined ? '—' : `${entry.p}%`,
          ),
          h(
            'span',
            { className: `dsp-row-delta ${delta > 0 ? 'up' : 'down'}` },
            hasDelta ? (delta > 0 ? `+${delta}` : `${delta}`) : '',
          ),
          h(
            'span',
            { className: 'dsp-row-note' },
            failed ? `失败：${entry.error}` : entry.note || '（没写阶段名）',
          ),
          entry.revised ? h('span', { className: 'dsp-revised' }, '重估') : null,
          h('span', { className: 'dsp-row-ms' }, `${seconds}s`),
        ),
        open
          ? h(
              'div',
              { className: 'dsp-row-detail' },
              h(
                'div',
                { className: 'dsp-detail-meta' },
                h('span', null, entry.model || '—'),
                h('span', null, `强度 ${entry.effort || '—'}`),
                tokens
                  ? h(
                      'span',
                      null,
                      `${formatTokens(tokens.input)} in / ${formatTokens(tokens.output)} out / ${formatTokens(
                        tokens.cacheRead,
                      )} cache`,
                    )
                  : null,
                entry.revised ? h('span', null, '插嘴后重估') : null,
              ),
              h('pre', { className: 'dsp-raw' }, entry.raw ? entry.raw : '（空输出）'),
            )
          : null,
      )
    }

    function renderEntry(entry, index) {
      return h(LogRow, { key: `${entry.at}:${index}`, entry })
    }

    /**
     * Who wins when the host re-broadcasts its saved look while the settings
     * card is previewing an unsaved one? The draft does, until it is committed.
     *
     * `source` is 'preview' (settings card) or 'server' (SSE frame, initial
     * config). Pure, so the policy can be tested without a browser.
     */
    function routeLook(state, incoming, source) {
      // Only carry the flow keys the caller actually sent: an older frame
      // without them must not look different from an identical newer one.
      const candidate = {
        color: incoming.color,
        opacity: incoming.opacity,
        style: incoming.style,
      }
      for (const key of ['flow', 'flowSpeed', 'flowQuality']) {
        if (incoming[key] !== undefined) candidate[key] = incoming[key]
      }
      const same = (a, b) =>
        !!a &&
        !!b &&
        String(a.color) === String(b.color) &&
        Number(a.opacity) === Number(b.opacity) &&
        String(a.style) === String(b.style) &&
        (a.flow === undefined || b.flow === undefined || Boolean(a.flow) === Boolean(b.flow)) &&
        (a.flowSpeed === undefined || b.flowSpeed === undefined || String(a.flowSpeed) === String(b.flowSpeed)) &&
        (a.flowQuality === undefined ||
          b.flowQuality === undefined ||
          String(a.flowQuality) === String(b.flowQuality))

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
          flow: config.flow !== false,
          flowSpeed: config.flowSpeed || 'slow',
          flowQuality: config.flowQuality || 'medium',
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
        config.flow,
        config.flowSpeed,
        config.flowQuality,
      ])

      const current = draft || {
        seconds: Math.round((Number(config.intervalMs) || 30000) / 1000),
        provider: config.provider || '',
        model: config.model || '',
        effort: config.reasoningEffort || '',
        color: config.color || '#90AFFF',
        opacity: Number(config.opacity) || 0.6,
        style: config.style || 'band',
        flow: config.flow !== false,
        flowSpeed: config.flowSpeed || 'slow',
        flowQuality: config.flowQuality || 'medium',
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
          flow: current.flow !== false,
          flowSpeed: current.flowSpeed,
          flowQuality: current.flowQuality,
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
            '流动动画',
            h(
              'div',
              { className: 'dsp-inline dsp-inline-wrap' },
              h(
                'label',
                { className: 'dsp-switch' },
                h('input', {
                  type: 'checkbox',
                  checked: current.flow !== false,
                  onChange: (event) => {
                    const next = { ...current, flow: event.target.checked }
                    setDraft(next)
                    api.preview(next)
                  },
                }),
                h('span', null, current.flow === false ? '已关闭' : '开启'),
              ),
              h(
                'span',
                { className: 'dsp-hint' },
                `质量：${(FLOW_QUALITIES.find((item) => item.id === current.flowQuality) || FLOW_QUALITIES[1]).label}`,
              ),
            ),
          ),
          field(
            '动画速率',
            h(
              'div',
              { className: 'dsp-inline dsp-inline-wrap' },
              h(
                'select',
                {
                  className: 'dsp-input',
                  value: current.flowSpeed || 'slow',
                  onChange: (event) => {
                    const next = { ...current, flowSpeed: event.target.value }
                    setDraft(next)
                    api.preview(next)
                  },
                },
                FLOW_SPEEDS.map((item) =>
                  h('option', { key: item.id, value: item.id }, `${item.label} — ${item.hint}`),
                ),
              ),
            ),
          ),
          field(
            '动画质量',
            h(
              'div',
              { className: 'dsp-inline dsp-inline-wrap' },
              h(
                'select',
                {
                  className: 'dsp-input',
                  value: current.flowQuality || 'medium',
                  onChange: (event) => {
                    const next = { ...current, flowQuality: event.target.value }
                    setDraft(next)
                    api.preview(next)
                  },
                },
                FLOW_QUALITIES.map((item) =>
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
        // The water filter is a real <svg><filter>; `filter: url(#dsp-water)`
        // on the highlight is what wobbles its edges.
        const water = ensureWaterFilter()
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
        source = new EventSource(`${EVENTS_PATH}?client=${CLIENT_TAG}`)
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
              water?.remove()
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
