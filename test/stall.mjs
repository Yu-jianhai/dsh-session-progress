import assert from 'node:assert/strict'
import { STALL_SAMPLES, STALL_STUCK, trackStall } from '../lib/index.js'

const at = (n) => 1_700_000_000_000 + n * 30_000
let state = { count: 0, since: 0 }

// 1) Moving the number forward is never a stall.
let step = trackStall(state, 40, 55, '改接口', at(0))
assert.equal(step.count, 0)
assert.equal(step.stall, null)
state = { count: step.count, since: step.since }

// 2) Small movement inside the tolerance counts as standing still, and the
// counter only becomes a warning once enough samples agree.
for (let i = 1; i <= STALL_SAMPLES; i += 1) {
  step = trackStall(state, 55, 55 + (i % 2 === 0 ? 1 : -1), '测试仍失败，排查中', at(i))
  state = { count: step.count, since: step.since }
  if (i < STALL_SAMPLES) assert.equal(step.stall, null, `quiet at ${i}`)
}
assert.equal(step.count, STALL_SAMPLES)
assert.equal(step.stall.level, 'warn')
assert.equal(step.stall.count, STALL_SAMPLES)
assert.equal(step.stall.since, at(1))
assert.equal(step.stall.failure, true, 'the words say it is failing too')

// 3) Enough flat samples escalates to "stuck", not a new warning each time.
for (let i = STALL_SAMPLES + 1; i <= STALL_STUCK; i += 1) {
  step = trackStall(state, 55, 55, '测试仍失败，排查中', at(i))
  state = { count: step.count, since: step.since }
}
assert.equal(step.stall.level, 'stuck')
assert.equal(step.stall.count, STALL_STUCK)
assert.equal(step.stall.since, at(1), 'the clock starts at the first flat sample')

// 4) Any real movement clears it, including moving backwards.
step = trackStall(state, 55, 48, '退回上一步重试', at(STALL_STUCK + 1))
assert.equal(step.count, 0)
assert.equal(step.stall, null)

// 5) A flat number with no failure words still counts, just without the hint.
const quiet = trackStall({ count: 3, since: at(0) }, 60, 60, '等构建', at(STALL_SAMPLES))
assert.equal(quiet.stall.level, 'warn')
assert.equal(quiet.stall.failure, false)

// 6) A missing previous state must not crash or start at a bogus count.
const fresh = trackStall(undefined, 30, 31, '', at(0))
assert.equal(fresh.count, 1)
assert.equal(fresh.stall, null)

console.log('stall assertions passed')
