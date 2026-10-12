import test from 'node:test';
import assert from 'node:assert/strict';
import { tierProbsFromLogprobs, tierProbsFromSystemOne, normalizeTierProbs, summarizeRows } from './router_calibrate.mjs';

const bad = (r) => { assert.equal(r.failed, true); assert.equal(r.reason, 'malformed_response'); };

test('C: no logprobs is a failed row, never the generated letter at 1.0', () => {
  bad(tierProbsFromLogprobs({ message: { content: 'B' } }));
  bad(tierProbsFromLogprobs({ logprobs: { content: [{ top_logprobs: [] }] } }));
});
test('C: partial letters, nonfinite or positive logprobs fail', () => {
  const mk = (c) => ({ logprobs: { content: [{ top_logprobs: c }] } });
  bad(tierProbsFromLogprobs(mk([{ token: 'A', logprob: -0.1 }, { token: 'B', logprob: -2 }])));
  bad(tierProbsFromLogprobs(mk([{ token: 'A', logprob: NaN }, { token: 'B', logprob: -2 }, { token: 'C', logprob: -3 }])));
  bad(tierProbsFromLogprobs(mk([{ token: 'A', logprob: 5 }, { token: 'B', logprob: -2 }, { token: 'C', logprob: -3 }])));
});
test('C: all three letters give a normalized prediction', () => {
  const r = tierProbsFromLogprobs({ logprobs: { content: [{ top_logprobs: [
    { token: 'A', logprob: Math.log(0.2) }, { token: 'B', logprob: Math.log(0.7) }, { token: 'C', logprob: Math.log(0.1) }] }] } });
  assert.equal(r.failed, undefined);
  assert.ok(Math.abs(r.probs.standard - 0.7) < 1e-9);
});
test('D: partial tiers fail', () => bad(tierProbsFromSystemOne({ probabilities: { cheap: 0.5, standard: 0.5 }, choice: 'cheap' })));
test('D: zero sum with a choice label fails (not one-hot)', () => {
  bad(tierProbsFromSystemOne({ probabilities: { cheap: 0, standard: 0, frontier: 0 }, choice: 'frontier' }));
  bad(tierProbsFromSystemOne({ choice: 'frontier' }));
  bad(tierProbsFromSystemOne(null));
});
test('D: null, negative, nonfinite, MAX_VALUE overflow fail', () => {
  bad(tierProbsFromSystemOne({ probabilities: { cheap: null, standard: 0.5, frontier: 0.5 } }));
  bad(tierProbsFromSystemOne({ probabilities: { cheap: -0.1, standard: 0.6, frontier: 0.5 } }));
  bad(tierProbsFromSystemOne({ probabilities: { cheap: Infinity, standard: 0, frontier: 0 } }));
  bad(tierProbsFromSystemOne({ probabilities: { cheap: Number.MAX_VALUE, standard: Number.MAX_VALUE, frontier: 0 } }));
});
test('D: valid input predicts with confidence = top score', () => {
  const r = tierProbsFromSystemOne({ probabilities: { cheap: 0.1, standard: 0.2, frontier: 0.7 } });
  assert.equal(r.failed, undefined);
  assert.ok(Math.abs(r.probs.frontier - 0.7) < 1e-9);
  assert.deepEqual(Object.keys(normalizeTierProbs({ cheap: 2, standard: 1, frontier: 1 }).probs), ['cheap', 'standard', 'frontier']);
});
test('summary counts failed rows as non-predictions, reported separately', () => {
  const s = summarizeRows([{ failed: false, correct: true }, { failed: false, correct: false }, { failed: true, reason: 'malformed_response' }]);
  assert.deepEqual([s.total, s.predicted, s.failed, s.correct], [3, 2, 1, 1]);
  assert.equal(s.accuracyOfPredicted, 0.5);
  assert.ok(Math.abs(s.accuracyOfAll - 1 / 3) < 1e-9);
});
