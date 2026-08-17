import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

const weekendThreadId = 'thread-weekend-team';

async function expectNoBlockingAxe(page: Page, state: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${state}: ${blocking.map((item) => `${item.id}: ${item.help}`).join('\n')}`).toEqual([]);
}

test('Messages click-through covers search, unread state, reply, incoming notice, and group creation', async ({ page }) => {
  await openPage(page, 'messages');
  await expect(page.getByTestId('messages-unread-total')).toHaveText('6 unread threads');

  await page.getByTestId('messages-thread-search').fill('weekend');
  await expect(page.getByTestId(`messages-thread-${weekendThreadId}`)).toBeVisible();
  await page.getByTestId('messages-thread-search').fill('missing title');
  await page.getByTestId('messages-clear-search').click();

  await page.getByTestId(`messages-thread-${weekendThreadId}`).click();
  await expect(page.getByTestId('messages-subject')).toHaveText('Weekend Team');
  await expect(page.getByTestId('messages-unread-total')).toHaveText('5 unread threads');
  await page.getByTestId('messages-incoming-dismiss').click();
  await expect(page.getByTestId('messages-incoming-dismiss')).toHaveCount(0);

  const reply = page.getByTestId('messages-reply-input');
  await reply.fill('  ');
  await page.getByTestId('messages-send').click();
  await expect(page.getByTestId('messages-reply-error')).toContainText('Write a message');
  await reply.fill('Coverage confirmed');
  await reply.press('Enter');
  await expect(page.getByTestId('messages-transcript').getByText('Coverage confirmed', { exact: true })).toHaveCount(1);

  await page.getByTestId('messages-new-thread').click();
  const dialog = page.getByTestId('messages-new-thread-dialog');
  await dialog.getByTestId('messages-thread-type-group').check();
  await dialog.getByTestId('messages-new-thread-title').fill('Care coordination');
  await dialog.getByTestId('messages-recipient-morgan-lee').check();
  await expect(dialog.getByTestId('messages-create-thread')).toBeDisabled();
  await dialog.getByTestId('messages-recipient-riley-chen').check();
  await dialog.getByTestId('messages-create-thread').click();
  await expect(page.getByTestId('messages-subject')).toHaveText('Care coordination');
  await expect(page.getByTestId('messages-participants')).toContainText('Morgan Lee');
  await expect(page.getByTestId('messages-participants')).not.toContainText('@');
});

test('Messages mutation failures preserve reply and create drafts for truthful recovery', async ({ page }) => {
  await openPage(page, `messages/${weekendThreadId}`);
  await page.getByTestId('messages-mutation-mode').selectOption('server-error');

  const reply = page.getByTestId('messages-reply-input');
  await reply.fill('Keep this reply intact');
  await page.getByTestId('messages-send').click();
  await expect(page.getByTestId('messages-reply-error')).toContainText('draft is still here');
  await expect(reply).toHaveValue('Keep this reply intact');
  await expect(page.getByTestId('page-trace')).toContainText(`POST /message-threads/${weekendThreadId}/messages {body} → 500`);

  await page.getByTestId('messages-new-thread').click();
  const dialog = page.getByTestId('messages-new-thread-dialog');
  await dialog.getByTestId('messages-thread-type-group').check();
  await dialog.getByTestId('messages-new-thread-title').fill('Preserved group draft');
  await dialog.getByTestId('messages-recipient-morgan-lee').check();
  await dialog.getByTestId('messages-recipient-riley-chen').check();
  await dialog.getByTestId('messages-create-thread').click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('messages-create-error')).toContainText('selections are still here');
  await expect(dialog.getByTestId('messages-new-thread-title')).toHaveValue('Preserved group draft');
  await expect(dialog.getByTestId('messages-recipient-morgan-lee')).toBeChecked();
  await expect(dialog.getByTestId('messages-recipient-riley-chen')).toBeChecked();
});

test('Messages preserves state in the hash and recovers in place with an open draft', async ({ page }) => {
  await openPage(page, `messages/${weekendThreadId}`);
  await page.getByTestId('messages-reply-input').fill('Draft survives page state');
  await page.getByTestId('messages-state-picker').selectOption('server-error');
  await expect(page).toHaveURL(/state=server-error/);
  await expect(page.getByTestId('page-state-server-error')).toBeVisible();
  await page.getByTestId('page-retry').click();
  await expect(page).toHaveURL(/state=ready/);
  await expect(page.getByTestId('messages-reply-input')).toHaveValue('Draft survives page state');

  await page.reload();
  await expect(page.getByTestId('page-messages')).toBeVisible();
  await expect(page.getByTestId('messages-state-picker')).toHaveValue('ready');
});

test('Messages is responsive and axe-clean across representative states', async ({ page }) => {
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, `messages/${weekendThreadId}`);
    await expect(page.getByTestId('messages-responsive-primary')).toBeVisible();
    if (width <= 640) await expect(page.getByTestId('messages-mobile-back')).toBeVisible();
    else await expect(page.getByTestId('messages-mobile-back')).toBeHidden();
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll, `${width}px`).toBeLessThanOrEqual(overflow.client + 1);
  }

  await expectNoBlockingAxe(page, 'ready conversation');
  await page.getByTestId('messages-new-thread').click();
  await expectNoBlockingAxe(page, 'new conversation dialog');
  await page.keyboard.press('Escape');

  await openPage(page, 'messages', '?state=server-error');
  await expectNoBlockingAxe(page, 'server error');
  await openPage(page, `messages/${weekendThreadId}`, '?state=readonly');
  await expectNoBlockingAxe(page, 'readonly conversation');

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await expect(page.getByText('礼拝チーム引き継ぎ 🎵', { exact: true })).toBeVisible();
  const resilientOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(resilientOverflow.scroll).toBeLessThanOrEqual(resilientOverflow.client + 1);
});
