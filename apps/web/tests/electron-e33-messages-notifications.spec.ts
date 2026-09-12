import { expect, test } from '@playwright/test';
import { fulfillJson, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';

const thread = { id: 31, title: 'Staff handoff', threadType: 'direct', taskId: null, createdBy: 1, createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', lastMessage: 'First', unreadCount: 0, isUnread: false, participants: [{ id: 2, name: 'Casey Staff', email: 'casey@example.invalid' }] };

test('E33: an open transcript refreshes on focus without mixing routes', async ({ page }) => {
  const seen: SeenRequest[] = [];
  let messages = [{ id: 1, threadId: 31, senderId: 2, senderName: 'Casey Staff', body: 'First', createdAt: '2026-09-11T00:00:00Z' }];
  await openPhase7Live(page, '/messages/31', seen, async (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/users') return fulfillJson(route, 200, thread.participants).then(() => true);
    if (path === '/message-threads') return fulfillJson(route, 200, [thread]).then(() => true);
    if (path === '/message-threads/31/messages') return fulfillJson(route, 200, messages).then(() => true);
    if (path === '/message-threads/31/read') return route.fulfill({ status: 204 }).then(() => true);
    return false;
  });
  await expect(page.getByTestId('messages-transcript')).toContainText('First');
  messages = [...messages, { id: 2, threadId: 31, senderId: 2, senderName: 'Casey Staff', body: 'Arrived while open', createdAt: '2026-09-11T00:01:00Z' }];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('messages-transcript')).toContainText('Arrived while open');
});

test('E33: failed notification read rolls back and navigation targets the entity', async ({ page }) => {
  const seen: SeenRequest[] = [];
  const notification = { id: 733, recipientUserId: 1, type: 'task_assigned', entityType: 'task', entityId: 'task-733', message: 'Assigned task', readAt: null, createdAt: '2026-09-11T00:00:00Z' };
  await openPhase7Live(page, '/agents', seen, async (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/notifications') return fulfillJson(route, 200, [notification]).then(() => true);
    if (path === '/notifications/733/read') return fulfillJson(route, 500, { error: 'failed' }).then(() => true);
    return false;
  });
  await page.getByTestId('notifications-button').click();
  await page.getByRole('menuitem', { name: /Assigned task/ }).click();
  await expect(page).toHaveURL(/#\/tasks\/task\/task-733$/);
  await page.getByTestId('notifications-button').click();
  await expect(page.getByRole('menuitem', { name: /Assigned task/ })).toBeVisible();
});
