import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';

test.describe('child navigation and accessible resizing', () => {
  test('moves parent → child → grandchild and returns one parent at a time', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('open-child-session-coverage-child').click();
    await expect(page.getByRole('heading', { name: 'Volunteer coverage audit' })).toBeVisible();
    await expect(page.getByTestId('child-back')).toHaveAccessibleName('Back to parent session Sunday service handoff');
    await expect(page.getByTestId('composer-input')).toBeDisabled();
    await expect(page.getByText('Child-agent transcripts are read only.')).toBeVisible();
    await page.getByTestId('open-child-session-coverage-grandchild').click();
    await expect(page.getByRole('heading', { name: 'Livestream reply verification' })).toBeVisible();
    await expect(page.getByTestId('child-back')).toHaveAccessibleName('Back to parent session Volunteer coverage audit');
    await expect(page.getByText(/Morgan Lee confirmed the livestream fallback/)).toBeVisible();
    await page.getByTestId('child-back').click();
    await expect(page.getByRole('heading', { name: 'Volunteer coverage audit' })).toBeVisible();
    await expect(page.getByText(/Acoustic guitar is still unassigned/)).toBeVisible();
    await page.getByTestId('child-back').click();
    await expect(page.getByRole('heading', { name: 'Sunday service handoff' })).toBeVisible();
    await expect(page.getByTestId('composer-input')).toBeEnabled();
  });

  test('resizes all panels from the keyboard with clamps and live values', async ({ page }) => {
    await openFixture(page);
    const tools = page.getByTestId('tools-resizer');
    await expect(tools).toHaveAttribute('aria-label', 'Resize Tools panel');
    await expect(tools).toHaveAttribute('aria-valuenow', '224');
    await tools.focus();
    await page.keyboard.press('ArrowUp');
    await expect(tools).toHaveAttribute('aria-valuenow', '240');
    await expect(tools).toHaveAttribute('aria-valuetext', '240 pixels');
    await page.keyboard.press('Home');
    await expect(tools).toHaveAttribute('aria-valuenow', '120');
    await page.keyboard.press('End');
    await expect(tools).toHaveAttribute('aria-valuenow', '320');
    const rail = page.getByTestId('rail-resizer');
    await rail.focus();
    await page.keyboard.press('ArrowRight');
    await expect(rail).toHaveAttribute('aria-valuenow', '292');
    await page.keyboard.press('Home');
    await expect(rail).toHaveAttribute('aria-valuenow', '228');
    await page.keyboard.press('End');
    await expect(rail).toHaveAttribute('aria-valuenow', '380');
    const inspector = page.getByTestId('inspector-resizer');
    await inspector.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(inspector).toHaveAttribute('aria-valuenow', '348');
    await expect(page.getByTestId('panel-resize-status')).toHaveText('Inspector width 348 pixels');
    await page.keyboard.press('Home');
    await expect(inspector).toHaveAttribute('aria-valuenow', '286');
    await page.keyboard.press('End');
    await expect(inspector).toHaveAttribute('aria-valuenow', '470');
  });
});

test.describe('attachment and @mention validation', () => {
  test('adds, classifies, removes, rejects, and recovers deterministically', async ({ page }) => {
    await openFixture(page);
    const choose = page.getByTestId('composer-attach');
    await choose.click();
    await page.getByTestId('attachment-option-large').click();
    await expect(page.getByTestId('attachment-large')).toContainText('full-transcript.json');
    await expect(page.getByTestId('attachment-large')).toContainText('first 100 KB');
    await expect(page.getByTestId('attachment-feedback')).toContainText('truncated to the first 100 KB');
    await page.getByTestId('attachment-remove-large').click();
    await expect(page.getByTestId('attachment-large')).toHaveCount(0);
    await choose.click();
    await page.getByTestId('attachment-option-binary').click();
    await expect(page.getByTestId('attachment-binary')).toContainText('local file reference');
    await expect(page.getByTestId('attachment-feedback')).toContainText('safe local file reference');
    await page.getByTestId('attachment-remove-binary').click();
    await choose.click();
    await page.getByTestId('attachment-option-unsafe').click();
    await expect(page.getByTestId('attachment-feedback')).toContainText('PATH_TRAVERSAL');
    await expect(page.getByTestId('attachment-list')).toHaveCount(0);
    await choose.click();
    await page.getByTestId('attachment-option-missing').click();
    await expect(page.getByTestId('attachment-feedback')).toContainText('file not found');
    await choose.click();
    await page.getByTestId('attachment-option-allowed').click();
    await expect(page.getByTestId('attachment-feedback')).toContainText('run-sheet.md attached');
    await page.getByTestId('attachment-remove-allowed').click();
    await expect(page.getByTestId('attachment-feedback')).toContainText('run-sheet.md removed');
  });

  test('@mention wraps keyboard selection, removes the token, and recovers after Escape', async ({ page }) => {
    await openFixture(page);
    const input = page.getByTestId('composer-input');
    await input.fill('Review @run');
    await expect(page.getByRole('option', { name: /run-sheet/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('composer-suggestions')).toHaveCount(0);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('Review');
    await expect(page.getByTestId('attachment-allowed')).toContainText('run-sheet.md');
  });

  test('@mention surfaces unsafe and missing-file failures without stale chips', async ({ page }) => {
    await openFixture(page);
    const input = page.getByTestId('composer-input');
    await input.fill('@outside');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('attachment-feedback')).toContainText('PATH_TRAVERSAL');
    await expect(page.getByTestId('attachment-list')).toHaveCount(0);
    await input.fill('@missing');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('attachment-feedback')).toContainText('file not found');
    await input.fill('@build');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('attachment-binary')).toContainText('local file reference');
    await expect(page.getByTestId('attachment-feedback')).toContainText('safe local file reference');
  });
});
