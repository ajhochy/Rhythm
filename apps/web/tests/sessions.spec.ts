import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';

test.describe('session rail and lifecycle', () => {
  test('creates an instant chat and an advanced session', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('new-chat-instant').click();
    await expect(page.getByRole('heading', { name: 'New chat 1' })).toBeVisible();
    await page.getByTestId('session-session-sunday-handoff').click();
    await page.getByTestId('new-session-advanced').click();
    await expect(page.getByTestId('advanced-create')).toBeDisabled();
    await expect(page.getByTestId('advanced-worktree-name')).toHaveCount(0);
    await page.getByTestId('advanced-isolate-worktree').check();
    await expect(page.getByTestId('advanced-worktree-name')).toBeVisible();
    await page.getByTestId('advanced-worktree-name').fill('release-readiness');
    await page.getByTestId('advanced-branch').selectOption('release/desktop');
    await expect(page.getByTestId('stash-confirm-dialog')).toBeVisible();
    await page.getByTestId('stash-cancel').click();
    await expect(page.getByTestId('advanced-branch')).not.toHaveValue('release/desktop');
    await page.getByTestId('advanced-branch').selectOption('release/desktop');
    await page.getByTestId('stash-confirm').click();
    await page.getByTestId('advanced-name').fill('Release readiness review');
    await page.getByTestId('advanced-create').click();
    await expect(page.getByRole('heading', { name: 'Release readiness review' })).toBeVisible();
    await expect(page.getByTestId('toast-status')).toContainText('created');

    await page.getByTestId('new-session-advanced').click();
    await page.getByTestId('advanced-name').fill('Client error fixture');
    await page.getByTestId('advanced-cwd').fill('/workspace/forbidden');
    await page.getByTestId('advanced-create').click();
    await expect(page.getByTestId('advanced-error')).toContainText('not available');
    await page.getByTestId('advanced-session-dialog-close').click();
    await page.getByTestId('new-session-advanced').click();
    await page.getByTestId('advanced-name').fill('Server error fixture');
    await page.getByTestId('advanced-cwd').fill('/workspace/server-error');
    await page.getByTestId('advanced-create').click();
    await expect(page.getByTestId('advanced-error')).toContainText('Something went wrong');
    await page.getByText('Details').click();
    await expect(page.getByTestId('advanced-error')).toContainText('fixture-create-503');
    await page.getByTestId('advanced-session-dialog-close').click();
  });

  test('filters, sorts, switches scopes, and selects a session', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('session-search-toggle').click();
    await page.getByTestId('session-search').fill('Sunday service');
    await expect(page.getByTestId('session-session-sunday-handoff')).toBeVisible();
    await page.getByTestId('project-filter').selectOption({ label: 'Rhythm desktop' });
    await expect(page.getByText('No active sessions match.')).toBeVisible();
    await page.getByTestId('project-filter').selectOption('all');
    await page.getByTestId('session-sort').selectOption('name');
    await page.getByTestId('scope-scheduled').click();
    await expect(page.getByTestId('session-session-queued')).toContainText('Monday planning digest');
    await page.getByTestId('scope-background').click();
    await expect(page.getByTestId('session-session-stuck')).toContainText('Integration health sweep');
  });

  test('archives, restores, resumes, cancels, and permanently deletes', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('session-menu-session-sunday-handoff').click();
    await page.getByTestId('archive-session-sunday-handoff').click();
    await expect(page.getByTestId('toast-status')).toContainText('archived');
    await page.getByTestId('session-menu-session-sunday-handoff').click();
    await page.getByTestId('unarchive-session-sunday-handoff').click();
    await expect(page.getByTestId('toast-status')).toContainText('restored');
    await page.getByTestId('session-session-completed').click();
    await page.getByTestId('session-menu-session-completed').click();
    await page.getByTestId('resume-session-completed').click();
    await expect(page.getByTestId('toast-status')).toContainText('resumed');
    await page.getByTestId('session-menu-session-completed').click();
    await page.getByTestId('cancel-session-completed').click();
    await expect(page.getByTestId('toast-status')).toContainText('canceled');
    await page.getByTestId('session-menu-session-completed').click();
    await page.getByTestId('delete-session-completed').click();
    await expect(page.getByTestId('delete-session-dialog')).toBeVisible();
    await page.getByTestId('confirm-session-delete').click();
    await expect(page.getByTestId('session-session-completed')).toHaveCount(0);
  });
});
