import { expect, test, type Page } from '@playwright/test';

// Path on the existing fixture preview; override if the preview serves it elsewhere.
const FIXTURE = process.env.OPEN_DESIGN_FIXTURE_PATH ?? '/tests/open-design-tools-fixture.html';
const open = (page: Page, bridge?: string) => page.goto(bridge ? `${FIXTURE}?bridge=${bridge}` : FIXTURE);
const pin = (page: Page, id: string) => page.getByTestId(`agent-tool-pin-${id}`);
const LIFECYCLE_COPY = /service|lifecycle|Rhythm-owned|loopback|package|rebuild|artifact|outside Rhythm/i;

test('AT-UI-01 catalog lists four tools with existing tabs pinned and Dayflow unpinned', async ({ page }) => {
  await open(page);
  for (const id of ['hermes', 'bot-crossing', 'open-design']) await expect(pin(page, id)).toBeChecked();
  await expect(pin(page, 'dayflow')).not.toBeChecked();
  await expect(page.getByTestId('agent-tools-catalog')).not.toContainText(LIFECYCLE_COPY);
});

test('AT-UI-02 pins persist per scope across reload and Reset restores defaults', async ({ page }) => {
  await open(page);
  await pin(page, 'dayflow').check();
  await pin(page, 'hermes').uncheck();
  await page.reload();
  await expect(pin(page, 'dayflow')).toBeChecked();
  await expect(pin(page, 'hermes')).not.toBeChecked();
  await page.getByTestId('agent-tools-reset-pins').click();
  await expect(pin(page, 'dayflow')).not.toBeChecked();
  await expect(pin(page, 'hermes')).toBeChecked();
});

test('AT-UI-03 blocked localStorage keeps defaults visible with safe non-persistence copy', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } }));
  await open(page);
  await expect(page.getByText('Pin preferences can’t be saved on this device.', { exact: false })).toBeVisible();
  await expect(pin(page, 'hermes')).toBeChecked();
  await expect(pin(page, 'dayflow')).not.toBeChecked();
});

test('AT-UI-04 Open OpenDesign attaches into the host region with no lifecycle copy', async ({ page }) => {
  await open(page);
  await page.getByTestId('agent-tool-open-design').getByRole('button', { name: 'Open' }).click();
  const region = page.getByRole('region', { name: 'OpenDesign workspace' });
  await expect(region).toBeVisible();
  await expect(region).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Product copy only; the fixture's own preview banner is excluded.
  await expect(page.getByTestId('agent-tools-catalog')).not.toContainText(LIFECYCLE_COPY);
  await expect(page.getByTestId('page-open-design')).not.toContainText(LIFECYCLE_COPY);
});

for (const [bridge, copy] of [
  ['missing-attach', 'OpenDesign isn’t running. Open the OpenDesign app, then select Retry.'],
  ['malformed-attach', 'OpenDesign isn’t running. Open the OpenDesign app, then select Retry.'],
  ['unavailable', 'OpenDesign isn’t running. Open the OpenDesign app, then select Retry.'],
  ['absent', 'OpenDesign isn’t available in this version of Rhythm.'],
] as const) {
  test(`AT-UI-05 ${bridge} bridge shows fixed error copy and Retry, never a blank success`, async ({ page }) => {
    await open(page, bridge);
    await page.getByTestId('agent-tool-open-design').getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('alert')).toHaveText(copy);
    await expect(page.getByRole('region', { name: 'OpenDesign workspace' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('alert')).toHaveText(copy);
  });
}

test('AT-UI-06 surfaces use existing theme tokens', async ({ page }) => {
  await open(page);
  const colors = await page.getByTestId('agent-tool-hermes').evaluate((element) => {
    const probe = document.createElement('div');
    probe.style.cssText = 'background: var(--surface); border: 1px solid var(--border-soft);';
    document.body.append(probe);
    const card = getComputedStyle(element);
    const token = getComputedStyle(probe);
    const result = { card: [card.backgroundColor, card.borderTopColor], token: [token.backgroundColor, token.borderTopColor] };
    probe.remove();
    return result;
  });
  expect(colors.card).toEqual(colors.token);
});
