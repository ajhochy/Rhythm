/**
 * #1378 / #1379 — cold-start retry budget for paired-gateway reads.
 *
 * Proven against the real module source transpiled in-process (same strategy
 * as tests/transport-clients.test.mjs); only the fetch attempt and the sleep
 * are injected.
 *
 * Run:  node --test tests/issue-1378-cold-start-retry.test.mjs
 */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const src = await readFile(
  new URL('../lib/opencode/cold-start-retry.ts', import.meta.url),
  'utf8',
);
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  fetchWithColdStartBackoff,
  isTransientGatewayStatus,
  GATEWAY_RETRY_DELAYS_MS,
} = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
);

function response(status) {
  return { status, body: null };
}

/** Records slept durations without actually waiting. */
function fakeSleep(record) {
  return async (ms) => {
    record.push(ms);
  };
}

test('a transient status is retried until it succeeds', async () => {
  const statuses = [504, 502, 200];
  let calls = 0;
  const slept = [];
  const result = await fetchWithColdStartBackoff(
    async () => response(statuses[calls++]),
    { retryable: true, sleep: fakeSleep(slept) },
  );
  assert.equal(result.status, 200);
  assert.equal(calls, 3, 'should have taken three attempts');
  assert.deepEqual(slept, [400, 1200], 'backoff must be increasing');
});

test('a success on the first attempt is never retried', async () => {
  let calls = 0;
  const slept = [];
  const result = await fetchWithColdStartBackoff(
    async () => {
      calls += 1;
      return response(200);
    },
    { retryable: true, sleep: fakeSleep(slept) },
  );
  assert.equal(result.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
});

test('a definite failure is surfaced immediately, not retried', async () => {
  for (const status of [400, 401, 403, 404, 500]) {
    let calls = 0;
    const result = await fetchWithColdStartBackoff(
      async () => {
        calls += 1;
        return response(status);
      },
      { retryable: true, sleep: fakeSleep([]) },
    );
    assert.equal(result.status, status);
    assert.equal(calls, 1, `status ${status} must not be retried`);
  }
});

test('non-idempotent requests get exactly one attempt', async () => {
  let calls = 0;
  const result = await fetchWithColdStartBackoff(
    async () => {
      calls += 1;
      return response(504);
    },
    { retryable: false, sleep: fakeSleep([]) },
  );
  assert.equal(result.status, 504);
  assert.equal(calls, 1, 'a write must never be replayed');
});

test('the budget is bounded — an always-transient upstream stops retrying', async () => {
  let calls = 0;
  const slept = [];
  const result = await fetchWithColdStartBackoff(
    async () => {
      calls += 1;
      return response(504);
    },
    { retryable: true, sleep: fakeSleep(slept) },
  );
  assert.equal(result.status, 504, 'the last response is surfaced');
  assert.equal(calls, GATEWAY_RETRY_DELAYS_MS.length + 1);
  assert.equal(slept.length, GATEWAY_RETRY_DELAYS_MS.length);
});

test('an aborted wait propagates instead of retrying', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchWithColdStartBackoff(async () => response(504), {
      retryable: true,
      signal: controller.signal,
    }),
  );
});

test('only the gateway transient statuses are treated as retryable', () => {
  assert.equal(isTransientGatewayStatus(502), true);
  assert.equal(isTransientGatewayStatus(503), true);
  assert.equal(isTransientGatewayStatus(504), true);
  assert.equal(isTransientGatewayStatus(500), false);
  assert.equal(isTransientGatewayStatus(429), false);
});

// ── #1422: a definitive 503 must not be replayed ─────────────────────────────
//
// The paired gateway answers 503 for BOTH "still warming" and the definitive
// "the Mac is asleep" (mac_offline). Replaying the latter burned the whole
// 4.6s budget before surfacing an answer the first response already carried,
// which stranded the chat screen in a loading state past its own timeout
// (issue-1387-c24). `isDefinitive` lets the caller separate the two.

/** A 503 carrying a JSON error body, readable via clone() like a real Response. */
function offlineResponse(code) {
  const payload = JSON.stringify({ error: code });
  return {
    status: 503,
    body: null,
    clone: () => ({ text: async () => payload }),
  };
}

test('issue-1422: a definitive mac_offline 503 is returned immediately, not retried', async () => {
  let calls = 0;
  const slept = [];
  const isDefinitive = async (res) => {
    if (res.status !== 503) return false;
    const { error } = JSON.parse(await res.clone().text());
    return error === 'mac_offline' || error === 'mac_offline_and_mirror_incomplete';
  };

  const result = await fetchWithColdStartBackoff(
    async () => {
      calls += 1;
      return offlineResponse('mac_offline');
    },
    { retryable: true, sleep: fakeSleep(slept), isDefinitive },
  );

  assert.equal(result.status, 503);
  assert.equal(calls, 1, 'a definitive answer must not be replayed');
  assert.deepEqual(slept, [], 'no backoff may be spent on a definitive answer');
});

test('issue-1422: a warming 503 is still retried when isDefinitive says no', async () => {
  // The predicate must not disable the budget wholesale — an ordinary 503 with
  // no mac_offline marker is still the cold-start case #1378 exists for.
  const statuses = [503, 503, 200];
  let calls = 0;
  const slept = [];

  const result = await fetchWithColdStartBackoff(
    async () => response(statuses[calls++]),
    { retryable: true, sleep: fakeSleep(slept), isDefinitive: async () => false },
  );

  assert.equal(result.status, 200);
  assert.equal(calls, 3, 'a warming 503 must still be replayed');
  assert.deepEqual(slept, [400, 1200]);
});

test('issue-1422: the definitive response keeps its body for the caller', async () => {
  // The retry path cancels bodies before replaying; a definitive answer must
  // be handed back intact so the caller can read its error code.
  const result = await fetchWithColdStartBackoff(
    async () => offlineResponse('mac_offline_and_mirror_incomplete'),
    { retryable: true, sleep: fakeSleep([]), isDefinitive: async () => true },
  );
  const { error } = JSON.parse(await result.clone().text());
  assert.equal(error, 'mac_offline_and_mirror_incomplete');
});
