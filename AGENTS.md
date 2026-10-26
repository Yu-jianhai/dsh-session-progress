# 改代码之前，先读这一页（60 秒）

这个仓库的源码加起来两千多行，通读一遍既慢又容易改错。**任何修改都按下面的顺序来**，不要直接打开 `lib/index.js` 从头读到尾。

## 0. 开工四步

```bash
node scripts/snapshot.cjs pre-<你要干什么>    # 1. 先拍一张快照，崩了能一键回退
npm test                                       # 2. 十条测试先全绿，再动手
grep -n "<函数名>" lib/index.js lib/client.js   # 3. 从 ARCHITECTURE.md 的符号索引跳到那一段
node scripts/index.cjs && npm run check         # 4. 改完重建索引再验收
```

- **函数在哪、旁边有什么不变量**：看 `ARCHITECTURE.md` 的「符号索引」（`node scripts/index.cjs` 生成，行号是权威）。
- **报错了先查 `PROBLEMS.md`**：每条都真炸过一次，写着现象 / 原因 / 修法 / 哪条测试守着它。
- **崩了怎么回**：`node scripts/restore.cjs latest`（或指定快照目录名）。快照只备份源码与文档，`node_modules` 不动，恢复后跑一次 `npm test` 确认。

## 为什么这样要求

- 反复踩的坑都在 `ARCHITECTURE.md` 的「绝不能做」和 `PROBLEMS.md` 里（读已删除的 `look`、CSS 注释里的反引号、`@property` 的 `inherits`、`BASE_CSS` 以反引号+换行结尾……），**每条都真炸过一次**。
- 两个文件是一体两面：宿主算 `{id, p, o}` 和 `look`，浏览器半侧只把 CSS 变量写上去。改错边会出现「代码全对但界面没反应」。

## 硬约束（改的时候不要违反）

- 宿主半侧只依赖 `sessions`（`inject: ['sessions']`）；`llm` 用 `ctx.get('llm')` 取，**不要加进 inject**。
- 浏览器半侧只能写自己注入的 `<style>`、`<svg>` 和 `[data-row-key^="session:"]` 上的 CSS 变量，**不要 append 别人的 DOM**。
- 一切推给浏览器的数据走 `/plugins/dsh-session-progress/*` 五个端点（`events` / `snapshot` / `log` / `config` / `debug`），新增字段要同时改宿主与客户端的读取处。
- `package.json` 的 `dsh.client.inject` 必须是静态数组。
- 发布脚本必须是 `.cjs`（仓库是 `"type": "module"`）；推送要带 `HTTPS_PROXY=http://127.0.0.1:7897`。
- 改了函数、加了函数、挪了位置 → `node scripts/index.cjs`；行号漂移时 `npm run check` 会直接报错。

## 怎么在看不见界面的情况下验证 UI

宿主是桌面版，浏览器工具进不去它的 webview（缺一次性 token）。可行的办法是「把真样式、真数据拉进一个本地页」：

| 想验证 | 命令 | 看什么 |
| --- | --- | --- |
| 色带形状 / 圆角 / 高光 | `node dev/gen-flow.mjs` → `dev/flow.html` | `window.__probe()` 读 `::before` 的 filter、duration、位移 |
| 四档流体质量（含水波、折射） | `node dev/gen-water.mjs` → `dev/water.html` | 每档的 `filter` / `backdrop-filter` / `animation` |
| 日志面板排版 | `node dev/gen-panel.mjs` → `dev/panel.html` | 行高、列宽、是否溢出 |
| 组件会不会抛错 | `node test/render.mjs` | 空 payload 与满 payload 各渲染一次 |
| 动画周期有没有缝 | `dev/seam.html` + 截图像素分析 | 见 `PROBLEMS.md` 第 13、14 条 |

截图工具在本机可用（先 `cmd //c start "" msedge "<file url>"` 拉起 Edge 再截），但 `browser_evaluate` 有 100ms 上限，**不要在表达式里 `await` 睡眠**。
