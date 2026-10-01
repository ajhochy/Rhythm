import { expect, test } from '@playwright/test';
import { fulfillJson, localSessionId, openInterceptedLiveApp } from './post-m1-phase-5-live-fixtures';
import { createLiveApprovalGateway } from '../src/gateway/approvals';

const row = (id: string, sessionId: string | null) => ({
  id, sessionId, action: `Synthetic ${id}`, preview: null, consequence: null,
  status: 'pending' as const, createdAt: '2026-10-01T12:00:00Z', decisionNonce: `nonce-${id}`, payloadDigest: null,
});

// Real app/provider/gateway; only HTTP/WebSocket boundaries are fixtures. Every local/hosted
// request is intercepted before navigation; never contact C1's actual ports or sign a decision.
test.beforeEach(async ({ page }) => {
  await page.route('https://api.vcrcapps.com/**', route => fulfillJson(route, 200, []));
});

test('c1/c6: post-mount global and bound cards converge on focus, reconnect, resume and reopen', async ({ page }) => {
  // Regression: one-shot hydration never publishes post-mount rows to the bell or transcript.
  let rows: ReturnType<typeof row>[] = [];
  await openInterceptedLiveApp(page, '/#/agents', { handleApi: async (route, request) => {
    if (request.pathname !== '/agent-approvals') return false;
    await fulfillJson(route, 200, rows); return true;
  } });
  await page.getByTestId('notifications-button').click();
  rows = [row('global', null), row('bound', localSessionId), row('foreign', 'other-session')];
  expect(rows.map(r => r.sessionId)).toEqual([null, localSessionId, 'other-session']);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('approval-card-global')).toBeVisible();
  await expect(page.getByTestId('approval-card-bound')).toBeVisible();
  await expect(page.getByTestId('approval-card-foreign')).toBeVisible();
  const banner = page.getByTestId('pending-approval-banner');
  await expect(banner).toContainText('Synthetic bound');
  await expect(banner).not.toContainText('Synthetic global');
  await expect(banner).not.toContainText('Synthetic foreign');
  for (const event of ['online', 'pageshow']) {
    rows = [...rows, row(event, null)];
    await page.evaluate(event => window.dispatchEvent(new Event(event)), event);
    await expect(page.getByTestId(`approval-card-${event}`)).toBeVisible();
  }
  rows = [...rows, row('visible', null)];
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByTestId('approval-card-visible')).toBeVisible();
  await page.reload();
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('approval-card-global')).toBeVisible();
  await expect(banner).toContainText('Synthetic bound');
});

test('c1: new cards appear while mounted without a focus event', async ({ page }) => {
  // Regression: no subscription/poll leaves a newly created global request invisible indefinitely.
  let rows: ReturnType<typeof row>[] = [];
  await openInterceptedLiveApp(page, '/#/agents', { handleApi: async (route, request) => {
    if (request.pathname !== '/agent-approvals') return false;
    await fulfillJson(route, 200, rows); return true;
  } });
  await page.getByTestId('notifications-button').click();
  rows = [row('new', null)];
  await expect(page.getByTestId('approval-card-new')).toBeVisible({ timeout: 12_000 });
});

test('c1: a healthy GET slower than the poll interval still publishes pending cards', async ({ page }) => {
  await openInterceptedLiveApp(page, '/#/agents', { handleApi: async (route, request) => {
    if (request.pathname !== '/agent-approvals') return false;
    await new Promise(resolve => setTimeout(resolve, 6_200));
    await fulfillJson(route, 200, [row('slow-healthy', null)]);
    return true;
  } });
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('approval-card-slow-healthy')).toBeVisible({ timeout: 12_000 });
});

for (const failure of ['403', '503', 'network', 'nonarray', 'schema'] as const) {
  test(`c2: ${failure} preserves last pending rows, announces failure and supports retry`, async ({ page }) => {
    // Regression: malformed success or a failed refresh silently turns pending into empty-success.
    let failed = false;
    await openInterceptedLiveApp(page, '/#/agents', { handleApi: async (route, request) => {
      if (request.pathname !== '/agent-approvals') return false;
      if (!failed) await fulfillJson(route, 200, [row('retained', localSessionId)]);
      else if (failure === 'network') await route.abort('failed');
      else await fulfillJson(route, Number(failure) || 200, failure === 'nonarray' ? { ok: true } : failure === 'schema' ? [{ id: 'broken' }] : {});
      return true;
    } });
    await page.getByTestId('notifications-button').click();
    await expect(page.getByTestId('approval-card-retained')).toBeVisible();
    failed = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('approval-queue-error')).toBeVisible();
    await expect(page.getByTestId('approval-queue-error')).toContainText(/Retry|retry/);
    await expect(page.getByTestId('approval-card-retained')).toBeVisible();
    await expect(page.getByTestId('pending-approval-banner')).toContainText('Synthetic retained');
    await expect(page.getByText('No notifications', { exact: true })).toHaveCount(0);
    failed = false;
    await page.getByRole('menuitem', { name: 'Refresh approvals', exact: true }).click();
    await expect(page.getByTestId('approval-queue-error')).toHaveCount(0);
    await expect(page.getByTestId('approval-queue-status')).toContainText('1 pending');
  });
}

test('c2/c3: initial auth failure is not an empty queue; keyboard reaches refresh and returns focus', async ({ page }) => {
  // Regression: bell reports No notifications and offers no persistent failure/retry or count.
  await openInterceptedLiveApp(page, '/#/agents', { handleApi: async (route, request) => {
    if (request.pathname !== '/agent-approvals') return false;
    await fulfillJson(route, 403, {}); return true;
  } });
  const bell = page.getByTestId('notifications-button');
  await expect(bell).toHaveAccessibleName(/approval.*unavailable/i);
  await bell.focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('approval-queue-error')).toContainText(/signed.*desktop|native/i);
  await expect(page.getByText('No notifications', { exact: true })).toHaveCount(0);
  const retry = page.getByRole('menuitem', { name: 'Refresh approvals', exact: true });
  await page.keyboard.press('Home'); await expect(retry).toBeFocused();
  await page.keyboard.press('Escape'); await expect(bell).toBeFocused();
});

test('c2: native capability failure remains actionable without any HTTP request or decision', async ({ page }) => {
  // Native bridge is an external boundary: rejection is supplied, not a signer/auth bypass.
  await page.addInitScript(() => {
    Object.assign(window, { rhythmShell: { humanApproval: { capability: async () => { throw new Error('Native approval unavailable'); } } } });
  });
  const fixture = await openInterceptedLiveApp(page);
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('approval-queue-error')).toContainText(/signed.*desktop|native/i);
  expect(fixture.requests.filter(r => r.pathname === '/agent-approvals')).toEqual([]);
  expect(fixture.requests.filter(r => r.method === 'PATCH')).toEqual([]);
});

for (const body of [{ ok: true }, [{ id: 'broken' }]]) {
  test(`c2: gateway rejects malformed pending shape ${JSON.stringify(body)}`, async () => {
    // Gateway validation is exercised directly, never replaced with a mock implementation.
    const gateway = createLiveApprovalGateway('http://fixture.invalid', 'synthetic', async () => new Response(JSON.stringify(body)), async () => 'synthetic-capability');
    await expect(gateway.listPending()).rejects.toThrow(/invalid.*approval|approval.*invalid/i);
  });
}

test('c2: legacy null-nonce rows stay discoverable without permitting a decision', async ({ page }) => {
  // Production repository permits pre-signature rows: one must not hide every valid pending row.
  await openInterceptedLiveApp(page, '/#/agents', { handleApi: async (route, request) => {
    if (request.pathname !== '/agent-approvals') return false;
    await fulfillJson(route, 200, [{ ...row('legacy', null), decisionNonce: null }, row('valid', null)]); return true;
  } });
  await page.getByTestId('notifications-button').click();
  const legacy = page.getByTestId('approval-card-legacy');
  await expect(legacy).toBeVisible();
  await expect(page.getByTestId('approval-card-valid')).toBeVisible();
  await expect(legacy).toContainText(/request.*again/i);
  await expect(legacy.getByRole('menuitem', { name: 'Approve', exact: true })).toBeDisabled();
});

test('c3: closed bell announces metadata-only pending count', async ({ page }) => {
  // Regression: a count is not announced if its live region only mounts after opening the bell.
  await openInterceptedLiveApp(page, '/#/agents', { handleApi: async (route, request) => {
    if (request.pathname !== '/agent-approvals') return false;
    await fulfillJson(route, 200, [row('private-action', null)]); return true;
  } });
  const announcement = page.getByTestId('approval-queue-announcement');
  await expect(announcement).toHaveAttribute('aria-live', 'polite');
  await expect(announcement).toContainText('1 pending');
  await expect(announcement).not.toContainText('private-action');
});

test('c2: late older refresh cannot erase newer pending cards', async ({ page }) => {
  // Regression: earlier empty snapshot arrives last and overwrites a newer valid read.
  let reads = 0;
  let release: (() => void) | undefined;
  await openInterceptedLiveApp(page, '/#/agents', { handleApi: async (route, request) => {
    if (request.pathname !== '/agent-approvals') return false;
    if (++reads === 3) { await new Promise<void>(resolve => { release = resolve; }); await fulfillJson(route, 200, []); }
    else await fulfillJson(route, 200, [row('newest', null)]);
    return true;
  } });
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('approval-card-newest')).toBeVisible();
  // StrictMode has two initial requests; hold the first post-mount refresh, then issue a new one.
  await page.getByRole('menuitem', { name: 'Refresh approvals', exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole('menuitem', { name: 'Refresh approvals', exact: true }).click();
  await expect(page.getByTestId('approval-queue-status')).toContainText('Refreshing');
  release!();
  await expect.poll(() => reads).toBeGreaterThan(3);
  await expect(page.getByTestId('approval-card-newest')).toBeVisible();
});

test('c4 negative: repeated gestures while native signing is pending cannot duplicate IPC or mutate', async ({ page }) => {
  // External native bridge deliberately rejects; no signature/capability enrollment is manufactured.
  await page.addInitScript(() => {
    let attempts = 0;
    Object.assign(window, { rhythmShell: { humanApproval: {
      capability: async () => 'synthetic-read-only',
      signDecision: async () => { attempts++; await new Promise(resolve => setTimeout(resolve, 500)); throw new Error('Fixture native refusal'); },
    } }, e1SigningAttempts: () => attempts });
  });
  const fixture = await openInterceptedLiveApp(page, '/#/agents', { handleApi: async (route, request) => {
    if (request.pathname !== '/agent-approvals') return false;
    await fulfillJson(route, 200, [row('no-mutation', localSessionId)]); return true;
  } });
  await page.getByTestId('notifications-button').click();
  const card = page.getByTestId('approval-card-no-mutation');
  await card.getByRole('menuitem', { name: 'Approve', exact: true }).click();
  await expect(card.getByRole('menuitem', { name: 'Reject', exact: true })).toBeDisabled();
  await expect(page.getByTestId('approval-queue-error')).toContainText('Native decision could not be sent');
  expect(await page.evaluate(() => (window as unknown as { e1SigningAttempts(): number }).e1SigningAttempts())).toBe(1);
  expect(fixture.requests.filter(r => r.method === 'PATCH')).toEqual([]);
  await expect(card).toBeVisible();
});

test('c2/c4: failed native decision stays actionable after a healthy pending refresh', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { rhythmShell: { humanApproval: {
      capability: async () => 'synthetic-read-only',
      signDecision: async () => { throw new Error('Fixture native refusal'); },
    } } });
  });
  let reads = 0;
  const fixture = await openInterceptedLiveApp(page, '/#/agents', { handleApi: async (route, request) => {
    if (request.pathname !== '/agent-approvals') return false;
    reads++;
    await fulfillJson(route, 200, [row('failed-decision', null)]);
    return true;
  } });
  await page.getByTestId('notifications-button').click();
  await page.getByTestId('approval-card-failed-decision').getByRole('menuitem', { name: 'Approve' }).click();
  await expect(page.getByTestId('approval-queue-error')).toContainText('Native decision could not be sent');
  const before = reads;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(page.getByTestId('approval-queue-error')).toContainText('Native decision could not be sent');
  await expect(page.getByTestId('approval-card-failed-decision')).toBeVisible();
  expect(fixture.requests.filter(r => r.method === 'PATCH')).toEqual([]);
});
