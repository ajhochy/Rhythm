import { expect, test, type Page } from '@playwright/test';
import { fulfillJson, matching, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';
import { localSessionId, openInterceptedLiveApp } from './post-m1-phase-5-live-fixtures';
import { createLiveApprovalGateway } from '../src/gateway/approvals';

const longValue = (index: number) => `https://approval.example.invalid/${'unbroken-token-'.repeat(18)}${index}?payload=${JSON.stringify({ index, body: 'x'.repeat(180) })}`;
const approval = (index: number) => ({
  id: `layout-${index}`, sessionId: null, agentConfigId: 'layout', action: `Approve externally supplied layout request ${index}`,
  preview: longValue(index), consequence: `Consequence ${longValue(index)}`, status: 'pending', actor: null, decidedAt: null,
  securityAction: 'external_send', payloadDigest: `digest-${index}`, taintId: null, taintedTurnId: null,
  boundAgent: 'layout', expiresAt: null, consumedAt: null, decisionNonce: `nonce-${index}`, createdAt: '2026-10-02T00:00:00.000Z',
});

async function openLongApprovalQueue(page: Page, viewport: { width: number; height: number }) {
  const seen: SeenRequest[] = []; const rows = Array.from({ length: 25 }, (_, index) => approval(index + 1));
  await page.setViewportSize(viewport);
  await page.addInitScript(() => { Object.assign(window, { rhythmShell: { gateway: { apiBase: 'http://127.0.0.1:4098', engineBase: 'http://127.0.0.1:4097', productionApiBase: 'https://api.vcrcapps.com' }, humanApproval: { capability: async () => 'layout-only-capability' } } }); });
  await openPhase7Live(page, '/agents', seen, async (route, request) => {
    if (new URL(request.url()).pathname === '/agent-approvals') return fulfillJson(route, 200, rows).then(() => true);
    return false;
  });
  await expect(page.getByRole('status', { name: 'Environment receipt' })).toContainText('Environment: Live');
  await expect.poll(() => matching(seen, 'GET', '/agent-approvals').length).toBeGreaterThan(0);
  await page.getByTestId('notifications-button').click();
  const menu = page.getByRole('menu', { name: 'Notifications' });
  await expect(menu).toBeVisible();
  await expect(page.getByTestId('approval-card-layout-1')).toBeVisible();
  return menu;
}

test('E1 approval queue contains long pending cards, wraps content, and keeps final controls reachable', async ({ page }) => {
  const menu = await openLongApprovalQueue(page, { width: 458, height: 800 });
  expect(await menu.evaluate((element) => ({ width: element.getBoundingClientRect().width, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, right: element.getBoundingClientRect().right }))).toMatchObject({ width: expect.any(Number), scrollHeight: expect.any(Number), clientHeight: expect.any(Number) });
  const geometry = await menu.evaluate((element) => ({ right: element.getBoundingClientRect().right, bottom: element.getBoundingClientRect().bottom, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
  expect(geometry.right).toBeLessThanOrEqual(458); expect(geometry.bottom).toBeLessThanOrEqual(800); expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  const finalCard = page.getByTestId('approval-card-layout-25');
  await finalCard.scrollIntoViewIfNeeded(); await expect(finalCard).toBeVisible();
  await expect(finalCard.getByRole('menuitem', { name: 'Approve', exact: true })).toBeVisible();
  await expect(finalCard.getByRole('menuitem', { name: 'Reject', exact: true })).toBeVisible();
  expect(await finalCard.locator('p').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  for (const control of await finalCard.getByRole('menuitem').all()) {
    expect(await control.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
    })).toBe(true);
  }
});

for (const viewport of [{ width: 390, height: 450 }, { width: 1440, height: 900 }]) {
  test(`E1 notification popover stays within both viewport edges at ${viewport.width}px`, async ({ page }) => {
    const menu = await openLongApprovalQueue(page, viewport);
    const geometry = await menu.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(viewport.width);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(viewport.height);
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  });
}

const e1Row = (id: string, sessionId: string | null) => ({
  id, sessionId, action: `Synthetic ${id}`, preview: null, consequence: null,
  status: 'pending' as const, createdAt: '2026-10-01T12:00:00Z', decisionNonce: `nonce-${id}`, payloadDigest: null,
});

test.beforeEach(async ({ page }) => {
  await page.route('https://api.vcrcapps.com/**', (route) => fulfillJson(route, 200, []));
});

test('E1 shared queue publishes a post-mount owned approval into the transcript banner', async ({ page }) => {
  let rows: ReturnType<typeof e1Row>[] = [];
  await openInterceptedLiveApp(page, '/#/agents', { handleApi: async (route, request) => {
    if (request.pathname !== '/agent-approvals') return false;
    await fulfillJson(route, 200, rows); return true;
  } });
  await page.getByTestId('notifications-button').click();
  rows = [e1Row('global', null), e1Row('bound', localSessionId), e1Row('foreign', 'other-session')];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('approval-card-global')).toBeVisible();
  await expect(page.getByTestId('approval-card-bound')).toBeVisible();
  await expect(page.getByTestId('approval-card-foreign')).toBeVisible();
  const banner = page.getByTestId('pending-approval-banner');
  await expect(banner).toContainText('Synthetic bound');
  await expect(banner).not.toContainText('Synthetic global');
  await expect(banner).not.toContainText('Synthetic foreign');
});

for (const [label, body] of [['non-array', { ok: true }], ['schema', [{ id: 'broken' }]]] as const) {
  test(`E1 ${label} pending response retains the previous queue and exposes retry`, async ({ page }) => {
    let malformed = false;
    await openInterceptedLiveApp(page, '/#/agents', { handleApi: async (route, request) => {
      if (request.pathname !== '/agent-approvals') return false;
      await fulfillJson(route, 200, malformed ? body : [e1Row('retained', localSessionId)]); return true;
    } });
    await page.getByTestId('notifications-button').click();
    await expect(page.getByTestId('approval-card-retained')).toBeVisible();
    malformed = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('approval-queue-error')).toContainText(/Invalid approval response.*Retry/i);
    await expect(page.getByTestId('approval-card-retained')).toBeVisible();
    await expect(page.getByTestId('pending-approval-banner')).toContainText('Synthetic retained');
  });
}

test('E1 initial forbidden approval read gives recovery guidance instead of an empty queue', async ({ page }) => {
  await openInterceptedLiveApp(page, '/#/agents', { handleApi: async (route, request) => {
    if (request.pathname !== '/agent-approvals') return false;
    await fulfillJson(route, 403, {}); return true;
  } });
  const bell = page.getByTestId('notifications-button');
  await expect(bell).toHaveAccessibleName(/approval.*unavailable/i);
  await bell.click();
  await expect(page.getByTestId('approval-queue-error')).toContainText(/signed.*desktop.*correct account/i);
  await expect(page.getByText('No notifications', { exact: true })).toHaveCount(0);
});

for (const body of [{ ok: true }, [{ id: 'broken' }]]) {
  test(`E1 gateway rejects malformed pending response ${JSON.stringify(body)}`, async () => {
    const gateway = createLiveApprovalGateway('https://synthetic.invalid', 'synthetic', async () => new Response(JSON.stringify(body)), async () => 'synthetic-capability');
    await expect(gateway.listPending()).rejects.toMatchObject({ status: 502, message: expect.stringContaining('Invalid approval response') });
  });
}
