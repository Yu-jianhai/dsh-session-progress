// The window detector, exercised against the shapes that actually show up.
import assert from 'node:assert/strict'
import { trackStall, LOOP_WINDOW, STALL_SAMPLES, STALL_STUCK } from '../lib/index.js'

const at = (index) => 1_700_000_000_000 + index * 30_000
const win = (points, notes = []) => points.map((p, index) => ({ p, note: notes[index] ?? '', at: at(index) }))

// A real turn from this machine: every estimate moves by ≥3%, so a "did the
// number move" test never fires. It retried the same CLI test for four minutes,
// swinging 45 ↔ 90.
const flapping = [68, 62, 58, 62, 68, 82, 85, 88, 90, 55, 62, 72, 45, 50, 45, 50, 72]
const flappingNotes = [
  'CLI测试失败，排查中',
  'CLI测试仍失败，修测试中',
  'CLI测试多处失败，排查中',
  '改CLI测试期望值',
  '修CLI测试断言',
  'CLI测试全通过',
  '补文档与验证插件契约',
  '补安装脚本并验证',
  '补安装脚本并验证',
  '按新要求重评剩余工作',
  '安装脚本调试中',
  'patch 校验通过',
  '新要求待评估',
  '排查cookie锁问题',
  '排查cookie锁问题',
  '定位插件注入点',
  '文档与测试收尾',
]

// 1) Steady progress is not a loop, however long the turn runs.
let verdict = { stall: null }
for (let index = 1; index < 8; index += 1) {
  const points = Array.from({ length: index + 1 }, (_, step) => 5 + step * 6)
  verdict = trackStall(win(points), at(index))
  assert.equal(verdict.stall, null, `monotonic progress at step ${index} is not a stall`)
}

// 2) The original flat case still works: four rounds inside the tolerance.
for (let index = 1; index <= STALL_SAMPLES; index += 1) {
  verdict = trackStall(win(Array.from({ length: index + 1 }, () => 40)), at(index))
}
assert.equal(verdict.stall?.reason, 'flat')
assert.equal(verdict.stall?.level, 'warn')

// 3) ...and it still reaches `stuck` after eight.
for (let index = 1; index <= STALL_STUCK; index += 1) {
  verdict = trackStall(win(Array.from({ length: index + 1 }, () => 40)), at(index))
}
assert.equal(verdict.stall?.level, 'stuck')

// 4) The case the user pointed at: the number keeps moving, it just keeps
//    coming back. This is what "一直在失败一直在重试" looks like in the log.
const tail = flapping.slice(-LOOP_WINDOW)
const tailNotes = flappingNotes.slice(-LOOP_WINDOW)
verdict = trackStall(win(tail, tailNotes), at(tail.length))
assert.notEqual(verdict.stall, null, 'a flapping turn is called out even though every step moved')
assert.equal(verdict.stall.reason, 'retry')
assert.equal(verdict.stall.level, 'stuck', 'four direction changes over 8 samples is a loop, not a wobble')
assert.equal(verdict.stall.turns >= 4, true)
assert.equal(verdict.stall.churn > 60, true)

// 5) A single correction back is not a loop: 60 → 62 → 58 → 70.
verdict = trackStall(win([60, 62, 58, 70]), at(4))
assert.equal(verdict.stall, null, 'one step back is a re-estimate, not a loop')

// 6) Two reversals with little movement stay quiet; the churn gate is what
//    separates "thinking out loud" from "spinning".
verdict = trackStall(win([40, 42, 39, 41, 43]), at(5))
assert.equal(verdict.stall, null, 'small zig-zags under the churn gate are not a loop')

// 7) Failure words are a hint, never the trigger: a flapping turn with no
//    failure wording anywhere still fires.
verdict = trackStall(win(tail, tail.map(() => '改代码')), at(tail.length))
assert.equal(verdict.stall?.reason, 'retry')
assert.equal(verdict.stall?.failure, false)

// 8) ...and a turn that merely mentions failure while advancing does not.
verdict = trackStall(win([10, 20, 30, 40], ['失败一次，已找到原因', '', '', '']), at(4))
assert.equal(verdict.stall, null, 'a mention of failure is not a verdict')

// 9) Degenerate windows never throw.
for (const input of [[], [{ p: null }], [{ p: 40 }], null, undefined]) {
  const result = trackStall(input, at(0))
  assert.equal(result.stall, null)
}

console.log('stall assertions passed')
