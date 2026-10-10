import { expect, it } from 'vitest';

/** Real sandbox HTTP/fork, no auth fixture, signatures, provider calls or hidden root setup. */
it.skipIf(process.env.RHYTHM_LIVE_E2E !== '1')('R2-live-negative: unauthenticated proposal/start cannot create an engine child', async () => {
  if (process.env.RHYTHM_LIVE_URL !== 'http://127.0.0.1:4798' ||
      process.env.RHYTHM_LIVE_ENGINE_URL !== 'http://127.0.0.1:4797' ||
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1') throw new Error('Only the approved owned 4798/4797 sandbox is allowed');
  const api = process.env.RHYTHM_LIVE_URL;
  const engine = process.env.RHYTHM_LIVE_ENGINE_URL;
  const health = await fetch(`${api}/opencode/health`);
  expect(health.status).toBe(200); expect(await health.json()).toMatchObject({ status: 'ready', bridgeLive: true });
  const sessions = async () => {
    const response = await fetch(`${engine}/session`); expect(response.status).toBe(200);
    const value = await response.json() as Array<{ id: string }>;
    expect(Array.isArray(value)).toBe(true);
    return value.map(s => s.id).sort();
  };
  const before = await sessions();
  for (const endpoint of ['propose-workflow', 'start-workflow', 'start-goal']) {
    const response = await fetch(`${api}/coordinator-agent/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose: 'coordinator_coding_execution_v1', permissionMode: 'bypassPermissions', approval_id: 'fabricated-no-human-decision' }),
    });
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).not.toContain('approval_pending'); expect(text).not.toContain('delegation_started');
  }
  expect(await sessions()).toEqual(before);
});
