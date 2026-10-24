/**
 * dsh-session-progress — host half.
 *
 * Real sampler: while a turn is running, every `intervalMs` this asks a cheap
 * model how far the turn has got. The model sees a trimmed transcript of the
 * current turn and answers one line of JSON, `{"p":0-100,"note":"…"}`. The
 * parsed `p` drives the band painted on the session row by the client half.
 *
 * Progress is monotonic inside a turn and never reaches 100 from the model:
 * only the durable `turn/end` event completes it.
 *
 * Every model call is recorded (raw output included) and served at
 * `/plugins/dsh-session-progress/log`, which is what the settings page shows.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EVENTS_PATH = '/plugins/dsh-session-progress/events'
const SNAPSHOT_PATH = '/plugins/dsh-session-progress/snapshot'
const DEBUG_PATH = '/plugins/dsh-session-progress/debug'
const LOG_PATH = '/plugins/dsh-session-progress/log'
const CONFIG_PATH = '/plugins/dsh-session-progress/config'

/** UI overrides survive restarts here, outside the profile's patch file. */
const STATE_FILE = process.env.DSP_STATE_FILE
  ? path.resolve(process.env.DSP_STATE_FILE)
  : path.join(os.homedir(), '.dsh', 'session-progress.config.json')

/** Paint tick. Cheap: it only re-broadcasts the current frame. */
const TICK_MS = 2000
const LOG_LIMIT = 300

const DEFAULT_CONFIG = {
  enabled: true,
  provider: 'deepseek-account',
  model: 'deepseek-flash',
  reasoningEffort: 'off',
  /** Delay before the first sample of a turn (let the model do something first). */
  firstDelayMs: 8000,
  intervalMs: 30000,
  maxSessions: 3,
  maxContextChars: 6000,
  timeoutMs: 30000,
  /** Seed width while the first sample is in flight. */
  seedP: 4,
  /** Look of the band: colour, opacity and one of LOOK_STYLES. */
  color: '#90AFFF',
  opacity: 0.6,
  style: 'band',
}

/** The band styles the client knows how to draw. */
const LOOK_STYLES = ['band', 'solid', 'underline', 'stripe', 'glow', 'segments']

const SYSTEM_PROMPT = [
  '你在监听一个编程助手正在执行的这一轮任务，估计它完成了多少。',
  '只输出一行 JSON，不要代码块、不要解释：{"p":<0-100 的整数>,"note":"<不超过 16 字的阶段名>"}',
  '规则：',
  '1. p 只在出现明确的新进展时提高；看不出来就保持和上次一样或略微提高。',
  '2. 不要把 p 报成 100——收尾由宿主判定，你最大报到 95。',
  '3. 刚开工、只有用户提问时 p 应该很低（0-15）。',
  '4. note 写当前阶段，例如「读代码」「改接口」「跑测试」「等用户」。',
].join('\n')

export const name = 'dsh-session-progress'
export const inject = ['sessions']

/** Bounds for the numeric knobs; anything outside is clamped, not rejected. */
const LIMITS = {
  intervalMs: [5000, 3600000],
  firstDelayMs: [0, 120000],
  maxSessions: [1, 10],
  maxContextChars: [1000, 40000],
  timeoutMs: [5000, 120000],
  seedP: [0, 90],
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/** Merge a partial config onto `base`, coercing and clamping every field. */
function sanitizeConfig(input, base) {
  const out = { ...base }
  if (!input || typeof input !== 'object') return out
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled
  for (const key of ['provider', 'model', 'reasoningEffort']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) out[key] = value.trim()
  }
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    if (input[key] !== undefined) out[key] = clampNumber(input[key], min, max, out[key])
  }
  if (typeof input.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.color.trim())) {
    out.color = input.color.trim().toUpperCase()
  }
  if (input.opacity !== undefined) {
    const opacity = Number(input.opacity)
    if (Number.isFinite(opacity)) out.opacity = Math.min(1, Math.max(0.05, Math.round(opacity * 100) / 100))
  }
  if (typeof input.style === 'string' && LOOK_STYLES.includes(input.style)) out.style = input.style
  return out
}

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return null
  }
}

function writeConfigFile(cfg) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8')
    return true
  } catch (error) {
    console.error('[dsh-session-progress] cannot persist config:', error?.message ?? error)
    return false
  }
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** Effort ids of a model, from either `{id}` objects or plain strings. */
function effortIds(model) {
  const efforts = model?.reasoning?.efforts
  if (!Array.isArray(efforts)) return []
  return efforts.map((item) => String(typeof item === 'string' ? item : (item?.id ?? ''))).filter(Boolean)
}

function idOf(item, ...keys) {
  if (typeof item === 'string') return item
  for (const key of keys) {
    const value = item?.[key]
    if (typeof value === 'string' && value) return value
  }
  return ''
}

function isLocalRequest(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return false
  if (req.headers?.host) {
    try {
      const host = new URL(`http://${req.headers.host}`)
      if (host.username || host.password) return false
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return false
    } catch {
      return false
    }
  }
  if (!req.headers?.origin) return true
  try {
    const origin = new URL(req.headers.origin)
    return ['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host
  } catch {
    return false
  }
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Flatten one message's content to plain text, tolerating both known shapes. */
function textOf(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const out = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') out.push(block.text)
    else if (block.type === 'tool-call') out.push(`[调用工具 ${block.name ?? '?'}]`)
    else if (block.type === 'image') out.push('[图片]')
    else if (block.type === 'file') out.push('[文件]')
  }
  return out.join(' ')
}

function clip(text, limit) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/**
 * Build the sampler context: everything from the last user message up to now,
 * each message clipped, total clipped to `maxChars`. Returns null when the
 * session has no messages yet.
 */
function buildContext(session, maxChars) {
  const messages = session?.deriveMessages?.()
  if (!Array.isArray(messages) || messages.length === 0) return null

  let start = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      start = i
      break
    }
  }
  const turn = (start >= 0 ? messages.slice(start) : messages.slice(-6)).filter(
    (message) => message?.role !== 'system' && message?.role !== 'developer',
  )
  if (turn.length === 0) return null

  const lines = []
  for (const message of turn) {
    const text = clip(textOf(message), 1200)
    if (!text) continue
    const label = message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : '工具'
    lines.push(`${label}: ${text}`)
  }
  let transcript = lines.join('\n')
  if (transcript.length > maxChars) transcript = transcript.slice(-maxChars)
  return transcript
}

function parseProgress(text) {
  const match = /\{[\s\S]*?\}/.exec(String(text ?? ''))
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    const p = Number(parsed?.p)
    if (!Number.isFinite(p)) return null
    const note = typeof parsed?.note === 'string' ? clip(parsed.note, 40) : ''
    return { p: Math.max(0, Math.min(100, p)), note }
  } catch {
    return null
  }
}

const EFFORT_RANK = {
  off: 0,
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  standard: 3,
  high: 4,
  xhigh: 5,
  max: 6,
}

/** The offered effort closest to `requested`, by thinking depth. */
function closestEffort(requested, offered) {
  const target = EFFORT_RANK[String(requested)] ?? 99
  let best = offered[0]
  let bestGap = Number.POSITIVE_INFINITY
  for (const id of offered) {
    const gap = Math.abs((EFFORT_RANK[String(id)] ?? 99) - target)
    if (gap < bestGap) {
      bestGap = gap
      best = id
    }
  }
  return best
}

/** The latest `session/title` event of a session, or '' when it has none. */
/**
 * Token counts straight from the adapter. `inputTokens` excludes cache reads
 * on some providers and includes them on others, so the adapter's own
 * `totalTokens` wins when present; otherwise sum every bucket we were given.
 */
function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  const count = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0)
  const input = count(usage.inputTokens)
  const output = count(usage.outputTokens)
  const cacheRead = count(usage.cacheReadTokens)
  const cacheWrite = count(usage.cacheWriteTokens)
  const total = count(usage.totalTokens) || input + output + cacheRead + cacheWrite
  if (total === 0) return null
  return { input, output, cacheRead, cacheWrite, total }
}

/** Sum the usage of every recorded sample (unpaged, the whole ring buffer). */
function sumTokens(entries) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, samples: 0 }
  for (const entry of entries) {
    const usage = entry?.tokens
    if (!usage) continue
    total.input += usage.input
    total.output += usage.output
    total.cacheRead += usage.cacheRead
    total.cacheWrite += usage.cacheWrite
    total.total += usage.total
    total.samples += 1
  }
  return total
}

function titleOf(session) {
  try {
    const events = typeof session?.ownEvents === 'function' ? session.ownEvents() : []
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (!event || event.type !== 'session/title') continue
      const title = event.data?.title
      if (typeof title === 'string' && title.trim()) return title.trim().slice(0, 80)
    }
  } catch {
    /* a title is nice-to-have, never fatal */
  }
  return ''
}

/**
 * The name shown for a session in the log: the session title when it has one,
 * otherwise the opening request (a brand-new session is not auto-titled yet
 * when the first sample runs), and only then a short id.
 */
function labelOf(session) {
  const title = titleOf(session)
  if (title) return title
  try {
    const events = typeof session?.ownEvents === 'function' ? session.ownEvents() : []
    for (const event of events) {
      if (!event || event.type !== 'user/message') continue
      const text = clip(textOf(event.data ?? {}), 40)
      if (text) return text
    }
  } catch {
    /* fall through to the id */
  }
  const id = typeof session?.id === 'string' ? session.id : ''
  return id.replace(/^session-/, '').slice(0, 8)
}


/**
 * Model-name hints that usually mean "cheap and fast", with a preference rank
 * (lower wins): a `mini` beats a `turbo`, because `turbo` is often still large.
 */
const CHEAP_HINTS = [
  ['mini', 0],
  ['lite', 0],
  ['small', 0],
  ['nano', 0],
  ['haiku', 0],
  ['flash', 1],
  ['fast', 1],
  ['instant', 1],
  ['turbo', 2],
]

/** Best (lowest) cheap-hint rank in a model id; Infinity when it has none. */
function cheapRank(modelId) {
  const text = String(modelId || '').toLowerCase()
  let best = Number.POSITIVE_INFINITY
  for (const [hint, rank] of CHEAP_HINTS) {
    if (text.includes(hint) && rank < best) best = rank
  }
  return best
}

/** Prefer a cheap model when the configured one does not exist on this machine. */
function pickRoute(models) {
  if (!Array.isArray(models) || models.length === 0) return null
  let best = null
  let bestRank = Number.POSITIVE_INFINITY
  for (const item of models) {
    const rank = cheapRank(item.model)
    if (rank < bestRank) {
      bestRank = rank
      best = item
    }
  }
  return best || models[0]
}

export function apply(ctx, config) {
  // patch file < preferred, then the UI overrides persisted in STATE_FILE
  const cfg = sanitizeConfig(readConfigFile(), sanitizeConfig(config, DEFAULT_CONFIG))

  /** @type {Set<any>} */
  const clients = new Set()
  /** @type {Map<string, {id: string, p: number, o: number, note: string, samples: number}>} */
  const state = new Map()
  /** @type {Set<string>} */
  const running = new Set()
  /** @type {Map<string, any>} */
  const timers = new Map()
  /** @type {Map<string, any>} */
  const fades = new Map()
  /** @type {Array<object>} */
  const log = []

  let effectiveEffort = cfg.reasoningEffort
  let effortProbed = false
  /** @type {string[]} reasoning efforts the model actually advertises */
  let offeredEfforts = []
  /** True once we know the configured route exists (or adopted a real one). */
  let routeResolved = false
  /** True when the configured route was missing and we swapped in another. */
  let routeFallback = false
  /** Warn about an empty catalog once, not on every sample. */
  let warnedNoCatalog = false

  const frame = () => ({
    type: 'progress',
    sessions: [...state.values()].map((entry) => ({ id: entry.id, p: entry.p, o: entry.o })),
    // The look travels with every frame so a settings change repaints even if
    // no settings card is open, and a fresh client paints correctly at once.
    look: { color: cfg.color, opacity: cfg.opacity, style: cfg.style },
  })

  const push = (res) => {
    try {
      res.write(`data: ${JSON.stringify(frame())}\n\n`)
    } catch {
      clients.delete(res)
    }
  }

  const broadcast = () => {
    for (const res of [...clients]) push(res)
  }

  const record = (entry) => {
    log.push(entry)
    if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT)
  }

  // ---- who is running ----------------------------------------------------
  // The durable turn boundary is the truth: `turn/start` opens the turn the
  // band describes and `turn/end` closes it. The two status events are only a
  // safety net for sessions whose log we did not observe from the start.
  const markRunning = (id, isRunning, source) => {
    const key = String(id ?? '')
    if (!key) return
    if (isRunning) {
      if (running.has(key)) return
      running.add(key)
      onTurnStart(key, source)
    } else if (running.delete(key)) {
      onTurnEnd(key, source)
    }
  }

  const clearTimer = (id) => {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    const fade = fades.get(id)
    if (fade) {
      clearTimeout(fade)
      fades.delete(id)
    }
  }

  const onTurnStart = (id, source) => {
    clearTimer(id)
    const entry = state.get(id)
    if (entry) {
      entry.p = 0
      entry.note = ''
      entry.samples = 0
      entry.o = cfg.opacity
    }
    console.log(`[dsh-session-progress] ${id} turn start (${source})`)
    schedule(id, cfg.firstDelayMs)
    broadcast()
  }

  const onTurnEnd = (id, source) => {
    clearTimer(id)
    const entry = state.get(id)
    console.log(`[dsh-session-progress] ${id} turn end (${source})`)
    if (!entry) {
      scheduleFadeOut(id)
      return
    }
    entry.p = 100
    entry.o = cfg.opacity
    broadcast()
    scheduleFadeOut(id)
  }

  /** 100% for a beat, then fade to transparent, then drop the rule. */
  const scheduleFadeOut = (id) => {
    clearTimer(id)
    const fade = setTimeout(() => {
      fades.delete(id)
      const entry = state.get(id)
      if (!entry) return
      entry.o = 0
      broadcast()
      const drop = setTimeout(() => {
        state.delete(id)
        broadcast()
      }, 420)
      if (typeof drop?.unref === 'function') drop.unref()
      fades.set(id, drop)
    }, 700)
    if (typeof fade?.unref === 'function') fade.unref()
    fades.set(id, fade)
  }

  if (typeof ctx.on === 'function') {
    ctx.on('session/event', (session, event) => {
      const type = event?.type
      if (type === 'turn/start') markRunning(session?.id, true, 'turn/start')
      else if (type === 'turn/end') markRunning(session?.id, false, 'turn/end')
    })
    ctx.on('api-session/status', (sessionId, isRunning) =>
      markRunning(sessionId, isRunning, 'api-session/status'),
    )
    ctx.on('agent/status', (payload) =>
      markRunning(payload?.agent?.id, payload?.status === 'running', 'agent/status'),
    )
  }

  // ---- sampler ------------------------------------------------------------
  const trackCount = () => {
    let count = 0
    for (const id of running) if (state.has(id) || timers.has(id)) count += 1
    return count
  }

  const schedule = (id, delay) => {
    clearTimer(id)
    if (!running.has(id)) return
    if (trackCount() > cfg.maxSessions && !state.has(id)) return
    const timer = setTimeout(() => {
      timers.delete(id)
      sample(id).catch((error) =>
        console.error('[dsh-session-progress] sampler failed:', error?.stack ?? error),
      )
    }, Math.max(0, delay))
    if (typeof timer?.unref === 'function') timer.unref()
    timers.set(id, timer)
  }

  /**
   * The effort ids the configured model really declares. Single source of
   * truth: the SAME catalog the settings dropdown shows (`listModels`), so
   * what you pick is what gets sent. `resolveModelInfo` is only a fallback —
   * it has been observed to advertise a different (smaller) set.
   */
  const declaredEfforts = async () => {
    try {
      const models = await describeModels()
      const hit = models.find((item) => item.provider === cfg.provider && item.model === cfg.model)
      if (hit && hit.efforts.length > 0) return hit.efforts
    } catch {
      /* fall through */
    }
    try {
      const info = await getLlm()?.resolveModelInfo?.(cfg.provider, cfg.model)
      return effortIds(info)
    } catch {
      return []
    }
  }

  const probeEffort = async (llm) => {
    if (effortProbed) return
    effortProbed = true
    const efforts = await declaredEfforts()
    offeredEfforts = efforts
    if (efforts.length === 0) {
      // The catalog was not readable yet; retry on the next sample instead of
      // freezing a wrong decision.
      effortProbed = false
      return
    }
    if (efforts.includes(cfg.reasoningEffort)) {
      effectiveEffort = cfg.reasoningEffort
      return
    }
    // Pick the CLOSEST offered effort, not the model's default: asking for
    // "off" must land on the least thinking that exists, never on "high".
    const fallback = closestEffort(cfg.reasoningEffort, efforts)
    console.log(
      `[dsh-session-progress] ${cfg.reasoningEffort} not offered by ${cfg.model} (offered: ${efforts.join(', ')}); using ${fallback}`,
    )
    effectiveEffort = fallback
    void llm
  }

  const findSession = (id) => {
    try {
      return ctx.sessions?.get?.(id) ?? null
    } catch {
      return null
    }
  }

  const sample = async (id) => {
    if (!running.has(id)) return
    const session = findSession(id)
    if (!session) {
      console.log(`[dsh-session-progress] ${id} is no longer live; dropping sampler`)
      return
    }
    const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
    if (!llm || typeof llm.stream !== 'function') {
      console.warn('[dsh-session-progress] llm service unavailable; skipping sample')
      schedule(id, cfg.intervalMs)
      return
    }

    if (!(await ensureRoute())) {
      // No readable catalog yet: this machine has no usable provider/model.
      // Wait for one instead of calling a route that cannot exist.
      if (!warnedNoCatalog) {
        warnedNoCatalog = true
        console.warn('[dsh-session-progress] no model catalog yet; waiting before sampling')
      }
      schedule(id, cfg.intervalMs)
      return
    }

    await probeEffort(llm)

    let transcript = null
    try {
      transcript = buildContext(session, cfg.maxContextChars)
    } catch (error) {
      console.warn('[dsh-session-progress] cannot read session messages:', error?.message ?? error)
    }

    const entry = state.get(id) ?? {
      id,
      p: cfg.seedP,
      o: cfg.opacity,
      note: '',
      samples: 0,
    }
    state.set(id, entry)
    broadcast()

    const prompt = [
      `会话：${id}`,
      `当前进度（上一次采样）：${entry.samples === 0 ? '尚未采样' : `${entry.p}%`}`,
      transcript ? `本轮记录：\n${transcript}` : '本轮记录：（还读不到消息）',
      '请给出现在的进度。',
    ].join('\n\n')

    const startedAt = Date.now()
    const controller = new AbortController()
    const killer = setTimeout(() => controller.abort(), cfg.timeoutMs)
    if (typeof killer?.unref === 'function') killer.unref()

    let text = ''
    let failure = ''
    /** The adapter reports token usage once per call, right before `finish`. */
    let usage = null
    try {
      const stream = llm.stream({
        provider: cfg.provider,
        model: cfg.model,
        reasoningEffort: effectiveEffort,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        temperature: 0,
        maxTokens: 120,
        signal: controller.signal,
      })
      for await (const chunk of stream) {
        if (!chunk || typeof chunk !== 'object') continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        else if (chunk.type === 'usage') usage = normalizeUsage(chunk.usage)
        else if (chunk.type === 'finish') {
          const kind = chunk.reason?.kind
          if (kind === 'error' || kind === 'aborted') {
            failure = chunk.reason?.failure?.message ?? kind
          }
        }
      }
    } catch (error) {
      failure = error?.message ?? String(error)
    } finally {
      clearTimeout(killer)
    }

    const ms = Date.now() - startedAt
    const parsed = failure ? null : parseProgress(text)

    record({
      at: new Date().toISOString(),
      sessionId: id,
      // Without a title the log mixes every session into one anonymous list;
      // fall back to the caller-side short id when the session has none yet.
      sessionTitle: labelOf(session),
      model: `${cfg.provider}/${cfg.model}`,
      effort: effectiveEffort,
      ms,
      p: parsed ? parsed.p : null,
      note: parsed ? parsed.note : '',
      raw: text.slice(0, 2000),
      tokens: usage,
      error: failure || (parsed ? '' : 'no JSON in output'),
    })

    if (running.has(id)) {
      if (parsed) {
        const next = Math.max(entry.p, parsed.p)
        entry.p = Math.max(0, Math.min(95, next))
        entry.note = parsed.note
        entry.samples += 1
        entry.o = cfg.opacity
        broadcast()
      }
      schedule(id, cfg.intervalMs)
    }
  }

  // ---- paint tick ---------------------------------------------------------
  const tick = () => {
    if (state.size > 0 || clients.size > 0) broadcast()
  }

  const timer = setInterval(tick, TICK_MS)
  if (typeof timer?.unref === 'function') timer.unref()

  ctx.effect(
    () => () => {
      clearInterval(timer)
      for (const handle of timers.values()) clearTimeout(handle)
      for (const handle of fades.values()) clearTimeout(handle)
      timers.clear()
      fades.clear()
      for (const res of clients) {
        try {
          res.end()
        } catch {
          /* the socket may already be gone */
        }
      }
      clients.clear()
      state.clear()
      running.clear()
    },
    'dsh-session-progress: timers + streams',
  )

  // ---- HTTP face ----------------------------------------------------------
  const snapshotHandler = (req, res) => {
    if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
    jsonResponse(res, 200, frame())
  }

  const debugHandler = (req, res) => {
    if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
    let liveSessions = []
    try {
      liveSessions = (ctx.sessions?.list?.() ?? []).map((session) => ({
        id: String(session?.id ?? ''),
        seq: Number(session?.seq ?? 0),
      }))
    } catch (error) {
      liveSessions = [{ id: `error: ${String(error)}` }]
    }
    jsonResponse(res, 200, {
      config: cfg,
      effort: effectiveEffort,
      offeredEfforts,
      running: [...running],
      samplers: [...timers.keys()],
      painted: [...state.values()],
      clients: clients.size,
      samples: log.length,
      liveSessions,
    })
  }

  const logHandler = async (req, res) => {
    if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
    const limit = (() => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const raw = Number(url.searchParams.get('limit'))
        return Number.isFinite(raw) && raw > 0 ? Math.min(LOG_LIMIT, raw) : 80
      } catch {
        return 80
      }
    })()
    let catalogEmpty = false
    try {
      await ensureRoute()
      catalogEmpty = (await describeModels()).length === 0
    } catch {
      catalogEmpty = false
    }
    jsonResponse(res, 200, {
      config: cfg,
      effort: effectiveEffort,
      routeFallback,
      catalogEmpty,
      total: log.length,
      tokens: sumTokens(log),
      entries: log.slice(-limit).reverse(),
    })
  }

  const eventsHandler = (req, res) => {
    if (!isLocalRequest(req)) return jsonResponse(res, 403, { error: 'local access only' })
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    res.write('retry: 2000\n\n')
    clients.add(res)
    push(res)
    req.on('close', () => clients.delete(res))
  }

  // ---- settings -----------------------------------------------------------
  const getLlm = () => (typeof ctx.get === 'function' ? ctx.get('llm') : undefined)

  /** Re-arm every running session so a new interval applies immediately. */
  const rescheduleAll = () => {
    for (const id of [...timers.keys()]) clearTimer(id)
    for (const id of running) {
      if (!cfg.enabled) break
      if (id === undefined || id === null) continue
      schedule(id, 500)
    }
  }

  /**
   * Apply a partial config from the settings UI: clamp, persist, re-probe the
   * model, re-arm the timers.
   */
  const applyConfig = (patch) => {
    const next = sanitizeConfig(patch, cfg)
    const modelChanged = next.provider !== cfg.provider || next.model !== cfg.model
    Object.assign(cfg, next)
    if (modelChanged) {
      // Re-check that the newly chosen route exists on this machine.
      routeResolved = false
      routeFallback = false
    }
    if (modelChanged || next.reasoningEffort !== effectiveEffort) {
      effortProbed = false
      effectiveEffort = cfg.reasoningEffort
      offeredEfforts = []
    }
    catalogAt = 0
    const persisted = writeConfigFile(cfg)
    rescheduleAll()
    broadcast()
    console.log(
      `[dsh-session-progress] config ${cfg.provider}/${cfg.model} effort=${cfg.reasoningEffort} every ${Math.round(cfg.intervalMs / 1000)}s${persisted ? '' : ' (not persisted)'}`,
    )
    return cfg
  }

  /** provider/model/effort catalog for the settings selects (cached 60s). */
  let catalog = null
  let catalogAt = 0
  const describeModels = async () => {
    if (catalog && Date.now() - catalogAt < 60000) return catalog
    const llm = getLlm()
    if (!llm || typeof llm.listModels !== 'function') return (catalog = [])
    const out = []
    let providers = []
    try {
      const list = typeof llm.listProviders === 'function' ? await llm.listProviders() : []
      providers = (Array.isArray(list) ? list : []).slice(0, 8)
    } catch {
      providers = []
    }
    if (providers.length === 0) providers = [cfg.provider]
    for (const provider of providers) {
      const providerId = idOf(provider, 'id', 'provider', 'name')
      if (!providerId) continue
      let models = []
      try {
        models = await llm.listModels(providerId)
      } catch {
        models = []
      }
      for (const model of (Array.isArray(models) ? models : []).slice(0, 40)) {
        const modelId = idOf(model, 'id', 'model', 'name')
        if (!modelId) continue
        let efforts = effortIds(model)
        let defaultEffort = typeof model?.reasoning?.defaultEffort === 'string' ? model.reasoning.defaultEffort : ''
        if (efforts.length === 0) {
          try {
            const info = await llm.resolveModelInfo?.(providerId, modelId)
            efforts = effortIds(info)
            defaultEffort = typeof info?.reasoning?.defaultEffort === 'string' ? info.reasoning.defaultEffort : defaultEffort
          } catch {
            efforts = []
          }
        }
        out.push({
          provider: providerId,
          model: modelId,
          label: `${providerId} / ${modelId}`,
          efforts,
          defaultEffort,
        })
      }
    }
    catalog = out
    catalogAt = Date.now()
    return catalog
  }

  /**
   * The shipped default route (deepseek-account/deepseek-flash) is only a
   * preference. Another machine may have a different account or vendor, and
   * forcing a route that does not exist would make the band silently never
   * appear, so adopt a real model the first time we can see the catalog.
   */
  const ensureRoute = async () => {
    if (routeResolved) return true
    const models = await describeModels()
    if (models.length === 0) return false
    routeResolved = true
    if (models.some((item) => item.provider === cfg.provider && item.model === cfg.model)) return true
    const pick = pickRoute(models)
    if (!pick) return false
    console.log(
      `[dsh-session-progress] ${cfg.provider}/${cfg.model} is not available on this machine; using ${pick.provider}/${pick.model}`,
    )
    cfg.provider = pick.provider
    cfg.model = pick.model
    routeFallback = true
    effortProbed = false
    effectiveEffort = cfg.reasoningEffort
    return true
  }

  const configPayload = async () => {
    // Show the real effective route and effort on the settings page even
    // before the first sample of this process.
    await ensureRoute()
    if (!effortProbed) await probeEffort(getLlm())
    const models = await describeModels()
    return {
      config: { ...cfg },
      effectiveRoute: { provider: cfg.provider, model: cfg.model },
      effectiveEffort,
      offeredEfforts,
      models,
      routeFallback,
      catalogEmpty: models.length === 0,
      stateFile: STATE_FILE,
    }
  }

  const configHandler = async (req, res) => {
    if (!isLocalRequest(req)) {
      jsonResponse(res, 403, { error: 'local access only' })
      return
    }
    try {
      if (req.method === 'POST') {
        const body = await readJsonBody(req)
        applyConfig(body)
      }
      jsonResponse(res, 200, await configPayload())
    } catch (error) {
      jsonResponse(res, 400, { error: String(error?.message ?? error) })
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (httpCtx) => {
      httpCtx.effect(
        () => httpCtx.webServer.register({ kind: 'exact', path: SNAPSHOT_PATH, handler: snapshotHandler }),
        'dsh-session-progress: snapshot endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({ kind: 'exact', path: EVENTS_PATH, handler: eventsHandler }),
        'dsh-session-progress: event stream',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({ kind: 'exact', path: DEBUG_PATH, handler: debugHandler }),
        'dsh-session-progress: debug endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({ kind: 'exact', path: LOG_PATH, handler: logHandler }),
        'dsh-session-progress: sample log endpoint',
      )
      httpCtx.effect(
        () => httpCtx.webServer.register({ kind: 'exact', path: CONFIG_PATH, handler: configHandler }),
        'dsh-session-progress: config endpoint',
      )
    })
  }
}

// Exported for the tests: the log label must never be a bare id when a
// session already has a title or an opening request.
export { labelOf, titleOf }
