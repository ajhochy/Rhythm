import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';

const destinations = ['dashboard', 'planner', 'tasks', 'rhythms', 'projects', 'messages', 'facilities', 'automations', 'integrations', 'agents'] as const;

test('post-m1-p1-c2a: keyboard navigation reaches every top-level destination with stable current-page semantics', async ({ page }) => {
  // Regression caught: a destination disappears from the keyboard path or navigation updates the
  // URL without updating its current-page semantic; visibility/current assertions fail.
  // This walks 10 wide destinations plus 8 overflow destinations and measures 12.0-12.2s against the
  // 20s global budget, so it failed once under machine load and then passed 3/3. Following the
  // tasks.spec.ts precedent it gets its own budget rather than raising the global one, so a
  // load-sensitive timeout cannot masquerade as missing product behaviour.
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFixture(page);

  for (const destination of destinations) {
    const control = page.getByTestId(`nav-${destination}`);
    await expect(control).toBeVisible();
    await control.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#/${destination}`));
    await expect(control).toHaveAttribute('aria-current', 'page');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const destination of destinations.filter((item) => !['dashboard', 'agents'].includes(item))) {
    await page.getByTestId('nav-more').focus();
    await page.keyboard.press('Enter');
    const control = page.getByTestId(`nav-${destination}-overflow`);
    await expect(control).toHaveRole('menuitem');
    // An ARIA menu moves focus to its first item when it opens, and that happens on a frame after
    // the click. Focusing a different item before it settles loses a race: the menu's own focus wins,
    // Enter activates the FIRST destination instead, and the URL silently fails to change. Wait for
    // the menu to finish taking focus, then drive it — the criterion is reaching every destination by
    // keyboard, not out-racing the component's focus management.
    await expect(page.getByTestId('nav-planner-overflow')).toBeFocused();
    await control.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#/${destination}`));
  }
});

test('post-m1-p1-c2c: wide menu activation returns focus deterministically to its trigger', async ({ page }) => {
  // Regression caught: activating a wide-header menu item removes the focused node and drops focus
  // onto body; the trigger-focused assertion fails.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFixture(page);
  await page.getByTestId('account-button').focus();
  await page.keyboard.press('Enter');
  // Opening the menu must move focus INTO it, onto the first item — which is Profiles, not the theme
  // toggle. An earlier draft asserted `theme-toggle` here and was simply wrong about the menu's
  // contents. Both halves of the criterion are still asserted: focus enters the menu on open, and
  // returns to the trigger on activation.
  await expect(page.getByTestId('account-profiles')).toBeFocused();
  await page.getByTestId('theme-toggle').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('account-button')).toBeFocused();
});

test('post-m1-p1-c2d: narrow overflow activation returns focus deterministically to More', async ({ page }) => {
  // Regression caught: choosing a compact overflow destination destroys the focused menu item and
  // leaves no deterministic keyboard continuation point; the More-focused assertion fails.
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page);
  await page.getByTestId('nav-more').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('nav-facilities-overflow')).toBeVisible();
  // Same race as c2a: let the menu finish moving focus to its first item before driving it, or the
  // component's focus wins and Enter activates Planner instead of Facilities.
  await expect(page.getByTestId('nav-planner-overflow')).toBeFocused();
  await page.getByTestId('nav-facilities-overflow').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/facilities/);
  await expect(page.getByTestId('nav-more')).toBeFocused();
});
