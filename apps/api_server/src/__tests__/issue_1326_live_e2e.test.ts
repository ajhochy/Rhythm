/** Live loopback diagnostic route for issue #1326. */
import { beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const describeLive = LIVE ? describe : describe.skip;

describeLive('issue #1326 live durable logs endpoint', () => {
  beforeAll(() => assertLiveE2EIsolation());

  it('serves a bounded tail from the isolated loopback api_server', async () => {
    const response = await fetch(`${BASE}/dev/logs/tail?lines=25`);
    expect(response.status).toBe(200);
    const body = await response.json() as { path: string; lines: string[] };
    expect(body.path).toMatch(/Library\/Logs\/Rhythm\/api_server\.log$/);
    expect(body.lines.length).toBeLessThanOrEqual(25);
    expect(body.lines.some((line) => line.includes('[server]'))).toBe(true);
  });
});
