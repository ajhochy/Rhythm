/**
 * Live contract for the 2026-10-22 approval/ownership regressions, driven
 * through the real sandbox engine, MCP server, API and this web UI. A loopback
 * scripted model chooses the tool calls; the engine signs them, and a human
 * click in the UI approves them.
 *
 *  A  rhythm_request_approval(security_payload with due_date) -> Approve in UI
 *     -> rhythm_create_task. An altered payload stays blocked; the exact one
 *     creates the task (it failed as "approval token does not match").
 *  B  an ownerless schedule runs, a human continues its session, Approve in UI
 *     -> rhythm_delegate_async starts the child (it failed 403 "caller session
 *     is owned by another user"). Another user is still refused; a legacy
 *     ownerless run is attributed at boot.
 *
 * Launch (sandbox only; never the live 4001/4096 app):
 *   F=/private/tmp/rhythm-approval-owner-fixture-<new>
 *   node apps/web/tests/fixtures/approval-owner-scripted-provider.mjs --prepare $F
 *   export HUMAN_APPROVAL_PUBLIC_KEY=... HUMAN_APPROVAL_CAPABILITY_SHA256=...   (from $F/human-approval.json)
 *   RHYTHM_APPROVED_FIXTURE_ROOT=$F RHYTHM_LIVE_DB_PATH=$F/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=$F/opencode \
 *   RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-approval-owner-sandbox RHYTHM_SANDBOX_API_PORT=7493 \
 *   RHYTHM_SANDBOX_ENGINE_PORT=7494 RHYTHM_SANDBOX_GATEWAY_PORT=7495 tools/dev/sandbox.sh up
 *   cd apps/web && RHYTHM_LIVE_E2E=1 RHYTHM_APPROVAL_OWNER_FIXTURE=$F RHYTHM_SANDBOX_DIR=<same> \
 *   RHYTHM_LIVE_API_URL=http://127.0.0.1:7493 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:7494 \
 *   npx playwright test -c tests/approval-owner-live-playwright.config.ts
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createECDH, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { liveEnvironment } from '../live-environment';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const fixture = process.env.RHYTHM_APPROVAL_OWNER_FIXTURE ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
const USER_TOKEN = 'e02-synthetic-session-not-a-secret';
const OTHER_USER_TOKEN = 'approval-owner-other-user-not-a-secret';
const PROVIDER = { id: 'approvalowner', model: 'approval-owner-scripted', port: 7496 };
const TASK = {
  title: 'Reply to Grace De Raadt — Christmas program ideas doc',
  notes: "Grace (Children's Ministry Co-Director) sent a Google Doc of Christmas program ideas on 2026-10-21. Work inbox (ajh@visaliacrc.com), message id 1a16028669f347f1. Review the doc and reply.",
  dueDate: '2026-10-23',
};
const webRoot = resolve(import.meta.dirname, '../..');
const Database = createRequire(resolve(webRoot, '../api_server/package.json'))('better-sqlite3');

type Row = Record<string, unknown>;
const db = <T>(read: (handle: { prepare(sql: string): { get(...a: unknown[]): T; run(...a: unknown[]): unknown } }) => T): T => {
  const handle = new Database(join(sandboxDir, 'rhythm.db'));
  try { return read(handle); } finally { handle.close(); }
};

async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean, label: string, ms = 120_000): Promise<T> {
  const deadline = Date.now() + ms;
  let value = await read();
  while (!done(value)) {
    if (Date.now() > deadline) throw new Error(`timed out: ${label} (last: ${String(JSON.stringify(value)).slice(0, 400)})`);
    await new Promise((r) => setTimeout(r, 250));
    value = await read();
  }
  return value;
}

// Marks the session as having read external content, the state a gmail read
// leaves behind. There is no unsigned API for it, so the row is written as the
// #1392 live suite does.
function armTaint(sessionId: string): void {
  db((handle) => {
    const sdk = (handle.prepare('SELECT sdk_session_id FROM agent_sessions WHERE id = ?').get(sessionId) as Row).sdk_session_id;
    handle.prepare(`INSERT OR REPLACE INTO agent_external_taint_state
      (session_id, sdk_session_id, taint_id, latest_event_id, tainted_turn_id, tainted_agent, source, updated_at)
      VALUES (?, ?, ?, ?, ?, 'manager', 'gmail.message', ?)`).run(sessionId, sdk, randomUUID(), randomUUID(), `turn-${randomUUID()}`, new Date().toISOString());
  });
}

const pendingFor = (sessionId: string, action: string) => db((handle) => handle.prepare(
  `SELECT id FROM agent_approvals WHERE session_id = ? AND security_action = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
).get(sessionId, action) as Row | undefined);

// Plays Electron main's role: sign the decision with the sandbox's throwaway key.
async function installDesktopSigner(page: Page): Promise<void> {
  const keys = JSON.parse(readFileSync(join(fixture, 'human-approval.json'), 'utf8'));
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(keys.privateKey, 'base64'));
  const point = ecdh.getPublicKey();
  const key = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256',
    x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url'),
    d: Buffer.from(keys.privateKey, 'base64').toString('base64url') } });
  await page.exposeFunction('__approvalOwnerSign', (id: string, status: string, nonce: string, digest: string | null) => ({
    capability: keys.capability,
    signature: sign('sha256', Buffer.from(['rhythm-human-approval-v1', id, status, nonce, digest ?? ''].join('\n')), key).toString('base64'),
  }));
  // Electron serves the renderer from rhythm:// and makes its local-API calls as
  // the authenticated desktop. A browser page gets neither (the gateway strips
  // Authorization; error responses are not CORS-readable), so play that
  // privileged side for the sandbox API origin only. Clicks and signatures stay real.
  const apiOrigin = liveEnvironment().apiBase;
  const cors = { 'access-control-allow-origin': 'http://127.0.0.1:4175', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  // Tasks are production-domain data; like the tasks-live suite, serve the
  // configured production origin from the sandbox API.
  const productionOrigin = 'https://approval-owner-live.invalid';
  await page.route((url) => url.origin === apiOrigin || url.origin === productionOrigin, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const target = new URL(route.request().url());
    const response = await route.fetch({ url: `${apiOrigin}${target.pathname}${target.search}`, maxRedirects: 0,
      headers: { ...route.request().headers(), authorization: `Bearer ${USER_TOKEN}`, 'x-rhythm-human-approval': keys.capability } });
    return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
  });
  await page.addInitScript((capability) => {
    const bridge = { capability: async () => capability,
      signDecision: (id: string, status: string, nonce: string, digest: string | null) =>
        (window as unknown as { __approvalOwnerSign: (...a: unknown[]) => Promise<unknown> }).__approvalOwnerSign(id, status, nonce, digest) };
    (window as unknown as { rhythmShell: unknown }).rhythmShell = { humanApproval: bridge };
  }, keys.capability);
}

async function approveInUi(page: Page, approvalId: string, expectedText: string): Promise<void> {
  await page.goto('/#/agents');
  await page.getByTestId('notifications-button').click();
  const card = page.getByTestId(`approval-card-${approvalId}`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(expectedText);
  const decided = page.waitForResponse((r) => r.url().endsWith(`/agent-approvals/${approvalId}`) && r.request().method() === 'PATCH');
  await card.getByRole('button', { name: 'Approve' }).click();
  expect((await decided).status()).toBe(200);
}

let provider: ChildProcess | null = null;
const created = { profiles: [] as string[], sessions: [] as string[], schedules: [] as string[], tasks: [] as string[] };
const suffix = randomUUID().slice(0, 8);
const managerId = `approval-owner-manager-${suffix}`;
const specialistId = `approval-owner-specialist-${suffix}`;

// An ownerless schedule (created without a bearer, like the legacy ones) fires
// and its run session is returned once the scripted briefing has replied.
async function scheduledRun(api: APIRequestContext, label: string): Promise<string> {
  const response = await fetch(`${liveEnvironment().apiBase}/agent-schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `[smoke] ${label} ${suffix}`, scheduleType: 'daily', scheduledTime: '03:00', timezone: 'America/Los_Angeles', prompt: '[S] morning briefing', agentConfigId: managerId }) });
  const schedule = await response.json();
  expect(response.status, JSON.stringify(schedule)).toBe(201);
  created.schedules.push(schedule.id);
  expect(schedule.createdByUserId ?? null).toBeNull();
  expect((await api.post(`/agent-schedules/${schedule.id}/trigger-now`)).ok()).toBe(true);
  const run = await until(() => db((handle) => handle.prepare('SELECT id, owner_user_id, is_system FROM agent_sessions WHERE scheduled_task_id = ? ORDER BY created_at DESC LIMIT 1').get(schedule.id) as Row | undefined),
    Boolean, `${label} scheduled run`, 150_000);
  created.sessions.push(String(run!.id));
  // Write path: the run is the local operator's, not ownerless.
  expect(run).toMatchObject({ owner_user_id: 1, is_system: 1 });
  await until(() => db((handle) => handle.prepare(`SELECT count(*) AS n FROM agent_session_messages WHERE session_id = ? AND raw_text LIKE '%BRIEFING_DONE%'`).get(run!.id) as Row).n as number, (n) => n > 0, `${label} briefing reply`);
  return String(run!.id);
}


test.describe('approval payload binding and scheduled session ownership (live sandbox)', () => {
  test.skip(!LIVE, 'Requires the assigned approval/owner sandbox');
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    const { apiBase } = liveEnvironment();
    expect(apiBase).toBe('http://127.0.0.1:7493');
    expect(sandboxDir.startsWith('/private/tmp/') && fixture.startsWith('/private/tmp/')).toBe(true);
    api = await playwright.request.newContext({ baseURL: apiBase, extraHTTPHeaders: { Authorization: `Bearer ${USER_TOKEN}` } });
    expect((await api.get('/opencode/health')).ok()).toBe(true);
    provider = spawn(process.execPath, [resolve(import.meta.dirname, '../fixtures/approval-owner-scripted-provider.mjs')], {
      env: { ...process.env, RHYTHM_APPROVAL_OWNER_PROVIDER_PORT: String(PROVIDER.port), RHYTHM_APPROVAL_OWNER_SPECIALIST: specialistId },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    await until(() => fetch(`http://127.0.0.1:${PROVIDER.port}/_approval_owner/log`).then((r) => r.ok).catch(() => false), Boolean, 'scripted provider', 10_000);
    const permissions = JSON.stringify({ rhythm_request_approval: 'allow', rhythm_create_task: 'allow', rhythm_delegate: 'allow' });
    for (const profile of [
      { id: specialistId, label: specialistId, isAgent: true, enabled: true, sessionSelectable: true, modelProvider: PROVIDER.id, modelId: PROVIDER.model, ocAgent: specialistId },
      { id: managerId, label: managerId, isAgent: true, isManager: true, enabled: true, sessionSelectable: true, modelProvider: PROVIDER.id, modelId: PROVIDER.model, ocAgent: managerId, allowedDelegatesJson: JSON.stringify([specialistId]), corePermissionsJson: permissions },
    ]) {
      const response = await api.post('/agent-configs', { data: profile });
      expect(response.status(), await response.text()).toBe(201);
      created.profiles.push(profile.id);
    }
    expect((await api.post('/system/refresh')).ok()).toBe(true);
  });

  test.afterAll(async () => {
    for (const id of created.tasks) await api.delete(`/tasks/${id}`).catch(() => undefined);
    for (const id of created.sessions.reverse()) await api.delete(`/agent-sessions/${id}/hard`).catch(() => undefined);
    for (const id of created.schedules) await api.delete(`/agent-schedules/${id}`).catch(() => undefined);
    for (const id of created.profiles.reverse()) await api.delete(`/agent-configs/${id}`).catch(() => undefined);
    provider?.kill('SIGTERM');
  });

  test('A: an approval requested with the tool argument names lets exactly that task be created', async ({ page }) => {
    await installDesktopSigner(page);
    // Both live failures happened after a human replied into the scheduled briefing.
    const session = { id: await scheduledRun(api, 'approval A') };
    armTaint(session.id);

    const promptedA = await api.post(`/agent-sessions/${session.id}/prompt`, { data: { prompt: '[A1] create the Grace follow-up task' } });
    expect(promptedA.ok(), await promptedA.text()).toBe(true);
    const pending = await until(() => pendingFor(session.id, 'task.create'), Boolean, 'task.create approval');
    await approveInUi(page, String(pending!.id), TASK.title);

    // The continuation wakes the agent: the altered retry is refused, the exact one lands.
    const log = await until(async () => (await (await fetch(`http://127.0.0.1:${PROVIDER.port}/_approval_owner/log`)).json()) as Array<{ prompt: string; results: string[] }>,
      (entries) => entries.some((entry) => entry.results.length >= 2), 'create_task attempts');
    const attempts = log.find((entry) => entry.results.length >= 2)!.results;
    expect(attempts[0]).toContain('approval token does not match the exact outbound action and payload');
    expect(attempts[1]).not.toMatch(/Blocked|does not match|Rhythm API error/);

    const tasks = await until(async () => (await (await api.get('/tasks')).json()) as Array<Row>, (rows) => rows.some((row) => row.title === TASK.title), 'created task');
    const task = tasks.find((row) => row.title === TASK.title)!;
    created.tasks.push(String(task.id));
    expect(task).toMatchObject({ title: TASK.title, notes: TASK.notes, dueDate: TASK.dueDate });
    expect(tasks.some((row) => String(row.title).endsWith('(edited)'))).toBe(false);
    expect(db((handle) => handle.prepare('SELECT consumed_at FROM agent_approvals WHERE id = ?').get(pending!.id) as Row).consumed_at).toBeTruthy();

    await page.goto('/#/tasks');
    await expect(page.locator('#tasks-title')).toBeVisible();
    await expect(page.getByTestId(`task-row-${task.id}`)).toContainText(TASK.title);
  });

  test('B: a human continuing a scheduled run can delegate after approval; another user cannot; async stays chat-only', async ({ page }) => {
    await installDesktopSigner(page);
    // The reported session's backfill: a legacy ownerless run, attributed at boot.
    expect(db((handle) => handle.prepare(`SELECT owner_user_id FROM agent_sessions WHERE id = 'legacy-ownerless-run'`).get() as Row).owner_user_id).toBe(1);

    const run = { id: await scheduledRun(api, 'briefing B') };

    // A human replies into the scheduled conversation and asks for a delegation.
    armTaint(String(run!.id));
    const promptedB = await api.post(`/agent-sessions/${run!.id}/prompt`, { data: { prompt: '[B1] delegate the follow-up' } });
    expect(promptedB.ok(), await promptedB.text()).toBe(true);
    const pending = await until(() => pendingFor(String(run!.id), 'delegation.start'), Boolean, 'delegation approval');
    await approveInUi(page, String(pending!.id), specialistId);

    // The approved delegation runs as the operator who owns the scheduled run.
    const child = await until(() => db((handle) => handle.prepare('SELECT id, owner_user_id FROM agent_sessions WHERE parent_session_id = ? ORDER BY created_at DESC LIMIT 1').get(run!.id) as Row | undefined), Boolean, 'child run');
    created.sessions.push(String(child!.id));
    expect(child!.owner_user_id).toBe(1);
    const log = await until(async () => (await (await fetch(`http://127.0.0.1:${PROVIDER.port}/_approval_owner/log`)).json()) as Array<{ prompt: string; results: string[] }>,
      (entries) => entries.some((entry) => entry.prompt.includes('[Rhythm human approval decision]') && entry.results.length > 0 && entry.results.some((r) => r.includes('CHILD_OK') || r.includes('owned by another user'))), 'delegate result');
    const delegated = log.filter((entry) => entry.results.length > 0).flatMap((entry) => entry.results);
    expect(delegated.join('\n')).toContain('CHILD_OK');
    expect(delegated.join('\n')).not.toContain('owned by another user');
    expect(db((handle) => handle.prepare('SELECT consumed_at FROM agent_approvals WHERE id = ?').get(pending!.id) as Row).consumed_at).toBeTruthy();

    const delegateAsync = (token: string) => fetch(`${liveEnvironment().apiBase}/agent-delegation/delegate-async`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ callerSessionId: run!.id, targetAgentConfigId: specialistId, prompt: '[CHILD] not allowed' }) });
    // Ownership stays strict for anyone else.
    const other = await delegateAsync(OTHER_USER_TOKEN);
    expect(other.status).toBe(403);
    expect(await other.text()).toMatch(/owned by another user/);
    // The owner now passes ownership and meets the deliberate #1123 rule instead:
    // async delegation remains interactive-chat only.
    const owner = await delegateAsync(USER_TOKEN);
    expect(owner.status).toBe(403);
    expect(await owner.text()).toMatch(/only available in interactive chat sessions/);
  });
});
