import { expect, test } from '@playwright/test';

test('post-m1-auth-c9: tokenless live mode is signed out rather than fixture-backed', async ({ page }) => {
  // Regression caught: live startup silently renders deterministic fixture sessions without a bearer.
  await page.goto('/#/agents');
  await expect(page.getByRole('heading', { name: 'Sign in to Rhythm' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Product destinations' })).toHaveCount(0);
  await expect(page.getByTestId('session-rail')).toHaveCount(0);
});
