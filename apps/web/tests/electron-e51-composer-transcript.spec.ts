import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { chooseDemo, openFixture } from './helpers';

test('IME composition never sends and ordinary Enter sends once', async ({ page }) => {
  await openFixture(page);
  const input = page.getByTestId('composer-input');
  const before = await page.locator('.message').count();
  await input.fill('composed message');
  await input.evaluate((element) => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })));
  await expect(page.locator('.message')).toHaveCount(before);
  await input.press('Enter');
  await expect(page.locator('.message')).toHaveCount(before + 1);

  const source = await readFile(new URL('../src/pages/messages/live.tsx', import.meta.url), 'utf8');
  expect(source).toContain('!event.nativeEvent.isComposing');
});

test('composer exposes and dismisses each suggestion list', async ({ page }) => {
  await openFixture(page);
  const input = page.getByTestId('composer-input');
  for (const value of ['/', '@run', '!']) {
    await input.fill(value);
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await expect(input).toHaveAttribute('aria-controls', 'composer-suggestions-list');
    await expect(input).toHaveAttribute('aria-activedescendant', /composer-(slash|mention|shell)-option-0/);
    await input.press('Escape');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
  }
});

test('activity status announces a decision and moves focus to it', async ({ page }) => {
  await openFixture(page);
  await chooseDemo(page, 'permission');
  await expect(page.getByTestId('agent-activity-status')).toContainText('waiting for your decision');
  await page.getByTestId('agent-go-to-activity').click();
  await expect(page.getByTestId('permission-card')).toBeFocused();
});
