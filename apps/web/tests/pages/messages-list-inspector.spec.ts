import { expect, test } from '@playwright/test';
import { openPage } from '../helpers';
import {
  atNarrow,
  atZoom200,
  expectInspectorHeading,
  expectListInspectorAxeClean,
  expectSelected,
  keyboardSelect,
  selectRow,
} from '../helpers/list-inspector';

const weekendThreadId = 'thread-weekend-team';
const longTitle = 'Facilities handoff and access planning for the late summer gathering';

test('Messages selects conversations with mouse and keyboard and hydrates their read state', async ({ page }) => {
  await openPage(page, 'messages');
  await expect(page.getByTestId('messages-unread-total')).toHaveText('6 unread threads');

  await selectRow(page, 'Weekend Team');
  await expectInspectorHeading(page, 'Weekend Team');
  await expect(page.getByTestId('messages-transcript')).toContainText('Final volunteer positions are ready.');
  await expect(page.getByTestId('messages-unread-total')).toHaveText('5 unread threads');

  await selectRow(page, longTitle);
  await expectInspectorHeading(page, longTitle);
  await expect(page.getByTestId('messages-transcript')).toContainText('Facilities access code');
  await expect(page.getByTestId('messages-unread-total')).toHaveText('4 unread threads');

  await keyboardSelect(page, { fromTitle: 'Weekend Team', presses: ['ArrowDown', 'Enter'] });
  await expectSelected(page, longTitle);
  await expectInspectorHeading(page, longTitle);
});

test('Messages restores selection and chooses a safe fallback after deletion', async ({ page }) => {
  await openPage(page, `messages/${weekendThreadId}`);
  await expectInspectorHeading(page, 'Weekend Team');
  await page.reload();
  await expectInspectorHeading(page, 'Weekend Team');

  await selectRow(page, longTitle);
  await expect(page).toHaveURL(/#\/messages\/thread-facilities-handoff(?:\?|$)/);
  await page.reload();
  await expectInspectorHeading(page, longTitle);

  await page.getByTestId('messages-selected-thread-actions').click();
  await page.getByTestId('messages-thread-delete-thread-facilities-handoff').click();
  await page.getByTestId('messages-delete-thread-confirm').click();
  await expectInspectorHeading(page, 'Care coordinators');
  await expect(page).toHaveURL(/#\/messages\/thread-care-coordinators(?:\?|$)/);
  await expect(page.getByTestId('messages-subject')).toHaveText('Care coordinators');

  await openPage(page, 'messages/deleted-conversation');
  await expect(page.getByTestId('messages-thread-not-found')).toContainText('Conversation not found');
  await expect(page.getByTestId('messages-back-to-conversations')).toBeVisible();
});

test('Messages exposes empty, loading, error, and read-only states in the shared frame', async ({ page }) => {
  await openPage(page, 'messages', '?state=empty');
  await expect(page.getByTestId('page-state-empty')).toContainText('No conversations');

  await openPage(page, 'messages', '?state=loading');
  await expect(page.locator('.list-inspector-state[role="status"]')).toContainText('Loading Conversations');

  await openPage(page, 'messages', '?state=server-error');
  await expect(page.getByTestId('page-state-server-error')).toContainText('Messages could not be loaded');
  await page.getByTestId('page-retry').click();
  await expect(page.getByRole('option', { name: 'Weekend Team' })).toBeVisible();

  await openPage(page, `messages/${weekendThreadId}`, '?state=readonly');
  await expectInspectorHeading(page, 'Weekend Team');
  await expect(page.getByTestId('messages-reply-input')).toBeDisabled();
  await page.getByTestId('messages-selected-thread-actions').click();
  await expect(page.getByTestId(`messages-thread-rename-${weekendThreadId}`)).toBeDisabled();
  await expectListInspectorAxeClean(page);
});

test('Messages keeps every item action and the composer inside the inspector', async ({ page }) => {
  await openPage(page, 'messages');
  await selectRow(page, 'Weekend Team');
  await expect(page.getByTestId('messages-unread-total')).toHaveText('5 unread threads');

  await page.getByTestId('messages-selected-thread-actions').click();
  await page.getByTestId(`messages-thread-toggle-${weekendThreadId}`).click();
  await expect(page.getByTestId('messages-unread-total')).toHaveText('6 unread threads');
  await page.getByTestId('messages-selected-thread-actions').click();
  await page.getByTestId(`messages-thread-toggle-${weekendThreadId}`).click();
  await expect(page.getByTestId('messages-unread-total')).toHaveText('5 unread threads');

  await page.getByTestId('messages-selected-thread-actions').click();
  await page.getByTestId(`messages-thread-rename-${weekendThreadId}`).click();
  await page.getByTestId('messages-rename-thread-input').fill('Weekend Team renamed');
  await page.getByTestId('messages-rename-thread-save').click();
  await expectInspectorHeading(page, 'Weekend Team renamed');

  const reply = page.getByTestId('messages-reply-input');
  for (let index = 1; index <= 18; index += 1) {
    await reply.fill(`Synthetic history message ${index}`);
    await reply.press('Enter');
  }
  await expect(page.getByTestId('messages-transcript')).toContainText('Synthetic history message 18');
  const bounds = await page.evaluate(() => {
    const detail = document.querySelector<HTMLElement>('[data-testid="list-inspector-detail"]')!;
    const transcript = document.querySelector<HTMLElement>('[data-testid="messages-transcript"]')!;
    const composer = document.querySelector<HTMLElement>('.messages-composer-fieldset')!;
    return {
      detailBottom: detail.getBoundingClientRect().bottom,
      composerBottom: composer.getBoundingClientRect().bottom,
      transcriptClientHeight: transcript.clientHeight,
      transcriptScrollHeight: transcript.scrollHeight,
    };
  });
  expect(bounds.transcriptScrollHeight).toBeGreaterThan(bounds.transcriptClientHeight);
  expect(bounds.composerBottom).toBeLessThanOrEqual(bounds.detailBottom + 1);

  await page.getByTestId('messages-selected-thread-actions').click();
  await expect(page.getByTestId(`messages-thread-delete-${weekendThreadId}`)).toBeVisible();
});

test('Messages remains usable at 640px, 200% zoom, and with long row metadata', async ({ page }) => {
  await atNarrow(page);
  await openPage(page, 'messages');
  await selectRow(page, longTitle);
  await expectInspectorHeading(page, longTitle);
  await expect(page.getByRole('button', { name: 'Back to list' })).toBeVisible();
  await expect(page.getByTestId('messages-reply-input')).toBeVisible();

  await atZoom200(page);
  await expectInspectorHeading(page, longTitle);
  await expect(page.getByTestId('messages-reply-input')).toBeVisible();
  await expect(page.getByTestId('messages-transcript')).toHaveAttribute('tabindex', '0');
  const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  await expectListInspectorAxeClean(page);
});
