# 踩过的坑：现象 → 原因 → 修法 → 谁守着它

每条都真炸过一次。**遇到怪现象先在这里搜关键词**，比重新调试快得多。新增的坑按 `P-编号` 追加，并把守卫（测试/断言）一起写上。

---

## P-01 色带整条消失，控制台只有一行 `bad frame`

- **现象**：会话在跑，进度日志正常，但侧栏一条色带都看不到。
- **原因**：`render()` 里读了一个已经被删掉的变量（0.4.1 把 `look` 改名成 `lookState` 时漏改）。`render()` 抛 `ReferenceError`，被 SSE 帧处理器的 `try/catch` 吞掉 → 动态样式表永远为空 → 没有 `--dsp-p`。
- **修法**：兜底不透明度改从 `lookState.painted` 取；`node --check` 不懂这种错，只能靠「真启动一次组件」。
- **守卫**：`test/render.mjs`（真跑组件、空 payload 不许抛错）+ `test/client-boot.mjs`。

## P-02 进度日志面板与设置卡片一起白屏（0.11.2 回归）

- **现象**：面板整个空白，`/debug` 显示 `logHits: 0`（客户端从没成功取过数），宿主侧 `/log` 数据完好。
- **原因**：`metaLine` 里 `Number.isFinite(Number(data && data.active))` —— `data` 为 null 时 `data && data.active` 得 `null`，而 **`Number(null) === 0`**，守卫被绕过，随后 `Number(data.active)` 抛 `Cannot read properties of null`。
- **修法**：先取 `activeRaw = data ? data.active : undefined`，再判 `undefined/null`。
- **守卫**：`test/render.mjs` 用空 payload 渲染每个 slot。

## P-03 `@property --dsp-p` 用了 `inherits: false`，宽度恒为 0

- **现象**：CSS 全对，`getComputedStyle(::after).width` 永远是 `0px`。
- **原因**：变量设在行上、由 `::after` 读；`inherits: false` 的注册属性不会被伪元素继承，拿到的是 `initial-value`。
- **修法**：`@property --dsp-p { inherits: true }`（`--dsp-o` 是未注册的普通属性，天生继承，不受影响）。
- **守卫**：`dev/harness.html` + 人工看；`test/look.mjs` 校验规则文本。

## P-04 往 CSS 注释里写反引号，整个模板字符串被截断

- **现象**：`SyntaxError: Unexpected identifier 'z'`（或 `'data'`、`'round'`），报错行看着完全正常。
- **原因**：`BASE_CSS` 是模板字符串，注释里的 `` `xxx` `` 会提前闭合。
- **修法**：CSS 注释里**不写反引号**，用 `xxx` 或「」代替。
- **守卫**：`node --check lib/client.js`（这条只有它能抓）。

## P-05 `dev/gen-*.mjs` 抽出来的 CSS 不生效

- **现象**：预览页里追加的规则全部无效，但页面肉眼正常。
- **原因**：`BASE_CSS` 以「反引号 + 换行」结尾，`indexOf('`;')` 找不到，于是一路吃到后面几千行 JS，`<style>` 里混进源码；CSS 解析器遇到无效内容后**丢掉其后所有规则**。
- **修法**：`source.slice(cssStart, source.indexOf('`', cssStart))`（到下一个反引号为止）。修完 `dev/water.html` 从 64 KB 降到 17 KB。
- **守卫**：无自动守卫 —— 生成器改动后必须用 `window.__probe()` 读回计算样式确认。

## P-06 `markRunning` 早退，同进程内的"中断"永远走不到

- **现象**：测试里 `history` 没有 `interrupted` 条目，而"色带停在 42%"那条断言**假性通过**（那 42 是上一轮自己采到的）。
- **原因**：`markRunning(id, true)` 在已 running 时直接 return；回合没 `turn/end` 又来了 `turn/start`，被吞掉。
- **修法**：`session/event` 的 turn/start 分支比较 `event.data.turn` 与已记录的轮次，更大就走 `onTurnStart(id, 'turn/start (reopened)')`。
- **守卫**：`test/history.mjs` 第二段（turn 3 无 turn/end → 断言 `p === 42`）。

## P-07 幽灵列：会话被关掉，活跃条目永远不消失

- **现象**：面板里有一列进度停在 13:25，永不更新。
- **原因**：会话被销毁/窗口关掉时没有 `turn/end`，`phase: 'active'` 的条目就留在实时列表里。
- **修法**：① 订阅 `agent/disposed`，`running.delete` + `closeTurn(id, 'interrupted')`（**不能走 `onTurnEnd`**，那条路会记成 `completed`）；② `tick()` 开头 `reapAbandonedTurns()` 兜底；③ `/log` 返回 `active` 供客户端算「本轮 N 次」。
- **守卫**：`test/history.mjs` 的 `agent/disposed` 用例（断言 `interrupted`）。

## P-08 面板"不刷新"：inflight 布尔锁 + fetch 没有超时

- **现象**：SSE 连着、色带正常，日志面板一动不动；`/debug` 的 `logHits` 不再增长。
- **原因**：`logFetch` 用 `inflight` 布尔守卫，`fetch` 不带超时；一次不返回的请求会让守卫永久为 true。
- **修法**：`AbortSignal.timeout(8000)` + `inflightSince` 看门狗（滞留超时就放弃重发）+ `hidden` 只跳过 15 秒而不是硬停 + 面板加「刷新」按钮。
- **守卫**：`test/client-boot.mjs`（断言源码里有 timeout 与看门狗）。

## P-09 测试之间互相污染（共享状态文件）

- **现象**：单独跑 `host-smoke` 通过，跟别的测试一起跑就断言失败；`log.tokens.total` 忽大忽小。
- **原因**：日志文件按状态文件的**目录**推导，多个测试共享 `%TEMP%\session-progress.log.json`。
- **修法**：按 `DSP_STATE_FILE` 的**文件名**派生（`dsp-smoke-<pid>.log.json`），测试结束删除。
- **守卫**：`test/host-smoke.mjs` 自己的 `ownStateFile()`。

## P-10 白色高光在浅色填充上完全看不见

- **现象**：用户三次反馈"没有流动动画"，而代码、版本、`prefers-reduced-motion` 全部正常。
- **原因**：`#90AFFF` 是浅色，白高光叠上去几乎没有对比度。
- **修法**：改成「暗尾 + 亮边」的双段渐变（暗影在前给出对比，亮边在后给出方向感），两种底色都成立。
- **守卫**：肉眼 + `dev/flow.html` 多帧截图。

## P-11 `clip-path` 不带 `round`，色带圆角外探出方角

- **现象**：高光扫到色带末端时，右端出现一块方形凸起。
- **原因**：`inset()` 默认方角，而填充 `::after` 是 `border-radius` 圆角。
- **修法**：`inset(… round var(--dsw-radius-md, 8px))`；`underline` 样式用 `round 2px`。
- **守卫**：`dev/flow.html` 暂停在色带末端截图。

## P-12 跨行位移算错就有缝：周期 200px → 203.09px

- **现象**：高光每轮跳一下（约 3px），像"卡帧"。
- **原因**：图案沿 `100deg` 轴排布，周期 200px 沿轴量；沿**行方向**的长度是 `200 / sin(100°) = 203.09px`。写成 `200×sin(100°)=197` 会每次差 6px。
- **修法**：`@keyframes dsp-flow { to { background-position: 203.09px 0 } }`，位移必须等于一个图案周期。
- **守卫**：`dev/seam.html` 截图像素自相关（最佳周期 203、均差 0.3）。

## P-13 高光跟随填充宽度用 `clip-path`，与 `width` 过渡不同步

- **现象**：用户说"动画不连贯，会突然瞬移"。
- **原因**：填充 `::after` 用 `width` 过渡，高光 `::before` 用 `clip-path: inset()` 过渡；两个属性的插值采样不同步，进度更新那一瞬间会错位。
- **修法**：`::before` 自己也用 `width: var(--dsp-p)` + `border-radius: inherit`，删掉 `clip-path`；两个伪元素同属性、同缓动，物理上不可能脱节。
- **守卫**：`dev/flow.html` 实测两个伪元素宽度必须相等（208.312px），且 `clip-path` 为 `none`。

## P-14 水波滤镜参数太小，在 32px 行高上等于没做

- **现象**：`filter: url(#dsp-water)` 生效，但肉眼完全看不出扭曲。
- **原因**：`feDisplacementMap scale` 太小（5 / 13）；且 `feTurbulence` 的 `baseFrequency` 是按大画布调的。
- **修法**：`baseFrequency="0.006 0.022" numOctaves="2"` + `scale="18"` + `feGaussianBlur 0.45`；`high` 再叠 `backdrop-filter: blur(1.6px) saturate(1.45) brightness(1.06)`。
- **守卫**：`dev/water.html` 的 2.6 倍放大对照条。

## P-15 引用了不存在的滤镜，元素整个不绘制

- **现象**：切到某个质量档，色带整条消失（比"看不出效果"严重得多）。
- **原因**：`filter: url(#dsp-water)` 指向不存在的 `<filter>` 时，浏览器**不画这个元素**。
- **修法**：`filtersReady` 标记 + `ensureWaterFilter()` 失败时降级为纯色高光（`flowDecls` 不输出 filter）。
- **守卫**：`test/look.mjs` 校验 `low` 档不得带任何 `filter: url(`。

## P-16 改「动画质量 / 速率 / 开关」时设置页预览不动

- **现象**：颜色、不透明度、样式一改预览立刻变；但动「动画质量」「动画速率」「流动动画」开关，预览要等下一次保存（或下一个 SSE 帧）才变 —— 看起来像预览坏了。
- **原因**：`paintLook(next)` 只把 `color / opacity / style` 装进候选对象，用这三项拼重绘 key。0.11.0 之后 `flowDecls` 还要读 `flow / flowSpeed / flowQuality`，这三个字段既不进候选也不进 key，于是「key 没变 → 直接 return」，样式表根本没重写。
- **修法**：候选与 key 都带上 `flow / flowSpeed / flowQuality`（`lib/client.js` 的 `paintLook`）。
- **守卫**：`test/render.mjs` 第 4 段 —— 找到设置页里那个含 `refract` 选项的 `<select>`，真的调它的 `onChange`，然后断言 look 样式表里出现了 `backdrop-filter:url(#dsp-refract)`。把 `paintLook` 的 key 改回去，这条会红。
- **教训**：凡是「纯函数按字段拼 key」的地方，加字段时**候选对象和 key 必须一起加**；测试要打到「触发真实事件 → 读产物」这一层，只断言函数输出会漏掉这种遗漏。

## P-17 高光的亮晕溢出到色带外面

- **现象**：会话行上的亮光在色带边缘之外还能看到一圈晕，短色带时更明显，甚至盖住右边的相对时间。
- **原因**：`filter: url(#dsp-water)` 会把像素**位移**，滤镜的区域是元素盒子的 `-25% … 150%`，`border-radius` 只裁盒子的内容、裁不住滤镜的输出；`baseFrequency` 越大位移越远，晕得越开。
- **修法**：表面层加一条**恒定**的 `clip-path: inset(0 round var(--dsw-radius-md, 8px))` —— 只有 `clip-path` 能裁滤镜输出。它不参与 `width` 过渡，所以不会把 0.11.0 的「clip/width 不同步」带回来；`underline` 档单独把它覆盖成 `inset(0 round 2px)`，因为那一条只有 3px 高。
- **守卫**：`test/look.mjs` 第 3c 段（从模块源码里读 `BASE_CSS` 断言 `::before` 带这条裁剪、`underline` 的覆盖存在、以及水膜档不用全白的高光）。
- **相邻教训**：水膜档盖在文字上方时，全白峰值 `rgba(255,255,255,1)` 会把字洗掉，于是那一档改用 `SWEEP_FILM`（峰值 0.8、暗尾 0.16）。

