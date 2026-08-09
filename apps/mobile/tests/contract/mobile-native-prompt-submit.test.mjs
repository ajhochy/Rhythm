import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const providerSource = await readFile(
  new URL('../../providers/opencode-provider.tsx', import.meta.url),
  'utf8',
);
const promptAsyncStart = providerSource.indexOf('await client.session.promptAsync({');
const promptAsyncEnd = providerSource.indexOf('\n        });', promptAsyncStart);
const promptAsyncRequest = providerSource.slice(promptAsyncStart, promptAsyncEnd);

test('mobile-native-prompt-submit-c1: unbound prompts never pass explicit undefined fields into the SDK request', () => {
  // Regression caught: Hermes converts explicitly-present undefined structured
  // fields while the generated SDK builds its native request body, throwing
  // before prompt_async reaches the paired gateway.
  assert.ok(promptAsyncStart >= 0 && promptAsyncEnd > promptAsyncStart);
  assert.doesNotMatch(promptAsyncRequest, /\n\s+(?:agent|model|system): executionPlan\.(?:agent|model|system),/);
});

test('mobile-native-prompt-submit-c2: the prompt_async request conditionally includes each optional override', () => {
  // Regression caught: an unbound session has no agent, model, or system
  // override but still serializes those keys instead of submitting its parts.
  for (const field of ['agent', 'model', 'system']) {
    assert.match(
      promptAsyncRequest,
      new RegExp(`\\.\\.\\.\\(executionPlan\\.${field} !== undefined \\? \\{ ${field}: executionPlan\\.${field} \\} : \\{\\}\\)`),
    );
  }
});

test('mobile-native-prompt-submit-c3: bound overrides retain their exact SDK field values', () => {
  // Regression caught: removing undefined properties also drops valid bound
  // agent/model/system overrides or transforms their values before transport.
  for (const field of ['agent', 'model', 'system']) {
    assert.match(
      promptAsyncRequest,
      new RegExp(`\\{ ${field}: executionPlan\\.${field} \\}`),
    );
  }
});
