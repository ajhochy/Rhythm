import { test as gap } from '@playwright/test';
import { test, expect, responseFor, assertResponse, ObservedApi } from './feature-test';

test('[P0] approvals: signed pending snapshot matches real visible cards', async ({ page }) => {
  // Catches expired or already-decided cards remaining actionable in the pending queue (#1614).
  const pending = responseFor(page, 'GET', '/agent-approvals');
  await page.goto('rhythm://app/index.html#/agents');
  const response = await pending; await assertResponse(response, 'GET', '/agent-approvals', 200);
  const rows = await response.json(); expect(Array.isArray(rows)).toBe(true);
  expect(rows.length, 'UNVERIFIED: visible-card agreement needs at least one real pending card; use a disposable signed fixture when the queue is empty').toBeGreaterThan(0);
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('approval-queue-status')).toContainText(`${rows.length} pending`);
  for (const row of rows) {
    expect(row).toMatchObject({ id: expect.any(String), action: expect.any(String), status: 'pending' });
    if (row.expiresAt) expect(Date.parse(row.expiresAt)).toBeGreaterThan(Date.now());
    await expect(page.getByTestId(`approval-card-${row.id}`)).toContainText(row.action);
  }
  const readback = await ObservedApi.from(response).json<Array<{ id: string; status: string }>>('/agent-approvals?status=pending');
  expect(readback.map(row => row.id).sort()).toEqual(rows.map((row: { id: string }) => row.id).sort());
  await page.keyboard.press('Escape');
});

test('[P0] approvals: failed refresh is visible, retains cards and recovers', async ({ page }) => {
  // Catches a failed signed read clearing known pending cards and displaying false empty success.
  const initial = responseFor(page, 'GET', '/agent-approvals');
  await page.goto('rhythm://app/index.html#/agents');
  const response = await initial; await assertResponse(response, 'GET', '/agent-approvals', 200);
  const rows = await response.json(); const api = ObservedApi.from(response);
  await page.getByTestId('notifications-button').click();
  const fail = async (route: import('@playwright/test').Route) => route.fulfill({ status: 503, json: { error: { message: '[smoke] approval service unavailable' } } });
  await page.route('**/agent-approvals?status=pending', fail);
  const failed = responseFor(page, 'GET', '/agent-approvals');
  await page.getByRole('menuitem', { name: 'Refresh approvals', exact: true }).click();
  await assertResponse(await failed, 'GET', '/agent-approvals', 503);
  await expect(page.getByTestId('approval-queue-error')).toContainText(/unavailable/i);
  for (const row of rows) await expect(page.getByTestId(`approval-card-${row.id}`)).toContainText(row.action);
  expect(await api.json('/agent-approvals?status=pending')).toEqual(rows);
  await page.unroute('**/agent-approvals?status=pending', fail);
  const recovered = responseFor(page, 'GET', '/agent-approvals');
  await page.getByRole('menuitem', { name: 'Refresh approvals', exact: true }).click();
  await assertResponse(await recovered, 'GET', '/agent-approvals', 200);
  await expect(page.getByTestId('approval-queue-error')).toHaveCount(0);
  await expect(page.getByTestId('approval-queue-status')).toContainText(`${rows.length} pending`);
  await page.keyboard.press('Escape');
});

gap('[P0] approvals: UNVERIFIED one-hour expiry, stale signed denial and history retention', () => {
  // Would catch TTL drift or an expired signed approval firing a side effect, not merely a hidden queue row.
  throw new Error('UNVERIFIED: approval creation has no owner scope or DELETE cleanup route; changing a real card is forbidden — requires a disposable app-matched database/native signer, nonce-owned benign action, controlled expiry and assertions of denial/no consumption plus retained all-history');
});
