import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

const weekendThreadId = 'thread-weekend-team';
const weekendSubject = 'Weekend Team';

async function expectMessagesPage(page: Page) {
  await expect(page.getByTestId('page-messages')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toHaveCount(1);
  await expect(page.getByTestId('module-placeholder')).toHaveCount(0);
}

async function openThreadActions(page: Page, threadId = weekendThreadId, subject = weekendSubject) {
  await page.getByTestId(`messages-thread-actions-${threadId}`).click();
  return page.getByRole('menu', { name: `Actions for ${subject}` });
}

test('issue-2006-c1: messages collection and thread deep links render the real page shell', async ({ page }) => {
  // Regression caught: #/messages or its thread deep link continues rendering ModulePlaceholder or loses the selected shell destination.
  await openPage(page, 'messages');
  await expectMessagesPage(page);
  await expect(page.getByTestId('nav-messages')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('messages-empty-selection')).toContainText('Select a conversation');

  await openPage(page, `messages/${weekendThreadId}`);
  await expectMessagesPage(page);
  await expect(page.getByTestId(`messages-thread-${weekendThreadId}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('messages-subject')).toHaveText(weekendSubject);
});

test('issue-2006-c2: search filters deterministic threads without changing the six unread baseline', async ({ page }) => {
  // Regression caught: title search is case-sensitive, filters the wrong field, changes unread totals, or fabricates a GET receipt per keystroke.
  await openPage(page, 'messages');
  await expectMessagesPage(page);
  await expect(page.getByTestId('messages-unread-total')).toHaveText('6 unread threads');
  await expect(page.getByTestId('messages-thread-list').locator('[data-unread="true"]')).toHaveCount(6);
  const traceBefore = await page.getByTestId('page-trace').textContent();

  await page.getByTestId('messages-thread-search').fill('wEeKeNd');
  await expect(page.getByTestId(`messages-thread-${weekendThreadId}`)).toBeVisible();
  await expect(page.getByTestId('messages-visible-count')).toHaveText('1 conversation');
  await expect(page.getByTestId('messages-thread-list').locator('[data-testid^="messages-thread-"][data-thread-row="true"]')).toHaveCount(1);
  await expect(page.getByTestId('messages-unread-total')).toHaveText('6 unread threads');
  await expect(page.getByTestId('page-trace')).toHaveText(traceBefore ?? '');

  await page.getByTestId('messages-thread-search').fill('not a fixture conversation');
  await expect(page.getByTestId('messages-no-results')).toContainText('No matching conversations');
  await page.getByTestId('messages-clear-search').click();
  await expect(page.getByTestId(`messages-thread-${weekendThreadId}`)).toBeVisible();
});

test('issue-2006-c3: state matrix no-results and invalid links expose deterministic recovery', async ({ page }) => {
  // Regression caught: a URL fixture state is blank or dead, Retry reloads the app, an invalid link strands the user, or readonly leaves a mutation enabled.
  await openPage(page, 'messages', '?state=loading');
  await expect(page.getByTestId('page-state-loading')).toContainText('Loading conversations');

  await openPage(page, 'messages', '?state=empty');
  await expect(page.getByTestId('page-state-empty')).toContainText('No conversations');
  await page.getByTestId('messages-empty-new-thread').click();
  await expect(page.getByTestId('messages-new-thread-dialog')).toBeVisible();

  await openPage(page, 'messages', '?state=server-error');
  await expect(page.getByTestId('page-state-server-error')).toHaveAttribute('role', 'alert');
  await page.getByTestId('page-retry').click();
  await expectMessagesPage(page);
  await expect(page).toHaveURL(/state=ready/);

  await openPage(page, 'messages', '?state=forbidden');
  await expect(page.getByTestId('page-state-forbidden')).toContainText('workspace membership');
  await openPage(page, 'messages', '?state=unavailable');
  await expect(page.getByTestId('page-state-unavailable')).toContainText('Rhythm API');

  await openPage(page, `messages/${weekendThreadId}`, '?state=readonly');
  await expect(page.getByTestId('page-state-readonly')).toContainText(/read-only/i);
  await expect(page.getByTestId('messages-mutations')).toBeDisabled();
  await expect(page.getByTestId('messages-thread-search')).toBeEnabled();
  await expect(page.getByTestId('messages-transcript')).toBeVisible();

  await openPage(page, 'messages/thread-does-not-exist');
  await expect(page.getByTestId('messages-thread-not-found')).toContainText('Conversation not found');
  await page.getByTestId('messages-back-to-conversations').click();
  await expect(page).toHaveURL(/#\/messages(?:\?|$)/);
});

test('issue-2006-c4: controls are live receipt-honest and restore focus', async ({ page }) => {
  // Regression caught: an enabled control has no stable identity/outcome, or Escape closes a menu/dialog without restoring its trigger.
  await openPage(page, 'messages');
  await expectMessagesPage(page);
  const enabled = page.getByTestId('page-messages').locator('button:enabled, input:enabled, select:enabled, textarea:enabled');
  const missingTestIds = await enabled.evaluateAll((elements) => elements
    .filter((element) => !/^[-a-z0-9]+$/.test(element.getAttribute('data-testid') ?? ''))
    .map((element) => element.outerHTML));
  expect(missingTestIds).toEqual([]);

  const newTrigger = page.getByTestId('messages-new-thread');
  await newTrigger.click();
  await expect(page.getByTestId('messages-new-thread-title')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('messages-new-thread-dialog')).toHaveCount(0);
  await expect(newTrigger).toBeFocused();

  const actionTrigger = page.getByTestId(`messages-thread-actions-${weekendThreadId}`);
  const traceBefore = await page.getByTestId('page-trace').textContent();
  await actionTrigger.click();
  await expect(page.getByRole('menuitem', { name: 'Mark as read' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(actionTrigger).toBeFocused();
  await page.getByTestId('messages-thread-search').fill('weekend');
  await expect(page.getByTestId('page-trace')).toHaveText(traceBefore ?? '');
});

test('issue-2006-c5: visible ledger records exact message endpoint receipts and excludes client-only controls', async ({ page }) => {
  // Regression caught: selection receipts use an assumed route/status, occur out of Flutter order, or client-only search/dialog actions create fake APIs.
  await openPage(page, 'messages');
  await expectMessagesPage(page);
  const trace = page.getByTestId('page-trace');
  await expect(trace).toContainText('GET /message-threads → 200');

  await page.getByTestId('messages-new-thread').click();
  await expect(trace).toContainText('GET /users → 200');
  await page.getByTestId('messages-new-thread-cancel').click();
  const beforeClientActions = await trace.textContent();
  await page.getByTestId('messages-thread-search').fill('weekend');
  await page.getByTestId('messages-thread-search').fill('');
  await expect(trace).toHaveText(beforeClientActions ?? '');

  await page.getByTestId(`messages-thread-${weekendThreadId}`).click();
  let ledger = await trace.textContent() ?? '';
  const markRead = ledger.lastIndexOf(`POST /message-threads/${weekendThreadId}/read → 204`);
  const getMessages = ledger.lastIndexOf(`GET /message-threads/${weekendThreadId}/messages → 200`);
  const refresh = ledger.lastIndexOf('GET /message-threads → 200');
  expect(markRead).toBeGreaterThan(-1);
  expect(getMessages).toBeGreaterThan(markRead);
  expect(refresh).toBeGreaterThan(getMessages);

  await page.getByTestId('messages-reply-input').fill('Receipt coverage reply');
  await page.getByTestId('messages-send').click();
  await expect(trace).toContainText(`POST /message-threads/${weekendThreadId}/messages {body} → 201`);

  let menu = await openThreadActions(page);
  await menu.getByRole('menuitem', { name: 'Mark as unread' }).click();
  await expect(trace).toContainText(`POST /message-threads/${weekendThreadId}/unread → 204`);
  menu = await openThreadActions(page);
  await menu.getByRole('menuitem', { name: 'Mark as read' }).click();

  await page.getByTestId('messages-new-thread').click();
  const dialog = page.getByTestId('messages-new-thread-dialog');
  await dialog.getByTestId('messages-thread-type-group').click();
  await dialog.getByTestId('messages-recipient-morgan-lee').check();
  await dialog.getByTestId('messages-recipient-riley-chen').check();
  await dialog.getByTestId('messages-new-thread-title').fill('Ledger coverage');
  await dialog.getByTestId('messages-create-thread').click();
  await expect(trace).toContainText('POST /message-threads {participantIds,threadType,title} → 201');
  ledger = await trace.textContent() ?? '';
  expect(ledger).toContain('GET /users → 200');
  expect(ledger).toContain('GET /message-threads → 200');
});

test('issue-2006-c6: ready page and New thread dialog satisfy axe and modal focus', async ({ page }) => {
  // Regression caught: the dense split pane looks correct while axe finds a serious violation or keyboard focus escapes the New thread modal.
  await openPage(page, 'messages');
  await expectMessagesPage(page);
  let result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

  await page.getByTestId('messages-new-thread').click();
  await expect(page.getByTestId('messages-new-thread-dialog')).toHaveAttribute('role', 'dialog');
  await expect(page.getByTestId('messages-new-thread-title')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('messages-new-thread-close')).toBeFocused();
  result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
});

test('issue-2006-c7: messages remains responsive under required presentation modes', async ({ page }) => {
  // Regression caught: the fixed Flutter split pane causes page overflow, hides conversation controls, or creates undersized touch targets at required breakpoints.
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, `messages/${weekendThreadId}`);
    await expectMessagesPage(page);
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll, `${width}px ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.client + 1);
    await expect(page.getByTestId('messages-responsive-primary')).toBeVisible();
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await expect(page.getByText('礼拝チーム引き継ぎ 🎵', { exact: true })).toBeVisible();
  const resilientOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(resilientOverflow.scroll).toBeLessThanOrEqual(resilientOverflow.client + 1);
  const undersized = await page.getByTestId('page-messages').locator('button:visible, input:visible, textarea:visible').evaluateAll((elements) => elements.flatMap((element) => {
    const control = element as HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement;
    const rect = element.getBoundingClientRect();
    return control.disabled || rect.width === 0 || rect.height === 0 || (rect.width >= 44 && rect.height >= 44)
      ? []
      : [{ testId: element.getAttribute('data-testid'), width: rect.width, height: rect.height }];
  }));
  expect(undersized).toEqual([]);
});

test('issue-2006-c8: fixture isolation blocks external I O and reload resets the seed', async ({ page }) => {
  // Regression caught: polling or a mutation contacts a real host, persists local state, or reloads time/random-dependent unread fixtures.
  const attemptedExternal: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') attemptedExternal.push(request.url());
  });
  await openPage(page, 'messages');
  await expectMessagesPage(page);
  const seededThreads = await page.getByTestId('messages-thread-list').locator('[data-thread-row="true"]').allTextContents();
  const menu = await openThreadActions(page);
  await menu.getByRole('menuitem', { name: 'Mark as read' }).click();
  await expect(page.getByTestId('messages-unread-total')).toHaveText('5 unread threads');

  await page.reload();
  await expectMessagesPage(page);
  await expect(page.getByTestId('messages-unread-total')).toHaveText('6 unread threads');
  const reloadedThreads = await page.getByTestId('messages-thread-list').locator('[data-thread-row="true"]').allTextContents();
  expect(reloadedThreads).toEqual(seededThreads);
  expect(attemptedExternal).toEqual([]);
});

test('issue-2006-c9: selecting and deep linking hydrate the correct conversation and read state', async ({ page }) => {
  // Regression caught: selection changes only the highlight while transcript/participants stay stale, or a deep link fails to mark and display the requested thread.
  await openPage(page, 'messages');
  await expectMessagesPage(page);
  await page.getByTestId(`messages-thread-${weekendThreadId}`).click();
  await expect(page).toHaveURL(/#\/messages\/thread-weekend-team(?:\?|$)/);
  await expect(page.getByTestId(`messages-thread-${weekendThreadId}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(`messages-thread-${weekendThreadId}`)).toHaveAttribute('data-unread', 'false');
  await expect(page.getByTestId('messages-subject')).toHaveText(weekendSubject);
  await expect(page.getByTestId('messages-thread-type')).toHaveText('Group');
  await expect(page.getByTestId('messages-participants')).toContainText('Morgan Lee');
  await expect(page.getByTestId('messages-participants')).toContainText('Visalia CRC');
  await expect(page.getByTestId('messages-transcript')).toContainText('Final volunteer positions are ready.');
  await expect(page.getByTestId('messages-transcript')).not.toContainText('Facilities access code');

  await openPage(page, `messages/${weekendThreadId}`);
  await expect(page.getByTestId('messages-subject')).toHaveText(weekendSubject);
  await expect(page.getByTestId('messages-transcript').locator('[data-message-row="true"]')).not.toHaveCount(0);
});

test('issue-2006-c10: new thread validates supported fields creates once and selects the result', async ({ page }) => {
  // Regression caught: Create accepts invalid recipient/title state, invents an initial body field, duplicates a thread, or closes without selecting/hydrating the returned record.
  await openPage(page, 'messages');
  await expectMessagesPage(page);
  await page.getByTestId('messages-new-thread').click();
  const dialog = page.getByTestId('messages-new-thread-dialog');
  await expect(dialog.getByTestId('messages-new-thread-body')).toHaveCount(0);
  await expect(dialog.getByTestId('messages-create-thread')).toBeDisabled();

  await dialog.getByTestId('messages-thread-type-group').click();
  await dialog.getByTestId('messages-recipient-morgan-lee').check();
  await expect(dialog.getByTestId('messages-create-thread')).toBeDisabled();
  await dialog.getByTestId('messages-new-thread-title').fill('Care coordination');
  await expect(dialog.getByTestId('messages-create-thread')).toBeDisabled();
  await dialog.getByTestId('messages-recipient-riley-chen').check();
  await expect(dialog.getByTestId('messages-create-thread')).toBeEnabled();

  const createsBefore = await page.getByTestId('page-trace').getByText(/POST \/message-threads \{/).count();
  await dialog.getByTestId('messages-create-thread').click();
  await expect(page).toHaveURL(/#\/messages\/thread-care-coordination(?:\?|$)/);
  await expect(page.getByTestId('messages-subject')).toHaveText('Care coordination');
  await expect(page.getByTestId('messages-participants')).toContainText('Morgan Lee');
  await expect(page.getByTestId('page-trace').getByText(/POST \/message-threads \{/)).toHaveCount(createsBefore + 1);
  await expect(page.getByTestId('page-trace')).toContainText('POST /message-threads {participantIds,threadType,title} → 201');
  await expect(page.getByTestId('page-trace')).toContainText('POST /message-threads/thread-care-coordination/read → 204');
  await expect(page.getByTestId('page-trace')).toContainText('GET /message-threads/thread-care-coordination/messages → 200');
});

test('issue-2006-c11: reply validates appends once preserves focus and exposes the exact receipt', async ({ page }) => {
  // Regression caught: blank reply emits a request, Shift+Enter sends, success duplicates the message, or rerender loses composer focus/scroll position.
  await openPage(page, `messages/${weekendThreadId}`);
  await expectMessagesPage(page);
  const input = page.getByTestId('messages-reply-input');
  const trace = page.getByTestId('page-trace');
  const sendsBefore = await trace.getByText(new RegExp(`POST /message-threads/${weekendThreadId}/messages`)).count();
  await input.fill('   ');
  await page.getByTestId('messages-send').click();
  await expect(page.getByTestId('messages-reply-error')).toContainText('Write a message');
  await expect(trace.getByText(new RegExp(`POST /message-threads/${weekendThreadId}/messages`))).toHaveCount(sendsBefore);
  await expect(input).toBeFocused();

  await input.fill('Confirmed for Sunday');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('Confirmed for Sunday\n');
  await expect(trace.getByText(new RegExp(`POST /message-threads/${weekendThreadId}/messages`))).toHaveCount(sendsBefore);
  await input.press('Enter');
  await expect(page.getByTestId('messages-transcript').getByText('Confirmed for Sunday', { exact: true })).toHaveCount(1);
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(trace).toContainText(`POST /message-threads/${weekendThreadId}/messages {body} → 201`);
  const scroll = await page.getByTestId('messages-transcript').evaluate((element) => ({ top: element.scrollTop, max: element.scrollHeight - element.clientHeight }));
  expect(scroll.max - scroll.top).toBeLessThanOrEqual(2);
});

test('issue-2006-c12: mark read and unread synchronize thread page and shell badges', async ({ page }) => {
  // Regression caught: the row badge changes alone while page/shell totals stay fixed, or read/unread uses the wrong route/status and skips refresh.
  await openPage(page, 'messages');
  await expectMessagesPage(page);
  await expect(page.getByTestId('nav-messages').getByLabel('6 unread')).toHaveText('6');
  await expect(page.getByTestId('messages-unread-total')).toHaveText('6 unread threads');
  await expect(page.getByTestId(`messages-thread-unread-${weekendThreadId}`)).toHaveText('1');

  let menu = await openThreadActions(page);
  await menu.getByRole('menuitem', { name: 'Mark as read' }).click();
  await expect(page.getByTestId(`messages-thread-unread-${weekendThreadId}`)).toHaveCount(0);
  await expect(page.getByTestId('messages-unread-total')).toHaveText('5 unread threads');
  await expect(page.getByTestId('nav-messages').getByLabel('5 unread')).toHaveText('5');
  await expect(page.getByTestId('page-trace')).toContainText(`POST /message-threads/${weekendThreadId}/read → 204`);

  menu = await openThreadActions(page);
  await menu.getByRole('menuitem', { name: 'Mark as unread' }).click();
  await expect(page.getByTestId(`messages-thread-unread-${weekendThreadId}`)).toHaveText('1');
  await expect(page.getByTestId('messages-unread-total')).toHaveText('6 unread threads');
  await expect(page.getByTestId('nav-messages').getByLabel('6 unread')).toHaveText('6');
  await expect(page.getByTestId('page-trace')).toContainText(`POST /message-threads/${weekendThreadId}/unread → 204`);
  await expect(page.getByTestId('page-trace')).toContainText('GET /message-threads → 200');
});

test('issue-2006-c13: thread rename and delete are functional and selection safe', async ({ page }) => {
  // Regression caught: thread actions are decorative, rename changes only one surface, or deleting the selected thread leaves a dead conversation route.
  await openPage(page, `messages/${weekendThreadId}`);
  await expectMessagesPage(page);
  const traceBefore = await page.getByTestId('page-trace').textContent();

  let menu = await openThreadActions(page);
  await menu.getByRole('menuitem', { name: 'Rename thread' }).click();
  const renameDialog = page.getByTestId('messages-rename-thread-dialog');
  const renameInput = renameDialog.getByTestId('messages-rename-thread-input');
  await expect(renameInput).toBeFocused();
  await expect(renameInput).toHaveValue(weekendSubject);
  await renameInput.fill('Sunday coordination');
  await renameDialog.getByTestId('messages-rename-thread-save').click();
  await expect(page.getByTestId('messages-subject')).toHaveText('Sunday coordination');
  await expect(page.getByTestId(`messages-thread-${weekendThreadId}`)).toContainText('Sunday coordination');
  await expect(page).toHaveURL(new RegExp(`#\/messages\/${weekendThreadId}(?:\\?|$)`));
  await expect(page.getByTestId('page-trace')).toHaveText(traceBefore ?? '');

  menu = await openThreadActions(page, weekendThreadId, 'Sunday coordination');
  await menu.getByRole('menuitem', { name: 'Delete thread' }).click();
  const deleteDialog = page.getByTestId('messages-delete-thread-dialog');
  await expect(deleteDialog).toContainText('Sunday coordination');
  await deleteDialog.getByTestId('messages-delete-thread-confirm').click();

  await expect(page.getByTestId(`messages-thread-${weekendThreadId}`)).toHaveCount(0);
  await expect(page.getByTestId('messages-visible-count')).toHaveText('7 conversations');
  await expect(page.getByTestId('messages-subject')).toHaveText('Facilities handoff and access planning for the late summer gathering');
  await expect(page).toHaveURL(/#\/messages\/thread-facilities-handoff(?:\?|$)/);
  await expect(page.getByTestId('messages-selected-thread-actions')).toBeFocused();
  await expect(page.getByTestId('page-trace')).not.toContainText('PATCH /message-threads');
  await expect(page.getByTestId('page-trace')).not.toContainText('DELETE /message-threads');
});
