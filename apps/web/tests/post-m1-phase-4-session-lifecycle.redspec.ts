import { expect, test, type Page } from '@playwright/test';
import { openFixture, resetFixtures } from './helpers';

function observeLiveBoundaries(page: Page) {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (['fetch', 'xhr', 'websocket'].includes(request.resourceType())) calls.push(request.url());
  });
  return calls;
}

test('post-m1-p4-c1a: fixture lifecycle controls are deterministic and remain boundary-free', async ({ page }) => {
  // Regression caught: a fixture lifecycle control leaks into HTTP/WS or produces a different
  // identity after reset; the boundary log or repeated created ID assertion fails.
  const boundaryCalls = observeLiveBoundaries(page);
  await openFixture(page);

  await page.getByTestId('new-chat-instant').click();
  await expect(page.getByTestId('session-session-created-1')).toBeVisible();
  await page.getByTestId('session-menu-session-created-1').click();
  await page.getByTestId('archive-session-created-1').click();
  await page.getByTestId('session-menu-session-created-1').click();
  await page.getByTestId('unarchive-session-created-1').click();
  await page.getByTestId('session-actions').click();
  await page.getByRole('menuitem', { name: 'Close session view' }).click();
  await page.getByTestId('session-menu-session-created-1').click();
  await page.getByTestId('delete-session-created-1').click();
  await page.getByTestId('confirm-session-delete').click();
  await expect(page.getByTestId('session-session-created-1')).toHaveCount(0);

  await resetFixtures(page);
  await page.getByTestId('new-chat-instant').click();
  await expect(page.getByTestId('session-session-created-1')).toBeVisible();
  expect(boundaryCalls).toEqual([]);
});

test('post-m1-p4-c1b: repeated fixture composition and recovery has stable observable state', async ({ page }) => {
  // Regression caught: fixture attachment/send/cancel/reconnect/reload behavior depends on live
  // state or nondeterministic IDs; the two snapshots or zero-boundary assertion fails.
  const boundaryCalls = observeLiveBoundaries(page);
  await openFixture(page);

  const run = async () => {
    await resetFixtures(page);
    // The reset target ("Sunday service handoff") is permanently `status: 'working'`
    // (fixtures.ts:72) by design, so it always shows Cancel, never Send — a fresh
    // instant chat is `idle` and gives this composition/cancel round trip somewhere
    // deterministic to actually exercise Send.
    await page.getByTestId('new-chat-instant').click();
    await expect(page.getByTestId('session-session-created-1')).toBeVisible();
    await page.getByTestId('composer-attach').click();
    await page.getByTestId('attachment-option-allowed').click();
    await page.getByTestId('composer-input').fill('Phase 4 deterministic prompt');
    await page.getByTestId('composer-send').click();
    await expect(page.getByText('Phase 4 deterministic prompt')).toBeVisible();
    await page.getByTestId('composer-cancel').click();
    await expect(page.getByTestId('toast-status')).toContainText('canceled');
    const snapshot = await page.getByTestId('transcript').innerText();
    await page.reload();
    await expect(page.getByText('Phase 4 deterministic prompt')).toBeVisible();
    return snapshot;
  };

  const first = await run();
  await page.evaluate(() => localStorage.removeItem('rhythm-agents-fixture-sessions'));
  await page.reload();
  await expect(page.getByTestId('composer-input')).toBeVisible();
  const second = await run();
  expect(second).toBe(first);
  expect(boundaryCalls).toEqual([]);
});
