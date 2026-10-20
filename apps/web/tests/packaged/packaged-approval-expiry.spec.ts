import { test as gap } from '@playwright/test';
import type { Page } from '@playwright/test';
import { test, expect, responseFor, assertResponse, ObservedApi, expectedRevision } from './feature-test';
import { OwnedPendingApprovalFixture } from './owned-approval-fixture';

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;

async function observedPendingCards(page: Page, fixture?: OwnedPendingApprovalFixture) {
  const pending = responseFor(page, 'GET', '/agent-approvals');
  await page.goto('rhythm://app/index.html#/agents');
  const initial = await pending;
  await assertResponse(initial, 'GET', '/agent-approvals', 200);
  await page.getByTestId('notifications-button').click();
  if (!fixture) return initial;
  await fixture.bind(initial);
  const owned = await fixture.create(0);
  const refreshed = responseFor(page, 'GET', '/agent-approvals');
  await page.getByRole('menuitem', { name: 'Refresh approvals', exact: true }).click();
  const response = await refreshed;
  await assertResponse(response, 'GET', '/agent-approvals', 200);
  expect(await response.json()).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: owned.id, action: owned.action, status: 'pending' }),
  ]));
  return response;
}

test('[P0] approvals: signed pending snapshot matches real visible cards', async ({ page }) => {
  // Catches expired or already-decided cards remaining actionable in the pending queue (#1614).
  const fixture = manifestPath ? new OwnedPendingApprovalFixture(manifestPath, expectedRevision) : undefined;
  try {
    const response = await observedPendingCards(page, fixture);
    const rows = await response.json(); expect(Array.isArray(rows)).toBe(true);
    expect(rows.length, 'UNVERIFIED: visible-card agreement needs a pending card; an empty ordinary queue stays read-only').toBeGreaterThan(0);
    await expect(page.getByTestId('approval-queue-status')).toContainText(`${rows.length} pending`);
    for (const row of rows) {
      expect(row).toMatchObject({ id: expect.any(String), action: expect.any(String), status: 'pending' });
      if (row.expiresAt) expect(Date.parse(row.expiresAt)).toBeGreaterThan(Date.now());
      await expect(page.getByTestId(`approval-card-${row.id}`)).toContainText(row.action);
    }
    const readback = await ObservedApi.from(response).json<Array<{ id: string; status: string }>>('/agent-approvals?status=pending');
    expect(readback.map(row => row.id).sort()).toEqual(rows.map((row: { id: string }) => row.id).sort());
    await page.keyboard.press('Escape');
  } finally { await fixture?.cleanup(); }
});

test('[P0] approvals: failed refresh is visible, retains cards and recovers', async ({ page }) => {
  // Catches a failed signed read clearing known pending cards and displaying false empty success.
  const fixture = manifestPath ? new OwnedPendingApprovalFixture(manifestPath, expectedRevision) : undefined;
  const fail = async (route: import('@playwright/test').Route) => route.fulfill({ status: 503, json: { error: { message: '[smoke] approval service unavailable' } } });
  try {
    const response = await observedPendingCards(page, fixture);
    const rows = await response.json(); const api = ObservedApi.from(response);
    expect(rows.length, 'UNVERIFIED: refresh retention needs a known pending card').toBeGreaterThan(0);
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
  } finally {
    try { await page.unroute('**/agent-approvals?status=pending', fail); }
    finally { await fixture?.cleanup(); }
  }
});

gap('[P0] approvals: UNVERIFIED one-hour expiry, stale signed denial and history retention', () => {
  // Would catch TTL drift or an expired signed approval firing a side effect, not merely a hidden queue row.
  throw new Error('UNVERIFIED: controlled private stale-card denial does not prove elapsed one-hour TTL or model-side-effect absence');
});
