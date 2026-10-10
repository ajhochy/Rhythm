'use strict';
// Manager-runnable deterministic check: no scope(), file reads, fetch, or server operations.
const assert = require('node:assert/strict');
const { destination } = require('./grid_transport_guard.cjs');
for (const endpoint of ['codex/responses', 'wham/usage']) {
  const url = new URL(`https://chatgpt.com/backend-api/${endpoint}`);
  const result = destination(url, new Headers({ authorization: 'Bearer syntheticgrid-openai-b-access', 'chatgpt-account-id': 'syntheticgrid-openai-b-workspace' }));
  assert.equal(result.url, `http://127.0.0.1:7482/backend-api/${endpoint}`);
  assert.equal(result.label, 'openai-b');
  for (const credential of ['', 'Bearer not-whitelisted', 'Bearer syntheticgrid-unlisted-access', 'Bearer __proto__']) {
    assert.throws(() => destination(url, new Headers({ authorization: credential })));
  }
}
for (const url of ['https://example.invalid/', 'https://chatgpt.com/backend-api/codex/responses?extra=1', 'http://127.0.0.1:4096/', 'http://user:pass@127.0.0.1:7482/']) {
  assert.throws(() => destination(new URL(url), new Headers({ authorization: 'Bearer syntheticgrid-openai-a-access' })));
}
assert.throws(() => destination(new URL('http://127.0.0.1:7482/'), new Headers({ authorization: 'Bearer not-whitelisted' })));
const anthropicHeaders = new Headers({ authorization: 'Bearer syntheticgrid-anthropic-b-access' });
assert.equal(destination(new URL('http://127.0.0.1:7482/v1/messages?beta=true'), anthropicHeaders).label, 'anthropic-b');
for (const url of ['https://api.anthropic.com/v1/messages?beta=true', 'http://127.0.0.1:7482/v1/messages?beta=false', 'http://127.0.0.1:7482/v1/messages?beta=true&extra=1']) {
  assert.throws(() => destination(new URL(url), anthropicHeaders));
}
for (const authorization of ['Bearer not-whitelisted', 'Bearer syntheticgrid-openai-a-access', '']) {
  assert.throws(() => destination(new URL('http://127.0.0.1:7482/v1/messages?beta=true'), new Headers({ authorization })));
}
const native = new Request('https://chatgpt.com/backend-api/codex/responses', { method: 'POST', headers: { authorization: 'Bearer syntheticgrid-openai-a-access' }, body: JSON.stringify({ model: 'gpt-6-luna', reasoning: { effort: 'high' } }) });
const target = destination(new URL(native.url), native.headers);
const clone = new Request(target.url, native);
assert.equal(clone.method, 'POST');
assert.equal(clone.headers.get('authorization') === native.headers.get('authorization'), true);
clone.json().then(body => { assert.deepEqual(body, { model: 'gpt-6-luna', reasoning: { effort: 'high' } }); console.info(JSON.stringify({ guardPolicyPassed: true, nativeBodyPreserved: true })); });
