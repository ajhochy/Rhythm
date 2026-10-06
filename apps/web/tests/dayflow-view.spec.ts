import { expect, test, type Page } from '@playwright/test';

const calls = (page: Page) => page.evaluate(() => (window as typeof window & { __dayflowView: string[] }).__dayflowView);

test('attaches hidden, sends positive bounds, then unblocks; never uses the external opener', async ({ page }) => {
  await page.goto('/tests/dayflow-view-harness.html');
  await expect(page.getByTestId('dayflow-native-host')).toHaveAttribute('data-phase', 'attached');
  await expect.poll(async () => (await calls(page)).includes('blocked:false')).toBe(true);
  const seen = await calls(page);
  expect(seen.slice(0, 2)).toEqual(['status', 'attach']);
  const bounds = seen.find((entry) => entry.startsWith('bounds:'))!;
  const rect = JSON.parse(bounds.slice('bounds:'.length));
  expect(Object.keys(rect).sort()).toEqual(['height', 'width', 'x', 'y']);
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(seen.indexOf(bounds)).toBeLessThan(seen.indexOf('blocked:false'));
  expect(seen.some((entry) => entry.startsWith('legacy-'))).toBe(false);
  await expect(page.getByRole('button', { name: /Open Dayflow/ })).toHaveCount(0);
});

test('a blocking modal hides the native view and closing it restores it', async ({ page }) => {
  await page.goto('/tests/dayflow-view-harness.html');
  await expect.poll(async () => (await calls(page)).includes('blocked:false')).toBe(true);
  await page.evaluate(() => (window as typeof window & { __setModal(open: boolean): void }).__setModal(true));
  await expect.poll(async () => (await calls(page)).at(-1)).toBe('blocked:true');
  await page.evaluate(() => (window as typeof window & { __setModal(open: boolean): void }).__setModal(false));
  await expect.poll(async () => (await calls(page)).at(-1)).toBe('blocked:false');
});

for (const mode of ['malformed', 'denied', 'status-unavailable', 'status-malformed', 'none']) {
  test(`${mode} bridge result is an honest unavailable state with no layout calls or external fallback`, async ({ page }) => {
    await page.goto(`/tests/dayflow-view-harness.html?mode=${mode}`);
    await expect(page.getByTestId('dayflow-native-host')).toHaveAttribute('data-phase', 'unavailable');
    await expect(page.getByText('Dayflow is unavailable here right now.')).toBeVisible();
    await expect(page.getByText('leaked-lease')).toHaveCount(0);
    const seen = await calls(page);
    expect(seen.some((entry) => entry.startsWith('bounds:') || entry.startsWith('legacy-'))).toBe(false);
  });
}

test('unmount blocks then detaches', async ({ page }) => {
  await page.goto('/tests/dayflow-view-harness.html');
  await expect.poll(async () => (await calls(page)).includes('blocked:false')).toBe(true);
  await page.evaluate(() => (window as typeof window & { __unmount(): void }).__unmount());
  await expect.poll(async () => (await calls(page)).slice(-2)).toEqual(['blocked:true', 'detach']);
});

test('a late attach after unmount sends no bounds and is not revived', async ({ page }) => {
  await page.goto('/tests/dayflow-view-harness.html?mode=late-attach');
  await page.waitForTimeout(300);
  const seen = await calls(page);
  expect(seen.slice(-2)).toEqual(['blocked:true', 'detach']);
  expect(seen.some((entry) => entry.startsWith('bounds:') || entry === 'blocked:false')).toBe(false);
});
