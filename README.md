<sub>大鲸鱼在线写插件</sub>

# dsh-session-progress

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）侧栏的每一个会话行上，铺一条**从行左向右伸长的半透明进度色带**：每 30 秒让一个**最轻思考强度**的模型读一遍当前轮次的上下文，给出 0–100 的进度，CSS 自己把色带平滑地推到那个位置。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.1-6b5cff)

- 颜色 `#90AFFF`，不透明度 60%，`0.9s` 缓动 —— 每轮一次采样，色带就往前跳一步。
- 色带是**铺在整行底下**的：标题、时间、悬停按钮全部照常可读可点，不插入任何 DOM。
- 进度**只增不减**，最多到 95；一轮结束（`turn/end`）补满 100，停留一瞬再淡出。
- 左侧栏多一个「**进度日志**」，把判断模型的**每一次原始输出**（含耗时、档位、JSON 原文）列出来，**一个会话一列、从左到右并排**：列头是色点、会话标题、最新进度和采样次数，列内各自滚动。
- **换一台机器不用改配置**：写死的只是「优先用哪个模型」，本机没有就自动挑一个可用的（详见[换机器](#换一台机器--别的-provider)）。

![色带样式预览（dev/harness.html 的独立复现页，用于在没有宿主的情况下比对透明度与缓动）](dev/harness.png)

## 安装

```sh
dsh plugin --profile desktop add github:Yu-jianhai/dsh-session-progress
```

然后**完全退出 DSH 再重新打开**。

想锁定版本，就在后面跟 commit：

```sh
dsh plugin --profile desktop add github:Yu-jianhai/dsh-session-progress#<commit-sha>
```

本包是纯 JavaScript、`lib/` 已提交，**没有构建步骤**，所以不需要给 pnpm 授权运行 `prepare`。卸载：

```sh
dsh plugin --profile desktop remove dsh-session-progress
```

## 用起来是什么样

| 位置 | 内容 |
|---|---|
| 侧栏会话行 | 整行宽的色带（默认 `#90AFFF`、60% 不透明），宽度 = 当前进度；颜色、不透明度、样式都能在设置里改 |
| 设置 → 插件 → 会话进度条 | 模型 / 思考强度 / 采样间隔 / 并发上限 的可视化表单，配置落在 `~/.dsh/session-progress.config.json` |
| 左侧栏「进度日志」 | 判断模型的每一次采样：**每个会话一列，从左到右并排**（列头 = 色点 + 会话标题 + 最新进度 + 次数），每条含时间、进度、阶段名、耗时、token 数、实际档位、原始输出 |
| 设置页里的同名卡片 | 与上一条同一份数据，不离开设置也能看 |

顶栏统计里有一行**累计消耗的 token**（判断模型自己的开销，不含你的主对话）：也就是每一次采样 `usage` 的 `inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens` 之和，每条记录里也单独标了这一次用了多少。列的顺序按"最近一次采样"排，某列跳到前面时会有 420ms 的滑动过渡，不会突然闪过去（`prefers-reduced-motion` 下不播放）。

进度语义（`lib/index.js`）：

1. 用户发来新消息 → 该会话开始采样，色带从 `seedP`（默认 4%）起步，先给一点反馈；
2. 每 `intervalMs` 采一次，取 `max(上次, 模型给的值)`，封顶 95 —— **不会倒退，也不会提前报满**；
   例外是**插嘴**：你在一轮还没跑完时又发了消息，剩余工作量已经变了，于是 `interjectDelayMs`（默认 2.5s）后再采一次，这**一次**允许比上一次低（会重新告诉模型"目标变了，请按新要求重估"）。日志里那一条会挂一个橙色的「重估」标记；
3. `turn/end`（任何结束原因）→ 立刻置 100，`700ms` 后开始淡出，`420ms` 后整条移除；
4. 采样失败 → 保留上一次的值；色带只在会话真正在跑时存在。

## 配置

配置文件：`~/.dsh/session-progress.config.json`（UI 保存的覆盖值，优先于 `cordis.patch.yml`）。

| 键 | 默认 | 范围 | 说明 |
|---|---|---|---|
| `enabled` | `true` | — | 总开关 |
| `provider` | `deepseek-account` | — | 模型提供方 |
| `model` | `deepseek-flash` | — | 判断用的模型 |
| `reasoningEffort` | `off` | — | 思考强度；模型不提供该档位时**按档位距离取最近的一档**并打印日志 |
| `intervalMs` | `30000` | 5000–3600000 | 采样间隔 |
| `interjectDelayMs` | `2500` | 500–30000 | 插嘴后多久补采一次（这次允许回退） |
| `firstDelayMs` | `8000` | 0–3600000 | 本轮首次采样前的等待，让模型先做点事 |
| `maxSessions` | `3` | 1–10 | 同时采样的会话数上限 |
| `maxContextChars` | `6000` | — | 送进模型的上下文上限（超出截尾） |
| `timeoutMs` | `30000` | — | 单次采样超时 |
| `seedP` | `4` | — | 首次采样返回前的起步宽度 |
| `color` | `#90AFFF` | `#RRGGBB` | 色带颜色；非十六进制值会被忽略并保留旧值 |
| `opacity` | `0.6` | 0.05–1 | 色带不透明度 |
| `style` | `band` | 六种之一 | 色带形状，见下节 |

**思考强度以模型目录为准。** 设置页的下拉框、采样时传给 adapter 的值、以及启动时打印的 `offered: …` 都来自同一份 `listModels()` 目录；`resolveModelInfo()` 与它不一致时以目录为准（`deepseek-flash` 的目录里就有 `off`）。

## 外观

设置页里「进度条颜色」「不透明度」「进度条样式」三个选项改完点保存即可，下方还有一行**用当前数值真画出来的预览**，拖颜色/不透明度时侧栏的色带会实时跟着变。

预览是**临时**的：改完不保存，离开设置页或点「重置」就还原成已保存的值。宿主每 2 秒会把自己保存的样式广播一次，插件把"未保存的预览"和"已保存的值"分开记，预览期间广播不会把色带顶回去。

六种样式（`style` 取值）：

| 值 | 样子 | 什么时候用 |
|---|---|---|
| `band` | 渐变横幅，右端 10px 渐隐 | 默认。最像"进度条"，高对比但不抢标题 |
| `solid` | 纯色实条，右端 1px 亮边 | 最克制；侧栏窄、颜色又淡时比 `band` 更清楚 |
| `underline` | 3px 细线贴行底 | 不想压住标题和时间的读法，信息密集时首选 |
| `stripe` | 45° 斜纹叠在底色上 | 进度变化慢、但希望"在跑"这件事一直显眼 |
| `glow` | 左淡右亮 + 内侧亮边 + 柔光 | 视觉最重，适合只在少数会话上开 |
| `segments` | 按 20% 切格 | 想一眼看出"到第几格"，比连续条更容易估读数 |

颜色要写成 `#RRGGBB`。非法的颜色/样式不会被写进配置，也不会拼进样式表（`test/look.mjs` 就是锁这件事的）。想先肉眼挑样式，打开 `dev/styles.html`（由 `node dev/gen-styles.mjs` 从真实源码生成，六种样式 × 三种进度 × 三种不透明度 × 三种颜色）。

## 换一台机器 / 别的 provider

`provider` / `model` 的默认值（`deepseek-account/deepseek-flash`）只是一份**偏好**，不是硬依赖。宿主第一次能读到模型目录时会核对：

1. 配置的模型存在 → 直接用；
2. 不存在 → 按名字挑一个便宜的顶上（`mini`/`lite`/`small`/`nano`/`haiku` 优先，其次 `flash`/`fast`/`instant`，最后 `turbo`，都没有就取目录第一个），并把实际生效的路线写进 `/config` 的 `effectiveRoute`，设置页会显示一行提示「原配置的模型在本机不存在，已自动改用 X」；
3. 目录是空的（这台机器还没配任何 provider）→ **不调用模型**，`/config` 返回 `catalogEmpty: true`，界面上直接告诉你「先去配置一个 provider」，避免刷一屏失败日志。

`cordis.patch.yml` 里因此**不写死 provider/model**：别人 clone 下来装上，第一次运行就知道该用什么。想锁定，就在设置卡片里选一次，值会落到本机的 `~/.dsh/session-progress.config.json`。

## 原理（为什么不用 React 组件）

DSH 给每个会话行渲染了稳定属性 `data-row-key="session:<id>"`，但**没有**一个常显的行内插槽：running 时 `sidebar.session.row.leading` 被状态点占着，行尾按钮只在悬停时出现。所以本插件一点 DOM 都不往行里插，只做两件事：

1. 注入一张固定样式表：给行加 `position: relative; isolation: isolate`，用 `::after` 画色带，宽度取 `--dsp-p`、不透明度取 `--dsp-o`，`z-index: -1` 让它待在行背景之上、文字之下；
2. 每次进度变化时整体重写另一张很小的样式表，按 id 写入 `[data-row-key="session:<id>"]{--dsp-p:42%;--dsp-o:.6}`。

`--dsp-p` 用 `@property` 注册为 `<percentage>`，于是「改变量」就等于「CSS 原生过渡」，完全不需要 React 重绘，也不受会话行重渲染影响。（`inherits` 必须是 `true`：变量写在行上、由伪元素读取，否则伪元素拿到的是初始值 `0%`。）

运行态判定用三个宿主信号，不轮询：

```js
ctx.on('session/event',      (session, event) => event.type === 'turn/start' ? run() : event.type === 'turn/end' ? idle() : null)
ctx.on('api-session/status', (sessionId, running) => …)
ctx.on('agent/status',       ({ agent, status }) => …)
```

### 端点（只监听回环地址）

| 路径 | 用途 |
|---|---|
| `/plugins/dsh-session-progress/events` | SSE，首帧为全量快照，之后每次变化一帧 |
| `/plugins/dsh-session-progress/snapshot` | 一次性 JSON 快照 |
| `/plugins/dsh-session-progress/log` | 判断模型的采样历史（环形缓冲，最多 300 条） |
| `/plugins/dsh-session-progress/config` | 读 / 写配置 |
| `/plugins/dsh-session-progress/debug` | 运行态、采样器、实际档位、模型目录 |

这些端点拒绝非本机 `Host` 的请求（`isLocalRequest`），不会对外网暴露。

## 已知取舍

- **依赖 `data-row-key` 这个内部属性。** 宿主改渲染方式时，色带会静默消失 —— 不崩溃、不错位、不污染别人的界面。
- **日志里的列头是会话名，不是 id。** 取值顺序：`session/title` 事件的标题 → 该会话的第一条用户消息（截 40 字）→ 短 id。刚建的新会话在自动命名之前，会先用你发的那句话当名字，所以任何时候都不该只看到一串代号。
- **自动换模型只看名字。** 名字里没有任何便宜档线索时，取目录里的第一个模型 —— 可能是贵的那一个；设置页里改一次即可锁定。
- **拖拽排序时会闪一下。** 宿主用 `::before` / `::after` 画插入指示线，与我们的伪元素撞车一瞬。
- **颜色是字面色，不走主题 token。** `#90AFFF` 是需求指定的值，暗色主题下偏亮；只把下拉菜单等原生控件交给 `--dsw-alias-*`。
- **会真的花 token。** 每个正在跑的会话每 30 秒一次真实模型调用（约 1–2k 输入 token），默认最多 3 个会话；把 `intervalMs` 调大或 `enabled: false` 可以随时停。
- 采样不并发：同一会话上一轮没回来就跳过这一拍。

## 开发

```sh
npm test    # 六套：假 ctx + 假 llm 跑宿主链路，桩 DOM 启动浏览器半侧，断言进度、日志、标题、档位、淡出、配置往返、换机回落、样式守卫
npm run check
```

- `test/host-smoke.mjs`：宿主半侧冒烟测试，用临时 state 文件，不碰你真实的 `~/.dsh/*.json`。
- `test/replan.mjs`：`nextProgress` 的单调性规则——平时的低值被忽略、插嘴后的低值被采纳、上下界都在。
- `test/client-boot.mjs`：用桩 DOM 把浏览器半侧整个启动起来，喂真实 SSE 帧，断言样式表真的被写出来、清理真的收干净。纯函数测试看不到这类错误——`render()` 里一个未定义的标识符会让色带**整条消失**而控制台只有一行 `bad frame`。
- `test/route-fallback.mjs`：模拟**别人的机器**——目录里没有默认模型时自动改用一个便宜模型、目录为空时一次模型都不调。
- `dev/release.cjs`：发布用，「大鲸鱼在线写插件」那句话由它自动加到 Release 正文开头，别再手拼 `curl`。
- `dev/harness.html`：把宿主真实的行结构与内联 CSS 复刻成独立页面，用来在没有 DSH 的情况下比对色带宽度、透明度与缓动。
- `dev/select-theme.html` / `dev/theme-probe.html`：验证原生 `<select>` 在深色主题下的弹层配色，以及主题判定函数在五种信号下的结果。
- 浏览器侧没有 JSX、没有构建：`lib/client.js` 是 `window.__ModuleLoader__.load({ id, factory })` 形式，React 由 `require('react')` 取得。

## License

[MIT](LICENSE) © 2026 Ne_Rn
