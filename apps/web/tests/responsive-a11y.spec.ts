import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';

const sizes = [
  { name: 'compact desktop', width: 1024, height: 720 },
  { name: 'tablet portrait', width: 768, height: 900 },
  { name: 'mobile-ish', width: 390, height: 844 },
] as const;

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

for (const size of sizes) {
  test(`${size.name} keeps the complete Agents workspace reachable without page overflow`, async ({ page }) => {
    await page.setViewportSize(size);
    await openFixture(page);
    await expectNoPageOverflow(page);
    if (await page.getByTestId('rail-expand').isVisible().catch(() => false)) await page.getByTestId('rail-expand').click();
    for (const id of ['new-chat-instant', 'tool-profiles']) {
      const control = page.getByTestId(id);
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
    }
    await expect(page.getByTestId('composer-input')).toBeVisible();
    await expect(page.getByTestId('composer-cancel')).toBeVisible();
    if (await page.getByTestId('inspector-expand').isVisible().catch(() => false)) await page.getByTestId('inspector-expand').click();
    await expect(page.getByTestId('inspector-context')).toBeVisible();
    const result = await new AxeBuilder({ page }).exclude('.traffic-lights').analyze();
    const blocking = result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''));
    expect(blocking, blocking.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
  });
}

test.describe('touch, text, direction, and contrast resilience', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('uses 44px touch targets for every visible enabled workbench control', async ({ page }) => {
    await openFixture(page);
    const undersized = await page.locator('button:visible, select:visible, textarea:visible, input:visible').evaluateAll((elements) => elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const control = element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (control.disabled || rect.width === 0 || rect.height === 0) return [];
      return rect.width < 44 || rect.height < 44 ? [{ label: control.getAttribute('aria-label') || control.textContent?.trim() || control.getAttribute('placeholder') || control.tagName, width: rect.width, height: rect.height }] : [];
    }));
    expect(undersized).toEqual([]);
  });

  test('wraps long RTL, CJK, and emoji content without hiding core controls', async ({ page }) => {
    await openFixture(page);
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.lang = 'ar'; });
    if (await page.getByTestId('rail-expand').isVisible().catch(() => false)) await page.getByTestId('rail-expand').click();
    await page.getByTestId('new-session-advanced').click();
    const longName = 'خطة تسليم طويلة جدًا للاجتماع الأسبوعي — 日本語の確認事項 — 👩🏽‍💻🎛️📋 ' + 'استمر في التحقق '.repeat(8);
    await page.getByTestId('advanced-name').fill(longName);
    await page.getByTestId('advanced-create').click();
    await expect(page.getByRole('heading', { name: longName })).toBeVisible();
    await expect(page.getByTestId('composer-input')).toBeVisible();
    await expectNoPageOverflow(page);
  });

  test('retains focus visibility and contrast semantics in forced-colors mode', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await openFixture(page);
    if (await page.getByTestId('rail-expand').isVisible().catch(() => false)) await page.getByTestId('rail-expand').click();
    await page.getByTestId('new-chat-instant').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('new-chat-instant')).toBeFocused();
    const outline = await page.getByTestId('new-chat-instant').evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe('none');
    await expect(page.getByTestId('scope-chats')).toHaveAttribute('aria-selected', 'true');
  });
});

test('supports 200% text scaling without obscuring primary actions', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openFixture(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  for (const id of ['new-chat-instant', 'composer-input', 'composer-cancel', 'session-actions', 'inspector-context']) {
    const control = page.getByTestId(id);
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeVisible();
  }
  await expectNoPageOverflow(page);
});

test('keyboard menus and dialogs restore focus without trapping the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page);
  await page.getByTestId('nav-more').click();
  await expect(page.getByRole('menu', { name: 'More destinations' }).getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('nav-more')).toBeFocused();
  if (await page.getByTestId('rail-expand').isVisible().catch(() => false)) await page.getByTestId('rail-expand').click();
  await page.getByTestId('new-session-advanced').scrollIntoViewIfNeeded();
  await page.getByTestId('new-session-advanced').click();
  await expect(page.getByTestId('advanced-name')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('advanced-session-dialog-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('new-session-advanced')).toBeFocused();
});
