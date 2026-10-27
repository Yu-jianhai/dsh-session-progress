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
    const CLIENT_TAG = '0.22.3-pill1'
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
      /** Switch the layout to our rail panel. Returns '' on success. Filled in by `apply`. */
      openPanel: () => '',
    }

    /** Open the log page from inside the settings card; '' means it worked. */
    function openLogPanel() {
      return api.openPanel()
    }

    // #region look
    // ---------------------------------------------------------------------------
    // The band is two layers and one stylesheet.
    //
    //   ::after   the FILL — how much of the row the progress covers. Its shape
    //             comes from LOOK_STYLES, its colour from the setting.
    //   ::before  the SURFACE — what sits on the fill and moves. Its behaviour
    //             comes entirely from the SURFACES table below.
    //
    // A surface declares *capabilities*, not CSS: `water` (the layer's own
    // pixels get displaced), `glass` (it carries a backdrop filter, i.e. it can
    // bend what is underneath).
    // Adding a look means adding one row to that table; nothing else knows ids.
    //
    // Both layers are driven by the same `--dsp-p` with the same width
    // transition. That is the load-bearing part: an earlier version clipped the
    // surface with `clip-path` while the fill animated `width`, the two
    // interpolations sampled at different moments, and the surface visibly
    // jumped the instant a new number landed.
    // ---------------------------------------------------------------------------
    /**
     * The six strip shapes, as data: every style is a geometry plus a paint
     * recipe, and one builder turns a recipe into declarations. Adding a style
     * means adding a row here, not writing another concatenated CSS string.
     *
     *   inset       block inset: `0` fills the row, `auto 3px` hangs a rule
     *   radius      border radius (inherit keeps the pill)
     *   height      fixed height, when the shape is not the full row
     *   segments    paint as N equal cells (.segments clips by progress)
     *   paint       gradient recipe: 'fade' | 'flat' | 'glow' | 'stripes'
     */
    /**
     * Panel skins. `apple` groups each session into a card with a tinted header
     * block (the colour is the session's hue), `classic` is the pre-0.21 dense
     * list. The band on the sidebar is identical in both — only the log panel
     * changes, which is what people actually asked to prettify.
     */
    const PANEL_STYLES = [
      { id: 'apple', label: '新 · 分组卡片' },
      { id: 'classic', label: '旧 · 紧凑列表' },
    ]

    const LOOK_STYLES = [
      {
        id: 'band',
        label: '渐变横幅',
        hint: '整行填充，右端 10px 渐隐（默认）',
        spec: { paint: 'fade', fadeFrom: 'calc(100% - 10px)' },
      },
      {
        id: 'solid',
        label: '纯色实条',
        hint: '整行纯色，右端一条 1px 亮边',
        spec: { paint: 'flat', edge: 'inset -1px 0 0 rgba(255,255,255,0.55)' },
      },
      {
        id: 'underline',
        label: '底部细线',
        hint: '3px 细线贴底，完全不遮文字',
        spec: { paint: 'flat', inset: 'auto 3px', height: '3px', radius: '2px' },
      },
      {
        id: 'stripe',
        label: '斜纹',
        hint: '45° 斜纹填充，像施工条',
        spec: { paint: 'stripes', angle: 45, size: 10 },
      },
      {
        id: 'glow',
        label: '流光',
        hint: '右端一道亮边 + 内侧柔光',
        spec: {
          paint: 'glow',
          edge: 'inset -2px 0 0 rgba(255,255,255,0.85), inset -18px 0 14px -12px rgba(255,255,255,0.95)',
        },
      },
      {
        id: 'segments',
        label: '分段',
        hint: '5 段等宽格子，一格一格往前走',
        spec: { paint: 'stripes', angle: 90, size: 20, clip: true, fullWidth: true },
      },
    ]

    const LOOK_IDS = LOOK_STYLES.map((style) => style.id)

    /** Turn a style spec into declarations for the fill layer. */
    function styleCss(spec, color, soft) {
      const shape = spec.inset ? `inset-block:${spec.inset};` : 'inset-block:0;'
      const width = spec.fullWidth ? 'width:100%;' : 'width:var(--dsp-p,0%);'
      const radius = `border-radius:${spec.radius || 'inherit'};`
      const height = spec.height ? `height:${spec.height};` : ''
      const clip = spec.clip ? 'clip-path:inset(0 calc(100% - var(--dsp-p,0%)) 0 0);' : ''
      const edge = spec.edge ? `box-shadow:${spec.edge};` : ''

      let paint
      if (spec.paint === 'flat') {
        paint = `background:${color};`
      } else if (spec.paint === 'glow') {
        paint = `background:linear-gradient(90deg,${soft} 0%,${color} 62%,${color} 100%);`
      } else if (spec.paint === 'stripes') {
        const cell = spec.size || 10
        // Segments are painted as N cells and clipped by progress; the plain
        // stripe tiles the whole band instead.
        paint = spec.clip
          ? `background:repeating-linear-gradient(${spec.angle}deg,${color} 0 calc(${cell}% - 3px),rgba(0,0,0,0) calc(${cell}% - 3px) ${cell}%);`
          : `background-color:${color};background-image:repeating-linear-gradient(${spec.angle}deg,rgba(255,255,255,0.28) 0 5px,rgba(255,255,255,0) 5px 10px);`
      } else {
        paint = `background:linear-gradient(90deg,${color} 0%,${color} ${spec.fadeFrom || 'calc(100% - 10px)'},${soft} 100%);`
      }
      return shape + 'inset-inline-start:0;' + width + radius + height + clip + paint + edge
    }

    /**
     * Accept what a colour input actually hands back.
     *
     * `input[type=color]` is supposed to give `#rrggbb`, but the eyedropper in
     * the OS picker (and some WebView builds) can return `rgb(...)`/`rgba(...)`
     * or shorthand `#abc`. Anything unparseable returns null so callers keep the
     * previous colour instead of silently painting a fallback.
     */
    function normalizeHex(raw) {
      const text = String(raw == null ? '' : raw).trim().toLowerCase()
      const short = /^#([0-9a-f]{3})$/.exec(text)
      if (short) {
        const parts = short[1].split('')
        return `#${parts[0]}${parts[0]}${parts[1]}${parts[1]}${parts[2]}${parts[2]}`.toUpperCase()
      }
      const hex = /^#([0-9a-f]{6})$/.exec(text)
      if (hex) return `#${hex[1]}`.toUpperCase()
      const rgb = /^rgba?\(\s*([0-9.]+%?)[\s,]+([0-9.]+%?)[\s,]+([0-9.]+%?)/.exec(text)
      if (!rgb) return null
      const channel = (value) => {
        const number = parseFloat(value)
        if (!Number.isFinite(number)) return null
        const scaled = value.endsWith('%') ? (number / 100) * 255 : number
        return Math.max(0, Math.min(255, Math.round(scaled)))
      }
      const parts = [channel(rgb[1]), channel(rgb[2]), channel(rgb[3])]
      if (parts.some((part) => part === null)) return null
      return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
    }

    function hexToRgb(color) {
      const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(color || ''))
      if (!match) return '144,175,255'
      return [match[1], match[2], match[3]].map((part) => parseInt(part, 16)).join(',')
    }

    /**
     * Every surface the band can wear, cheapest first.
     *
     *   motion  there is a moving layer at all
     *   water   the layer's own pixels run through `#dsp-water`
     *   glass   the layer carries a backdrop filter (it bends what is under it)
     *   tint    how much colour the surface itself lays down (0–1)
     *   strong  use the high-contrast streak instead of the light one
     *   cross   two bands drift in opposite directions instead of one sweep
     *   emboss  the fill gets a lit top edge and a shaded bottom edge
     *
     * `refract` is the experimental tier: a light band and a shade band travel
     * in opposite directions under a glassy embossed edge, so the surface looks
     * like it is flowing rather than like the progress just moved. It stays
     * *under* the text on purpose -- an earlier version glued a film on top and
     * smeared the title.
     */
    const SURFACES = {
      off: {
        label: '关',
        hint: '不画水层',
        motion: 'none',
      },
      low: {
        label: '低 · 扁平',
        hint: '一层平滑扫光，不动下面的内容',
        motion: 'drift',
        pattern: 'sweep',
      },
      medium: {
        label: '中等 · 水波',
        hint: '水层自己带波纹，边缘会摆',
        motion: 'drift',
        pattern: 'sweep',
        water: true,
      },
      high: {
        label: '高级 · 水波 + 光学',
        hint: '在水波上再加一层背景柔化提亮',
        motion: 'drift',
        pattern: 'sweep',
        water: true,
        glass: true,
      },
      refract: {
        label: '实验 · 流光',
        hint: '一亮一暗两道带相向而行，玻璃浮雕边，不动文字',
        motion: 'cross',
        pattern: 'cross',
        emboss: true,
        blur: 'blur(1.5px) saturate(1.06)',
      },
    }

    /**
     * Set to false when the SVG filters could not be created. Every `filter:`
     * / `backdrop-filter:` reference is then dropped: a `url(#…)` pointing at
     * nothing makes Chromium skip painting the element entirely, so the band
     * would vanish instead of merely losing its texture.
     */
    let filtersReady = true

    /** Rows for the settings dropdown, in the order people should see them. */
    const FLOW_QUALITIES = ['refract', 'high', 'medium', 'low', 'off'].map((id) => ({
      id,
      label: SURFACES[id].label,
      hint: SURFACES[id].hint,
    }))
    const FLOW_QUALITY_IDS = FLOW_QUALITIES.map((item) => item.id)

    const FLOW_SPEEDS = [
      { id: 'slow', label: '慢', hint: '10.5 秒一圈' },
      { id: 'normal', label: '标准', hint: '5.9 秒一圈' },
      { id: 'fast', label: '快', hint: '3 秒一圈' },
    ]
    const FLOW_SPEED_IDS = FLOW_SPEEDS.map((item) => item.id)
    const FLOW_DURATION = { slow: '10.5s', normal: '5.9s', fast: '3s' }

    // One axis, one period, one travel. Everything that moves is built from
    // these three numbers, so a tier can never drift out of phase with another.
    //
    // The pattern runs along a 100deg axis, which advances sin(100deg) = 0.9848
    // of the row's x axis: one period of 264px along that axis is 268.073px
    // across the row. Shifting the pattern by exactly that distance puts every
    // layer back where it started, so the loop has no seam and no dead frame.
    const AXIS_DEG = 100
    const PERIOD = 264
    const TRAVEL = PERIOD / Math.sin((AXIS_DEG * Math.PI) / 180)
    const TRAVEL_PX = `${TRAVEL.toFixed(3)}px`
    const HALF = PERIOD / 2

    const gradient = (stops) => `repeating-linear-gradient(${AXIS_DEG}deg,${stops.join(',')})`

    // The ordinary sweep: a dark tail and a bright edge, so it reads on a light
    // fill as well as on a dark one.
    const SWEEP_THIN = gradient([
      'rgba(0,0,0,0) 0px',
      'rgba(0,0,0,0.16) 46px',
      'rgba(255,255,255,0.92) 56px',
      'rgba(255,255,255,0) 64px',
      `rgba(0,0,0,0) ${HALF}px`,
    ])
    // A second, slower layer so the band is not just one line crawling along.
    const SWEEP_SWELL = gradient([
      'rgba(255,255,255,0) 0px',
      'rgba(255,255,255,0.10) 96px',
      'rgba(132,170,255,0.12) 168px',
      `rgba(255,255,255,0) ${PERIOD}px`,
    ])
    // The experimental tier: a light band and a shade band that cross each
    // other, which is what makes the surface look like it is flowing rather
    // than like a highlight passing by.
    const CROSS_LIGHT = gradient([
      'rgba(255,255,255,0) 0px',
      'rgba(255,255,255,0.55) 34px',
      'rgba(255,255,255,0) 92px',
      `rgba(255,255,255,0) ${PERIOD}px`,
    ])
    const CROSS_SHADE = gradient([
      'rgba(0,0,0,0) 0px',
      'rgba(0,0,0,0.3) 44px',
      'rgba(0,0,0,0) 104px',
      `rgba(0,0,0,0) ${PERIOD}px`,
    ])

    /**
     * Experimental colour: the fill itself is a rainbow that walks.
     *
     * Same trick as the surfaces — a repeating gradient whose period is an exact
     * multiple of one travel — so the seam is never visible whichever width the
     * fill happens to be at.
     */
    const RAINBOW_PERIOD = 168
    const RAINBOW_TRAVEL = `${(RAINBOW_PERIOD / Math.sin((AXIS_DEG * Math.PI) / 180)).toFixed(3)}px`
    // Evenly spaced stops instead of hard 24px bands: `repeating-linear-gradient`
    // interpolates between plain colour stops, so the hues melt into each other
    // and the first/last stop being the same colour closes the loop with no seam.
    const RAINBOW_HUES = ['#ff5f6d', '#ffa14f', '#ffe066', '#7ee8a2', '#5fc8ff', '#a78bff', '#ff8ad4']
    const RAINBOW =
      `repeating-linear-gradient(${AXIS_DEG}deg,` +
      RAINBOW_HUES.map(
        (hue, index) => `${hue} ${((index * RAINBOW_PERIOD) / RAINBOW_HUES.length).toFixed(1)}px`,
      ).join(',') +
      `,#ff5f6d ${RAINBOW_PERIOD}px)`

    /** How a surface moves, one keyframes set per direction pattern. */
    const MOTIONS = {
      drift: {
        name: 'dsp-drift',
        note: 'both layers travel forward together',
        keyframes:
          '@keyframes dsp-drift{from{background-position:0 0,0 0}' +
          `to{background-position:${TRAVEL_PX} 0,${TRAVEL_PX} 0}}`,
      },
      cross: {
        name: 'dsp-cross',
        note: 'light travels forward, shade travels back',
        keyframes:
          '@keyframes dsp-cross{from{background-position:0 0,0 0}' +
          `to{background-position:${TRAVEL_PX} 0,-${TRAVEL_PX} 0}}`,
      },
    }
    const MOTION_CSS =
      Object.values(MOTIONS)
        .map((motion) => motion.keyframes)
        .join('') +
      `@keyframes dsp-rainbow{from{background-position:0 0}to{background-position:${RAINBOW_TRAVEL} 0}}`

    /** Which gradients a surface paints, in layer order. */
    const PATTERNS = {
      sweep: [SWEEP_THIN, SWEEP_SWELL],
      cross: [CROSS_LIGHT, CROSS_SHADE],
    }

    /**
     * Declarations for the surface layer only (colour-independent).
     *
     * Everything about how it moves and what it can distort lives here, so the
     * fill layer never has to know which surface is active. When the browser
     * cannot build the SVG filters, `filtersReady` is false and every
     * `filter:` / `backdrop-filter:` reference is dropped: pointing at a filter
     * that does not exist makes the browser skip painting the element, which
     * looks exactly like "the band disappeared".
     */
    function flowDecls(look) {
      const source = look && typeof look === 'object' ? look : {}
      const quality = FLOW_QUALITY_IDS.includes(source.flowQuality) ? source.flowQuality : 'medium'
      const speed = FLOW_SPEED_IDS.includes(source.flowSpeed) ? source.flowSpeed : 'slow'
      const surface = SURFACES[quality]
      // Switching the layer off is a decision about the surface, not about the
      // band: the fill keeps its colour, only the moving film disappears.
      if (source.flow === false || !surface.motion || surface.motion === 'none') {
        return 'animation:none;opacity:0;'
      }

      const pattern = PATTERNS[surface.pattern] || PATTERNS.sweep
      const decls = [
        `--dsp-flow-duration:${FLOW_DURATION[speed]};`,
        `background-image:${pattern.join(',')};`,
        `animation:${MOTIONS[surface.motion].name} var(--dsp-flow-duration, 10.5s) linear infinite;`,
      ]
      if (surface.blur) decls.push(`filter:${surface.blur};`)
      if (!filtersReady) return decls.join('')

      if (surface.water) decls.push('filter:url(#dsp-water);')
      if (surface.glass) {
        // `backdrop-filter` is the only CSS hook that can bend what is *under*
        // a layer; on the band that means the row's own background.
        decls.push('backdrop-filter:blur(1.6px) saturate(1.45) brightness(1.06);')
      }
      return decls.join('')
    }

    /**
     * The whole sheet: the generated keyframes plus the two rule blocks. Only
     * this one is written into the `<style>` element, so the keyframes always
     * match the gradients the rules just built.
     */
    function sheetCss(look) {
      return MOTION_CSS + styleRules(look)
    }

    /** Declarations for both layers, with the selected colour baked in. */
    function styleRules(look) {
      // The keyframes are generated from TRAVEL, so they can never disagree
      // with the gradient stops above.

      const source = look && typeof look === 'object' ? look : {}
      const color = /^#[0-9a-f]{6}$/i.test(String(source.color || '')) ? source.color : '#90AFFF'
      const style = LOOK_IDS.includes(source.style) ? source.style : 'band'
      const quality = FLOW_QUALITY_IDS.includes(source.flowQuality) ? source.flowQuality : 'medium'
      const pick = LOOK_STYLES.find((item) => item.id === style) || LOOK_STYLES[0]
      const surface = SURFACES[quality]
      const soft = `rgba(${hexToRgb(color)},0.35)`

      const fill = [styleCss(pick.spec, color, soft)]
      // Glass looked at from the front: a lit top edge and a shaded bottom edge
      // are what make a flat rectangle read as a raised pane.
      if (surface.emboss) {
        fill.push(
          'box-shadow:inset 1px -1px 1px -0.5px rgba(255,255,255,0.75),' +
            'inset -1px 1px 1px -0.5px rgba(0,0,0,0.35),' +
            'inset 0 0 10px rgba(255,255,255,0.14);',
        )
      }
      // A surface that paints under the text gets its glassiness on the fill
      // layer instead — the surface layer is too thin to read as glass there.
      if (surface.glass && filtersReady) {
        fill.push('backdrop-filter:blur(1.6px) saturate(1.45) brightness(1.06);')
      }

      if (source.rainbow === true) {
        // The fill keeps its shape (width/radius/clip from the style) and swaps
        // only its paint. `flow: false` leaves a still rainbow rather than a
        // moving one — the switch turns off motion, not colour.
        fill.push(`background:${RAINBOW};`)
        // A 12% black scrim keeps the row's own text readable over the bright
        // stops (yellow/green are the worst) without dulling the hues.
        fill.push('box-shadow:inset 0 0 0 100px rgba(0,0,0,0.12);')
        if (source.flow !== false) {
          const beat = { slow: '7s', normal: '4.4s', fast: '2.6s' }[source.flowSpeed] || '4.4s'
          fill.push(`animation:dsp-rainbow ${beat} linear infinite;`)
        }
      }


      const layer = [flowDecls(source)]

      // Bloom. The surface is otherwise the moving highlight; with the rainbow
      // on it becomes a blurred copy of the same, travelling on the same beat,
      // so the light looks like it is coming out of the colour instead of
      // sitting on top of it. It stays clipped to the band, so nothing spills.
      if (source.rainbow === true) {
        layer.push(`background-image:${RAINBOW};`)
        // Screen keeps the bloom as *light* on top of the hues; plain alpha would
        // milk the band out to pastel. The opacity override is deliberate: the
        // surface's usual `var(--dsp-o)` is tuned for a white sheen, not a wash.
        layer.push('filter:blur(6px) saturate(1.35);')
        layer.push('mix-blend-mode:screen;opacity:0.45;')
        if (source.flow !== false) {
          const glowBeat = { slow: '7s', normal: '4.4s', fast: '2.6s' }[source.flowSpeed] || '4.4s'
          layer.push(`animation:dsp-rainbow ${glowBeat} linear infinite;`)
        }
      }
      if (surface.tint > 0) layer.push(`background-color:rgba(${hexToRgb(color)},${surface.tint});`)
      // A 3px underline must not get a full-height film lying on top of it, and
      // its clip has to follow that shorter shape or the sweep would be cut off.
      if (pick.id === 'underline') {
        layer.push('inset-block:auto 3px;height:3px;border-radius:2px;clip-path:inset(0 round 2px);')
      }

      return `[data-row-key^="session:"]::after{${fill.join('')}}[data-row-key^="session:"]::before{${layer.join('')}}`
    }

    /**
     * The filters themselves. Kept as real SVG because CSS cannot displace
     * pixels by noise: `filter: url(#dsp-water)` is the only way to get those
     * wobbly edges without drawing every frame in canvas.
     *
     * `#dsp-water` is the only filter left: it wobbles the layer it is applied
     * to. The experimental tier used to bend the row's text through a second
     * filter; it now circulates a conic light instead, which needs no filter.
     */
    const WATER_SVG = [
      '<defs><filter id="dsp-water" x="-25%" y="-25%" width="150%" height="150%"',
      ' color-interpolation-filters="sRGB">',
      // Wide, slow waves (low baseFrequency) with a big displacement: on a 32px
      // tall row a small scale is invisible, which is what the first attempt got.
      '<feTurbulence type="fractalNoise" baseFrequency="0.006 0.022" numOctaves="2" seed="7" result="warp"/>',
      '<feDisplacementMap in="SourceGraphic" in2="warp" scale="18" xChannelSelector="R" yChannelSelector="G"/>',
      '<feGaussianBlur stdDeviation="0.45"/>',
      '</filter>',
      '</defs>',
    ].join('')

    /**
     * Create the `<svg>` that hosts the filters, once per page. Returns null on
     * browsers where any step is unavailable, and the caller then clears
     * `filtersReady` so no rule ever references a missing filter.
     */
    function ensureWaterFilter() {
      const existing = document.getElementById('dsp-water-defs')
      if (existing) return existing
      if (typeof document.createElementNS !== 'function') return null
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
  /* One clock for the whole band: the fill and the film animate the same
     property with the same easing, so they can never slide out of step. */
  --dsp-progress-ms: 900ms;
  --dsp-progress-ease: cubic-bezier(0.22, 0.61, 0.36, 1);
  --dsp-fade-ms: 280ms;
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
    width var(--dsp-progress-ms) var(--dsp-progress-ease),
    opacity var(--dsp-fade-ms) ease;
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
  /* Bounded by its own width instead of by a clip-path. Both pseudo-elements
     then animate the same property with the same easing, so the highlight can
     never lag behind the fill -- that lag is what looked like the sweep
     teleporting when a new sample landed. border-radius clips the pattern at
     the rounded end by itself, so the square-corner bug from 0.11.0 cannot
     come back either. */
  width: var(--dsp-p, 0%);
  border-radius: inherit;
  /* A filter may paint outside the border box: the water filter displaces
     pixels, and that displacement is bounded by neither width nor
     border-radius, so the sweep used to halo past the pill. clip-path is the
     only thing that clips a filter's output. The shape never animates, so this
     cannot reintroduce the width/clip desync of 0.11.0. */
  clip-path: inset(0 round var(--dsw-radius-md, 8px));
  z-index: -1;
  pointer-events: none;
  /* The pattern itself lives in the look sheet's flowDecls(), because which
     pattern it is -- flat, water, or the experimental film -- is a property of
     the selected surface, not of the layout. Only the plumbing stays here. */
  background-repeat: repeat;
  background-size: auto;
  /* Name and duration come from the look sheet: which motion a surface uses is
     a property of that surface, and the speed setting only changes the clock. */
  animation: none;
  /* Rows announce themselves through IntersectionObserver: only what can be
     seen keeps animating. A sidebar keeps dozens of rows mounted; animating
     all of them to show one is pure waste. */
  animation-play-state: paused;
  /* the highlight fades in and out with the band, never on its own */
  opacity: var(--dsp-o, 0);
  transition:
    width var(--dsp-progress-ms) var(--dsp-progress-ease),
    opacity var(--dsp-fade-ms) ease;
}
[data-row-key^="session:"].dsp-live::before {
  animation-play-state: running;
}
/* Nothing on screen, nothing to animate. */
html[data-dsp-hidden] [data-row-key^="session:"]::before {
  animation-play-state: paused;
}
@media (prefers-reduced-motion: reduce) {
  .dsp-panel,
  .dsp-row-detail,
  .dsp-spark polyline {
    animation: none;
  }
  .dsp-row-line,
  .dsp-row-caret,
  .dsp-btn,
  .dsp-gutter,
  .dsp-column-head {
    transition: none;
  }
  [data-row-key^="session:"]::after {
    transition: none;
    animation: none;
  }
  [data-row-key^="session:"]::before {
    animation: none;
    transition: none;
    opacity: 0;
  }
}
.dsp-loglink { gap: 6px; }
.dsp-loglink-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsp-loglink-body {
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary, #9aa0a8);
}
.dsp-loglink-inline {
  margin-top: 10px;
  border-top: 1px solid rgba(128, 128, 128, 0.18);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dsp-loglink-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
  min-width: 0;
}
.dsp-loglink-time {
  color: var(--dsw-alias-label-tertiary, #888);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  flex: none;
}
.dsp-loglink-p {
  color: var(--dsw-alias-label-primary, inherit);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  flex: none;
  width: 34px;
  text-align: right;
}
.dsp-loglink-note {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, #aaa);
}
.dsp-loglink-error {
  margin-top: 8px;
  color: rgb(255, 138, 138);
}
.dsp-loglink-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
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
  gap: 10px;
  width: 100%;
  margin: 0;
  padding: 5px 6px;
  border: none;
  border-radius: 5px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 160ms cubic-bezier(0.22, 0.61, 0.36, 1), transform 140ms ease;
}
.dsp-row-line:hover {
  background: rgba(128, 128, 128, 0.1);
}
.dsp-row-time {
  flex: none;
  width: 58px;
  font-size: 11px;
  letter-spacing: 0.1px;
  color: var(--dsw-alias-label-tertiary, #888);
  font-variant-numeric: tabular-nums;
}
.dsp-row-p {
  flex: none;
  width: 38px;
  text-align: right;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.2px;
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
  font-size: 13px;
  line-height: 1.45;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsp-row.failed .dsp-row-note {
  color: #ff8080;
}
.dsp-row-ms {
  flex: none;
  width: 30px;
  text-align: right;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #888);
  font-variant-numeric: tabular-nums;
}
/* Motion: short, eased, and always interruptible — the panel repaints every
   3 seconds, so nothing may animate on a timer the reader did not start. */
@keyframes dsp-unfold {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes dsp-panel-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes dsp-draw {
  from {
    stroke-dashoffset: 240;
  }
  to {
    stroke-dashoffset: 0;
  }
}
.dsp-row-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 5px 6px;
  padding: 6px 8px;
  animation: dsp-unfold 240ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
  transform-origin: top center;
  border-left: 2px solid rgba(144, 175, 255, 0.45);
  border-radius: 0 6px 6px 0;
  background: rgba(128, 128, 128, 0.08);
}
.dsp-detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #888);
}
/* One column per session, left to right: the head names the session, the body
   scrolls its own samples, so several running sessions stay comparable. */
.dsp-columns {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 4px;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
}
.dsp-column {
  flex: 1 1 320px;
  min-width: 264px;
  max-width: 720px;
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
  /* Hug the rows instead of drawing empty boxes down the screen; a long column
     is still capped by max-height 100% below and scrolls on its own. */
  align-items: flex-start;
}
.dsp-panel-body > .dsp-columns > .dsp-column {
  max-height: 100%;
}
.dsp-column-head {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 10px 6px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.22);
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.1));
}
.dsp-column-head-top {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.dsp-column-head-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 15px;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, #888);
}
.dsp-column-time {
  margin-left: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
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

.dsp-spark polyline {
  animation: dsp-draw 620ms ease-out both;
}
.dsp-spark {
  flex: none;
  opacity: 0.85;
  overflow: visible;
}
.dsp-row-caret {
  flex: none;
  width: 9px;
  margin-left: -2px;
  font-size: 12px;
  line-height: 1;
  color: var(--dsw-alias-label-tertiary, #888);
  transition: transform 160ms ease;
  transform-origin: 50% 45%;
}
.dsp-row-caret.open {
  transform: rotate(90deg);
}
.dsp-row-line:hover .dsp-row-caret {
  color: var(--dsw-alias-label-primary, #fff);
}
.dsp-column-empty {
  padding: 16px 8px;
  text-align: center;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #888);
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
/* Small physical cues: buttons and cards respond to the pointer, then settle. */
.dsp-btn {
  transition: background 150ms cubic-bezier(0.22, 0.61, 0.36, 1), transform 120ms ease, border-color 150ms ease;
}
.dsp-btn:active {
  transform: scale(0.97);
}
.dsp-column-head {
  transition: background 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
.dsp-seg {
  transition: box-shadow 180ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
.dsp-seg-body > * {
  animation: dsp-unfold 200ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
/* ---- history column: closed and interrupted turns ---------------------- */
/* The history column holds the same rows as a session column — including the
   expanded detail — so it grows like one instead of being pinned to a rail. */
/* Drag handle between columns: a thin strip that lights up on hover. */
.dsp-gutter {
  flex: 0 0 8px;
  align-self: stretch;
  border-radius: 3px;
  cursor: col-resize;
  background: transparent;
  transition: background 140ms ease;
}
.dsp-gutter:hover,
.dsp-gutter:active {
  background: rgba(144, 175, 255, 0.45);
}
.dsp-history {
  flex: 1 1 360px;
  min-width: 300px;
  max-width: 640px;
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
  font-size: 13px;
  font-weight: 500;
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 0;
  border: none;
  background: none;
  color: var(--dsw-alias-label-secondary, #b8bec8);
  font-size: 12px;
  cursor: pointer;
  transition: color 150ms ease;
}
.dsp-seg-more:hover {
  color: var(--dsw-alias-label-primary, #e6e8eb);
}
.dsp-seg-caret {
  display: inline-block;
  font-size: 11px;
  line-height: 1;
  transform: rotate(0deg);
  transition: transform 180ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
.dsp-seg-caret.open {
  transform: rotate(90deg);
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
  font-size: 11.5px;
  line-height: 1.55;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(128, 128, 128, 0.1);
}
.dsp-panel {
  animation: dsp-panel-in 280ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
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
.dsp-refresh {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.dsp-btn-xs {
  height: 20px;
  padding: 0 8px;
  font-size: 11px;
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
.dsp-check {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--dsw-alias-accent, #90afff);
  cursor: pointer;
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

/* ── Panel skin: apple (0.21) ──────────────────────────────────────────
   Grouped layout, in the spirit of Apple's settings panels: one card per
   session, a tinted header block that carries the session's own hue, generous
   gutters, hairline separators and pill buttons. Only the log panel uses this;
   the sidebar band is untouched. Everything is opt-out via 面板样式 → 旧. */
.dsp-skin-apple {
  background: var(--dsw-alias-bg-base, #101114);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text",
    "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0;
}
.dsp-skin-apple .dsp-panel-head {
  padding: 20px 22px 14px;
  gap: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0));
}
.dsp-skin-apple .dsp-panel-title {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.015em;
}
.dsp-skin-apple .dsp-panel-sub {
  font-family: inherit;
  font-size: 12px;
  gap: 6px 14px;
  color: rgba(235, 235, 245, 0.55);
}
.dsp-skin-apple .dsp-panel-body {
  padding: 16px;
  gap: 16px;
}
.dsp-skin-apple .dsp-column {
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
  box-shadow: 0 14px 30px -26px rgba(0, 0, 0, 0.95);
}
.dsp-skin-apple .dsp-column-head {
  padding: 12px 16px 11px;
  gap: 6px;
  border-bottom: none;
  background: var(--dsp-tint, rgba(255, 255, 255, 0.05));
  border-radius: 18px 18px 0 0;
}
.dsp-skin-apple .dsp-column-head-top {
  gap: 8px;
}
.dsp-skin-apple .dsp-column-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
}
.dsp-skin-apple .dsp-column-head-sub {
  gap: 10px;
}
.dsp-skin-apple .dsp-column-stat {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.92);
}
.dsp-skin-apple .dsp-column-time {
  font-size: 11px;
  color: rgba(235, 235, 245, 0.5);
}
.dsp-skin-apple .dsp-column-body {
  /* The scrollbar only eats from the right, so anything centred in the content
     box sits ~4px left of the card's middle. Reserving both edges keeps the
     rows and the load-more pill on the card's own centreline. */
  scrollbar-gutter: stable both-edges;
  padding: 4px 6px 6px;
  gap: 0;
}
.dsp-skin-apple .dsp-row + .dsp-row {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
.dsp-skin-apple .dsp-row-line {
  /* 11px of padding was Apple's "comfortable" row for touch; a log list is
     scanned, not tapped, so it drops to 7px and fits three more rows. */
  padding: 7px 10px;
  gap: 10px;
  border-radius: 10px;
}
.dsp-skin-apple .dsp-row-line:hover {
  background: rgba(255, 255, 255, 0.06);
}
.dsp-skin-apple .dsp-row-time {
  width: 62px;
  font-size: 11px;
  color: rgba(235, 235, 245, 0.5);
}
.dsp-skin-apple .dsp-row-p {
  width: 42px;
  font-size: 15px;
  font-weight: 600;
}
.dsp-skin-apple .dsp-row-note {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.88);
}
.dsp-skin-apple .dsp-row-ms {
  width: 38px;
  font-size: 11px;
  color: rgba(235, 235, 245, 0.42);
}
.dsp-skin-apple .dsp-row-detail {
  margin: 0 10px 10px;
  padding: 10px 12px;
  border-left: none;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
}
.dsp-skin-apple .dsp-history .dsp-column-head {
  background: rgba(255, 255, 255, 0.05);
}
.dsp-skin-apple .dsp-seg {
  border: none;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
}
.dsp-skin-apple .dsp-seg-head {
  border-bottom: none;
}
.dsp-skin-apple .dsp-btn {
  border-radius: 999px;
}
.dsp-skin-apple .dsp-btn.ghost {
  border-color: transparent;
  background: rgba(255, 255, 255, 0.08);
}
.dsp-skin-apple .dsp-btn.ghost:hover {
  background: rgba(255, 255, 255, 0.14);
}
.dsp-skin-apple .dsp-seg-more,
.dsp-skin-apple .dsp-history-more {
  /* A column body is a flex column: align-self centres this. Margin auto on a
     stretched item left the label hugging the left edge instead. */
  align-self: center;
  margin: 6px 0 10px;
  padding: 6px 16px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(235, 235, 245, 0.92);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0.1px;
}
.dsp-history-more,
.dsp-seg-more {
  /* .dsp-btn-xs pins height: 20px. With 6px padding that leaves an 8px content
     box, so the glyphs were drawn right past the bottom edge. Let the box size
     itself to the text instead of inheriting that height. */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: auto;
  min-height: 28px;
  line-height: 1.2;
  font-size: 12.5px;
  color: var(--dsw-alias-label-primary, inherit);
  padding: 5px 14px;
}
.dsp-skin-apple .dsp-seg-more:hover,
.dsp-skin-apple .dsp-history-more:hover {
  background: rgba(255, 255, 255, 0.12);
  text-decoration: none;
}
.dsp-skin-apple .dsp-column-empty {
  padding: 18px 12px;
  text-align: center;
  color: rgba(235, 235, 245, 0.4);
}
.dsp-skin-apple .dsp-column-head .dsp-column-title {
  color: rgba(255, 255, 255, 0.95);
}
/* The default scrollbar is a bright slab next to a rounded card. */
.dsp-skin-apple .dsp-column-body::-webkit-scrollbar,
.dsp-skin-apple .dsp-column-body::-webkit-scrollbar-track {
  width: 8px;
  background: transparent;
}
.dsp-skin-apple .dsp-column-body::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
}
.dsp-skin-apple .dsp-column-body::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.24);
}
/* One hairline inside the header block keeps the tint from looking flat. */
.dsp-skin-apple .dsp-column-head {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
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
      inflightSince: 0,
      lastChangeAt: 0,
      lastFetchAt: 0,
      beat: 0,
      applied: 0,
      /** History is heavy, so it is fetched only once somebody asks for it. */
      // History is cheap now (the host trims each row to what the column draws),
      // so it loads with the first paint instead of hiding behind a button.
      wantsHistory: true,
      historyMore: false,
      /** Rows already merged in; the newest poll only adds to this, never resets it. */
      historyRows: [],
      /** True while the in-flight request is a "load older" one. */
      loadingOlder: false,
      historyCursor: null,
      /** How many log rows each column renders before offering "more". */
      rowLimit: 40,
    }

    const LOG_POLL_MS = 3000
    const LOG_QUIET_POLL_MS = 12000
    /** Cap on merged history rows — paging is only useful up to a point. */
    const HISTORY_KEEP = 600

    const logNotify = () => {
      for (const subscriber of [...logStore.subscribers]) subscriber()
    }

    const logHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

    // A fetch that never settles used to freeze the panel forever: `inflight`
    // stayed true, so every later poll bailed out. Two guards now: a real
    // timeout on the request, and a watchdog that forgives a hung one.
    const LOG_FETCH_MS = 8000

    const logFetch = async () => {
      if (logStore.inflight && Date.now() - logStore.inflightSince < LOG_FETCH_MS + 7000) return
      logStore.inflight = false
      if (logStore.subscribers.size === 0) return
      // Hiding the tab stops the *extra* polling, but a window that wrongly
      // reports itself hidden (`visibilityState` inside the desktop shell) must
      // not freeze the panel: after fifteen seconds we poll anyway.
      if (logHidden() && Date.now() - logStore.lastFetchAt < 15000) return
      logStore.inflight = true
      logStore.inflightSince = Date.now()
      logStore.beat += 1
      try {
        const query =
          `limit=${logStore.limit || 80}` +
          `${logStore.version ? `&since=${logStore.version}` : ''}` +
          `${logStore.applied ? `&applied=${logStore.applied}` : ''}` +
          `&history=${logStore.wantsHistory ? '1' : '0'}` +
          `&historyLimit=40` +
          `${logStore.loadingOlder && logStore.historyCursor ? `&historyBefore=${encodeURIComponent(logStore.historyCursor)}` : ''}` +
          `&beat=${logStore.beat}&client=${CLIENT_TAG}`
        const options = { cache: 'no-store' }
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
          options.signal = AbortSignal.timeout(LOG_FETCH_MS)
        }
        const res = await fetch(`${LOG_PATH}?${query}`, options)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        const version = Number(json && json.version)
        if (Number.isFinite(version)) {
          logStore.version = version
          logStore.applied = version
        }
        logStore.lastFetchAt = Date.now()
        if (!json || json.unchanged !== true) {
          // Older pages are additive: a plain poll only brings the newest page,
          // so replacing the column with it would drop everything already
          // fetched — which is exactly the "it bounces back" bug.
          const loadedOlder = logStore.loadingOlder
          const hadRows = logStore.historyRows.length > 0
          if (json && Array.isArray(json.history)) {
            const merged = new Map()
            for (const row of logStore.historyRows) if (row && row.at) merged.set(row.at, row)
            for (const row of json.history) if (row && row.at) merged.set(row.at, row)
            const rows = [...merged.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)))
            logStore.historyRows = rows.slice(0, HISTORY_KEEP)
            json.history = logStore.historyRows
          }
          // Only a paging response knows whether older turns remain. A plain
          // poll always sees "more beyond this page", so letting it write this
          // flag would resurrect the button forever after the end is reached.
          if (loadedOlder || !hadRows) logStore.historyMore = Boolean(json && json.historyMore)
          logStore.loadingOlder = false
          logStore.historyCursor = null
          logStore.data = json
          logStore.error = ''
          logStore.lastChangeAt = Date.now()
          logNotify()
        }
      } catch (failure) {
        const message = failure && failure.message ? failure.message : String(failure)
        logStore.lastFetchAt = Date.now()
        if (message !== logStore.error) {
          logStore.error = message
          logNotify()
        }
      } finally {
        logStore.inflight = false
      }
    }

    /** Ask for the history column (once), and repaint right away. */
    const logWantHistory = () => {
      if (logStore.wantsHistory) return
      logStore.wantsHistory = true
      logStore.version = 0
      logFetch()
    }

    /** Pull the next page of closed turns (cursor = oldest row we already have). */
    const logMoreHistory = () => {
      const data = logStore.data
      const rows = (data && data.history) || []
      if (!logStore.historyMore || rows.length === 0) return
      logStore.historyCursor = rows[rows.length - 1].at
      logStore.loadingOlder = true
      logStore.version = 0
      logNotify()
      logFetch()
    }

    /** Show another page of rows in every column. */
    const logMoreRows = () => {
      logStore.rowLimit += 40
      logNotify()
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

    // A manual nudge from the panel header: forget what we hold and ask again.
    const logRefresh = async () => {
      logStore.inflight = false
      await logFetch()
      logNotify()
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

      return { data: logStore.data, error: logStore.error, reload: logRefresh }
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
      // `total` is the whole ring buffer (live + history); the header wants the
      // number of rows currently on screen as "本轮", so prefer the explicit
      // live count and fall back to summing the groups for old hosts.
      const live = Array.isArray(data && data.entries) ? data.entries.length : 0
      const activeRaw = data ? data.active : undefined
      // `Number(null)` is 0 and `0` is finite, so guard the second access too --
      // reading `data.active` on a null payload threw and blanked the panel.
      const rounds =
        activeRaw !== undefined && activeRaw !== null && Number.isFinite(Number(activeRaw))
          ? Number(activeRaw)
          : live
      const historyTotal = (data && data.historyTotal) || 0
      const interrupted = (data && data.interruptedTotal) || 0
      return h(
        'div',
        { className: 'dsp-panel-sub' },
        h('span', { className: 'dsp-sub-group' }, `${model} · 强度 ${effort} · 每 ${interval} 秒`),
        h(
          'span',
          { className: 'dsp-sub-group' },
          `本轮 ${rounds} 次 · 历史 ${historyTotal}${
            interrupted > 0 ? `（中断 ${interrupted}）` : ''
          }`,
        ),
        h(
          'span',
          { className: 'dsp-sub-group dsp-tokens', title: '判断模型累计消耗的 token（含历史轮次）' },
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
          h('span', { className: `dsp-row-caret${open ? ' open' : ''}`, 'aria-hidden': 'true' }, '›'),
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
      for (const key of ['flow', 'flowSpeed', 'flowQuality', 'rainbow', 'panelStyle']) {
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
          String(a.flowQuality) === String(b.flowQuality)) &&
        (a.rainbow === undefined || b.rainbow === undefined || Boolean(a.rainbow) === Boolean(b.rainbow)) &&
        (a.panelStyle === undefined ||
          b.panelStyle === undefined ||
          String(a.panelStyle) === String(b.panelStyle))

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
    /**
     * The last few estimates as a sparkline. The rows say what each sample was;
     * this says where it has been, which is the question the panel exists for.
     * Oldest on the left, so the line reads left to right like a clock.
     */
    function renderSpark(entries, hue) {
      const points = entries
        .slice(0, 24)
        .map((entry) => (entry && Number.isFinite(Number(entry.p)) ? Number(entry.p) : null))
        .reverse()
        .filter((value) => value !== null)
      if (points.length < 2) return null
      const width = 60
      const height = 18
      const step = width / (points.length - 1)
      const path = points
        .map((value, index) => `${(index * step).toFixed(1)},${(height - 2 - (value / 100) * (height - 4)).toFixed(1)}`)
        .join(' ')
      return h(
        'svg',
        {
          className: 'dsp-spark',
          width,
          height,
          viewBox: `0 0 ${width} ${height}`,
          'aria-hidden': 'true',
        },
        h('polyline', {
          points: path,
          fill: 'none',
          stroke: `hsl(${hue} 72% 62%)`,
          'stroke-width': 1.5,
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
        }),
      )
    }

    function renderColumn(group, width) {
      const latest = group.entries[0] || {}
      const lastP = latest.p === null || latest.p === undefined ? '—' : `${latest.p}%`
      const title = group.title || shortId(group.id)
      const dotColor = `hsl(${hueOf(group.id)} 72% 62%)`
      return h(
        'section',
        {
          className: 'dsp-column',
          key: group.id,
          'data-session-id': group.id,
          style: width
            ? { '--dsp-tint': `hsla(${hueOf(group.id)}, 58%, 56%, 0.15)`, flex: `0 0 ${width}px`, maxWidth: 'none' }
            : { '--dsp-tint': `hsla(${hueOf(group.id)}, 58%, 56%, 0.15)` },
        },
        h(
          'div',
          { className: 'dsp-column-head' },
          h(
            'div',
            { className: 'dsp-column-head-top' },
            h('span', { className: 'dsp-dot', style: { background: dotColor } }),
            h('span', { className: 'dsp-column-title', title: group.title || group.id }, title),
          ),
          h(
            'div',
            { className: 'dsp-column-head-sub' },
            h('span', { className: 'dsp-column-stat' }, `${lastP} · ${group.entries.length} 次`),
            h('span', { className: 'dsp-column-time' }, clockOf(latest.at)),
            renderSpark(group.entries, hueOf(group.id)),
          ),
        ),
        h(
          'div',
          { className: 'dsp-column-body' },
          group.entries.length === 0
            ? h('div', { className: 'dsp-column-empty' }, '还没有采样')
            : null,
          group.entries
            .slice(0, logStore.rowLimit)
            .map((entry, index) => renderEntry(entry, `${group.id}:${index}`)),
          group.entries.length > logStore.rowLimit
            ? h(
                'button',
                {
                  className: 'dsp-btn dsp-btn-xs dsp-seg-more',
                  key: 'more',
                  type: 'button',
                  onClick: logMoreRows,
                },
                `还有 ${group.entries.length - logStore.rowLimit} 条`,
              )
            : null,
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
          entries.length > 2
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dsp-seg-more',
                  'aria-expanded': open,
                  onClick: () => setOpen((value) => !value),
                },
                open
                  ? h('span', { className: 'dsp-seg-caret open' }, '›')
                  : h('span', { className: 'dsp-seg-caret' }, '›'),
                open ? '收起' : `展开全部 ${entries.length} 条`,
              )
            : null,
        ),
      )
    }

    /** The leftmost column: turns that are over (or were cut short). */
    function renderHistoryColumn(segments, width) {
      return h(
        'section',
        {
          className: 'dsp-column dsp-history',
          key: 'history',
          'data-session-id': 'history',
          style: width ? { flex: `0 0 ${width}px`, maxWidth: 'none' } : undefined,
        },
        h(
          'div',
          { className: 'dsp-column-head' },
          h('span', { className: 'dsp-dot', style: { background: 'rgba(150,155,168,.9)' } }),
          h('span', { className: 'dsp-column-title', title: '已经结束或被中断的轮次' }, '历史轮次'),
          h(
            'span',
            { className: 'dsp-column-stat' },
            logStore.historyMore ? `${segments.length} 轮 · 还有` : `${segments.length} 轮`,
          ),
        ),
        h(
          'div',
          { className: 'dsp-column-body' },
          segments.map((segment) => h(HistorySegment, { key: segment.key, segment })),
          logStore.historyMore
            ? h(
                'button',
                {
                  className: 'dsp-btn dsp-btn-xs dsp-history-more',
                  type: 'button',
                  disabled: logStore.loadingOlder,
                  onClick: logMoreHistory,
                },
                logStore.loadingOlder ? '加载中…' : '再看 40 轮',
              )
            : null,
        ),
      )
    }

    // Column widths are the reader's business: the panel remembers what they
    // dragged to, per column key, so the history column can be widened without
    // touching the session columns next to it.
    const COLUMN_WIDTH_KEY = 'dsp:column-widths'
    const COLUMN_MIN = 220
    const COLUMN_MAX = 960

    function readColumnWidths() {
      try {
        const raw = window.localStorage.getItem(COLUMN_WIDTH_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function writeColumnWidths(next) {
      try {
        window.localStorage.setItem(COLUMN_WIDTH_KEY, JSON.stringify(next))
      } catch {
        /* private mode, or a shell without storage: sizes stay for this view */
      }
    }

    function ColumnList(props) {
      const ref = useColumnFlip(props.entries)
      const segments = groupHistory(props.history || [])
      const [widths, setWidths] = React.useState(readColumnWidths)

      const widthOf = (key) => {
        const width = Number(widths[key])
        return Number.isFinite(width) && width > 0 ? Math.round(width) : null
      }

      const startResize = (key, event) => {
        // A gutter resizes the column on its left: [history][gutter][session]…
        const column = event.currentTarget.previousElementSibling
        if (!column) return
        event.preventDefault()
        const startX = event.clientX
        const startWidth = column.getBoundingClientRect().width
        const move = (moveEvent) => {
          const next = Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, startWidth + (moveEvent.clientX - startX)))
          column.style.flex = `0 0 ${Math.round(next)}px`
          column.style.maxWidth = 'none'
        }
        const stop = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', stop)
          const final = Number.parseFloat(String(column.style.flex).split(' ').pop())
          if (Number.isFinite(final)) {
            setWidths((current) => {
              const next = { ...current, [key]: Math.round(final) }
              writeColumnWidths(next)
              return next
            })
          }
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', stop)
      }

      const resetWidth = (key) => {
        setWidths((current) => {
          const next = { ...current }
          delete next[key]
          writeColumnWidths(next)
          return next
        })
      }

      const gutter = (key) =>
        h('div', {
          className: 'dsp-gutter',
          key: `gutter:${key}`,
          role: 'separator',
          'aria-orientation': 'vertical',
          title: '拖动调整这一列的宽度，双击还原',
          onPointerDown: (event) => startResize(key, event),
          onDoubleClick: () => resetWidth(key),
        })

      const columns = []
      const history = segments.length > 0
        ? renderHistoryColumn(segments, widthOf('history'))
        : renderHistoryPlaceholder(props.historyTotal || 0, widthOf('history'))
      columns.push(history)
      columns.push(gutter('history'))
      for (const group of groupBySession(props.entries)) {
        const key = String(group.id)
        columns.push(renderColumn(group, widthOf(key)))
        columns.push(gutter(key))
      }
      return h('div', { className: 'dsp-columns', ref }, columns)
    }

    /**
     * The history column needs a second, heavier request, so it starts as a
     * one-line invitation instead of holding up the first paint.
     */
    function renderHistoryPlaceholder(total, width) {
      return h(
        'section',
        {
          className: 'dsp-column dsp-history',
          key: 'history',
          style: width ? { flex: `0 0 ${width}px`, maxWidth: 'none' } : undefined,
        },
        h(
          'div',
          { className: 'dsp-column-head' },
          h('span', { className: 'dsp-dot', style: { background: 'rgba(128,128,128,0.55)' } }),
          h('span', { className: 'dsp-column-title' }, '历史轮次'),
          h('span', { className: 'dsp-column-stat' }, total ? `${total} 轮` : '—'),
        ),
        h(
          'div',
          { className: 'dsp-column-body' },
          h(
            'div',
            { className: 'dsp-history-load' },
            h(
              'button',
              { className: 'dsp-btn dsp-btn-xs', type: 'button', onClick: logWantHistory },
              '加载历史',
            ),
            h('div', { className: 'dsp-hint' }, '历史条目较重，点开才拉'),
          ),
        ),
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

      /**
       * The only place that turns a host config into form state. The derive
       * effect and the post-save adopt both call it, so a saved colour is never
       * shown as the old one while the next /config round-trip is in flight.
       */
      const draftFrom = (cfg) => {
        const source = cfg || {}
        return {
          seconds: Math.round((Number(source.intervalMs) || 30000) / 1000),
          provider: source.provider || '',
          model: source.model || '',
          effort: source.reasoningEffort || '',
          color: source.color || '#90AFFF',
          opacity: Number(source.opacity) || 0.6,
          style: source.style || 'band',
          flow: source.flow !== false,
          flowSpeed: source.flowSpeed || 'slow',
          flowQuality: source.flowQuality || 'medium',
          maxSessions: Number(source.maxSessions) || 3,
          rainbow: source.rainbow === true,
          panelStyle: source.panelStyle === 'classic' ? 'classic' : 'apple',
        }
      }

      React.useEffect(() => {
        if (draft || !data) return
        setDraft(draftFrom(config))
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
        config.maxSessions,
        config.rainbow,
        config.panelStyle,
      ])

      const current = draft || draftFrom(config)
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
          maxSessions: Number(current.maxSessions) || 3,
          rainbow: current.rainbow === true,
          panelStyle: current.panelStyle === 'classic' ? 'classic' : 'apple',
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
            // Adopt exactly what the host stored. Clearing the draft here rebuilt
            // the form from the *previous* /config, so a freshly saved colour
            // snapped back to the old swatch until the page was reloaded.
            if (payload && payload.config) {
              setDraft(draftFrom(payload.config))
              api.commit(payload.config)
            } else {
              setDraft(null)
            }
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
            '同屏进度条数量',
            h(
              'select',
              {
                className: 'dsp-input',
                value: String(current.maxSessions),
                onChange: (event) => setDraft({ ...current, maxSessions: Number(event.target.value) }),
              },
              [1, 2, 3, 4, 5, 6, 8, 10].map((count) =>
                h('option', { key: count, value: String(count) }, `${count} 条`),
              ),
            ),
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
                  // The eyedropper inside the picker can hand back `rgb(...)`;
                  // keep the old colour rather than sending something the host
                  // would reject (that is the "picked a colour, nothing moved").
                  const color = normalizeHex(event.target.value)
                  if (!color) return
                  const next = { ...current, color }
                  setDraft(next)
                  api.preview(next)
                },
              }),
              h('code', { className: 'dsp-code' }, String(current.color || '').toUpperCase()),
            ),
          ),
          field(
            '实验 · 彩虹走马灯',
            h(
              'span',
              { className: 'dsp-inline-wrap' },
              h('input', {
                type: 'checkbox',
                className: 'dsp-check',
                checked: current.rainbow === true,
                onChange: (event) => {
                  const next = { ...current, rainbow: event.target.checked }
                  setDraft(next)
                  api.preview(next)
                },
              }),
              h(
                'span',
                { className: 'dsp-hint' },
                current.rainbow
                  ? '色带在彩虹里走，速度跟上面的「动画速率」走'
                  : '打开后色带的颜色不再是单色，而是一段会走的彩虹',
              ),
            ),
          ),
          field(
            '面板样式',
            h(
              'div',
              { className: 'dsp-inline dsp-inline-wrap' },
              h(
                'select',
                {
                  className: 'dsp-input',
                  value: current.panelStyle === 'classic' ? 'classic' : 'apple',
                  onChange: (event) => {
                    const next = { ...current, panelStyle: event.target.value }
                    setDraft(next)
                    api.preview(next)
                  },
                },
                PANEL_STYLES.map((item) => h('option', { key: item.id, value: item.id }, item.label)),
              ),
              h('span', { className: 'dsp-hint' }, '只影响左侧栏的「进度日志」，不影响侧栏色带'),
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
              title: '丢掉还没保存的改动，回到当前已保存的设置',
              onClick: () => {
                setDraft(null)
                setStatus('')
                if (saved.current) api.commit(saved.current)
                reload()
              },
            },
            '撤销改动',
          ),
          h(
            'button',
            {
              className: 'dsp-btn ghost',
              type: 'button',
              title: '把颜色、样式、动画、同屏数量等全部恢复成插件出厂的默认值',
              onClick: () => {
                setStatus('恢复中…')
                fetch(CONFIG_PATH, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ reset: true }),
                })
                  .then((res) =>
                    res.json().then((payload) => {
                      if (!res.ok) throw new Error(String(payload && payload.error) || `HTTP ${res.status}`)
                      return payload
                    }),
                  )
                  .then((payload) => {
                    if (payload && payload.config) {
                      setDraft(draftFrom(payload.config))
                      api.commit(payload.config)
                      saved.current = payload.config
                    } else {
                      setDraft(null)
                    }
                    setStatus('已恢复默认')
                    reload()
                  })
                  .catch((err) => setStatus(`恢复失败：${String((err && err.message) || err)}`))
              },
            },
            '恢复默认',
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

    /**
     * Settings-page card: a pointer to the log, not a copy of it.
     *
     * The settings page is for turning knobs; the log is for reading what the
     * judge model said, and it is a full page of its own (the rail entry). Two
     * half-sized copies of the same list only taught people to scroll the wrong
     * one, so this card states where the log lives and offers a door.
     */
    function ProgressLogCard() {
      // A click that cannot switch panels used to fail silently; keep the
      // reason on screen so "打不开" is reportable instead of mysterious.
      const [failure, setFailure] = React.useState('')
      // If the shell refuses to switch panels, the card still answers the
      // question "最近发生了什么" instead of leaving a dead button.
      const [rows, setRows] = React.useState(null)

      const loadInline = () => {
        try {
          fetch(`${LOG_PATH}?limit=8&history=0`)
            .then((res) => (res && res.ok ? res.json() : null))
            .then((json) => {
              const entries = (json && json.entries) || []
              setRows(
                entries.slice(0, 8).map((entry) => ({
                  at: clockOf(entry && entry.at),
                  p: entry && Number.isFinite(Number(entry.p)) ? `${Number(entry.p)}%` : '—',
                  note: (entry && entry.note) || '',
                })),
              )
            })
            .catch(() => setRows([]))
        } catch {
          setRows([])
        }
      }
      return h(
        'div',
        { className: 'dsp-card dsp-loglink' },
        h('div', { className: 'dsp-loglink-title' }, '进度日志'),
        h(
          'div',
          { className: 'dsp-loglink-body' },
          '判断模型每一次给出的数字、阶段名、涨跌、耗时和 token，连同它返回的原始 JSON，都记在进度日志里。',
          h('br', null),
          '那是左侧栏的一个独立面板，不占设置页的位置。',
        ),
        h(
          'div',
          { className: 'dsp-loglink-actions' },
          h(
            'button',
            {
              className: 'dsp-btn',
              type: 'button',
              onClick: () => {
                const message = openLogPanel()
                setFailure(message)
                if (message) loadInline()
              },
            },
            '打开进度日志',
          ),
          h(
            'span',
            { className: 'dsp-hint' },
            '日志每 3 秒自动刷新；要看最近几条，直接开面板就行。',
          ),
        ),
        failure
          ? h('div', { className: 'dsp-hint dsp-loglink-error' }, `打不开：${failure}`)
          : null,
        rows && rows.length
          ? h(
              'div',
              { className: 'dsp-loglink-inline' },
              rows.map((row) =>
                h(
                  'div',
                  { className: 'dsp-loglink-row', key: `${row.at}-${row.p}` },
                  h('span', { className: 'dsp-loglink-time' }, row.at),
                  h('span', { className: 'dsp-loglink-p' }, row.p),
                  h('span', { className: 'dsp-loglink-note' }, row.note),
                ),
              ),
            )
          : null,
      )
    }

    /**
     * The left-rail panel (`main` keyed slot, key = PANEL_ID): every sampler
     * answer, raw, newest first.
     */
    function SampleLogPanel() {
      const { data, error, reload } = useLog(120)
      const entries = Array.isArray(data && data.entries) ? data.entries : []
      const history = Array.isArray(data && data.history) ? data.history : []
      const skin = (data && data.config && data.config.panelStyle) === 'classic' ? 'classic' : 'apple'
      return h(
        'div',
        { className: `dsp-panel dsp-skin-${skin}` },
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
            h(
              'span',
              { className: 'dsp-refresh' },
              h('span', null, '每 3 秒自动刷新'),
              h(
                'button',
                {
                  className: 'dsp-btn ghost dsp-btn-xs',
                  type: 'button',
                  title: '立刻重新拉一次（自动刷新卡住时用）',
                  onClick: () => {
                    reload()
                  },
                },
                '刷新',
              ),
            ),
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
        lookSheet.textContent = sheetCss(null)

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
        let water = null
        try {
          water = ensureWaterFilter()
        } catch (error) {
          filtersReady = false
          console.error('[dsh-session-progress] no svg filter, falling back to the flat highlight:', error)
        }
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

      // Only rows that are actually on screen are allowed to animate, and
      // nothing animates while the window is hidden. Both are one class plus
      // one attribute, so the style engine does the gating, not a timer.
      let rowObserver = null
      let rowWatcher = null
      let visibilityHandler = null

      const markVisibleRows = () => {
        const rows = document.querySelectorAll('[data-row-key^="session:"]')
        if (!rowObserver) {
          for (const row of rows) row.classList.add('dsp-live')
          return
        }
        for (const row of rows) {
          if (row.dataset.dspWatched === '1') continue
          row.dataset.dspWatched = '1'
          rowObserver.observe(row)
        }
      }

      const startRowGating = () => {
        try {
          if (typeof window.IntersectionObserver === 'function') {
            rowObserver = new window.IntersectionObserver(
              (records) => {
                for (const record of records) {
                  const row = record.target
                  if (record.isIntersecting) row.classList.add('dsp-live')
                  else row.classList.remove('dsp-live')
                }
              },
              { rootMargin: '120px' },
            )
          }
        } catch {
          rowObserver = null
        }
        // Rows come and go with the sidebar's own virtualisation, so the set is
        // re-scanned by a mutation watcher rather than by a polling timer.
        try {
          let queued = false
          rowWatcher = new MutationObserver(() => {
            if (queued) return
            queued = true
            const run = () => {
              queued = false
              markVisibleRows()
            }
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
            else setTimeout(run, 200)
          })
          rowWatcher.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
          })
        } catch {
          rowWatcher = null
        }
        markVisibleRows()

        visibilityHandler = () => {
          const hidden = document.visibilityState === 'hidden'
          try {
            if (hidden) document.documentElement.setAttribute('data-dsp-hidden', '')
            else document.documentElement.removeAttribute('data-dsp-hidden')
          } catch {
            /* ignore */
          }
          if (!hidden) markVisibleRows()
        }
        try {
          document.addEventListener('visibilitychange', visibilityHandler)
          visibilityHandler()
        } catch {
          visibilityHandler = null
        }
      }

      startRowGating()

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

      // The settings card offers a door to the log page. `layout.selectPanel`
      // is the same call the rail icon makes, so the two entries cannot drift
      // apart. It throws when the panel id is unknown, and a thrown selector
      // must never take the card down with it.
      api.openPanel = () => {
        // The settings card is a door to the rail panel. Three paths exist in
        // different shells: `layout.selectPanel` (throws when the main key is
        // not registered), `panels.selectPanel` (the array behind it), and
        // `layout.select` on older faces. Try them in that order and report the
        // first real error instead of failing silently.
        const problems = []
        const attempt = (label, fn) => {
          try {
            const value = fn()
            if (value !== false) return true
          } catch (error) {
            problems.push(`${label}: ${error && error.message ? error.message : error}`)
          }
          return false
        }

        // `ctx.get(name)` reaches optional services without declaring them in
        // `inject` (declaring a face the shell may not mount would block `apply`).
        const face = (name) => {
          try {
            return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]
          } catch {
            return undefined
          }
        }
        const layout = face('layout')
        const panels = face('panels')

        const hasMain =
          layout && typeof layout.hasMainPanel === 'function'
            ? (() => {
                try {
                  return layout.hasMainPanel(PANEL_ID)
                } catch {
                  return true
                }
              })()
            : true
        // A shell that dropped our keyed `main` entry would throw from
        // `selectPanel`; registering it again is cheap and idempotent.
        if (!hasMain) {
          attempt('re-register main', () => {
            if (typeof registerPanel !== 'function') return false
            ctx.slots.inject('main', registerPanel)
            return true
          })
        }

        const opened =
          attempt('layout.selectPanel', () => layout && layout.selectPanel(PANEL_ID)) ||
          attempt('panels.selectPanel', () => panels && panels.selectPanel(PANEL_ID)) ||
          attempt('layout.select', () => layout && typeof layout.select === 'function' && layout.select(PANEL_ID))

        if (!opened) {
          console.error('[dsh-session-progress] could not open the log panel:', problems.join(' | ') || 'no layout face on this shell')
        }
        return opened ? '' : problems.join(' | ') || '这个外壳没有提供切换面板的接口'
      }

      /** Adopt a look as saved truth (after a save, a reset, or on unmount). */
      api.commit = (next) => {
        lookState.previewing = false
        if (next && typeof next === 'object') lookState.serverLook = next
        if (lookState.serverLook) applyLook(lookState.serverLook, 'server')
      }

      /** Write the stylesheet for one look, if it differs from what is painted. */
      const paintLook = (next) => {
        // Everything `flowDecls` reads has to be in the candidate *and* in the
        // key. Colour/opacity/style were the only fields here once, so the flow
        // tier, its speed and the on/off switch repainted nothing until the next
        // SSE frame arrived — the preview looked dead for those three controls.
        const candidate = {
          color: next.color,
          opacity: next.opacity,
          style: next.style,
          flow: next.flow,
          flowSpeed: next.flowSpeed,
          flowQuality: next.flowQuality,
          rainbow: next.rainbow === true,
          panelStyle: next.panelStyle === 'classic' ? 'classic' : 'apple',
        }
        const key = `${candidate.color}|${candidate.opacity}|${candidate.style}|${candidate.flow}|${candidate.flowSpeed}|${candidate.flowQuality}|${candidate.rainbow}|${candidate.panelStyle}`
        if (key === lookKey) return
        lookKey = key
        lookState.painted = candidate
        if (lookSheet) lookSheet.textContent = sheetCss(candidate)
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
            // The host already trims, and it says how many bands it allows:
            // honouring that number here means a stale frame from an older
            // build can never paint more rows than the setting allows.
            const cap = Math.max(1, Math.min(10, Number(payload.limit) || 10))
            for (const item of payload.sessions) {
              if (values.size >= cap) break
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
              try {
                rowObserver?.disconnect()
                rowWatcher?.disconnect()
                if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler)
                document.documentElement.removeAttribute('data-dsp-hidden')
                for (const row of document.querySelectorAll('[data-dsp-watched]')) {
                  row.classList.remove('dsp-live')
                  delete row.dataset.dspWatched
                }
              } catch {
                /* cleanup must never throw */
              }
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
