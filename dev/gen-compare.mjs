// Four candidate sweeps on the real fill colour, side by side, so the choice is
// made by looking instead of by arguing. Uses the shipped BASE_CSS for the fill.
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
const css = source.match(/const BASE_CSS = `([\s\S]*?)`\n/)[1]
const lookSource = source.match(/\/\/ #region look([\s\S]*?)\/\/ #endregion look/)[1]
const styleRules = new Function(`${lookSource}; return styleRules`)()
const lookRules = styleRules({ color: '#90AFFF', opacity: 0.7, style: 'band' })

const candidates = [
  ['E 前缘亮线 + 尾部暗影', `linear-gradient(100deg, rgba(0,0,0,0) 32%, rgba(0,0,0,0.16) 44%, rgba(255,255,255,0.92) 50%, rgba(255,255,255,0) 57%, rgba(0,0,0,0) 68%)`],
  ['F 宽暗影', `linear-gradient(100deg, rgba(0,0,0,0) 26%, rgba(0,0,0,0.26) 50%, rgba(0,0,0,0) 74%)`],
  ['G 斜纹流动', `repeating-linear-gradient(100deg, rgba(255,255,255,0) 0px, rgba(255,255,255,0.55) 10px, rgba(255,255,255,0) 20px, rgba(0,0,0,0.10) 26px, rgba(255,255,255,0) 34px)`],
  ['H 亮芯 + 宽暗影', `linear-gradient(100deg, rgba(0,0,0,0) 24%, rgba(0,0,0,0.20) 42%, rgba(255,255,255,0.95) 50%, rgba(0,0,0,0.20) 58%, rgba(0,0,0,0) 76%)`],
]

const row = (index, label, p) => `
  <div class="wrap">
    <div class="label">${label}</div>
    <div class="row" data-candidate="${index}" data-row-key="session:c${index}"
         style="--dsp-p:${p}%;--dsp-o:0.7">
      <span class="slot"></span><span class="title">改一下登录页的跳转</span><span class="time">3 分钟前</span>
    </div>
  </div>`

const overrides = candidates
  .map(([_, gradient], index) => `[data-row-key="session:c${index}"]::before{background:${gradient};}`)
  .join('\n')

const html = `<!doctype html>
<meta charset="utf-8">
<title>sweep candidates</title>
<style>
  body { margin: 0; padding: 22px; background: #17181c; color: #d8dce2; font: 13px/1.5 system-ui, sans-serif; }
  ${css}
  ${lookRules}
  ${overrides}
  .wrap { margin-bottom: 18px; }
  .label { font-size: 11px; color: #8b93a1; margin-bottom: 6px; }
  .row { display: flex; align-items: center; height: 32px; padding: 0 8px; gap: 0; width: 320px;
         border-radius: 8px; color: #e6e8eb; background: transparent; }
  .slot { width: 16px; height: 20px; flex: none; }
  .title { flex: 1; margin: 0 6px 0 4px; font-size: 14px; }
  .time { font-size: 10px; color: #8b93a1; flex: none; }
</style>
${candidates.map(([label], index) => row(index, label, index === 2 ? 46 : 62)).join('\n')}
<script>
  window.__pause = () => document.querySelectorAll('[data-candidate]').forEach((node) => {
    const anims = node.getAnimations({ subtree: true })
    anims.forEach((anim) => { anim.pause(); anim.currentTime = 1700 })
  })
</script>
`
fs.writeFileSync(path.join(import.meta.dirname, 'compare.html'), html)
console.log('wrote dev/compare.html')
