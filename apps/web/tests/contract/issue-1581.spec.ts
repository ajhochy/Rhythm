import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openFixture, openPage } from '../helpers';

const destinations = ['Dashboard', 'Planner', 'Tasks', 'Rhythms', 'Projects', 'Messages', 'Facilities', 'Automations', 'Integrations', 'Agents', 'Settings'];
const appMenuDestinations = ['Agents', 'Messages', 'Dashboard', 'Planner', 'Tasks', 'Rhythms', 'Projects', 'Facilities', 'Automations', 'Integrations', 'Settings'];
// Same gate as issue-1552: only refresh the committed evidence PNGs on request, so a
// routine suite run never dirties tracked artifacts with byte-identical-looking rewrites.
const evidence = (name: string) => process.env.RHYTHM_CAPTURE_EVIDENCE === '1' ? `../../docs/ai/runs/artifacts/${name}` : `test-results/${name}`;

for (const width of [1440, 1320, 900, 780, 390]) {
  test(`issue-1581-c1/c2: ${width}px App menu keeps canonical grouped destinations on screen`, async ({ page }) => {
    // The grouped App menu is canonical at every width; only the current destination is direct.
    await page.setViewportSize({ width, height: 900 });
    await openFixture(page);
    const nav = page.getByRole('navigation', { name: 'Product destinations' });
    const more = page.getByTestId('nav-more');
    await expect(page.getByTestId('nav-agents')).toBeVisible();
    await expect(more).toBeVisible();
    await page.screenshot({ path: evidence(`issue-1581-${width}-closed.png`) });
    await more.click();
    const menu = nav.getByRole('menu', { name: 'App menu' });
    await expect(menu).toBeVisible();
    await page.screenshot({ path: evidence(`issue-1581-${width}-open.png`) });
    expect(await menu.getByRole('menuitem').evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')))).toEqual(appMenuDestinations.map((name) => `nav-${name.toLowerCase()}-overflow`));
    const rect = await menu.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.y).toBeGreaterThan(0);
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(900);
    for (const item of await menu.getByRole('menuitem').all()) {
      const box = await item.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(await item.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      })).toBe(true);
    }
    const visibleHit = await menu.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.left + r.width / 2, r.bottom - 20));
    });
    expect(visibleHit).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).include('.app-header').analyze();
    expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
  });
}

test('issue-1581-c3: hidden active destination is marked, selection navigates and closes', async ({ page }) => {
  // Regression: active route is only marked on the hidden top-level button, or selection leaves the menu open.
  await page.setViewportSize({ width: 1100, height: 900 });
  await openPage(page, 'facilities');
  const more = page.getByTestId('nav-more');
  await more.click();
  await expect(page.getByTestId('nav-facilities-overflow')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('nav-settings-overflow').click();
  await expect(page).toHaveURL(/#\/settings(?:\?|$)/);
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(page.getByTestId('nav-settings-overflow')).toHaveAttribute('aria-current', 'page');
});

test('issue-1581-c4: keyboard traversal, selection, Escape and outside click restore focus', async ({ page }) => {
  // Regression: ArrowUp/Home/End or Enter/Space cannot reach a hidden route, or dismissal strands keyboard focus.
  await page.setViewportSize({ width: 780, height: 900 });
  await openFixture(page);
  const more = page.getByTestId('nav-more');
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('nav-agents-overflow')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByTestId('nav-settings-overflow')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByTestId('nav-agents-overflow')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('nav-settings-overflow')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('nav-agents-overflow')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('nav-agents-overflow')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/messages$/);
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await page.locator('#main-content').click({ position: { x: 20, y: 20 } });
  await expect(more).toBeFocused();
});

test('issue-1581-c5: resizing while open preserves the stable App menu without stale state', async ({ page }) => {
  // Unlike the retired responsive overflow, a grouped App menu is stable across widths.
  await page.setViewportSize({ width: 780, height: 900 });
  await openFixture(page);
  const more = page.getByTestId('nav-more');
  await more.click();
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  expect(await page.getByRole('menu', { name: 'App menu' }).getByRole('menuitem').evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')))).toEqual(appMenuDestinations.map((name) => `nav-${name.toLowerCase()}-overflow`));
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(more).toBeVisible();
  await expect(page.getByRole('menu', { name: 'App menu' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('issue-1581-c2/c4: 550x450 at 200% text can scroll keyboard End to visible Settings', async ({ page }) => {
  // Regression: the last route is clipped below the viewport at 200% text despite being keyboard-focusable.
  await page.setViewportSize({ width: 550, height: 450 });
  await openFixture(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const more = page.getByTestId('nav-more');
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('nav-agents-overflow')).toBeFocused();
  await page.keyboard.press('End');
  const settings = page.getByTestId('nav-settings-overflow');
  await expect(settings).toBeFocused();
  const menu = page.getByRole('menu', { name: 'App menu' });
  const panel = await menu.boundingBox();
  const box = await settings.boundingBox();
  expect(panel).not.toBeNull();
  expect(box).not.toBeNull();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(550);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(450);
  expect(box!.y + box!.height).toBeLessThanOrEqual(450);
  expect(await settings.evaluate((element) => {
    const r = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  })).toBe(true);
  const outline = await settings.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('issue-1581-c6: open responsive menu has no critical or serious axe violations', async ({ page }) => {
  // Regression: overflow controls lose keyboard-accessible names/roles or aria state.
  await page.setViewportSize({ width: 780, height: 900 });
  await openFixture(page);
  await page.getByTestId('nav-more').click();
  const results = await new AxeBuilder({ page }).include('.destination-nav').analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
});

test('issue-1581-c2: built renderer shows the panel above the workspace', async ({ page }) => {
  // Regression: dev CSS works but the bundled renderer still clips the real menu.
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(`http://127.0.0.1:${process.env.RHYTHM_DIST_PORT ?? 4582}/index.html#/agents`);
  const more = page.getByTestId('nav-more');
  await expect(more).toBeVisible();
  await more.click();
  const last = page.getByTestId('nav-settings-overflow');
  await expect(last).toBeVisible();
  const box = await last.boundingBox();
  expect(box).not.toBeNull();
  expect(await last.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
  })).toBe(true);
  await page.screenshot({ path: evidence('issue-1581-dist-1100-open.png') });
});

test('issue-1581-c2: header menus stay above expanded Agents rail and Details at 780', async ({ page }) => {
  // Regression: a header stacking context below the z-index:20 narrow overlays hides More/account menu items.
  await page.setViewportSize({ width: 780, height: 900 });
  await openFixture(page);
  for (const [expand, trigger] of [['rail-expand', 'nav-more'], ['session-details', 'account-button']] as const) {
    await page.getByTestId(expand).click();
    if (expand === 'rail-expand') await page.getByTestId('rail-collapse').click();
    await page.getByTestId(trigger).click();
    const items = page.locator('.menu-popover [role="menuitem"]');
    await expect(items.first()).toBeVisible();
    for (const item of await items.all()) {
      expect(await item.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      }), await item.textContent() ?? '').toBe(true);
    }
    await page.keyboard.press('Escape');
  }
});
