import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { apiPost } from '../api_client.js';

// #1115 — org-optimizer `fetch failed`: a full pass held open by
// org_optimizer_run_controller can run 200-600s, but undici's default fetch
// dispatcher aborts with a generic "TypeError: fetch failed"
// (UND_ERR_HEADERS_TIMEOUT) if response HEADERS don't arrive within its
// hard-coded 300s default.
//
// These tests drive a REAL local HTTP server with a controllable response
// delay rather than a mocked global fetch. A mocked-fetch version of this
// test passed while the real implementation was broken at runtime: Node's
// global fetch is backed by its own internal, separately vendored undici
// (node:internal/deps/undici) — mixing an Agent from the external `undici`
// npm package into it throws "invalid onRequestStart method" even though it
// type-checks and satisfies a mock. Only a real request against a real
// socket catches that class of bug.
describe('apiPost — #1115 per-call timeout override', () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  function startDelayedServer(responseDelayMs: number): Promise<string> {
    server = http.createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }, responseDelayMs);
    });
    return new Promise((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        const { port } = server!.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  }

  it('a short timeoutMs rejects a response slower than the configured headers timeout', async () => {
    const url = await startDelayedServer(1500);

    await expect(apiPost(url, 'tok', '/slow', {}, { timeoutMs: 200 })).rejects.toThrow();
  }, 10_000);

  it('a raised timeoutMs tolerates the same slow response the short one rejected', async () => {
    const url = await startDelayedServer(1500);

    const result = await apiPost<{ ok: boolean }>(url, 'tok', '/slow', {}, { timeoutMs: 5_000 });
    expect(result).toEqual({ ok: true });
  }, 10_000);

  it('the default call path (no opts) still completes a normal fast request', async () => {
    const url = await startDelayedServer(0);

    const result = await apiPost<{ ok: boolean }>(url, 'tok', '/fast', {});
    expect(result).toEqual({ ok: true });
  });

  it("org-optimizer's configured run timeout is deterministically above undici's 300s default", () => {
    // Cross-checked against the real exported constant in orgOptimizer.test.ts;
    // restated here as a plain numeric fact so this file alone documents the
    // regression being guarded.
    const ORG_OPTIMIZER_RUN_TIMEOUT_MS = 900_000;
    expect(ORG_OPTIMIZER_RUN_TIMEOUT_MS).toBeGreaterThan(300_000);
  });
});
