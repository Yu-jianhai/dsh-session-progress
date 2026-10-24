# ARCHITECTURE — 这张地图就是代码

> 改代码前读这一页，别通读源码。**符号索引里的行号由 `node scripts/index.cjs` 生成**，手写说明部分不要删。
>
> 最后核对：0.6.0（历史轮 + 接续）

## 一句话

宿主（`lib/index.js`）每 30 秒用一个轻模型读当前轮次上下文，算出 `p`（0–100）；浏览器（`lib/client.js`）把这个数字写成会话行上的 CSS 变量 `--dsp-p`，由一条 `::after` 色带画出来。判断模型的每次原始回答、以及每个轮次的完整记录，都落在「进度日志」里。

## 数据流（一条线，别分叉）

```
turn/start ──► running.add ──► schedule(firstDelayMs)
user 插嘴 ──► interject ──► replan = true ──► 提前重采样
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
| `test/*.mjs` | 七套：`label` `host-smoke` `route-fallback` `panel-group` `look` `client-boot` `replan` | 依赖真实 DSH |
| `dev/*` | 探针页：`harness.html`（色带外观）、`select-theme.html`（下拉深色）、`styles.html`（六种样式）、`columns.html`（竖列几何） | 被 `package.json files` 排除，不进包 |
| `scripts/index.cjs` | 重算本文件的符号索引 | — |

## HTTP 端点（全部只认本机）

| 路径 | 用途 | 关键字段 |
|---|---|---|
| `/plugins/dsh-session-progress/events` | SSE 推帧 | `{type:'progress', sessions:[{id,p,o}], look:{color,opacity,style}}` |
| `/snapshot` | 一次性当前帧 | 同上 |
| `/debug` | 自检 | `running`、`turns`、`resumeP`、`active`、`closed`、`offeredEfforts` |
| `/log?limit=N` | 日志 | `entries`(active)、`history`(closed)、`historyTotal`、`interruptedTotal`、`tokens`、`config` |
| `/config` GET/POST | 读写配置 | 见下表 |

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
| `color` / `opacity` / `style` | `#90AFFF` / `0.6` / `band` | `#RRGGBB` / 0.05–1 / 六选一 | 只管外观 |

## 符号索引

<!-- INDEX:BEGIN -->
| 文件 | 行 | 符号 | 位置 | 类型 |
|---|---|---|---|---|
| `lib/index.js` | 43 | `LOG_FILE` | module | const fn |
| `lib/index.js` | 92 | `nextProgress` | module | const fn |
| `lib/index.js` | 97 | `name` | module | const |
| `lib/index.js` | 98 | `inject` | module | const |
| `lib/index.js` | 111 | `clampNumber` | module | function |
| `lib/index.js` | 118 | `sanitizeConfig` | module | function |
| `lib/index.js` | 140 | `readConfigFile` | module | function |
| `lib/index.js` | 148 | `writeConfigFile` | module | function |
| `lib/index.js` | 164 | `readLogFile` | module | function |
| `lib/index.js` | 174 | `writeLogFile` | module | function |
| `lib/index.js` | 191 | `resumeSeed` | module | function |
| `lib/index.js` | 203 | `readJsonBody` | module | function |
| `lib/index.js` | 233 | `effortIds` | module | function |
| `lib/index.js` | 239 | `idOf` | module | function |
| `lib/index.js` | 248 | `isLocalRequest` | module | function |
| `lib/index.js` | 268 | `jsonResponse` | module | function |
| `lib/index.js` | 279 | `textOf` | module | function |
| `lib/index.js` | 294 | `clip` | module | function |
| `lib/index.js` | 304 | `buildContext` | module | function |
| `lib/index.js` | 332 | `parseProgress` | module | function |
| `lib/index.js` | 359 | `closestEffort` | module | function |
| `lib/index.js` | 379 | `normalizeUsage` | module | function |
| `lib/index.js` | 381 | `count` | apply | const fn |
| `lib/index.js` | 392 | `sumTokens` | module | function |
| `lib/index.js` | 407 | `titleOf` | module | function |
| `lib/index.js` | 427 | `labelOf` | module | function |
| `lib/index.js` | 462 | `cheapRank` | module | function |
| `lib/index.js` | 472 | `pickRoute` | module | function |
| `lib/index.js` | 486 | `apply` | module | function |
| `lib/index.js` | 540 | `frame` | apply | const fn |
| `lib/index.js` | 548 | `push` | apply | const fn |
| `lib/index.js` | 556 | `broadcast` | apply | const fn |
| `lib/index.js` | 561 | `prune` | apply | const fn |
| `lib/index.js` | 576 | `persist` | apply | const fn |
| `lib/index.js` | 585 | `record` | apply | const fn |
| `lib/index.js` | 597 | `closeTurn` | apply | const fn |
| `lib/index.js` | 622 | `markRunning` | apply | const fn |
| `lib/index.js` | 634 | `clearTimer` | apply | const fn |
| `lib/index.js` | 647 | `onTurnStart` | apply | const fn |
| `lib/index.js` | 674 | `onTurnEnd` | apply | const fn |
| `lib/index.js` | 690 | `scheduleFadeOut` | apply | const fn |
| `lib/index.js` | 716 | `interject` | apply | const fn |
| `lib/index.js` | 760 | `trackCount` | apply | const fn |
| `lib/index.js` | 766 | `schedule` | apply | const fn |
| `lib/index.js` | 786 | `declaredEfforts` | apply | const fn |
| `lib/index.js` | 802 | `probeEffort` | apply | const fn |
| `lib/index.js` | 827 | `findSession` | apply | const fn |
| `lib/index.js` | 841 | `sample` | apply | const fn |
| `lib/index.js` | 855 | `sampleOnce` | apply | const fn |
| `lib/index.js` | 991 | `tick` | apply | const fn |
| `lib/index.js` | 1024 | `snapshotHandler` | apply | const fn |
| `lib/index.js` | 1029 | `debugHandler` | apply | const fn |
| `lib/index.js` | 1057 | `logHandler` | apply | const fn |
| `lib/index.js` | 1059 | `limit` | factory | const fn |
| `lib/index.js` | 1091 | `eventsHandler` | apply | const fn |
| `lib/index.js` | 1105 | `getLlm` | apply | const fn |
| `lib/index.js` | 1108 | `rescheduleAll` | apply | const fn |
| `lib/index.js` | 1121 | `applyConfig` | apply | const fn |
| `lib/index.js` | 1148 | `describeModels` | apply | const fn |
| `lib/index.js` | 1204 | `ensureRoute` | apply | const fn |
| `lib/index.js` | 1223 | `configPayload` | apply | const fn |
| `lib/index.js` | 1241 | `configHandler` | apply | const fn |
| `lib/client.js` | 87 | `hexToRgb` | factory | function |
| `lib/client.js` | 94 | `styleRules` | factory | function |
| `lib/client.js` | 511 | `cssEscape` | factory | function |
| `lib/client.js` | 522 | `shortId` | factory | function |
| `lib/client.js` | 528 | `formatTokens` | factory | function |
| `lib/client.js` | 536 | `clockOf` | factory | function |
| `lib/client.js` | 545 | `useConfig` | factory | function |
| `lib/client.js` | 571 | `useLog` | factory | function |
| `lib/client.js` | 602 | `metaLine` | factory | function |
| `lib/client.js` | 631 | `routeWarning` | factory | function |
| `lib/client.js` | 651 | `renderEntry` | factory | function |
| `lib/client.js` | 692 | `routeLook` | factory | function |
| `lib/client.js` | 721 | `hueOf` | factory | function |
| `lib/client.js` | 734 | `groupBySession` | factory | function |
| `lib/client.js` | 764 | `groupHistory` | factory | function |
| `lib/client.js` | 801 | `renderColumn` | factory | function |
| `lib/client.js` | 833 | `useColumnFlip` | factory | function |
| `lib/client.js` | 869 | `HistorySegment` | factory | function |
| `lib/client.js` | 926 | `renderHistoryColumn` | factory | function |
| `lib/client.js` | 945 | `ColumnList` | factory | function |
| `lib/client.js` | 957 | `renderColumns` | factory | function |
| `lib/client.js` | 961 | `emptyState` | factory | function |
| `lib/client.js` | 966 | `SettingsCard` | factory | function |
| `lib/client.js` | 1248 | `SettingsPanel` | factory | function |
| `lib/client.js` | 1253 | `ProgressLogCard` | factory | function |
| `lib/client.js` | 1272 | `SampleLogPanel` | factory | function |
| `lib/client.js` | 1317 | `SampleLogIcon` | factory | function |
| `lib/client.js` | 1335 | `apply` | factory | function |
<!-- INDEX:END -->

## 绝不能做（每条都真炸过一次）

1. **不要在 `render()` 里读 `look`** —— 模块级变量已改名 `lookState`，读到旧名字抛 `ReferenceError`，被帧处理器的 `try/catch` 吞掉后**一条色带都不画**，控制台只有一行 `bad frame`（0.4.2 就是这么挂的）。
2. **CSS 注释里不要写反引号** —— `BASE_CSS` 是模板字符串，一个反引号直接提前结束它，报 `SyntaxError: Unexpected identifier`。
3. **`@property --dsp-p` 必须 `inherits: true`** —— 伪元素 `::after` 读不到不继承的自定义属性，宽度恒为 `initial-value: 0%`（整条不可见，且不报错）。
4. **`\\\\n` 与 `\\n` 分清** —— 用 python 写回源码时，模板字符串里的 `\n` 只能是单反斜杠；写错会让断言匹配不上或者把换行写进字符串字面量。
5. **不要给 `dsh.client.inject` 传函数** —— 必须是静态数组，否则整个 bundle 被判零依赖、静默禁用。
6. **不要在宿主半侧 `inject: ['llm']`** —— `llm` 是可选服务，用 `ctx.get('llm')`；写进 inject 会让没配模型的机器加载失败。
7. **`ensureRoute` 失败时不要死循环重试** —— `warnedNoCatalog` 只警告一次，然后等下一个 `intervalMs`。

## 样式系统（改外观只看这块）

- 三张注入表，顺序固定：`base`（结构）→ `look`（颜色/形状，覆盖 base）→ `dynamic`（每帧重写 `[data-row-key="session:<id>"]{--dsp-p:…;--dsp-o:…}`）→ `theme`（`color-scheme` + 原生下拉）。
- 结构规则只写 `::after` 的定位与 `transition`；颜色、厚度、裁切都在 `styleRules(look)` 返回的规则里。
- 深色判定按权威信号：`body[data-ds-dark-theme]` → `html[data-ds-theme-source]` → `computedStyle.colorScheme` → class/data-* → 背景亮度 → `matchMedia`。
- `routeLook(state, incoming, source)` 是纯函数：`server` 帧不能盖掉用户正在预览的样式（0.4.1 的 bug）。

## 轮次与历史（0.6.0 新增）

- `turns: Map<sessionId, number>`：`turn/start` 时 +1；`record()` 每条样本都带 `turn`。
- `log` 是一个数组，每条有 `phase: 'active' | 'closed'` 与 `outcome: 'completed' | 'interrupted' | ''`。
- `closeTurn(id, outcome)`：把该会话所有 `active` 样本冻结；`interrupted` 时用 `resumeSeed()` 算出接续点存进 `resumeP`。
- 下次 `turn/start`：`entry.p = resumeP.get(id) ?? 0`，并给判断模型加一句「上一轮被打断，已到 X%，接着算」。
- 持久化：`~/.dsh/session-progress.log.json`（`DSP_LOG_FILE` 可覆盖），1.2 秒防抖写；退出时兜底写一次。启动时把残留的 `active` 全部改判 `interrupted`。

## 测试矩阵

| 文件 | 守住什么 |
|---|---|
| `test/label.mjs` | 会话名取值链：`session/title` → 首句 → 短 id |
| `test/host-smoke.mjs` | 端到端：采样 → 单调 → 插嘴回退 → usage → 配置归一化与持久化 |
| `test/route-fallback.mjs` | 目录缺模型 / 目录为空两条路径 |
| `test/panel-group.mjs` | `groupBySession`/`formatTokens` 等纯函数 |
| `test/look.mjs` | 六种样式都带颜色、坏输入回落、无 CSS 注入 |
| `test/client-boot.mjs` | 把浏览器半侧真启动一遍（桩 DOM） |
| `test/replan.mjs` | `nextProgress` 的单调与回退 |
| `test/history.mjs` | 轮次关闭、中断接续、重启后残留 active 改判 interrupted、磁盘持久化 |

## 发布

```bash
npm test && npm run check
git add -A && git commit -m "feat: … (0.x.y)"      # 署名 Ne_Rn
HTTPS_PROXY=http://127.0.0.1:7897 git push origin main
node dev/release.cjs v0.x.y "标题" notes.md          # 自动加「大鲸鱼在线写插件」小字
```

- 发布脚本必须 `.cjs`（仓库 `"type": "module"`）。
- token 从 `git credential fill` 取，不落盘、不进 git config。
