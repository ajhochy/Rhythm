import { expect, test } from '@playwright/test';
import { chooseDemo, openFixture, resetFixtures } from './helpers';

test.describe('transcript decisions and composer', () => {
  test('handles permission once, always, and deny with a reason', async ({ page }) => {
    await openFixture(page);
    await chooseDemo(page, 'permission');
    await expect(page.getByTestId('permission-card')).toBeVisible();
    await page.getByTestId('permission-allow-once').click();
    await expect(page.getByTestId('toast-status')).toContainText('allowed once');
    await resetFixtures(page);
    await chooseDemo(page, 'permission');
    await page.getByTestId('permission-always').click();
    await expect(page.getByTestId('toast-status')).toContainText('always allowed');
    await resetFixtures(page);
    await chooseDemo(page, 'permission');
    await page.getByTestId('permission-reason').fill('Use the isolated release worktree instead.');
    await page.getByTestId('permission-deny').click();
    await expect(page.getByTestId('toast-status')).toContainText('denied');
  });

  test('answers and rejects an agent question', async ({ page }) => {
    await openFixture(page);
    await chooseDemo(page, 'question');
    await page.getByLabel('Compatibility first').check();
    await page.getByTestId('question-answer').click();
    await expect(page.getByTestId('toast-status')).toContainText('Answer sent');
    await resetFixtures(page);
    await chooseDemo(page, 'question');
    await page.getByTestId('question-reject').click();
    await expect(page.getByTestId('toast-status')).toContainText('rejected');
  });

  test('copies, reverts, restores, forks, compacts, and loads older history', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('load-older').click();
    await expect(page.getByText('Earlier session context loaded')).toBeVisible();
    await page.getByTestId('copy-msg-assistant-handoff').click();
    await expect(page.getByTestId('toast-status')).toContainText('copied');
    await page.getByTestId('revert-msg-assistant-handoff').click();
    await expect(page.getByTestId('reverted-banner')).toBeVisible();
    await page.getByTestId('unrevert').click();
    await expect(page.getByTestId('reverted-banner')).toHaveCount(0);
    await page.getByTestId('summarize-msg-assistant-handoff').click();
    await expect(page.getByTestId('toast-status')).toContainText('compacted');
    await page.getByTestId('fork-msg-assistant-handoff').click();
    await expect(page.getByRole('heading', { name: /fork/ })).toBeVisible();
  });

  test('supports slash, file mention, shell shortcut, attachment, model/profile, send, cancel, and offline queue', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('composer-cancel').click();
    await page.getByTestId('composer-input').fill('/');
    await expect(page.getByTestId('composer-suggestions')).toBeVisible();
    await page.getByTestId('command-review').click();
    await page.getByTestId('composer-input').fill('@');
    await page.getByRole('option', { name: /run-sheet/ }).click();
    await page.getByTestId('composer-input').fill('!');
    await page.getByTestId('shell-shortcut-option').click();
    await page.getByTestId('composer-attach').click();
    await page.getByTestId('attachment-option-allowed').click();
    await expect(page.getByTestId('attachment-allowed')).toContainText('run-sheet.md');
    await page.getByTestId('composer-profile').selectOption('profile-builder');
    await page.getByTestId('composer-model').selectOption('claude-sonnet-4');
    await expect(page.getByTestId('model-scope-dialog')).toBeVisible();
    await page.getByTestId('model-session-default').click();
    await expect(page.getByTestId('composer-permission-mode').locator('option')).toHaveText(['Default', 'Accept Edits', 'Plan', 'Bypass']);
    await page.getByTestId('composer-permission-mode').selectOption('Bypass');
    await expect(page.getByTestId('bypass-confirm-dialog')).toBeVisible();
    await page.getByTestId('bypass-confirm').click();
    await expect(page.getByTestId('composer-permission-mode')).toHaveValue('Bypass');
    await page.getByTestId('composer-fast').click();
    await page.getByTestId('composer-input').fill('Verify the current handoff state.');
    await page.getByTestId('composer-send').click();
    await expect(page.getByTestId('toast-status')).toContainText('sent');
    await chooseDemo(page, 'offline');
    await page.getByTestId('composer-input').fill('Queue this until the desktop reconnects.');
    await page.getByTestId('composer-send').click();
    await expect(page.getByTestId('connection-status')).toContainText('queued locally');
    await page.getByTestId('reconnect-button').click();
    await expect(page.getByTestId('connection-status')).toContainText('connected');
    await expect(page.getByTestId('transcript').getByText('Queue this until the desktop reconnects.')).toBeVisible();
  });
});
