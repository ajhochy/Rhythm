import assert from 'node:assert/strict';
import test from 'node:test';
import { appliedEffort, categoryPatch, gridEngineState, moveCandidate, priceLabel } from '../src/components/tools/gridPolicy.ts';

const a = { model: 'anthropic/claude-haiku-5-5', effort: 'low', cost_per_task: 0.02 };
const b = { model: 'openai/gpt-6-luna', effort: 'max', cost_per_task: 0.07 };
test('reorder swaps neighbours and refuses out-of-range moves', () => {
  assert.deepEqual(moveCandidate([a, b], 1, -1), [b, a]);
  assert.deepEqual(moveCandidate([a, b], 0, -1), [a, b]);
});
test('category patch sends all four tiers with only the edited tier replaced', () => {
  const grid = { routing: { coding: { 1: [b], 2: [b], 3: [b], 4: [a, b] } } };
  assert.deepEqual(categoryPatch(grid, 'coding', 4, [b]), { 1: [b], 2: [b], 3: [b], 4: [b] });
});
test('engine state mirrors the server gate: grid runs only with saved mode on|shadow', () => {
  assert.equal(gridEngineState({ routing: { engine: 'grid' }, features: { model_routing: 'on' } }).running, 'on');
  assert.equal(gridEngineState({ routing: { engine: 'grid' }, features: { model_routing: 'default' } }).running, null);
  assert.equal(gridEngineState({ features: { model_routing: 'on' } }).engine, 'legacy');
});
test('applied effort clamps like the server and $0 is never labelled free', () => {
  assert.equal(appliedEffort('max', ['low', 'high']), 'high');
  assert.equal(appliedEffort('low', ['high', 'xhigh']), 'high');
  assert.equal(appliedEffort('low', []), null);
  assert.match(priceLabel(0), /not proven free/);
  assert.doesNotMatch(priceLabel(0), /^Free/);
});
