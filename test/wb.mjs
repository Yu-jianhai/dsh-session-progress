// WorkBuddy runs come from another plugin and have states, not a percentage.
// These are the pure pieces in between: the API's record goes in, what the
// panel draws comes out. If they drift, WB cards start claiming things WB never
// said (a made-up number, a state it does not have).
import assert from 'node:assert/strict'
import { WB_STATE_LABEL, normalizeWbRun, wbPayload, wbUnavailable } from '../lib/index.js'

// 1) A running record stays running, even if the API also carries a stale
//    state field from the last write.
const running = normalizeWbRun({
  id: '20261103-003656-x',
  title: '  按 wb 评审意见改 PPT  ',
  phase: 'running',
  state: 'ok',
  model: 'auto',
  seconds: 12.5,
  rounds: 3,
})
assert.equal(running.phase, 'running')
assert.equal(running.state, 'running')
assert.equal(running.title, '按 wb 评审意见改 PPT')
assert.equal(running.seconds, 12.5)
assert.equal(running.rounds, 3)

// 2) Finished runs keep their verdict; anything unknown degrades to stale
//    instead of inventing a state the panel has no colour for.
assert.equal(normalizeWbRun({ id: 'a', phase: 'history', state: 'fail' }).state, 'fail')
assert.equal(normalizeWbRun({ id: 'b', phase: 'history', state: 'ok' }).state, 'ok')
assert.equal(normalizeWbRun({ id: 'c', phase: 'history', state: 'killed' }).state, 'killed')
assert.equal(normalizeWbRun({ id: 'd', phase: 'history', state: 'weird' }).state, 'stale')
assert.equal(normalizeWbRun({ id: 'e', phase: 'history' }).state, 'stale')

// 3) Missing titles fall back to the id, long ones are cut.
assert.equal(normalizeWbRun({ id: 'only-id' }).title, 'only-id')
assert.equal(normalizeWbRun({ id: 'x', title: 'y'.repeat(300) }).title.length, 160)

// 4) Junk is dropped rather than rendered as an empty card.
assert.equal(normalizeWbRun(null), null)
assert.equal(normalizeWbRun({}), null)
assert.equal(normalizeWbRun({ id: '' }), null)

// 5) Tokens are a history number: a running run has not reported them yet.
const payload = wbPayload(
  [{ id: 'r1', phase: 'running', state: 'running' }],
  [
    { id: 'h1', phase: 'history', state: 'ok', inTok: 100, outTok: 20 },
    { id: 'h2', phase: 'history', state: 'fail', inTok: 5, outTok: 1 },
  ],
)
assert.equal(payload.available, true)
assert.equal(payload.running.length, 1)
assert.equal(payload.history.length, 2)
assert.equal(payload.tokens, 126)

// 6) Non-arrays are tolerated (an old host may answer with null).
assert.deepEqual(wbPayload(null, undefined).history, [])
assert.equal(wbPayload(null, undefined).tokens, 0)

// 7) "Not installed" is an explicit answer, not an empty list the UI must guess
//    at.
const missing = wbUnavailable()
assert.equal(missing.available, false)
assert.deepEqual(missing.running, [])
assert.equal(missing.tokens, 0)
assert.ok(missing.reason.length > 0)
assert.equal(wbUnavailable('boom').reason, 'boom')

// 8) Every state the panel can draw has a word for it.
for (const state of ['running', 'ok', 'fail', 'killed', 'stale']) {
  assert.equal(typeof WB_STATE_LABEL[state], 'string', `${state} has a label`)
}

console.log('wb assertions passed')
