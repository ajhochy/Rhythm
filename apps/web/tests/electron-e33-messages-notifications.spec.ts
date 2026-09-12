import { expect, test } from '@playwright/test';
import { fulfillJson, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';

const thread = { id: 31, title: 'Staff handoff', threadType: 'direct', taskId: null, createdBy: 1, createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', lastMessage: 'First', unreadCount: 0, isUnread: false, participants: [{ id: 2, name: 'Casey Staff', email: 'casey@example.invalid' }] };

test('E33: an open transcript refreshes on focus without mixing routes', async ({ page }) => {
  await page.clock.install();
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
  await expect(page.getByTestId('messages-thread-list')).not.toHaveAttribute('role', 'grid');
  await expect(page.getByTestId('messages-thread-31')).toHaveJSProperty('tagName', 'BUTTON');
  messages = [...messages, { id: 2, threadId: 31, senderId: 2, senderName: 'Casey Staff', body: 'Arrived while open', createdAt: '2026-09-11T00:01:00Z' }];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('messages-transcript')).toContainText('Arrived while open');
  messages = [...messages, { id: 3, threadId: 31, senderId: 2, senderName: 'Casey Staff', body: 'Arrived on cadence', createdAt: '2026-09-11T00:02:00Z' }];
  await page.clock.fastForward(15_001);
  await expect(page.getByTestId('messages-transcript')).toContainText('Arrived on cadence');
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

test('E33: a delayed old-thread refresh cannot overwrite a newly routed thread', async ({ page }) => {
  const seen: SeenRequest[] = []; let delay = false; let pending = false; let delivered = false; let release = () => {};
  const second = { ...thread, id: 32, title: 'Second thread', lastMessage: 'Second' };
  await openPhase7Live(page, '/messages/31', seen, async (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/users') return fulfillJson(route, 200, thread.participants).then(() => true);
    if (path === '/message-threads') return fulfillJson(route, 200, [thread, second]).then(() => true);
    if (path === '/message-threads/31/messages') { if (delay) { pending = true; await new Promise<void>((resolve) => { release = resolve; }); delivered = true; } return fulfillJson(route, 200, [{ id: 1, threadId: 31, senderId: 2, senderName: 'Casey', body: 'Late old response', createdAt: '' }]).then(() => true); }
    if (path === '/message-threads/32/messages') return fulfillJson(route, 200, [{ id: 2, threadId: 32, senderId: 2, senderName: 'Casey', body: 'Current second response', createdAt: '' }]).then(() => true);
    if (path.endsWith('/read')) return route.fulfill({ status: 204 }).then(() => true);
    return false;
  });
  delay = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => pending).toBe(true);
  await page.evaluate(() => { location.hash = '#/messages/32'; });
  await expect(page.getByTestId('messages-transcript')).toContainText('Current second response');
  release(); await expect.poll(() => delivered).toBe(true);
  await expect(page.getByTestId('messages-transcript')).not.toContainText('Late old response');
});
