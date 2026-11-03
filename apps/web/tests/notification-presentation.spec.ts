import { expect, test, type Page } from '@playwright/test';
import { fulfillJson, canonicalProfile, canonicalSession, type BoundaryRequest } from './post-m1-phase-5-live-fixtures';
import type { PendingApproval } from '../src/gateway/approvals';

const taskPayload = {
  due_date: '2026-10-07',
  notes: 'Review the Sunday checklist and assign the remaining preparation tasks. '.repeat(7),
  title: 'Prepare Sunday checklist',
  extra_context: { source: 'Synthetic preview fixture', token: 'unbroken-token-'.repeat(35) },
};
const taskPreview = `task.create: ${JSON.stringify(taskPayload)}`;
const consequence = 'Adds one open task due October 7. No one is scheduled or notified.';
const approval = (id: string, preview = taskPreview, action = 'Authorize task.create'): PendingApproval => ({
  id, sessionId: null, action, preview, consequence,
  status: 'pending', createdAt: '2026-10-05T12:00:00Z', decisionNonce: `nonce-${id}`, payloadDigest: `digest-${id}`,
});

async function openQueue(page: Page, rows: PendingApproval[] = [approval('task-1'), approval('task-2')], native?: 'hermes' | 'colony') {
  await page.addInitScript((native) => {
    Object.assign(window, { rhythmShell: {
      gateway: { apiBase: 'http://127.0.0.1:4001', engineBase: 'http://127.0.0.1:4096', productionApiBase: 'https://api.vcrcapps.com' },
      humanApproval: {
        capability: async () => 'synthetic-presentation-capability',
        signDecision: async (approvalId: string, status: string, decisionNonce: string, payloadDigest: string | null) => {
          (window as unknown as { signedPresentationDecisions: unknown[] }).signedPresentationDecisions.push({ approvalId, status, decisionNonce, payloadDigest });
          return { capability: 'synthetic-presentation-capability', signature: 'synthetic-signed-decision' };
        },
      },
    }, signedPresentationDecisions: [] });
    if (native) {
      const calls: { action: string; payload?: unknown }[] = [];
      Object.assign(window, { notificationNativeCalls: calls });
      const bridge = {
        attach: async () => { calls.push({ action: 'attach' }); return { ok: true, attachment: 'stable-fixture-child' }; },
        setBounds: async (bounds: unknown) => { calls.push({ action: 'bounds', payload: bounds }); return true; },
        detach: async () => { calls.push({ action: 'detach' }); return true; },
        sendIntent: (intent: unknown) => { calls.push({ action: 'intent', payload: intent }); return Promise.resolve({ ok: true }); },
        getStatus: async () => ({ v: 1, available: true, enabled: true, sources: [] }),
        onEvent: () => () => {},
      };
      Object.assign((window as unknown as { rhythmShell: object }).rhythmShell,
        native === 'hermes' ? { hermes: { enabled: true }, hermesView: bridge } : { colonyView: bridge });
    }
  }, native);
  await page.route('https://api.vcrcapps.com/**', route => fulfillJson(route, 200, []));
  const decisions: BoundaryRequest[] = [];
  // Use the production CSP's allowed loopback origins, intercepting every request before navigation.
  await page.routeWebSocket('ws://127.0.0.1:4001/ws/agents', socket => socket.onMessage(() => {}));
  await page.route('http://127.0.0.1:4096/**', route => fulfillJson(route, 200, { healthy: true }));
  await page.route('http://127.0.0.1:4001/**', async route => {
    const raw = route.request();
    if (raw.method() === 'OPTIONS') return fulfillJson(route, 204, undefined);
    const url = new URL(raw.url());
    const request: BoundaryRequest = { method: raw.method(), pathname: url.pathname, search: url.search, body: raw.postData() ? raw.postDataJSON() : undefined, headers: raw.headers() };
    if (request.pathname === '/agent-approvals') return fulfillJson(route, 200, rows);
    if (request.pathname.startsWith('/agent-approvals/') && request.method === 'PATCH') {
      decisions.push(request); return fulfillJson(route, 503, {});
    }
    if (request.pathname === '/health') return fulfillJson(route, 200, { healthy: true });
    if (request.pathname === '/agent-configs') return fulfillJson(route, 200, [canonicalProfile]);
    if (request.pathname === '/agent-sessions') return fulfillJson(route, 200, { sessions: [canonicalSession] });
    if (request.pathname === `/agent-sessions/${canonicalSession.id}`) return fulfillJson(route, 200, { session: canonicalSession, messages: [] });
    return fulfillJson(route, 404, { error: { code: 'NOT_FOUND' } });
  });
  await page.goto(`/#/${native ?? 'agents'}`);
  await expect(page.getByRole('status', { name: 'Environment receipt' })).toContainText('Environment: Live', { timeout: 10_000 });
  await page.getByTestId('notifications-button').click();
  const menu = page.getByRole('menu', { name: 'Notifications' });
  await expect(menu).toBeVisible();
  const card = page.getByTestId(`approval-card-${rows[0].id}`);
  await expect(card).toBeVisible();
  return { menu, card, decisions };
}

test('notification-c1: task cards show readable titles and compact summaries', async ({ page }) => {
  const { card } = await openQueue(page);
  await expect(card.locator('strong')).toContainText(taskPayload.title);
  await expect(card).toContainText('2026-10-07');
  await expect(card).toContainText(consequence);
  await expect(card.getByRole('menuitem', { name: 'Show details', exact: true })).toBeVisible();
  await expect(card.locator('pre')).toHaveCount(0);
  expect(await card.innerText()).not.toContain('"due_date"');
  expect((await card.boundingBox())!.height).toBeLessThan(300);
});

test('notification-c2: details preserve the exact complete original payload without executing it', async ({ page }) => {
  const { card, menu, decisions } = await openQueue(page);
  const toggle = card.getByRole('menuitem', { name: 'Show details', exact: true });
  const controlledId = await toggle.getAttribute('aria-controls');
  expect(controlledId).toBeTruthy();
  await expect(page.locator(`[id="${controlledId}"]`)).toHaveCount(1);
  await expect(page.locator(`[id="${controlledId}"]`)).not.toBeVisible();
  await toggle.click();
  await expect(menu).toBeVisible();
  await expect(card.locator('pre')).toHaveText(taskPreview);
  expect(await card.locator('pre').textContent()).toBe(taskPreview);
  await expect(card).toContainText(consequence);
  expect(decisions).toEqual([]);
  await card.getByRole('menuitem', { name: 'Hide details', exact: true }).click();
  await expect(card.locator('pre')).toHaveCount(0);
  expect(decisions).toEqual([]);
});

test('notification-c3: small approval controls sit inline beside the title', async ({ page }) => {
  const { card } = await openQueue(page);
  const title = (await card.locator('strong').boundingBox())!;
  const yes = (await card.getByRole('menuitem', { name: 'Approve', exact: true }).boundingBox())!;
  const no = (await card.getByRole('menuitem', { name: 'Reject', exact: true }).boundingBox())!;
  expect(Math.abs(yes.y - no.y)).toBeLessThanOrEqual(1);
  expect(no.x).toBeGreaterThan(yes.x + yes.width);
  expect(yes.x).toBeGreaterThanOrEqual(title.x + title.width);
  expect(Math.abs(yes.y + yes.height / 2 - title.y - title.height / 2)).toBeLessThanOrEqual(1);
  for (const name of ['Approve', 'Reject']) {
    const control = card.getByRole('menuitem', { name, exact: true });
    const bounds = (await control.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(24);
    expect(bounds.height).toBeGreaterThanOrEqual(24);
    expect(bounds.width).toBeLessThanOrEqual(32);
    expect(bounds.height).toBeLessThanOrEqual(32);
    await expect(control).toHaveAttribute('title', new RegExp(name));
  }
  expect((await card.boundingBox())!.height).toBeLessThan(210);
});

test('notification-c11: compact title controls wrap safely at a very narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 568 });
  const { card, menu } = await openQueue(page);
  const title = (await card.locator('strong').boundingBox())!;
  const yes = (await card.getByRole('menuitem', { name: 'Approve', exact: true }).boundingBox())!;
  const no = (await card.getByRole('menuitem', { name: 'Reject', exact: true }).boundingBox())!;
  expect(yes.y).toBeGreaterThanOrEqual(title.y + title.height);
  expect(Math.abs(yes.y - no.y)).toBeLessThanOrEqual(1);
  expect(no.x + no.width).toBeLessThanOrEqual(240);
  expect(await menu.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  for (const name of ['Approve', 'Reject']) {
    const control = card.getByRole('menuitem', { name, exact: true });
    await expect(control).toBeVisible();
    expect(await control.evaluate(e => { const b = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); })).toBe(true);
  }
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 450 }, { width: 1024, height: 768 }, { width: 1392, height: 912 }]) {
  test(`notification-c4-${viewport.width}: wrapping, scrolling, and controls fit the viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const rows = Array.from({ length: 29 }, (_, index) => approval(`task-${index + 1}`));
    const { menu, card } = await openQueue(page, rows);
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(await menu.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    if (process.env.RHYTHM_CAPTURE_EVIDENCE === '1' && (viewport.width === 1392 || viewport.width === 390)) {
      await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
      await page.screenshot({ path: testInfo.outputPath(`notification-preview-${viewport.width}.png`) });
      await menu.screenshot({ path: testInfo.outputPath(`notification-menu-preview-${viewport.width}.png`) });
    }
    await card.getByRole('menuitem', { name: 'Show details', exact: true }).click();
    expect(await card.locator('pre').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    const final = page.getByTestId('approval-card-task-29');
    await final.scrollIntoViewIfNeeded();
    for (const name of ['Approve', 'Reject']) {
      const control = final.getByRole('menuitem', { name, exact: true });
      await expect(control).toBeVisible();
      expect(await control.evaluate(e => { const b = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); })).toBe(true);
    }
  });
}

for (const [label, preview, action] of [
  ['malformed', 'task.create: {"title": "Incomplete"', 'Authorize task.create'],
  ['unknown', 'email.send: {"body":"<script>untrusted text</script>","recipient":"synthetic@example.invalid"}', 'Authorize email.send'],
  ['plain', 'Review this synthetic change before sending.', 'Send a prepared update'],
  ['mismatched-action', taskPreview, 'Authorize task.delete'],
] as const) {
  test(`notification-c5-${label}: unknown or plain previews retain exact accessible details`, async ({ page }) => {
    const { card } = await openQueue(page, [approval('fallback', preview, action)]);
    await expect(card).toContainText(action);
    await card.getByRole('menuitem', { name: 'Show details', exact: true }).click();
    expect(await card.locator('pre').textContent()).toBe(preview);
    expect(await page.locator('script').filter({ hasText: 'untrusted text' }).count()).toBe(0);
  });
}

test('notification-c8: a long task title stays compact while full details remain available', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const preview = `task.create: ${JSON.stringify({ title: 'unbroken-title-'.repeat(90), notes: 'Short synthetic task notes.' })}`;
  const { card } = await openQueue(page, [approval('long-title', preview)]);
  expect((await card.boundingBox())!.height).toBeLessThan(300);
  await card.getByRole('menuitem', { name: 'Show details', exact: true }).click();
  expect(await card.locator('pre').textContent()).toBe(preview);
  expect(await card.locator('pre').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
});

test('notification-c9: legacy unsigned approvals preserve their warning and disabled actions', async ({ page }) => {
  const row = { ...approval('legacy'), preview: null, decisionNonce: null };
  const { card } = await openQueue(page, [row]);
  await expect(card).toContainText('This legacy approval cannot be signed');
  await expect(card.getByRole('menuitem', { name: 'Approve', exact: true })).toBeDisabled();
  await expect(card.getByRole('menuitem', { name: 'Reject', exact: true })).toBeDisabled();
  await expect(card.getByRole('menuitem', { name: 'Show details', exact: true })).toHaveCount(0);
});

test('notification-c10: a task without notes keeps JSON behind details', async ({ page }) => {
  const preview = `task.create: ${JSON.stringify({ due_date: '2026-10-07', title: 'Prepare a short checklist' })}`;
  const { card } = await openQueue(page, [approval('no-notes', preview)]);
  await expect(card.locator('strong')).toContainText('Prepare a short checklist');
  expect(await card.innerText()).not.toContain('"title"');
  await card.getByRole('menuitem', { name: 'Show details', exact: true }).click();
  expect(await card.locator('pre').textContent()).toBe(preview);
});

test('notification-c6: decisions retain the signed ID nonce digest and existing failure behavior', async ({ page }) => {
  const row = approval('bound');
  const { card, menu, decisions } = await openQueue(page, [row]);
  await card.getByRole('menuitem', { name: 'Approve', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => decisions.length).toBe(1);
  expect(decisions[0].pathname).toBe('/agent-approvals/bound');
  expect(decisions[0].body).toEqual({ status: 'approved', signature: 'synthetic-signed-decision' });
  expect(await page.evaluate(() => (window as unknown as { signedPresentationDecisions: unknown[] }).signedPresentationDecisions)).toEqual([{ approvalId: row.id, status: 'approved', decisionNonce: row.decisionNonce, payloadDigest: row.payloadDigest }]);
  await expect(menu).toBeVisible();
  await expect(card).toBeVisible();
  expect(row.preview).toBe(taskPreview);
});

type NativeReceipt = { action: string; payload?: { x?: number; y?: number; width?: number; height?: number; event?: string; payload?: { hidden?: boolean } } };
const nativeCalls = (page: Page) => page.evaluate(() => (window as unknown as { notificationNativeCalls: NativeReceipt[] }).notificationNativeCalls);
for (const native of ['hermes', 'colony'] as const) for (const width of [1392, 520]) {
  test(`notification-c7-${native}-${width}: opening and expanding keeps native view attached in a positive reserved band`, async ({ page }) => {
    await page.setViewportSize({ width, height: 912 });
    const { card, menu } = await openQueue(page, [approval('native')], native);
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    await expect(page.getByTestId('notifications-button')).toBeFocused();
    await expect.poll(async () => (await nativeCalls(page)).filter(x => x.action === 'bounds').at(-1)?.payload?.width ?? 0).toBeGreaterThan(0);
    const initialCalls = await nativeCalls(page);
    const attachCount = initialCalls.filter(x => x.action === 'attach').length;
    await page.evaluate(() => (window as unknown as { notificationNativeCalls: NativeReceipt[] }).notificationNativeCalls.splice(0));
    await page.getByTestId('notifications-button').click();
    await card.getByRole('menuitem', { name: 'Show details', exact: true }).click();
    await expect(page.locator('.app-canvas')).toHaveAttribute('data-native-overlay-active', 'true');
    await expect.poll(async () => {
      const bounds = (await nativeCalls(page)).filter(x => x.action === 'bounds').at(-1)?.payload;
      const rect = await menu.boundingBox();
      return Boolean(bounds && rect && bounds.width! > 0 && bounds.height! > 0 &&
        (bounds.x! + bounds.width! <= rect.x || rect.x + rect.width <= bounds.x! || bounds.y! + bounds.height! <= rect.y || rect.y + rect.height <= bounds.y!));
    }).toBe(true);
    await expect(page).toHaveURL(new RegExp(`#/${native}$`));
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('notifications-button')).toBeFocused();
    await expect(page.locator('.app-canvas')).not.toHaveAttribute('data-native-overlay-active', 'true');
    const during = await nativeCalls(page);
    expect(attachCount).toBeGreaterThan(0);
    expect(during.filter(x => x.action === 'attach' || x.action === 'detach')).toEqual([]);
    expect(during.filter(x => x.action === 'bounds').every(x => x.payload!.width! > 0 && x.payload!.height! > 0)).toBe(true);
    expect(during.filter(x => x.action === 'intent' && x.payload?.event === 'host.visibility' && x.payload.payload?.hidden === true)).toEqual([]);
  });
}
