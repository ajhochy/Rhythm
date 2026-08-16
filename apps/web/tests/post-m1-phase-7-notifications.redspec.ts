import { expect, test, type WebSocketRoute } from '@playwright/test';
import { fulfillJson, matching, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';

const notification = {
  id: 701, recipientUserId: 7, type: 'task_assigned', entityType: 'task', entityId: 'task-7',
  message: 'Phase 7 task assigned', readAt: null, createdAt: '2026-08-15T10:00:00.000Z',
};

test('post-m1-p7-c4b: live notifications derive recipient-scoped unread badge read state and owned navigation', async ({ page }) => {
  // Regression caught: the bell always says 2 unread and Mark all read only emits a toast.
  const seen: SeenRequest[] = [];
  await openPhase7Live(page, '/agents', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/notifications') return fulfillJson(route, 200, [notification]).then(() => true);
    if (url.pathname === '/notifications/read-all') return route.fulfill({ status: 204 }).then(() => true);
    if (url.pathname === `/notifications/${notification.id}/read`) return route.fulfill({ status: 204 }).then(() => true);
    if (url.pathname === `/tasks/${notification.entityId}`) return fulfillJson(route, 200, { id: notification.entityId, ownerId: 7, title: 'Owned task' }).then(() => true);
    return false;
  });

  await expect.poll(() => matching(seen, 'GET', '/notifications').length).toBeGreaterThan(0);
  await page.getByTestId('notifications-button').click();
  await expect(page.getByText(notification.message)).toBeVisible();
  await expect(page.getByText('1 unread', { exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: /mark all read/i }).click();
  await expect.poll(() => matching(seen, 'POST', '/notifications/read-all').length).toBe(1);
  await page.reload();
  await expect(page.getByText(notification.message)).toHaveCount(0);
});

test('post-m1-p7-c4c: notification.push is deduplicated by numeric id without losing concurrent session events', async ({ page }) => {
  // Regression caught: the live socket handles session events but ignores notification.push.
  const seen: SeenRequest[] = [];
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket('ws://127.0.0.1:4098/ws/agents', (route) => { socket = route; });
  await openPhase7Live(page, '/agents', seen, async (route, request) => {
    if (new URL(request.url()).pathname === '/notifications') return fulfillJson(route, 200, []).then(() => true);
    return false;
  });
  await expect.poll(() => Boolean(socket)).toBe(true);
  const push = { v: 1, type: 'notification.push', id: 702, title: 'Agent result', body: 'Phase 7 push body' };
  socket!.send(JSON.stringify({ v: 1, type: 'session.status', id: 'session-7', working: true }));
  socket!.send(JSON.stringify(push));
  socket!.send(JSON.stringify(push));

  await page.getByTestId('notifications-button').click();
  await expect(page.getByText(push.title, { exact: true })).toHaveCount(1);
  await expect(page.getByText(push.body, { exact: true })).toHaveCount(1);
  await expect(page.getByText('1 unread', { exact: true })).toBeVisible();
});
