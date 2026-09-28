import assert from 'node:assert/strict';
import test from 'node:test';
import { accountStatus } from '../src/components/tools/aiAccountsBridge.ts';
const provider = { grantEnabled: false, applicationState: 'absent', rhythmSourceState: 'static-api-key', hermesSourceState: 'absent', sharingEligibility: 'eligible' };
const dto = () => ({ version: 1, availability: 'available', providers: Object.fromEntries(['openai','anthropic','google','openrouter'].map(name => [name, { ...provider }])), childMayRetainCredential: false });
test('UI metadata parser drops unknown secret fields and refuses coerced enums', () => {
  const input = dto(); input.secret = 'synthetic-key'; input.providers.openai.secret = 'synthetic-key';
  assert.equal(JSON.stringify(accountStatus(input)).includes('synthetic-key'), false);
  for (const field of ['applicationState', 'rhythmSourceState', 'hermesSourceState', 'sharingEligibility']) {
    const invalid = dto(); invalid.providers.openai[field] = [provider[field]];
    assert.equal(accountStatus(invalid).availability, 'unavailable');
  }
});
