/**
 * E1 real queue-read gate. The operator starts the approved disposable sandbox;
 * this spec starts only its Vite renderer and never signs an approval decision.
 * The sandbox fixture DB must contain the public synthetic bearer below, and
 * its API must be configured with SHA-256 of the public capability below.
 */
import { realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const bearer = 'e02-synthetic-session-not-a-secret';
const capability = 'e1-public-synthetic-capability-v1';
const apiBase = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const engineBase = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
const run = process.env.RHYTHM_LIVE_E2E === '1';

test.skip(!run, 'RHYTHM_LIVE_E2E=1 is required for disposable sandbox writes');

function assertSandbox() {
  const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
  if (process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' || !sandboxDir ||
      !(sandboxDir.startsWith('/private/tmp/') || sandboxDir.startsWith('/var/folders/')) ||
      !basename(sandboxDir).startsWith('rhythm-') ||
      realpathSync(sandboxDir) !== sandboxDir ||
      process.env.DB_PATH !== join(sandboxDir, 'rhythm.db')) {
    throw new Error('E1 live gate requires the canonical disposable sandbox and its active rhythm.db');
  }
  const api = new URL(apiBase);
  const engine = new URL(engineBase);
  for (const target of [api, engine]) {
    if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' ||
        !target.port || ['4000', '4001', '4002', '4096'].includes(target.port) ||
        target.pathname !== '/' || target.search || target.hash || target.username || target.password) {
      throw new Error('E1 live gate accepts only non-shipping loopback sandbox ports');
    }
  }
  if (api.port === engine.port) throw new Error('E1 API and engine ports must differ');
  if (process.env.RHYTHM_SANDBOX_E1_PUBLIC_FIXTURE !== '1') {
    throw new Error('E1 requires a DB fixture with the public synthetic bearer and capability digest');
  }
  return sandboxDir;
}

async function postSynthetic(request: APIRequestContext, path: string, body: Record<string, unknown>) {
  const response = await request.post(`${apiBase}${path}`, {
    headers: { Authorization: `Bearer ${bearer}` }, data: body,
  });
  expect(response.status(), `${path}: ${await response.text()}`).toBe(201);
  return await response.json() as { id: string; status?: string };
}

async function addApproval(request: APIRequestContext, action: string, sessionId: string | null) {
  const row = await postSynthetic(request, '/agent-approvals', { action, sessionId, preview: 'Public synthetic E1 fixture only' });
  expect(row.status).toBe('pending');
  return row.id;
}

async function openReadOnlyQueue(page: Page, sessionId: string) {
  await page.addInitScript((publicCapability) => {
    Object.assign(window, { rhythmShell: { humanApproval: {
      capability: async () => publicCapability,
      signDecision: async () => { throw new Error('E1 read-only fixture refuses decisions'); },
    } } });
  }, capability);
  await page.goto(`/#/agents?sessionId=${encodeURIComponent(sessionId)}`);
  await page.getByTestId('notifications-button').click();
}

test('real sandbox queue converges after mount, focus, reconnect and reload while retaining unrelated pending rows', async ({ page, request, context }) => {
  const sandboxDir = assertSandbox();
  const marker = `E1-public-synthetic-${Date.now()}-${process.pid}`;
  const session = await postSynthetic(request, '/agent-sessions', {
    agentId: null, cwd: sandboxDir, name: `${marker}-bound-session`,
  });
  const other = await postSynthetic(request, '/agent-sessions', {
    agentId: null, cwd: sandboxDir, name: `${marker}-other-session`,
  });
  const approvalsGets: number[] = [];
  const approvalPatches: string[] = [];
  page.on('response', (response) => {
    if (response.url().startsWith(`${apiBase}/agent-approvals?status=pending`)) approvalsGets.push(response.status());
  });
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().startsWith(`${apiBase}/agent-approvals/`)) approvalPatches.push(req.url());
  });
  await openReadOnlyQueue(page, session.id);
  const globalId = await addApproval(request, `${marker}-global`, null);
  const boundId = await addApproval(request, `${marker}-bound`, session.id);
  const unrelatedId = await addApproval(request, `${marker}-unrelated`, other.id);

  // These are actual API rows created after mount; there are no route interceptors.
  for (const id of [globalId, boundId, unrelatedId]) {
    await expect(page.getByTestId(`approval-card-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('pending-approval-banner')).toContainText(`${marker}-bound`);
  await expect(page.getByTestId('pending-approval-banner')).not.toContainText(`${marker}-global`);
  await expect(page.getByTestId('pending-approval-banner')).not.toContainText(`${marker}-unrelated`);

  const focusedId = await addApproval(request, `${marker}-focus`, null);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId(`approval-card-${focusedId}`)).toBeVisible();
  await context.setOffline(true);
  await context.setOffline(false);
  const reconnectedId = await addApproval(request, `${marker}-reconnect`, null);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId(`approval-card-${reconnectedId}`)).toBeVisible();
  await expect(page.getByTestId(`approval-card-${unrelatedId}`)).toBeVisible();

  await page.reload();
  await page.getByTestId('notifications-button').click();
  for (const id of [globalId, boundId, unrelatedId, focusedId, reconnectedId]) {
    await expect(page.getByTestId(`approval-card-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('pending-approval-banner')).toContainText(`${marker}-bound`);
  expect(approvalsGets).toContain(200);
  expect(approvalPatches).toEqual([]);
});
