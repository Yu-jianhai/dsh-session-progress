# ARCHITECTURE — 这张地图就是代码

> 改代码前读这一页，别通读源码。**符号索引里的行号由 `node scripts/index.cjs` 生成**（该脚本只在仓库里，不随包发布），手写说明部分不要删。
>
> 最后核对：0.12.0（实验折射 + 高光改 width 跟随 + 快照/恢复）
>
> **踩过的坑按现象查 `PROBLEMS.md`**，这里只放结构和不变量。

## 一句话

宿主（`lib/index.js`）每 30 秒用一个轻模型读当前轮次上下文，算出 `p`（0–100）；浏览器（`lib/client.js`）把这个数字写成会话行上的 CSS 变量 `--dsp-p`，由一条 `::after` 色带画出来。判断模型的每次原始回答、以及每个轮次的完整记录，都落在「进度日志」里。

## 数据流（一条线，别分叉）

```
turn/start ──► running.add ──► schedule(firstDelayMs)
user 插嘴 ──► interject ──► replan = true ──► 提前重采样（附「目标变了」提示）
                                  │
                     sampleOnce() ── llm.stream(上下文) ──► {"p":68,"note":"…"}
                                  │
                     record(entry) + entry.p = nextProgress(...)
                                  │
                     frame() ──SSE──► client: 写 <style> 里的 --dsp-p / --dsp-o
turn/end ──► closeTurn('completed') ──► p=100 ──► 淡出 ──► state.delete
新 turn 压在旧 turn 上 / 进程重启 ──► closeTurn('interrupted') ──► 历史轮 + 接续点
```

三个来源都会往 `/log` 里写：`active`（正在跑的本轮）、`closed + completed`（跑完的）、`closed + interrupted`（被打断、下次接着跑的）。

## 文件职责

| 文件 | 管什么 | 不要放什么 |
|---|---|---|
| `lib/index.js` | 抓事件、调度采样、调 `llm.stream`、维护 `state`/`log`/`turns`、四个 HTTP 端点、持久化配置与日志 | 任何 DOM、任何 CSS |
| `lib/client.js` | 注入三张样式表、把帧写成 CSS 变量、`SampleLogPanel`/`ProgressLogCard`/`SettingsCard`、`main`+`sidebar.panellist`+`plugins.bundle.config` 三个座位 | 任何模型调用、任何滚动/轮询之外的状态 |
| `cordis.patch.yml` | 只写 config（间隔、首选模型等），**故意不写 provider/model 的兜底路线** | 大段注释以外的逻辑 |
| `test/*.mjs` | 十套：`label` `look` `direction` `client-boot` `history` `host-smoke` `route-fallback` `panel-group` `perf-contract` `render` | 依赖真实 DSH |
| `dev/*` | 探针页：`harness.html`（色带外观）、`styles.html`（六种样式）、`flow.html`（高光）、`water.html`（四档质感）、`panel.html`（日志面板）、`seam.html`（周期取像素） | 生成物不进包，`gen-*.mjs` 留下 |
| `scripts/index.cjs` | 重算本文件的符号索引 | — |
| `scripts/snapshot.cjs` / `restore.cjs` | 开工前拍快照、崩了一键回滚（`backups/`，不进 git） | — |
| `PROBLEMS.md` | 现象→原因→修法→守卫的坑表 | — |

## HTTP 端点（全部只认本机）

| 路径 | 用途 | 关键字段 |
|---|---|---|
| `/plugins/dsh-session-progress/events` | SSE 推帧 | `{type:'progress', sessions:[{id,p,o}], look:{color,opacity,style}}` |
| `/snapshot` | 一次性当前帧 | 同上 |
| `/debug` | 自检 | `running`、`turns`、`resumeP`、`active`、`closed`、`offeredEfforts`、`clientTags`、`logHits`/`logApply`（客户端自报版本与取数次数） |
| `/log?limit=N` | 日志 | `entries`(active)、`active`(本轮次数)、`history`(closed)、`historyTotal`、`interruptedTotal`、`tokens`、`config`、`version` |
| `/log?limit=N&since=V` | 日志（增量） | 版本未变时只回 `{version, unchanged:true, tokens}`，不再发全文 |
| `/config` GET/POST | 读写配置 | 见下表 |

## 空转成本（0.7.0 定的三条线）

侧栏开着几小时才是常态，所以「什么都没变」的时刻必须几乎不花钱。三处被钉死：

1. **轮询**：客户端只有一个 store（`logStore`），面板与设置卡片共用；每 3 秒带 `since=<version>`，没变就只回一行。`document.hidden` 时完全不发请求，切回前台立刻补一次。安静 45 秒后自动降到 12 秒一次。
2. **推帧**：`broadcast()` 先把帧 `JSON.stringify` 一次（不是每个客户端一次），与上次相同就不发；空闲超 30 秒才发一条 `: ping` 保活。**新订阅者的首帧也算「当前帧」**，否则下一个 tick 会把它当变化再发一遍。
3. **重绘**：`render()` 用 `lastCss` 比对，相同就不碰 `textContent`；FLIP 只在列顺序变化时测量（`orderKey`）。

落盘时 `raw` 截到 400 字（`RAW_IN_FILE`），内存里仍是完整的 2000 字——历史列只显示 `note`，不需要原文。

## 配置项（`sanitizeConfig` 是唯一入口）

| 键 | 默认 | 范围 | 说明 |
|---|---|---|---|
| `enabled` | `true` | — | 关掉就完全不采样 |
| `provider` / `model` | `deepseek-account` / `deepseek-flash` | 目录里存在才用 | 不存在时 `ensureRoute` 自动换一个 |
| `reasoningEffort` | `off` | 模型目录声明的档位 | 目录优先，`resolveModelInfo` 只作兜底 |
| `firstDelayMs` | `8000` | 500–60000 | 一轮开始后第一次采样等多久 |
| `intervalMs` | `30000` | 5000–3600000 | 之后每次间隔 |
| `interjectDelayMs` | `2500` | 500–30000 | 插嘴后多久补采一次 |
| `maxSessions` | `3` | 1–10 | 同时画几条 |
| `maxContextChars` | `6000` | 1000–20000 | 喂给判断模型的上下文上限 |
| `timeoutMs` | `30000` | 1000–120000 | 单次调用超时 |
| `color` / `opacity` / `style` | `#90AFFF` / `0.6` / `band` | `#RRGGBB` / 0.05–1 / 六选一 | 色带外观 |
| `flow` | `true` | 布尔 | 流动高光总开关 |
| `flowSpeed` | `slow` | `slow`/`normal`/`fast` | 一圈 10.5 / 5.9 / 3 秒 |
| `flowQuality` | `medium` | `refract`/`high`/`medium`/`low`/`off` | 折射多一行「实验」项；非法值退回默认 |

## 符号索引

<!-- INDEX:BEGIN -->
| 文件 | 行 | 符号 | 位置 | 类型 |
|---|---|---|---|---|
| `lib/index.js` | 53 | `LOG_FILE` | module | const fn |
| `lib/index.js` | 114 | `nextProgress` | module | const fn |
| `lib/index.js` | 117 | `keep` | apply | const fn |
| `lib/index.js` | 124 | `name` | module | const |
| `lib/index.js` | 125 | `inject` | module | const |
| `lib/index.js` | 138 | `clampNumber` | module | function |
| `lib/index.js` | 145 | `sanitizeConfig` | module | function |
| `lib/index.js` | 175 | `readConfigFile` | module | function |
| `lib/index.js` | 183 | `writeConfigFile` | module | function |
| `lib/index.js` | 199 | `readLogFile` | module | function |
| `lib/index.js` | 210 | `slimEntry` | module | function |
| `lib/index.js` | 215 | `writeLogFile` | module | function |
| `lib/index.js` | 232 | `resumeSeed` | module | function |
| `lib/index.js` | 244 | `readJsonBody` | module | function |
| `lib/index.js` | 274 | `effortIds` | module | function |
| `lib/index.js` | 280 | `idOf` | module | function |
| `lib/index.js` | 289 | `isLocalRequest` | module | function |
| `lib/index.js` | 309 | `jsonResponse` | module | function |
| `lib/index.js` | 320 | `textOf` | module | function |
| `lib/index.js` | 335 | `clip` | module | function |
| `lib/index.js` | 345 | `buildContext` | module | function |
| `lib/index.js` | 373 | `parseProgress` | module | function |
| `lib/index.js` | 400 | `closestEffort` | module | function |
| `lib/index.js` | 420 | `normalizeUsage` | module | function |
| `lib/index.js` | 422 | `count` | apply | const fn |
| `lib/index.js` | 433 | `sumTokens` | module | function |
| `lib/index.js` | 454 | `titleOf` | module | function |
| `lib/index.js` | 491 | `labelOf` | module | function |
| `lib/index.js` | 526 | `cheapRank` | module | function |
| `lib/index.js` | 536 | `pickRoute` | module | function |
| `lib/index.js` | 550 | `apply` | module | function |
| `lib/index.js` | 604 | `frame` | apply | const fn |
| `lib/index.js` | 625 | `frameText` | apply | const fn |
| `lib/index.js` | 630 | `writeFrame` | apply | const fn |
| `lib/index.js` | 641 | `push` | apply | const fn |
| `lib/index.js` | 654 | `broadcast` | apply | const fn |
| `lib/index.js` | 686 | `bumpLog` | apply | const fn |
| `lib/index.js` | 691 | `prune` | apply | const fn |
| `lib/index.js` | 706 | `persist` | apply | const fn |
| `lib/index.js` | 715 | `record` | apply | const fn |
| `lib/index.js` | 728 | `closeTurn` | apply | const fn |
| `lib/index.js` | 754 | `markRunning` | apply | const fn |
| `lib/index.js` | 766 | `clearTimer` | apply | const fn |
| `lib/index.js` | 779 | `onTurnStart` | apply | const fn |
| `lib/index.js` | 807 | `onTurnEnd` | apply | const fn |
| `lib/index.js` | 823 | `scheduleFadeOut` | apply | const fn |
| `lib/index.js` | 849 | `interject` | apply | const fn |
| `lib/index.js` | 904 | `trackCount` | apply | const fn |
| `lib/index.js` | 915 | `trimToLimit` | apply | const fn |
| `lib/index.js` | 937 | `schedule` | apply | const fn |
| `lib/index.js` | 957 | `declaredEfforts` | apply | const fn |
| `lib/index.js` | 973 | `probeEffort` | apply | const fn |
| `lib/index.js` | 998 | `findSession` | apply | const fn |
| `lib/index.js` | 1020 | `sample` | apply | const fn |
| `lib/index.js` | 1049 | `sampleOnce` | apply | const fn |
| `lib/index.js` | 1201 | `reapAbandonedTurns` | apply | const fn |
| `lib/index.js` | 1214 | `tick` | apply | const fn |
| `lib/index.js` | 1248 | `snapshotHandler` | apply | const fn |
| `lib/index.js` | 1253 | `debugHandler` | apply | const fn |
| `lib/index.js` | 1292 | `noteClient` | apply | const fn |
| `lib/index.js` | 1301 | `logHandler` | apply | const fn |
| `lib/index.js` | 1304 | `query` | factory | const fn |
| `lib/index.js` | 1311 | `limit` | factory | const fn |
| `lib/index.js` | 1364 | `eventsHandler` | apply | const fn |
| `lib/index.js` | 1379 | `getLlm` | apply | const fn |
| `lib/index.js` | 1382 | `rescheduleAll` | apply | const fn |
| `lib/index.js` | 1395 | `applyConfig` | apply | const fn |
| `lib/index.js` | 1423 | `describeModels` | apply | const fn |
| `lib/index.js` | 1479 | `ensureRoute` | apply | const fn |
| `lib/index.js` | 1498 | `configPayload` | apply | const fn |
| `lib/index.js` | 1516 | `configHandler` | apply | const fn |
| `lib/client.js` | 33 | `openLogPanel` | factory | function |
| `lib/client.js` | 113 | `styleCss` | factory | function |
| `lib/client.js` | 139 | `hexToRgb` | factory | function |
| `lib/client.js` | 236 | `gradient` | factory | const fn |
| `lib/client.js` | 329 | `flowDecls` | factory | function |
| `lib/client.js` | 363 | `sheetCss` | factory | function |
| `lib/client.js` | 368 | `styleRules` | factory | function |
| `lib/client.js` | 465 | `ensureWaterFilter` | factory | function |
| `lib/client.js` | 1120 | `cssEscape` | factory | function |
| `lib/client.js` | 1131 | `shortId` | factory | function |
| `lib/client.js` | 1137 | `formatTokens` | factory | function |
| `lib/client.js` | 1145 | `clockOf` | factory | function |
| `lib/client.js` | 1154 | `useConfig` | factory | function |
| `lib/client.js` | 1206 | `logNotify` | factory | const fn |
| `lib/client.js` | 1210 | `logHidden` | factory | const fn |
| `lib/client.js` | 1217 | `logFetch` | factory | const fn |
| `lib/client.js` | 1267 | `logWantHistory` | factory | const fn |
| `lib/client.js` | 1275 | `logMoreRows` | factory | const fn |
| `lib/client.js` | 1280 | `logSchedule` | factory | const fn |
| `lib/client.js` | 1293 | `logRefresh` | factory | const fn |
| `lib/client.js` | 1299 | `logWatchVisibility` | factory | const fn |
| `lib/client.js` | 1308 | `useLog` | factory | function |
| `lib/client.js` | 1334 | `metaLine` | factory | function |
| `lib/client.js` | 1376 | `routeWarning` | factory | function |
| `lib/client.js` | 1402 | `LogRow` | factory | function |
| `lib/client.js` | 1474 | `renderEntry` | factory | function |
| `lib/client.js` | 1485 | `routeLook` | factory | function |
| `lib/client.js` | 1525 | `hueOf` | factory | function |
| `lib/client.js` | 1538 | `groupBySession` | factory | function |
| `lib/client.js` | 1568 | `groupHistory` | factory | function |
| `lib/client.js` | 1605 | `renderColumn` | factory | function |
| `lib/client.js` | 1651 | `useColumnFlip` | factory | function |
| `lib/client.js` | 1690 | `HistorySegment` | factory | function |
| `lib/client.js` | 1747 | `renderHistoryColumn` | factory | function |
| `lib/client.js` | 1766 | `ColumnList` | factory | function |
| `lib/client.js` | 1781 | `renderHistoryPlaceholder` | factory | function |
| `lib/client.js` | 1810 | `renderColumns` | factory | function |
| `lib/client.js` | 1814 | `emptyState` | factory | function |
| `lib/client.js` | 1819 | `SettingsCard` | factory | function |
| `lib/client.js` | 2268 | `SettingsPanel` | factory | function |
| `lib/client.js` | 2280 | `ProgressLogCard` | factory | function |
| `lib/client.js` | 2319 | `SampleLogPanel` | factory | function |
| `lib/client.js` | 2380 | `SampleLogIcon` | factory | function |
| `lib/client.js` | 2398 | `apply` | factory | function |
<!-- INDEX:END -->

## 绝不能做（每条都真炸过一次）

1. **不要在 `render()` 里读 `look`** —— 模块级变量已改名 `lookState`，读到旧名字抛 `ReferenceError`，被帧处理器的 `try/catch` 吞掉后**一条色带都不画**，控制台只有一行 `bad frame`（0.4.2 就是这么挂的）。
2. **CSS 注释里不要写反引号** —— `BASE_CSS` 是模板字符串，一个反引号直接提前结束它，报 `SyntaxError: Unexpected identifier`。
3. **`@property --dsp-p` 必须 `inherits: true`** —— 伪元素 `::after` 读不到不继承的自定义属性，宽度恒为 `initial-value: 0%`（整条不可见，且不报错）。
4. **`\\\\n` 与 `\\n` 分清** —— 用 python 写回源码时，模板字符串里的 `\n` 只能是单反斜杠；写错会让断言匹配不上或者把换行写进字符串字面量。
5. **不要给 `dsh.client.inject` 传函数** —— 必须是静态数组，否则整个 bundle 被判零依赖、静默禁用。
6. **不要在宿主半侧 `inject: ['llm']`** —— `llm` 是可选服务，用 `ctx.get('llm')`；写进 inject 会让没配模型的机器加载失败。
7. **`ensureRoute` 失败时不要死循环重试** —— `warnedNoCatalog` 只警告一次，然后等下一个 `intervalMs`。
8. **`push()` 写完一帧必须更新 `lastFrameText`** —— 它是新订阅者的首帧，若不认作「当前帧」，下一个 tick 会把同一内容当变化再发一遍（0.7.0 的 `perf-contract` 就是靠这条抓住的）。
9. **不要把方向判断搬回宿主** —— 曾经用 `max(上次, 新值)` 兜抖动，结果模型永远无法承认「上次估高了」；提示里给了上一次的数字，就该让它自己定。
10. **缺失滤镜时不要输出 `filter: url(#…)`** —— 浏览器会整条不画。`SURFACES` 表之外还要看 `filtersReady`（0.12.0 的兜底，0.13.0 抽进表里）。
11. **表面的宽度不要用 `clip-path` 跟随** —— 与填充的 `width` 过渡不同步就是「瞬移」；两层必须同用一个 `width` 与同一条缓动（0.13.0 的 `SURFACES` 表）。
12. **`titleOf` 的缓存必须有 `seq`** —— 没有序号就分不清「旧标题」和「新标题」，测试里的假会话 id 相同、无 `seq`，缓存一开就串味。
13. **`above: true` 的档位必须给 `tint`** —— 水层盖到文字上方却不铺一层淡底色，字会被 `backdrop-filter` 糊成看不清；tint 是"能扭到"与"还能读"之间的那条线。

## 样式系统（改外观只看这块）

- 三张注入表，顺序固定：`base`（结构）→ `look`（颜色/形状，覆盖 base）→ `dynamic`（每帧重写 `[data-row-key="session:<id>"]{--dsp-p:…;--dsp-o:…}`）→ `theme`（`color-scheme` + 原生下拉）。
- 结构规则只写 `::after` 的定位与 `transition`；颜色、厚度、裁切都在 `styleRules(look)` 返回的规则里。
- 深色判定按权威信号：`body[data-ds-dark-theme]` → `html[data-ds-theme-source]` → `computedStyle.colorScheme` → class/data-* → 背景亮度 → `matchMedia`。
- `routeLook(state, incoming, source)` 是纯函数：`server` 帧不能盖掉用户正在预览的样式（0.4.1 的 bug）。
- **两层分工（0.15.0 重构后）**：`::after` 是**填充**（宽度 `--dsp-p`，颜色/形状来自 `LOOK_STYLES`）；`::before` 是**表面**（会移动的那一层）。行为不写在 CSS 里，写在 `SURFACES` 表里，每档只说它「怎么动、画什么」：
  ```js
  SURFACES = {
    off:     { motion: 'none' },
    low:     { motion: 'drift', pattern: 'sweep' },
    medium:  { motion: 'drift', pattern: 'sweep', water: true },
    high:    { motion: 'drift', pattern: 'sweep', water: true, glass: true },
    refract: { motion: 'cross', pattern: 'cross', emboss: true, blur: 'blur(1.5px) saturate(1.06)' },
  }
  ```
  `FLOW_QUALITIES` 由这张表派生，**加一档只改这里**。`flowDecls(look)` 只做三件事：按 `pattern` 取渐变、按 `motion` 取动画名、按 `water`/`glass` 追加滤镜。
- **实验 · 彩虹走马灯（0.17.0，0.18.0 改成柔光版）**：`rainbow: true` 时 `styleRules` 在**填充层**追加 `background:${RAINBOW}` 与 `animation:dsp-rainbow <beat> linear infinite`（`RAINBOW_PERIOD = 168`、`RAINBOW_TRAVEL = 168 / sin(100°) = 170.592px`，和表面用的是同一套数学），并压一层 `box-shadow:inset 0 0 0 100px rgba(0,0,0,0.12)` 保证文字可读。`flow: false` 时只上静态彩虹、不加动画。`@keyframes dsp-rainbow` 由 `MOTION_CSS` 一并生成，所以永远和图上的周期一致。 0.18.0 起色标改成等距（不再用 `0 24px` 这种硬边写法，浏览器会在相邻色标之间插值），并把**表面层借来当光晕**：同一份 `RAINBOW` 加上 `filter:blur(6px) saturate(1.35)` 与 `mix-blend-mode:screen; opacity:0.45;`，再叠 `animation:dsp-rainbow` 与填充同步。这三条追加在 `layer`（表面声明数组）里、`flowDecls` 之后，所以后写的 `background-image` / `filter` / `animation` 会覆盖表面那套高光——这是有意的：打开彩虹时表面就从扫光换成光晕。
- **可见才动（0.16.0）**：`BASE_CSS` 的 `::before` 是 `animation-play-state: paused`，`[data-row-key^="session:"].dsp-live::before` 才 `running`。`apply()` 里的 `startRowGating()` 用 `IntersectionObserver`（`rootMargin: 120px`）给行加 `dsp-live`，另用 `MutationObserver`（rAF 合并）重扫新增行——侧栏有虚拟化，行会被替换掉。`html[data-dsp-hidden] ::before{animation-play-state:paused}` 在 `visibilitychange` 时切换。**这两处都是"减载"，不改变任何视觉效果**。
- **为什么位移没用 transform**：伪元素只有 `::before`/`::after` 两个，表面层同时要承担 `width: var(--dsp-p)` 与裁切。把位移改成 `transform` 就必须把裁切交给第三个元素（不存在），或在宿主行上加 mask（等于改宿主 DOM，AGENTS.md 禁止）。所以保留 `background-position`，靠"动画范围本来就限制在 `width` 内 + `clip-path` 裁外溢"来兜住成本。
- **日志按需（0.16.0）**：`/log` 带 `since` 短路、`history=0` 不带历史；客户端一列只画 `logStore.rowLimit = 40` 条，多出「还有 N 条」；历史为空时渲染 `renderHistoryPlaceholder()`（「加载历史」按钮 → `logWantHistory()`）。
- **同屏数量（0.16.0）**：`frame()` 带 `limit: clamp(maxSessions)`，会话按 `entry.at` 降序 `slice(0, limit)`；`applyConfig` 末尾调 `trimToLimit()` 让改设置立刻生效。
- **一套动作数学**：`AXIS_DEG = 100`、`PERIOD = 264`（沿轴）、`TRAVEL = PERIOD / sin(100°) = 268.073px`（跨行）。渐变用 `PERIOD`/`HALF` 生成，关键帧用 `TRAVEL` 生成，**两者都不手写数字**：
  - `MOTIONS.drift` → `@keyframes dsp-drift`：两层同向走一个周期；
  - `MOTIONS.cross` → `@keyframes dsp-cross`：亮带向前、暗带向后，各自一个周期；
  - `MOTION_CSS` 被 `sheetCss(look)` 拼在规则前面，写进同一张 look 样式表 —— 关键帧永远跟着渐变的周期走，不可能脱节。
  - 速度只由 `--dsp-flow-duration` 决定（慢 10.5s / 标准 5.9s / 快 3s）；`BASE_CSS` 里 `animation: none;`，动作名完全交给 look 表。
- **同步时钟**：`BASE_CSS` 在行上声明 `--dsp-progress-ms: 900ms`、`--dsp-progress-ease`、`--dsp-fade-ms: 280ms`，填充与表面**两层的 `transition` 都引用这三个变量** —— 一个属性、一条缓动，物理上不可能错位（0.11.0 那次「瞬移」就是两层各用一套插值）。
- **两层同宽**：两层都写 `width: var(--dsp-p)`，表面另有**恒定**的 `clip-path: inset(0 round var(--dsw-radius-md, 8px))`。`width` 负责跟随进度，`clip-path` 负责裁住滤镜外溢的像素（滤镜区域是 `-25% … 150%`，`border-radius` 裁不住）；裁剪不参与过渡，所以不会把 0.11.0 的问题带回来。
- **水波质感（0.11.0，参数照 32px 真实行高调的）**：`#dsp-water` 是 `feTurbulence`（`baseFrequency="0.006 0.022"`、`numOctaves="2"`）→ `feDisplacementMap scale="18"` → `feGaussianBlur 0.45`。第一版 `0.014 0.045 / scale 5` 在 32px 行上几乎看不见。注入失败时返回 `null`、`filtersReady = false`，整套滤镜声明被跳过 —— **不能抛错**，否则 render 停摆、色带整条消失（0.4.2 的形态）。
- **实验 · 流光（0.14.0，0.15.0 并入同一套动作）**：`refract` 档「表面自己在流」——`CROSS_LIGHT` 向右、`CROSS_SHADE` 向左（周期都等于位移），表面 `blur(1.5px) saturate(1.06)`，填充层加浮雕内阴影（上沿提亮、下沿压暗）。它**永远在文字下面**；0.13.0 那版把水膜盖到文字上方用 `backdrop-filter` 扭字形，效果真实但把字抹糊、整层重合成也贵，已撤。锥形光（`conic-gradient` + 动画角度）试过，32px 扁条上会被拉成一片亮，读不出「在转」。
- **列里的东西不许缩**- **列里的东西不许缩**：`.dsp-column-body` 在面板里是有明确高度的 flex 容器，子项默认 `flex-shrink: 1` 会把自己压扁而不是溢出——历史列曾因此把 12 轮压成 39px 且永远不出滚动条（0.8.1）。`.dsp-column-body > *` 与 `.dsp-seg-body > *` 都锁 `flex: none`；几何用 `dev/history-scroll.html` 的 `window.__probe()` 量。

## 轮次与历史（0.6.0 新增）

- `turns: Map<sessionId, number>`：`turn/start` 时 +1；`record()` 每条样本都带 `turn`。
- `log` 是一个数组，每条有 `phase: 'active' | 'closed'` 与 `outcome: 'completed' | 'interrupted' | ''`。
- `closeTurn(id, outcome)`：把该会话所有 `active` 样本冻结；`interrupted` 时用 `resumeSeed()` 算出接续点存进 `resumeP`。
- 下次 `turn/start`：`entry.p = resumeP.get(id) ?? 0`，并给判断模型加一句「上一轮被打断，已到 X%，接着算」。
- 持久化：`~/.dsh/session-progress.log.json`（`DSP_LOG_FILE` 可覆盖），1.2 秒防抖写；退出时兜底写一次。启动时把残留的 `active` 全部改判 `interrupted`。
- **方向由判断模型定**（0.8.0）：`nextProgress(current, parsed)` 只做 0–95 夹紧与取整，不再取 `max`；提示里固定带 `before` 与上一次它自己写的 `note`；日志条目多一个 `prev`，前端据此画 `+5` / `-3`。

## 测试矩阵

| 文件 | 守住什么 |
|---|---|
| `test/label.mjs` | 会话名取值链：`session/title` → 首句 → 短 id |
| `test/host-smoke.mjs` | 端到端：采样 → 方向 → 插嘴上调/下调 → usage → 配置归一化与持久化 |
| `test/route-fallback.mjs` | 目录缺模型 / 目录为空两条路径 |
| `test/panel-group.mjs` | `groupBySession`/`formatTokens` 等纯函数 |
| `test/look.mjs` | 六种样式都带颜色、坏输入回落、无 CSS 注入 |
| `test/client-boot.mjs` | 把浏览器半侧真启动一遍（桩 DOM） |
| `test/direction.mjs` | `nextProgress` 两个方向都采纳、0–95 夹紧、解析失败保留原值 |
| `test/history.mjs` | 轮次关闭、中断接续、重启后残留 active 改判 interrupted、`agent/disposed` 收尾、磁盘持久化 |
| `test/perf-contract.mjs` | `/log?since` 增量、SSE 去重与保活、落盘 raw 截断、`titleOf` 缓存、客户端自报（`client`/`beat`/`applied`） |
| `test/render.mjs` | 四个 slot 真渲染：空 payload 不抛错、满 payload 出结构（`data.active` 空指针就是这么抓到的） |

## 发布

```bash
npm test && npm run check
git add -A && git commit -m "feat: … (0.x.y)"      # 署名 Ne_Rn
HTTPS_PROXY=http://127.0.0.1:7897 git push origin main
node dev/release.cjs v0.x.y "标题" notes.md          # 自动加「大鲸鱼在线写插件」小字
```

- 发布脚本必须 `.cjs`（仓库 `"type": "module"`）。
- token 从 `git credential fill` 取，不落盘、不进 git config。
