import { expect, test } from '@playwright/test';

// The rail's tools live behind one "More" disclosure above the account footer.
test('More is collapsed by default, toggles by keyboard, opens a tool and persists expansion', async ({ page }) => {
  await page.goto('/agents');
  const rail = page.getByRole('complementary', { name: 'Agents', exact: true });
  const more = rail.getByRole('button', { name: 'More', exact: true });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(more).toHaveAttribute('aria-controls', 'rail-more-tools');
  await expect(page.getByTestId('tool-profiles')).toBeHidden();
  await expect(rail.locator('[data-testid="tools-resizer"]')).toHaveCount(0);

  await more.focus();
  await more.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(more).toBeFocused();
  const profiles = page.getByTestId('tool-profiles');
  await expect(profiles).toBeVisible();
  await expect(profiles).toHaveAttribute('title', 'Identity and policy');
  await expect(profiles).toHaveAccessibleName('Profiles');
  await more.press('Space');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(profiles).toBeHidden();
  await more.press('Space');

  // The session list takes the remaining rail height; More sits just above the account footer.
  const [list, moreBox, footer] = await Promise.all([rail.locator('.session-list').boundingBox(), rail.locator('.rail-more').boundingBox(), rail.locator('.rail-account').boundingBox()]);
  expect(moreBox!.y).toBeGreaterThanOrEqual(list!.y + list!.height - 1);
  expect(footer!.y).toBeGreaterThanOrEqual(moreBox!.y + moreBox!.height - 1);

  await page.reload();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await page.getByTestId('tool-profiles').click();
  await expect(page).toHaveURL(/#\/profiles/);
});
