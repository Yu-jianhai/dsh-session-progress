# 改代码之前，先读 `ARCHITECTURE.md`

这个仓库的源码加起来两千多行，通读一遍既慢又容易改错。**任何修改都按下面的顺序来**，不要直接打开 `lib/index.js` 从头读到尾：

1. 打开 **`ARCHITECTURE.md`**，看「符号索引」找到你要改的那几个函数、它们在哪、旁边有哪些不变量。
2. 用 `grep -n "<函数名>" lib/index.js lib/client.js` 直接跳到那一段，只读那一段。
3. 改完跑 `npm test`（七套）+ `npm run check`。
4. **改了函数、加了函数、挪了位置，就更新 `ARCHITECTURE.md` 的符号索引**：`node scripts/index.cjs` 会重算行号，手写的说明别删。

## 为什么这样要求

- 这个插件反复踩的坑都在 `ARCHITECTURE.md` 的「绝不能做」一节里（读已删除的 `look`、CSS 注释里的反引号、`@property` 的 `inherits`、`\\n` 转义），**那几条每条都真炸过一次**。
- 两个文件是一体两面：宿主算出 `{id, p, o}` 和 `look`，浏览器半侧只负责把 CSS 变量写上去。改错边会出现"代码全对但界面没反应"。

## 硬约束（改的时候不要违反）

- 宿主半侧只依赖 `sessions`（`inject: ['sessions']`）；`llm` 用 `ctx.get('llm')` 取，**不要加进 inject**。
- 浏览器半侧只能写自己注入的 `<style>` 和 `[data-row-key^="session:"]` 上的 CSS 变量，**不要 append 别人的 DOM**。
- 一切推给浏览器的数据走 `/plugins/dsh-session-progress/*` 四个端点，新增字段要同时改 `frame()`/`logHandler()` 和客户端的读取处。
- `package.json` 的 `dsh.client.inject` 必须是静态数组。
- 发布脚本必须是 `.cjs`（仓库是 `"type": "module"`）；推送要带 `HTTPS_PROXY=http://127.0.0.1:7897`。
