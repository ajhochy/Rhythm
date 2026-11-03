import { test as gap } from '@playwright/test';
import { test, expect, responseFor, assertResponse, localRows } from './feature-test';
import { ensurePrimaryForPrivateActor, existingPrimary, openExistingPrimary, openRuns } from './primary-read';

test('[P0] primary: permanent entry reopens the server-designated root and canonical history', async ({ page, sessions }) => {
  // Catches an ordinary SDK fallback, wrong primary identity or a Ready composer backed by a different conversation.
  await sessions.open();
  await ensurePrimaryForPrivateActor(page, sessions.api!);
  const history = responseFor(page, 'POST', '/coordinator-conversations/history');
  const { root } = await openExistingPrimary(page);
  const response = await history; await assertResponse(response, 'POST', '/coordinator-conversations/history', 200);
  const body = await response.json();
  expect(body).toMatchObject({ kind: 'history', conversation: { sessionId: root.id, primaryOwnerRoot: true }, messages: expect.any(Array) });
  await openRuns(page);
  await expect(page.getByTestId('coordinator-conversation-card')).toContainText('Coding runs');
  const reopened = responseFor(page, 'POST', '/coordinator-conversations/resolve');
  await page.getByTestId('rhythm-primary-entry').click();
  expect(await (await reopened).json()).toMatchObject({ created: false, sessionId: root.id });
  await expect(page.getByTestId(`session-${root.id}`)).toHaveAttribute('aria-current', 'true');
});

test('[P0] primary: failed resolve preserves the ordinary session and visibly retries', async ({ page, sessions }) => {
  // Catches failed primary entry replacing an ordinary chat with an unrelated empty SDK session.
  await sessions.open();
  const root = await ensurePrimaryForPrivateActor(page, sessions.api!);
  const own = await sessions.create(' primary fallback');
  // setup_unavailable is a valid first-use acknowledgement, not a failed
  // transport. Use an invalid acknowledgement to exercise failure/retry.
  const fail = async (route: import('@playwright/test').Route) => route.fulfill({ status: 503, json: { error: 'temporary service failure' } });
  await page.route('**/coordinator-conversations/resolve', fail);
  const failed = responseFor(page, 'POST', '/coordinator-conversations/resolve');
  await page.getByTestId('rhythm-primary-entry').click();
  await assertResponse(await failed, 'POST', '/coordinator-conversations/resolve', 503);
  await expect(page.getByText('Rhythm could not be opened. Your ordinary chats are unchanged.', { exact: true })).toBeVisible();
  await expect(page.getByTestId(`session-${own.id}`)).toHaveAttribute('aria-current', 'true');
  expect(await sessions.read(own.id)).toMatchObject({ name: own.name });
  await page.unroute('**/coordinator-conversations/resolve', fail);
  expect((await openExistingPrimary(page)).root.id).toBe(root.id);
});

test('[P0] primary: rapid entry and reload keep one canonical root', async ({ page, sessions }) => {
  // Catches duplicate primary allocation and stale selected-session hydration winning over the resolved root.
  await sessions.open();
  const root = await ensurePrimaryForPrivateActor(page, sessions.api!);
  const rootsBefore = localRows('SELECT id FROM agent_sessions WHERE owner_user_id=? AND coordinator_conversation_json IS NOT NULL ORDER BY id', root.owner_user_id);
  await page.route('**/coordinator-conversations/setup', route => route.abort('blockedbyclient'));
  const resolved = responseFor(page, 'POST', '/coordinator-conversations/resolve');
  await page.getByTestId('rhythm-primary-entry').dblclick();
  expect(await (await resolved).json()).toMatchObject({ created: false, sessionId: root.id });
  await expect(page.getByTestId(`session-${root.id}`)).toHaveAttribute('aria-current', 'true');
  await page.reload();
  expect((await openExistingPrimary(page)).root.id).toBe(root.id);
  await expect(page.getByTestId(`session-${root.id}`)).toHaveAttribute('aria-current', 'true');
  expect((await existingPrimary(page)).id).toBe(root.id);
  expect(localRows('SELECT id FROM agent_sessions WHERE owner_user_id=? AND coordinator_conversation_json IS NOT NULL ORDER BY id', root.owner_user_id)).toEqual(rootsBefore);
});

// Private first-use profile choice, dismissal, and retry are exercised in
// packaged-ai-000-primary-first-use.spec.ts against a fresh synthetic actor.

gap('[P0] primary: UNVERIFIED scoped message persists once on the canonical Coordinator root', () => {
  // Would catch a primary composer sending through the ordinary SDK path or replaying the scoped message twice.
  throw new Error('UNVERIFIED: a model message writes the real permanent primary journal and cannot be deleted by this nonce — requires a disposable signed-in primary/database and canonical API/engine/history readback after retry and reload');
});
