// The judgement model decides which way the band moves.
//
// Until 0.8 the host clamped every sample to `max(previous, estimate)`, so a
// stalled or over-estimated turn could never come back down; the model was not
// even told what it had said last time. Now the previous number and the stage
// it named travel with the prompt, and whatever comes back wins -- this file
// pins that, plus the one rule the host still owns: the 0-95 range.
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

process.env.DSP_STATE_FILE = path.join(os.tmpdir(), `dsp-direction-${process.pid}.json`)
const { nextProgress } = await import('../lib/index.js')

// Both directions are ordinary answers now.
assert.equal(nextProgress(42, 20), 20, 'a lower estimate is taken as-is')
assert.equal(nextProgress(42, 60), 60, 'a higher estimate is taken as-is')
assert.equal(nextProgress(88, 12), 12, 'a big step back is not softened')
assert.equal(nextProgress(0, 0), 0)

// The range belongs to the host: the turn end is what paints 100.
assert.equal(nextProgress(0, 100), 95, 'the sampler never reports 100')
assert.equal(nextProgress(95, 140), 95)
assert.equal(nextProgress(5, -3), 0, 'a negative percentage clamps to zero')
assert.equal(nextProgress(120, 40), 40)

// A failed parse keeps whatever is on screen.
assert.equal(nextProgress(42, null), 42)
assert.equal(nextProgress(42, undefined), 42)
assert.equal(nextProgress(42, Number.NaN), 42)
assert.equal(nextProgress(undefined, 30), 30, 'no previous value means no floor')

// Numbers arrive as strings from JSON in some paths; the helper stays numeric
// and hands back whole percentages.
assert.equal(nextProgress('42', '20'), 20)
assert.equal(nextProgress(9, 8.6), 9)
assert.equal(nextProgress(9, 8.4), 8)

console.log('direction assertions passed')
