'use strict';
// TEST ONLY. No production imports. Both the Node preload and engine plugin use this policy.
const fs = require('node:fs');
// Exact fixed scope roots only (original grid cohort; fresh Dayflow-unavailable cohort). Any other
// value refuses scope. Destinations, credentials and every rule below are identical for both.
const ROOTS = ['/private/tmp/sdmr-grid-sandbox', '/private/tmp/sdmr-grid-sandbox-r6u', '/private/tmp/sdmr-grid-sandbox-r14c'];
const ROOT = process.env.RHYTHM_GRID_SANDBOX_ROOT ?? ROOTS[0];
const LOCAL = 'http://127.0.0.1:7482';
const labels = ['openai-a', 'openai-b', 'anthropic-a', 'anthropic-b'];
const tokens = Object.fromEntries(labels.map(label => [`syntheticgrid-${label}-access`, label]));
function scope() {
  if (!ROOTS.includes(ROOT)) throw new Error('GRID_SCOPE_REFUSED');
  for (const p of [ROOT, `${ROOT}/home`, `${ROOT}/tmp`]) {
    if (fs.realpathSync(p) !== p) throw new Error('GRID_SCOPE_REFUSED');
  }
  if (process.env.HOME !== `${ROOT}/home` || process.env.TMPDIR !== `${ROOT}/tmp` ||
      process.env.RHYTHM_API_BASE !== 'http://127.0.0.1:4398' ||
      process.env.RHYTHM_OPENCODE_ENGINE_PORT !== '4397' ||
      fs.realpathSync(`${ROOT}/home/.syntheticgrid-approved`) !== `${ROOT}/home/.syntheticgrid-approved` ||
      fs.readFileSync(`${ROOT}/home/.syntheticgrid-approved`, 'utf8') !== 'syntheticgrid-local-only-v1\n') {
    throw new Error('GRID_SCOPE_REFUSED');
  }
}
function identity(headers) {
  const bearer = headers.get('authorization');
  const key = headers.get('x-api-key');
  if (key) throw new Error('GRID_CREDENTIAL_REFUSED');
  if (!bearer) return null;
  const token = bearer.replace(/^Bearer /, '');
  const label = Object.hasOwn(tokens, token) ? tokens[token] : null;
  if (!label) throw new Error('GRID_CREDENTIAL_REFUSED');
  const account = headers.get('chatgpt-account-id');
  if (account && account !== `syntheticgrid-${label}-workspace`) throw new Error('GRID_IDENTITY_REFUSED');
  return label;
}
function destination(url, headers) {
  if (url.username || url.password || url.hash) throw new Error('GRID_EGRESS_REFUSED');
  // The native Anthropic plugin adds this query to an ALREADY local Messages URL.
  // Never broaden the exact external allowlist (including external ?beta=true).
  if (url.origin === LOCAL && url.search && !(url.pathname === '/v1/messages' && url.search === '?beta=true')) throw new Error('GRID_EGRESS_REFUSED');
  const external = new Map([
    ['https://chatgpt.com/backend-api/codex/responses', '/backend-api/codex/responses'],
    ['https://chatgpt.com/backend-api/wham/usage', '/backend-api/wham/usage'],
    ['https://api.anthropic.com/v1/messages', '/v1/messages'],
  ]);
  const route = external.get(url.href);
  if (route) {
    const label = identity(headers);
    if (!label || (route === '/v1/messages') !== label.startsWith('anthropic-')) throw new Error('GRID_CREDENTIAL_REFUSED');
    return { url: LOCAL + route, label, kind: route === '/backend-api/codex/responses' ? 'responses' : 'usage' };
  }
  // Declared public scheduled-suite fixture only (scheduled_dayflow_memory_live_e2e scripted provider).
  // Exact host/port/path/bearer; 7481 is NOT added to the generic loopback list below.
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '7481' && !url.search &&
      url.pathname === '/v1/chat/completions' &&
      headers.get('authorization') === 'Bearer sdmr-synthetic-only' && !headers.has('x-api-key')) {
    return { url: url.href, label: null, kind: 'loopback' };
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !['4398', '4397', '4399', '7482', '7483'].includes(url.port)) throw new Error('GRID_EGRESS_REFUSED');
  const auth = headers.get('authorization');
  if (url.origin === LOCAL && url.pathname === '/v1/messages') {
    const label = identity(headers);
    if (!label?.startsWith('anthropic-')) throw new Error('GRID_CREDENTIAL_REFUSED');
    return { url: url.href, label, kind: 'loopback' };
  }
  if (['4398', '4399'].includes(url.port) && auth === 'Bearer e02-synthetic-session-not-a-secret' && !headers.has('x-api-key')) {
    return { url: url.href, label: null, kind: 'loopback' };
  }
  if (url.port === '7482' && url.pathname === '/v1/decisions' && auth === 'Bearer syntheticgrid-decisions' && !headers.has('x-api-key')) {
    return { url: url.href, label: 'classifier', kind: 'decisions' };
  }
  // Declared public Dayflow fixture only; never allow this credential on external endpoints.
  if (url.port === '7483' && ['/v1/chat/completions', '/v1/models'].includes(url.pathname) && auth === 'Bearer od-synthetic-only' && !headers.has('x-api-key')) {
    return { url: url.href, label: null, kind: 'loopback' };
  }
  return { url: url.href, label: identity(headers), kind: 'loopback' };
}
function install(role) {
  scope();
  const symbol = Symbol.for(`syntheticgrid.guard.${role}`);
  if (globalThis[symbol]) return globalThis[symbol];
  const original = globalThis.fetch.bind(globalThis);
  const state = { installed: true, role, counters: { responses: 0, usage: 0, decisions: 0, loopback: 0, refused: 0 } };
  globalThis.fetch = async (input, init) => {
    let request, target;
    try {
      request = new Request(input, init);
      target = destination(new URL(request.url), request.headers);
    } catch {
      state.counters.refused++;
      throw new Error('GRID_TRANSPORT_REFUSED'); // never embed URL, credentials, or input
    }
    state.counters[target.kind]++;
    // Only fixed counter names and synthetic labels cross this local evidence channel.
    await original(`${LOCAL}/_grid/guard`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
      body: JSON.stringify({ role, installed: true, counters: state.counters, accountLabel: target.label }),
      signal: AbortSignal.timeout(3000),
    }).then(r => { if (!r.ok) throw new Error('GRID_EVIDENCE_REFUSED'); });
    // Request cloning preserves native SDK method/body/headers/signal. Only transport URL changes.
    const forwarded = new Request(target.url, request);
    return original(forwarded, { redirect: 'error' });
  };
  globalThis[symbol] = state;
  state.ready = original(`${LOCAL}/_grid/guard`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, installed: true }), redirect: 'error', signal: AbortSignal.timeout(3000),
  }).then(r => { if (!r.ok) throw new Error('GRID_GUARD_HANDSHAKE_REFUSED'); return true; });
  return state;
}
module.exports = { ROOT, LOCAL, labels, tokens, scope, identity, destination, install };
