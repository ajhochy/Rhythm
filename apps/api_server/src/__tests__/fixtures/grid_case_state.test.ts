import { expect, it } from 'vitest';
import { resetGridCaseState } from './grid_case_state';

it('failed unknown/429/config cases cannot leak test controls into the next case; evidence survives', async () => {
  const baseline = {
    unknown: false, malformed: false, fail429: [], usage: {
      'openai-a': { five: 40, week: 50 }, 'openai-b': { five: 5, week: 10 },
      'anthropic-a': { five: 40, week: 50 }, 'anthropic-b': { five: 5, week: 10 },
    },
  };
  let provider: object = { unknown: true, malformed: true, fail429: ['openai-a'], usage: {} };
  let config = 'all-excluded';
  const captures = [{ accountLabel: 'openai-a', HTTPstatus: 429 }];
  const cooldowns = [{ accountId: 'syntheticgrid-openai-a', exhaustedUntil: 42 }];
  const calls: string[] = [];
  const reset = () => resetGridCaseState(async body => {
    calls.push('control'); provider = { ...provider, ...body };
  }, async () => { calls.push('configure'); config = 'baseline'; }, async () => {
    calls.push('usage'); expect(provider).toEqual(baseline); expect(config).toBe('baseline');
  });
  // Model afterEach even when the meaningful case assertion throws, then beforeEach.
  await expect((async () => {
    try { throw new Error('original case failure'); }
    finally { await reset(); }
  })()).rejects.toThrow('original case failure');
  provider = { unknown: true, fail429: ['anthropic-b'], malformed: true, usage: {} };
  config = 'cross-provider';
  await reset();
  expect(calls).toEqual(['control', 'configure', 'usage', 'control', 'configure', 'usage']);
  expect(captures).toEqual([{ accountLabel: 'openai-a', HTTPstatus: 429 }]);
  expect(cooldowns).toEqual([{ accountId: 'syntheticgrid-openai-a', exhaustedUntil: 42 }]);
});
