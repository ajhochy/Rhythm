/** Real mobile gateway owner boundary; synthetic devices cold-paired by the existing service. */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { assertLiveE2EIsolation } from './_live_e2e_guard';
const live = process.env.RHYTHM_LIVE_E2E === '1';
(live ? describe : describe.skip)('C1 actual mobile schedule authority', () => {
  it('missing/invalid device and real non-owner cannot queue or create a run/root', async () => {
    assertLiveE2EIsolation();
    expect(process.env.RHYTHM_LIVE_URL).toBe('http://127.0.0.1:4098');
    const file = process.env.RHYTHM_C1_DEVICES_FILE!;
    expect(file).toMatch(/^\/private\/tmp\/rhythm-c1-gap-fixtures-/);
    const devices = JSON.parse(readFileSync(file, 'utf8')) as { userId: number; deviceToken: string }[];
    const owner = devices.find(d => d.userId === 1)!;
    const other = devices.find(d => d.userId === 2)!;
    expect(owner.deviceToken).not.toBe(other.deviceToken);
    const request = async (port: number, path: string, method = 'GET', token?: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Device ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      const parsed: unknown = await response.json();
      expect(parsed).not.toBeNull();
      expect(typeof parsed).toBe('object');
      return { status: response.status, body: parsed as Record<string, unknown> };
    };
    const marker = `C1-auth-${randomUUID()}`;
    const created = await request(4099, '/mobile-gateway/tools/agent-schedules', 'POST', owner.deviceToken, { name: marker, scheduleType: 'once', runAt: '2099-01-01T00:00:00.000Z', prompt: marker, agentKind: 'opencode' });
    expect(created.status).toBe(201);
    expect(created.body.createdByUserId).toBe(1);
    const id = created.body.id;
    expect((await request(4098, `/agent-schedules/${id}`, 'PATCH', undefined, { enabled: false })).status).toBe(200);
    const snapshot = async () => ({
      task: await request(4098, `/agent-schedules/${id}`),
      runs: await request(4098, `/agent-schedules/${id}/runs`),
      roots: await request(4098, `/agent-sessions?limit=100&scope=scheduled&includeArchived=true&scheduledTaskId=${id}`),
    });
    const before = await snapshot();
    expect(before.task.body).toMatchObject({ enabled: false, lastRunStatus: null });
    expect(before.runs.body).toEqual([]);
    expect(before.roots.body.sessions).toEqual([]);
    // A positive read of the very same real path proves this is not a fake-path 404.
    expect(await request(4099, `/mobile-gateway/tools/agent-schedules/${id}`, 'GET', owner.deviceToken)).toEqual(before.task);
    expect((await request(4099, '/mobile-gateway/tools/agent-schedules', 'GET', other.deviceToken)).body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
    const evidence = [];
    for (const [kind, token, status, code] of [
      ['missing', undefined, 401, 'UNAUTHORIZED'],
      ['invalid', 'c1-invalid-synthetic-device', 401, 'UNAUTHORIZED'],
      ['non-owner', other.deviceToken, 404, 'NOT_FOUND'],
    ] as const) {
      const start = Date.now();
      const result = await request(4099, `/mobile-gateway/tools/agent-schedules/${id}/trigger-now`, 'POST', token);
      expect(result.status).toBe(status);
      expect(result.body.error).toMatchObject({ code });
      expect(JSON.stringify(result.body)).not.toMatch(/stack|deviceToken|Bearer|SECRET/);
      const after = await snapshot();
      expect(after.task).toEqual(before.task);
      expect(after.runs).toEqual(before.runs);
      expect(after.roots.status).toBe(200);
      expect(after.roots.body).toMatchObject({ sessions: [], resumable: [], ancestors: [], pageInfo: { hasMore: false, nextCursor: null } });
      evidence.push({ kind, method: 'POST', port: 4099, path: `/mobile-gateway/tools/agent-schedules/${id}/trigger-now`, elapsedMs: Date.now() - start, result, unchanged: true });
    }
    writeFileSync(`${process.env.RHYTHM_C1_GAP_EVIDENCE}/auth-live.json`, JSON.stringify({ marker, taskId: id, ownerUserId: 1, nonOwnerUserId: 2, before, evidence }, null, 2));
    console.log('C1 mobile negative boundary', JSON.stringify({ taskId: id, evidence }));
  }, 60000);
});
