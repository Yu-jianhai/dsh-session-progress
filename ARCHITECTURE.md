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
| `lib/index.js` | 112 | `nextProgress` | module | const fn |
| `lib/index.js` | 115 | `keep` | apply | const fn |
| `lib/index.js` | 122 | `name` | module | const |
| `lib/index.js` | 123 | `inject` | module | const |
| `lib/index.js` | 136 | `clampNumber` | module | function |
| `lib/index.js` | 143 | `sanitizeConfig` | module | function |
| `lib/index.js` | 172 | `readConfigFile` | module | function |
| `lib/index.js` | 180 | `writeConfigFile` | module | function |
| `lib/index.js` | 196 | `readLogFile` | module | function |
| `lib/index.js` | 207 | `slimEntry` | module | function |
| `lib/index.js` | 212 | `writeLogFile` | module | function |
| `lib/index.js` | 229 | `resumeSeed` | module | function |
| `lib/index.js` | 241 | `readJsonBody` | module | function |
| `lib/index.js` | 271 | `effortIds` | module | function |
| `lib/index.js` | 277 | `idOf` | module | function |
| `lib/index.js` | 286 | `isLocalRequest` | module | function |
| `lib/index.js` | 306 | `jsonResponse` | module | function |
| `lib/index.js` | 317 | `textOf` | module | function |
| `lib/index.js` | 332 | `clip` | module | function |
| `lib/index.js` | 342 | `buildContext` | module | function |
| `lib/index.js` | 370 | `parseProgress` | module | function |
| `lib/index.js` | 397 | `closestEffort` | module | function |
| `lib/index.js` | 417 | `normalizeUsage` | module | function |
| `lib/index.js` | 419 | `count` | apply | const fn |
| `lib/index.js` | 430 | `sumTokens` | module | function |
| `lib/index.js` | 451 | `titleOf` | module | function |
| `lib/index.js` | 488 | `labelOf` | module | function |
| `lib/index.js` | 523 | `cheapRank` | module | function |
| `lib/index.js` | 533 | `pickRoute` | module | function |
| `lib/index.js` | 547 | `apply` | module | function |
| `lib/index.js` | 601 | `frame` | apply | const fn |
| `lib/index.js` | 617 | `frameText` | apply | const fn |
| `lib/index.js` | 622 | `writeFrame` | apply | const fn |
| `lib/index.js` | 633 | `push` | apply | const fn |
| `lib/index.js` | 646 | `broadcast` | apply | const fn |
| `lib/index.js` | 678 | `bumpLog` | apply | const fn |
| `lib/index.js` | 683 | `prune` | apply | const fn |
| `lib/index.js` | 698 | `persist` | apply | const fn |
| `lib/index.js` | 707 | `record` | apply | const fn |
| `lib/index.js` | 720 | `closeTurn` | apply | const fn |
| `lib/index.js` | 746 | `markRunning` | apply | const fn |
| `lib/index.js` | 758 | `clearTimer` | apply | const fn |
| `lib/index.js` | 771 | `onTurnStart` | apply | const fn |
| `lib/index.js` | 798 | `onTurnEnd` | apply | const fn |
| `lib/index.js` | 814 | `scheduleFadeOut` | apply | const fn |
| `lib/index.js` | 840 | `interject` | apply | const fn |
| `lib/index.js` | 895 | `trackCount` | apply | const fn |
| `lib/index.js` | 901 | `schedule` | apply | const fn |
| `lib/index.js` | 921 | `declaredEfforts` | apply | const fn |
| `lib/index.js` | 937 | `probeEffort` | apply | const fn |
| `lib/index.js` | 962 | `findSession` | apply | const fn |
| `lib/index.js` | 976 | `sample` | apply | const fn |
| `lib/index.js` | 990 | `sampleOnce` | apply | const fn |
| `lib/index.js` | 1139 | `reapAbandonedTurns` | apply | const fn |
| `lib/index.js` | 1152 | `tick` | apply | const fn |
| `lib/index.js` | 1186 | `snapshotHandler` | apply | const fn |
| `lib/index.js` | 1191 | `debugHandler` | apply | const fn |
| `lib/index.js` | 1227 | `noteClient` | apply | const fn |
| `lib/index.js` | 1236 | `logHandler` | apply | const fn |
| `lib/index.js` | 1239 | `query` | factory | const fn |
| `lib/index.js` | 1246 | `limit` | factory | const fn |
| `lib/index.js` | 1295 | `eventsHandler` | apply | const fn |
| `lib/index.js` | 1310 | `getLlm` | apply | const fn |
| `lib/index.js` | 1313 | `rescheduleAll` | apply | const fn |
| `lib/index.js` | 1326 | `applyConfig` | apply | const fn |
| `lib/index.js` | 1354 | `describeModels` | apply | const fn |
| `lib/index.js` | 1410 | `ensureRoute` | apply | const fn |
| `lib/index.js` | 1429 | `configPayload` | apply | const fn |
| `lib/index.js` | 1447 | `configHandler` | apply | const fn |
| `lib/client.js` | 90 | `hexToRgb` | factory | function |
| `lib/client.js` | 127 | `flowDecls` | factory | function |
| `lib/client.js` | 141 | `styleRules` | factory | function |
| `lib/client.js` | 194 | `ensureWaterFilter` | factory | function |
| `lib/client.js` | 819 | `cssEscape` | factory | function |
| `lib/client.js` | 830 | `shortId` | factory | function |
| `lib/client.js` | 836 | `formatTokens` | factory | function |
| `lib/client.js` | 844 | `clockOf` | factory | function |
| `lib/client.js` | 853 | `useConfig` | factory | function |
| `lib/client.js` | 901 | `logNotify` | factory | const fn |
| `lib/client.js` | 905 | `logHidden` | factory | const fn |
| `lib/client.js` | 912 | `logFetch` | factory | const fn |
| `lib/client.js` | 960 | `logSchedule` | factory | const fn |
| `lib/client.js` | 973 | `logRefresh` | factory | const fn |
| `lib/client.js` | 979 | `logWatchVisibility` | factory | const fn |
| `lib/client.js` | 988 | `useLog` | factory | function |
| `lib/client.js` | 1014 | `metaLine` | factory | function |
| `lib/client.js` | 1056 | `routeWarning` | factory | function |
| `lib/client.js` | 1082 | `LogRow` | factory | function |
| `lib/client.js` | 1154 | `renderEntry` | factory | function |
| `lib/client.js` | 1165 | `routeLook` | factory | function |
| `lib/client.js` | 1204 | `hueOf` | factory | function |
| `lib/client.js` | 1217 | `groupBySession` | factory | function |
| `lib/client.js` | 1247 | `groupHistory` | factory | function |
| `lib/client.js` | 1284 | `renderColumn` | factory | function |
| `lib/client.js` | 1316 | `useColumnFlip` | factory | function |
| `lib/client.js` | 1355 | `HistorySegment` | factory | function |
| `lib/client.js` | 1412 | `renderHistoryColumn` | factory | function |
| `lib/client.js` | 1431 | `ColumnList` | factory | function |
| `lib/client.js` | 1443 | `renderColumns` | factory | function |
| `lib/client.js` | 1447 | `emptyState` | factory | function |
| `lib/client.js` | 1452 | `SettingsCard` | factory | function |
| `lib/client.js` | 1816 | `SettingsPanel` | factory | function |
| `lib/client.js` | 1821 | `ProgressLogCard` | factory | function |
| `lib/client.js` | 1840 | `SampleLogPanel` | factory | function |
| `lib/client.js` | 1901 | `SampleLogIcon` | factory | function |
| `lib/client.js` | 1919 | `apply` | factory | function |
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
10. **缺失滤镜时不要输出 `filter: url(#…)`** —— 浏览器会整条不画。必须先 `filtersReady` 判断（0.12.0 的兜底）。
11. **高光的宽度不要用 `clip-path` 跟随** —— 与填充的 `width` 过渡不同步，会表现成「瞬移」（0.12.0 改成两层同用 `width`）。
12. **`titleOf` 的缓存必须有 `seq`** —— 没有序号就分不清「旧标题」和「新标题」，测试里的假会话 id 相同、无 `seq`，缓存一开就串味。

## 样式系统（改外观只看这块）

- 三张注入表，顺序固定：`base`（结构）→ `look`（颜色/形状，覆盖 base）→ `dynamic`（每帧重写 `[data-row-key="session:<id>"]{--dsp-p:…;--dsp-o:…}`）→ `theme`（`color-scheme` + 原生下拉）。
- 结构规则只写 `::after` 的定位与 `transition`；颜色、厚度、裁切都在 `styleRules(look)` 返回的规则里。
- 深色判定按权威信号：`body[data-ds-dark-theme]` → `html[data-ds-theme-source]` → `computedStyle.colorScheme` → class/data-* → 背景亮度 → `matchMedia`。
- `routeLook(state, incoming, source)` 是纯函数：`server` 帧不能盖掉用户正在预览的样式（0.4.1 的 bug）。
- **色带的两个伪元素分工**：`::after` 是填充本体（宽度 `--dsp-p`，颜色/形状来自 look 表，`z-index: -2`）；`::before` 是流动高光（`z-index: -1`，压在上面），**自己也用 `width: var(--dsp-p, 0%)` + `border-radius: inherit`**，不再用 `clip-path` 去裁（0.12.0）。
  为什么改：填充用 `width` 过渡、高光用 `clip-path: inset()` 过渡，两个属性的插值采样不同步，进度落地那一瞬间高光会错位成「瞬移/突变」（用户三次反馈的那个）。同一个 `width` + 同一条缓动，两层的进退在物理上就不可能脱节；圆角交给 `border-radius` 自己裁，0.11.1 的方角问题也不会回来。`segments` 样式保留自己的 `clip-path`，那是填充形状，不是高光。
  高光是一条 **200px 周期的平铺斜纹**，用 `@keyframes dsp-flow` 平移 `background-position`（0.9.3 从 transform 改过来的：transform 方案里元素只有 100% 宽，走一趟就空半天，看起来像「只在进度变化时闪一下」）。一周期正好等于跨行位移，所以接缝对齐、**任何宽度、任何时刻都有至少一道在带内**。代价是每帧重画这条小渐变。
  速度由 `--dsp-flow-duration` 决定（慢 10.5s / 标准 5.9s / 快 3s），写在 look 表里。
  `underline` 样式把自己的高光改回 3px 贴底（`height:3px;border-radius:2px`），否则一条全高光带会悬在细线上方；它的 `opacity` 绑 `--dsp-o`，色带淡出时高光一起淡出。宿主自己也会用 `::before`/`::after`（拖拽放置指示线），但只在拖拽瞬间生效，平时不冲突。
- **水波质感（0.11.0）**：`::before` 的 `filter: url(#dsp-water)` 指向插件自己注入 `<body>` 的 `<svg id="dsp-water-defs">`，里面是 `feTurbulence`（`baseFrequency="0.006 0.022"`、`numOctaves="2"`）→ `feDisplacementMap`（`scale="18"`，取 R/G 通道）→ `feGaussianBlur`（`stdDeviation="0.45"`）。`high` 另外加 `backdrop-filter: blur(1.6px) saturate(1.45) brightness(1.06)`。
  - **参数不能想当然**：第一版 `baseFrequency 0.014 0.045 / scale 5` 在 32px 高的行上几乎看不见；`0.008 0.028 / scale 13` 仍偏弱；`0.006 0.022 / scale 18` 才在 2.6 倍放大对照图里清楚看出边缘摆动。改参数就去 `dev/water.html` 看。
  - 生成水波规则的是纯函数 `flowDecls(look)`；`styleRules` 现在同时输出 `::after` 与 `::before` 两组规则，`underline` 的 3px 特例仍写在后者里。
  - 注入失败（没有 `document.createElementNS`）时返回 `null`、整套滤镜不生效，但**不能抛错** —— 否则整个 render 停摆，色带会整条消失（就是 0.4.2 那个 bug 的形态）。
- **实验性折射（0.12.0）**：`flowQuality: 'refract'` 时 `::before` 改用 `filter: url(#dsp-refract)`，那个滤镜在同一张 `<svg>` 里：`feTurbulence`（`baseFrequency="0.005 0.020"`、`numOctaves="3"`、`seed="11"`）→ `feDisplacementMap scale="24"` → 一份 `feOffset dx=-1.3` 抽红、一份 `dx=+1.3` 抽蓝（`feColorMatrix` 只留单通道）→ 两次 `feBlend mode="screen"` → `feGaussianBlur 0.22`。色散彩边就是这么来的：位移量大的地方，红蓝两份对不齐。比 `high` 更贵，所以标注「实验」，卡就往 `medium` 退。
  - **引用了不存在的滤镜会让元素整个不绘制**（不是"没效果"，是"没有"）。`apply()` 里 `ensureWaterFilter()` 失败时置 `filtersReady = false`，`flowDecls` 随即只输出时长、不输出 `filter`，色带退回纯色高光。
- **一条采样只用一行**（0.10.0）：`.dsp-row > button.dsp-row-line` 是五列网格（时间 56 / 进度 34 / 涨跌 26 / 阶段名 flex / 耗时），点开才渲染 `.dsp-row-detail`（模型、档位、token 拆分、`raw`）。之前的 `.dsp-item` 每行是带边框的卡片 + 八字段 wrap + `<pre>` 原文，是「看起来杂乱」的主因。列表密度靠 `.dsp-row + .dsp-row` 的发丝线分隔，不靠间隙。
- **列里的东西不许缩**：`.dsp-column-body` 在面板里是有明确高度的 flex 容器，子项默认 `flex-shrink: 1` 会把自己压扁而不是溢出——历史列曾因此把 12 轮压成 39px 且永远不出滚动条（0.8.1）。`.dsp-column-body > *` 与 `.dsp-seg-body > *` 都锁 `flex: none`；几何用 `dev/history-scroll.html` 的 `window.__probe()` 量。

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
