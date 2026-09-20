import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const roots = (page: Page) => page.locator('.list-inspector');
const row = (page: Page, title: string) => roots(page).getByRole('option', { name: title, exact: true, includeHidden: true });

export function usesNativeAxeLegacyMode(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'rhythm:' && url.hostname === 'app' && url.pathname === '/index.html';
  } catch {
    return false;
  }
}

export async function selectRow(page: Page, title: string) {
  const target = row(page, title);
  const back = roots(page).getByRole('button', { name: 'Back to list', exact: true });
  // A live mutation can resolve before React commits its selected row. Wait
  // for that row to exist before deciding whether its rail is hidden.
  await expect(target).toHaveCount(1);
  // A narrow ListInspector intentionally presents either the inspector or the
  // rail. Follow its visible Back to list affordance before selecting another
  // row; never force a click through the hidden rail.
  if (!await target.isVisible()) {
    if (await back.isVisible()) {
      await back.click();
      await expect(target).toBeVisible();
    }
  }
  await target.click();
  await expectSelected(page, title);
}

export async function expectSelected(page: Page, title: string) {
  await expect(row(page, title)).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, title)).toHaveClass(/\bselected\b/);
  await expect(roots(page).locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
}

export async function expectInspectorHeading(page: Page, text: string) {
  const inspector = roots(page).locator('.list-inspector-detail:visible');
  const heading = inspector.getByRole('heading', { name: text, exact: true });
  await expect(heading).toBeVisible();
  const headingId = await heading.getAttribute('id');
  expect(headingId, 'The inspector heading needs an ID for aria-labelledby').toBeTruthy();
  await expect(inspector).toHaveAttribute('aria-labelledby', headingId!);
  await expect(inspector).toHaveAccessibleName(text);
}

export async function keyboardSelect(page: Page, { fromTitle, presses }: { fromTitle: string; presses: string[] }) {
  await row(page, fromTitle).focus();
  for (const key of presses) await page.keyboard.press(key);
}

export async function expectListInspectorAxeClean(page: Page) {
  await expect(roots(page).first()).toBeVisible();
  for (const root of await roots(page).all()) {
    const list = root.locator('[role="listbox"]');
    await expect(list).toHaveCount(1);
    await expect(list).toHaveAttribute('tabindex', '0');
    await expect(list).toHaveAttribute('aria-label', /\S/);
    const options = list.locator('[role="option"]');
    for (const option of await options.all()) {
      await expect(option).toHaveAttribute('aria-label', /\S/);
      await expect(option).toHaveAttribute('aria-selected', /^(true|false)$/);
      await expect(option).toHaveAttribute('tabindex', /^(0|-1)$/);
      await expect(option.locator('button, a[href], input, select, textarea, [role="button"], [role="link"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])')).toHaveCount(0);
      if (await option.isVisible()) {
        await expect(option).toHaveAccessibleName(/\S/);
        expect(await option.evaluate((element) => element.getBoundingClientRect().height), 'List rows must have a 44px target').toBeGreaterThanOrEqual(44);
      }
    }
    const focusStops = await options.evaluateAll((elements) => {
      const selectable = elements.filter((element) => element.getAttribute('aria-disabled') !== 'true' && !element.matches(':disabled'));
      return { selectable: selectable.length, tabStops: selectable.filter((element) => element.getAttribute('tabindex') === '0').length };
    });
    if (focusStops.selectable > 0) expect(focusStops.tabStops, 'The list must have one roving row tab stop').toBe(1);
    await expect(root.locator('div[aria-label]:not([role]), span[aria-label]:not([role])')).toHaveCount(0);
  }
  const axe = new AxeBuilder({ page }).include('.list-inspector');
  // Electron's CDP transport cannot create Axe's temporary finishRun target.
  // ListInspector has no cross-origin frames, so legacy mode retains this scope's full rule set.
  if (usesNativeAxeLegacyMode(page.url())) axe.setLegacyMode(true);
  const result = await axe.analyze();
  expect(result.violations, result.violations.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toEqual([]);
}

/** Match parity-edge-cases.spec.ts: CSS zoom exercises reflow, unlike device scale. */
export async function atZoom200(page: Page) {
  await page.evaluate(async () => {
    document.body.style.zoom = '2';
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

export async function atNarrow(page: Page) {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
