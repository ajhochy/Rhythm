import { expect, test } from '@playwright/test';
import { createLiveScheduleGateway } from '../../src/gateway/schedules';

const base = 'http://127.0.0.1:4098';
const task = (allowedMcpsJson: string | null, agentConfigId = 'org-reviewer') => ({
  id: 'owned-reviewer', name: 'Reviewer', agentConfigId, allowedMcpsJson,
});
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

test('Rhythm-granted trigger waits for the shared authenticated ensure before POST', async () => {
  let release!: () => void;
  let readyCalls = 0;
  const pendingReady = new Promise<void>(resolve => { release = resolve; });
  const paths: string[] = [];
  const gateway = createLiveScheduleGateway(base, 'token', async (url) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    return json(task('{"rhythm":["rhythm_list_agents"]}'));
  }, () => { readyCalls++; return pendingReady; });
  const triggered = gateway.triggerNow('owned-reviewer');
  await expect.poll(() => readyCalls).toBe(1);
  expect(paths).toEqual(['/agent-schedules/owned-reviewer']);
  release();
  await triggered;
  expect(paths).toEqual(['/agent-schedules/owned-reviewer', '/agent-schedules/owned-reviewer/trigger-now']);
});

test('zero-MCP task triggers without waiting for unrelated Rhythm ensure', async () => {
  const paths: string[] = [];
  let readyCalls = 0;
  const gateway = createLiveScheduleGateway(base, 'token', async (url) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    return json(task('{}'));
  }, async () => { readyCalls++; });
  await gateway.triggerNow('owned-reviewer');
  expect(readyCalls).toBe(0);
  expect(paths).toEqual(['/agent-schedules/owned-reviewer', '/agent-schedules/owned-reviewer/trigger-now']);
});

test('inherited profile Rhythm grants require ensure', async () => {
  const paths: string[] = [];
  let readyCalls = 0;
  const gateway = createLiveScheduleGateway(base, 'token', async (url) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path === '/agent-schedules/owned-reviewer') return json(task(null));
    if (path === '/agent-configs/org-reviewer') return json({ allowedMcpsJson: '{"rhythm":["rhythm_list_agents"]}' });
    return json(task(null));
  }, async () => { readyCalls++; });
  await gateway.triggerNow('owned-reviewer');
  expect(readyCalls).toBe(1);
  expect(paths).toEqual(['/agent-schedules/owned-reviewer', '/agent-configs/org-reviewer', '/agent-schedules/owned-reviewer/trigger-now']);
});

test('an unrelated MCP grant never waits for Rhythm ensure', async () => {
  const paths: string[] = [];
  let readyCalls = 0;
  const gateway = createLiveScheduleGateway(base, 'token', async (url) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    return json(task('{"obsidian":["obsidian_search"]}'));
  }, async () => { readyCalls++; });
  await gateway.triggerNow('owned-reviewer');
  expect(readyCalls).toBe(0);
  expect(paths).toEqual(['/agent-schedules/owned-reviewer', '/agent-schedules/owned-reviewer/trigger-now']);
});

for (const scope of ['{"rhythm":[]}', '{"rhythm":{"allowedTools":[]}}']) {
  test(`server-wide Rhythm scope waits for authenticated ensure: ${scope}`, async () => {
    let readyCalls = 0;
    const gateway = createLiveScheduleGateway(base, 'token', async () => json(task(scope)),
      async () => { readyCalls++; });
    await gateway.triggerNow('owned-reviewer');
    expect(readyCalls).toBe(1);
  });
}

test('a valid unrestricted profile waits, while a missing CLI profile does not', async () => {
  for (const exists of [true, false]) {
    let readyCalls = 0;
    const gateway = createLiveScheduleGateway(base, 'token', async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.startsWith('/agent-configs/')) return exists
        ? json({ allowedMcpsJson: null }) : new Response('', { status: 404 });
      return json(task(null));
    }, async () => { readyCalls++; });
    await gateway.triggerNow('owned-reviewer');
    expect(readyCalls).toBe(exists ? 1 : 0);
  }
});

test('explicit deny-all and unrelated server arrays skip Rhythm ensure', async () => {
  for (const scope of ['[]', '["obsidian"]']) {
    let readyCalls = 0;
    const gateway = createLiveScheduleGateway(base, 'token', async () => json(task(scope)),
      async () => { readyCalls++; });
    await gateway.triggerNow('owned-reviewer');
    expect(readyCalls).toBe(0);
  }
});
