// The painted number is monotonic on purpose, except right after the user
// speaks mid-turn -- then the fresh estimate is the truth, even if lower.
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

process.env.DSP_STATE_FILE = path.join(os.tmpdir(), `dsp-replan-${process.pid}.json`)
const { nextProgress } = await import('../lib/index.js')

// A normal sample may only raise the bar: no twitching.
assert.equal(nextProgress(42, 20, false), 42, 'a lower normal estimate is ignored')
assert.equal(nextProgress(42, 42, false), 42)
assert.equal(nextProgress(42, 60, false), 60, 'a higher normal estimate is adopted')

// After an interjection the bar may move backwards...
assert.equal(nextProgress(42, 20, true), 20, 'a revised estimate may lower the bar')
assert.equal(nextProgress(92, 5, true), 5)
// ...but the revision still respects the same bounds.
assert.equal(nextProgress(42, 60, true), 60)
assert.equal(nextProgress(0, 100, true), 95, 'the sampler never reports 100')
assert.equal(nextProgress(0, 140, false), 95)
assert.equal(nextProgress(5, -3, true), 0, 'a negative percentage clamps to zero')

// Config values can be strings; the helper stays numeric.
assert.equal(nextProgress('42', 20, false), 42)

console.log('revision assertions passed')
