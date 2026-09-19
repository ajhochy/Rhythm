import { expect, test, type Locator, type Page } from '@playwright/test';
import { openFixture } from './helpers';

async function dragBy(page: Page, splitter: Locator, deltaX: number, deltaY: number) {
  const bounds = await splitter.boundingBox();
  expect(bounds).not.toBeNull();
  const startX = bounds!.x + bounds!.width / 2;
  const startY = bounds!.y + bounds!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 4 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('splitter-test-storage-initialized') === 'true') return;
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('layout.')) localStorage.removeItem(key);
    }
    sessionStorage.setItem('splitter-test-storage-initialized', 'true');
  });
});

test.describe('shared Splitter', () => {
  test('pointer drag resizes a ListInspector pane and persists across reload', async ({ page }) => {
    await openFixture(page, '#/tools/tasks');
    const splitter = page.getByRole('separator', { name: 'Resize Scheduled agent jobs list' });
    await expect(splitter).toHaveAttribute('aria-orientation', 'vertical');
    await expect(splitter).toHaveAttribute('aria-valuenow', '320');

    await dragBy(page, splitter, 72, 0);
    await expect(splitter).toHaveAttribute('aria-valuenow', '392');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('layout.list-inspector.scheduled-agent-jobs'))).toBe('392');

    await page.reload();
    await expect(page.getByTestId('tool-page-tasks')).toBeVisible();
    await expect(page.getByRole('separator', { name: 'Resize Scheduled agent jobs list' })).toHaveAttribute('aria-valuenow', '392');
  });

  test('keyboard resizing uses shared steps, bounds, values, and reset', async ({ page }) => {
    await openFixture(page);
    const rail = page.getByTestId('rail-resizer');
    await expect(rail).toHaveAccessibleName('Resize Agents rail');
    await expect(rail).toHaveAttribute('aria-orientation', 'vertical');
    await expect(rail).toHaveAttribute('aria-valuemin', '228');
    await expect(rail).toHaveAttribute('aria-valuemax', '380');
    await expect(rail).toHaveAttribute('aria-valuenow', '280');

    await rail.focus();
    await page.keyboard.press('ArrowRight');
    await expect(rail).toHaveAttribute('aria-valuenow', '296');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(rail).toHaveAttribute('aria-valuenow', '360');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    await expect(rail).toHaveAttribute('aria-valuenow', '380');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');
    await expect(rail).toHaveAttribute('aria-valuenow', '228');
    await page.keyboard.press('Enter');
    await expect(rail).toHaveAttribute('aria-valuenow', '280');
    await expect(rail).toHaveAttribute('aria-valuetext', '280 pixels');

    await page.keyboard.press('ArrowRight');
    await rail.dblclick();
    await expect(rail).toHaveAttribute('aria-valuenow', '280');

    await page.evaluate(() => {
      localStorage.setItem('layout.agents.rail', '9999');
      localStorage.setItem('layout.agents.tools', '-1');
    });
    await page.reload();
    await expect(page.getByTestId('rail-resizer')).toHaveAttribute('aria-valuenow', '380');
    await expect(page.getByTestId('tools-resizer')).toHaveAttribute('aria-valuenow', '120');
  });

  test('nested horizontal and vertical splitters remain independent', async ({ page }) => {
    await openFixture(page);
    const rail = page.getByTestId('rail-resizer');
    const tools = page.getByTestId('tools-resizer');
    const inspector = page.getByTestId('inspector-resizer');
    const shell = page.getByTestId('shell-navigation-resizer');

    await expect(tools).toHaveAccessibleName('Resize Tools panel');
    await expect(tools).toHaveAttribute('aria-orientation', 'horizontal');
    await expect(shell).toHaveAccessibleName('Resize app navigation');
    await expect(shell).toHaveAttribute('aria-orientation', 'horizontal');
    await expect(inspector).toHaveAttribute('aria-orientation', 'vertical');

    await tools.focus();
    await page.keyboard.press('ArrowUp');
    await expect(tools).toHaveAttribute('aria-valuenow', '240');
    await rail.focus();
    await page.keyboard.press('ArrowRight');
    await expect(rail).toHaveAttribute('aria-valuenow', '296');
    await expect(tools).toHaveAttribute('aria-valuenow', '240');
    await inspector.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(inspector).toHaveAttribute('aria-valuenow', '352');

    await expect.poll(() => page.evaluate(() => ({
      rail: localStorage.getItem('layout.agents.rail'),
      tools: localStorage.getItem('layout.agents.tools'),
      inspector: localStorage.getItem('layout.agents.inspector'),
    }))).toEqual({ rail: '296', tools: '240', inspector: '352' });
  });

  test('pointercancel releases capture, text selection, and drag listeners', async ({ page }) => {
    await openFixture(page);
    const rail = page.getByTestId('rail-resizer');
    const bounds = await rail.boundingBox();
    expect(bounds).not.toBeNull();
    const startX = bounds!.x + bounds!.width / 2;
    const startY = bounds!.y + bounds!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 32, startY);
    const cancelledAt = Number(await rail.getAttribute('aria-valuenow'));
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
    await page.mouse.move(startX + 96, startY);
    await page.mouse.up();

    await expect(rail).toHaveAttribute('aria-valuenow', String(cancelledAt));
    await expect.poll(() => page.evaluate(() => document.body.style.userSelect)).not.toBe('none');
  });

  test('Settings reset clears every layout preference and restores mounted defaults', async ({ page }) => {
    await openFixture(page);
    const shell = page.getByTestId('shell-navigation-resizer');
    await shell.focus();
    await page.keyboard.press('ArrowDown');
    await expect(shell).toHaveAttribute('aria-valuenow', '64');
    await page.getByTestId('rail-resizer').focus();
    await page.keyboard.press('ArrowRight');

    await page.evaluate(() => { window.location.hash = '/settings'; });
    await expect(page.getByTestId('page-settings')).toBeVisible();
    await page.getByRole('option', { name: 'Appearance', exact: true }).click();
    await page.getByTestId('reset-layout').click();
    await expect(shell).toHaveAttribute('aria-valuenow', '48');
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('layout.')))).toEqual([]);

    await page.evaluate(() => { window.location.hash = '/agents'; });
    await expect(page.getByTestId('rail-resizer')).toHaveAttribute('aria-valuenow', '280');
  });

  test('Agents and ListInspector routes both expose named separators', async ({ page }) => {
    await openFixture(page);
    await expect(page.getByRole('separator', { name: 'Resize Agents rail' })).toBeVisible();
    await expect(page.getByRole('separator', { name: 'Resize Inspector' })).toBeVisible();
    await expect(page.getByRole('separator', { name: 'Resize Tools panel' })).toBeVisible();

    await page.evaluate(() => { window.location.hash = '/tools/tasks'; });
    await expect(page.getByRole('separator', { name: 'Resize Scheduled agent jobs list' })).toBeVisible();
  });
});
