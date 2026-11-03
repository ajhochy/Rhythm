import type { Page, Response, Route } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { OwnedWebApprovals, type OwnedApproval, type WebApprovalCard } from './owned-web-approval-fixture';

// Authoring contract, not a historical pass receipt. Execute only after root's coordinated build:
// RHYTHM_LIVE_E2E=1 RHYTHM_SANDBOX_DIR=/private/tmp/<fresh-name> bash apps/web/tests/web-host/run-sandbox.sh \
//   apps/web/node_modules/.bin/playwright test --config apps/web/tests/web-host/playwright.config.ts web-host-approvals.spec.ts
// Standard cloud-absent synthetic fixture runs all six checks; no paid-provider evidence is claimed.
test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires explicit live flag and a validated disposable synthetic sandbox');

function responseFor(page: Page, method: string, pathname = '/web/approvals') {
  return page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === pathname);
}

async function assertTokenless(response: Response, fixture: OwnedWebApprovals, status: number) {
  expect(new URL(response.url()).origin).toBe(fixture.origin);
  expect(response.status()).toBe(status);
  const headers = await response.request().allHeaders();
  expect(headers.authorization).toBeUndefined();
  expect(headers['x-rhythm-human-approval']).toBeUndefined();
}

async function showPending(page: Page, fixture: OwnedWebApprovals, owned: OwnedApproval): Promise<WebApprovalCard[]> {
  expect((await fixture.bootstrap()).capabilities.approvals).toBe(true);
  const initial = responseFor(page, 'GET');
  await page.goto('/#/agents');
  await assertTokenless(await initial, fixture, 200);
  await page.getByTestId('notifications-button').click();
  const pending = responseFor(page, 'GET');
  await page.getByRole('menuitem', { name: 'Refresh approvals', exact: true }).click();
  const response = await pending;
  await assertTokenless(response, fixture, 200);
  expect(new URL(response.url()).searchParams.get('status')).toBe('pending');
  const rows = await response.json() as WebApprovalCard[];
  expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ id: owned.id, action: owned.action, sessionId: owned.sessionId, status: 'pending' })]));
  for (const row of rows) {
    expect(row.decisionMode).toBe('trusted-tailnet-web');
    expect(row.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(row.cardHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row).not.toHaveProperty('decisionNonce');
    expect(row).not.toHaveProperty('signature');
  }
  await expect(page.getByTestId(`approval-card-${owned.id}`)).toBeVisible();
  return rows;
}

async function decide(page: Page, fixture: OwnedWebApprovals, card: WebApprovalCard, status: 'approved' | 'rejected', expectedStatus = 200) {
  const pending = responseFor(page, 'PATCH', `/web/approvals/${card.id}`);
  await page.getByTestId(`approval-card-${card.id}`).getByRole('menuitem', { name: status === 'approved' ? 'Approve' : 'Reject', exact: true }).click();
  const response = await pending;
  await assertTokenless(response, fixture, expectedStatus);
  expect(response.request().postDataJSON()).toEqual({ status, revision: card.revision, cardHash: card.cardHash });
  const body = await response.json();
  if (expectedStatus === 200) {
    expect(body).toMatchObject({ id: card.id, status, audit: {
      kind: 'trusted-tailnet-web-decision-v1', source: 'trusted-tailnet-web', assurance: 'trusted-tailnet',
      ownerUserId: 1, ownerName: 'Synthetic Admin', displayIdentity: 'Synthetic Admin via browser',
      attestation: 'owner_chose_in_browser', decision: status, revision: card.revision, cardHash: card.cardHash,
    } });
    expect(Number.isFinite(Date.parse(body.decidedAt))).toBe(true);
  }
  return body;
}

test('#72: browser pending snapshot matches real visible cards and database rows', async ({ page }) => {
  const fixture = new OwnedWebApprovals();
  try {
    const owned = fixture.createInert();
    const rows = await showPending(page, fixture, owned);
    expect(rows.length).toBeGreaterThan(0);
    await expect(page.getByTestId('approval-queue-status')).toContainText(`${rows.length} pending`);
    for (const row of rows) {
      if (row.expiresAt) expect(Date.parse(row.expiresAt)).toBeGreaterThan(Date.now());
      await expect(page.getByTestId(`approval-card-${row.id}`)).toContainText(row.action);
    }
    expect((await fixture.pending()).map(row => row.id).sort()).toEqual(rows.map(row => row.id).sort());
    expect(fixture.approval(owned)).toMatchObject({ status: 'pending', session_id: owned.sessionId, decision_nonce: owned.nonce, consumed_at: null });
  } finally { await fixture.cleanup(); }
});

test('#73: failed browser refresh retains known cards and recovers from the real API', async ({ page }) => {
  const fixture = new OwnedWebApprovals();
  // Only the deliberate network-error leg is substituted. Successful reads and cards are real.
  const fail = (route: Route) => route.fulfill({ status: 503, json: { error: { message: '[smoke] approval service unavailable' } } });
  const pattern = '**/web/approvals?status=pending';
  try {
    const owned = fixture.createInert();
    const rows = await showPending(page, fixture, owned);
    await page.route(pattern, fail);
    const failed = responseFor(page, 'GET');
    await page.getByRole('menuitem', { name: 'Refresh approvals', exact: true }).click();
    await assertTokenless(await failed, fixture, 503);
    await expect(page.getByTestId('approval-queue-error')).toContainText(/unavailable/i);
    for (const row of rows) await expect(page.getByTestId(`approval-card-${row.id}`)).toContainText(row.action);
    expect(await fixture.pending()).toEqual(rows);
    await page.unroute(pattern, fail);
    const recovered = responseFor(page, 'GET');
    await page.getByRole('menuitem', { name: 'Refresh approvals', exact: true }).click();
    await assertTokenless(await recovered, fixture, 200);
    await expect(page.getByTestId('approval-queue-error')).toHaveCount(0);
    await expect(page.getByTestId('approval-queue-status')).toContainText(`${rows.length} pending`);
  } finally {
    try { await page.unroute(pattern, fail); } finally { await fixture.cleanup(); }
  }
});

test('#74: browser Reject clears an owned inert card without engine execution', async ({ page }) => {
  const fixture = new OwnedWebApprovals();
  try {
    const owned = fixture.createInert();
    const card = (await showPending(page, fixture, owned)).find(row => row.id === owned.id)!;
    const hits = await fixture.providerHits();
    const result = await decide(page, fixture, card, 'rejected');
    await expect(page.getByTestId(`approval-card-${owned.id}`)).toBeHidden();
    expect((await fixture.pending()).some(row => row.id === owned.id)).toBe(false);
    // Browser ownership requires a session. Unlike the historical sessionless native fixture,
    // this closed SDK-less session durably queues a continuation but cannot execute one.
    const persisted = fixture.approval(owned);
    expect(persisted).toMatchObject({ status: 'rejected', decision_nonce: null, consumed_at: null, continuation_state: 'queued' });
    expect(JSON.parse(persisted.actor)).toEqual(result.audit);
    expect(fixture.rows('SELECT status,sdk_session_id FROM agent_sessions WHERE id=?', owned.sessionId)).toEqual([{ status: 'closed', sdk_session_id: null }]);
    expect(fixture.rows('SELECT id FROM agent_session_messages WHERE session_id=?', owned.sessionId)).toEqual([]);
    expect(await fixture.providerHits()).toBe(hits);
  } finally { await fixture.cleanup(); }
});

test('#75: stale browser Approve returns 403 and leaves the exact owned decision unconsumed', async ({ page }) => {
  const fixture = new OwnedWebApprovals();
  try {
    const owned = fixture.createInert();
    const card = (await showPending(page, fixture, owned)).find(row => row.id === owned.id)!;
    fixture.expire(owned);
    const before = fixture.approval(owned);
    const hits = await fixture.providerHits();
    await decide(page, fixture, card, 'approved', 403);
    await expect(page.getByTestId('approval-queue-error')).toContainText(/expired/i);
    await expect(page.getByTestId('approval-queue-error')).toContainText(/ask.*(new proposal|request approval again)/i);
    expect((await fixture.pending()).some(row => row.id === owned.id)).toBe(false);
    expect(fixture.approval(owned)).toEqual(before);
    expect(before).toMatchObject({ status: 'pending', decision_nonce: owned.nonce, consumed_at: null, continuation_state: null });
    expect(Date.parse(before.expires_at)).toBeLessThan(Date.now());
    expect(await fixture.providerHits()).toBe(hits);
  } finally { await fixture.cleanup(); }
});

test('2c continuation: browser Approve wakes the exact real sandbox SDK session once', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = new OwnedWebApprovals();
  try {
    const session = await fixture.createLiveSession();
    // Creation persists `starting`; establish real provider completion and idle before approval.
    await page.goto('/#/agents');
    await page.getByTestId(`session-${session.id}`).click();
    await expect(page.getByTestId('composer-input')).toBeEnabled();
    await page.getByTestId('composer-input').fill('S0:plain synthetic approval continuation setup');
    await page.getByTestId('composer-send').click();
    await expect(page.getByTestId('transcript')).toContainText('hello hello 🌱', { timeout: 40_000 });
    await expect.poll(async () => (await fixture.call(`/agent-sessions/${session.id}`)).body.session.status).toBe('idle');
    const beforeMessages = await fixture.engineMessages(session.id);
    expect(beforeMessages.filter(message => message.info.role === 'assistant' && message.info.time?.completed)).toHaveLength(1);
    const owned = fixture.createApproval(session.id);
    const card = (await showPending(page, fixture, owned)).find(row => row.id === owned.id)!;
    const hits = await fixture.providerHits();
    const result = await decide(page, fixture, card, 'approved');
    await expect.poll(() => fixture.approval(owned).continuation_state, { timeout: 40_000 }).toBe('delivered');
    const marker = `<!-- rhythm-approval-continuation:${owned.id} -->`;
    await expect.poll(async () => (await fixture.engineMessages(session.id)).filter(message => message.info.role === 'assistant'
      && message.info.time?.completed && message.parts.some(part => part.type === 'text' && part.text?.includes('hello hello 🌱'))).length,
    { timeout: 40_000 }).toBe(2);
    const messages = await fixture.engineMessages(session.id);
    expect(messages.filter(message => message.info.role === 'user' && message.parts.some(part => part.type === 'text' && part.text?.includes(marker)))).toHaveLength(1);
    expect(messages.every(message => message.info.sessionID === session.sdkSessionId)).toBe(true);
    expect(messages.flatMap(message => message.parts).filter(part => part.type === 'tool')).toEqual([]);
    expect(await fixture.providerHits()).toBe(hits + 1);
    expect(JSON.parse(fixture.approval(owned).actor)).toEqual(result.audit);
    await expect.poll(async () => (await fixture.call(`/agent-sessions/${session.id}`)).body.session.status).toBe('idle');
    await page.keyboard.press('Escape');
    await page.getByTestId(`session-${session.id}`).click();
    await expect.poll(async () => (await page.getByTestId('transcript').innerText()).split('hello hello 🌱').length - 1).toBe(2);
    await page.reload();
    await page.getByTestId(`session-${session.id}`).click();
    await expect.poll(async () => (await page.getByTestId('transcript').innerText()).split('hello hello 🌱').length - 1).toBe(2);
    expect((await fixture.engineMessages(session.id)).filter(message => message.info.role === 'user'
      && message.parts.some(part => part.type === 'text' && part.text?.includes(marker)))).toHaveLength(1);
  } finally { await fixture.cleanup(); }
});

test('2c cloud-absent guard: local approvals work while notification actions remain unavailable', async ({ page }) => {
  test.skip(process.env.RHYTHM_WEB_CLOUD_TEST === '1', 'Run the standard cloud-absent sandbox for this independent capability guard');
  const fixture = new OwnedWebApprovals();
  const cloudRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/cloud/')) cloudRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  try {
    expect((await fixture.bootstrap()).capabilities).toMatchObject({ cloud: false, approvals: true });
    const owned = fixture.createInert();
    await showPending(page, fixture, owned);
    await expect(page.getByTestId(`approval-card-${owned.id}`).getByRole('menuitem', { name: 'Approve', exact: true })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: 'Refresh approvals', exact: true })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: 'Mark all read', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('approval-queue-error')).toHaveCount(0);
    expect(cloudRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await fixture.cleanup(); }
});
