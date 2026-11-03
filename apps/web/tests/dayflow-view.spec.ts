import { expect, test, type Page } from '@playwright/test';

const calls = (page: Page) => page.evaluate(() => (window as typeof window & { __dayflowView: string[] }).__dayflowView);

test('native Dayflow has no outer header or footer and fills the available height on resize', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto('/tests/dayflow-view-harness.html');
  const host = page.getByTestId('dayflow-native-host');
  await expect(host).toHaveAttribute('data-phase', 'attached');
  await expect.poll(async () => (await calls(page)).includes('blocked:false')).toBe(true);
  const boundsMatchHost = async () => page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-testid="dayflow-native-host"]')!;
    const bounds = (window as typeof window & { __getDayflowLastBounds(): { x: number; y: number; width: number; height: number } | null }).__getDayflowLastBounds();
    if (!bounds) return false;
    const rect = host.getBoundingClientRect();
    return Math.abs(bounds.x - rect.x) < 0.5 && Math.abs(bounds.y - rect.y) < 0.5 &&
      Math.abs(bounds.width - rect.width) < 0.5 && Math.abs(bounds.height - rect.height) < 0.5;
  });
  await expect.poll(boundsMatchHost).toBe(true);
  const shortHeight = await host.evaluate((node) => node.getBoundingClientRect().height);
  const readGeometry = () => page.evaluate(() => {
    const rect = document.querySelector<HTMLElement>('[data-testid="dayflow-native-host"]')!.getBoundingClientRect();
    const native = (window as typeof window & { __getDayflowLastBounds(): { x: number; y: number; width: number; height: number } | null }).__getDayflowLastBounds();
    return { host: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, native };
  });
  const shortGeometry = await readGeometry();

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(async () => await host.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(shortHeight + 100);
  await expect.poll(boundsMatchHost).toBe(true);
  const tallGeometry = await readGeometry();
  console.info(`Dayflow view geometry at 1280px wide: ${JSON.stringify({ viewportHeight: 560, ...shortGeometry })} -> ${JSON.stringify({ viewportHeight: 900, ...tallGeometry })}`);

  const workspace = page.getByTestId('tool-page-dayflow');
  await expect(workspace.locator('header, .dayflow-workspace-footer')).toHaveCount(0);
  await expect(workspace.getByRole('heading', { name: 'Dayflow', exact: true })).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: 'Dayflow Settings', exact: true })).toHaveCount(0);
  await expect(workspace.getByText('The original Dayflow screens appear below.')).toHaveCount(0);
  await expect(workspace.getByText(/Bridge import state is managed separately/)).toHaveCount(0);

  for (const height of [300, 480, 560, 900]) {
    await page.setViewportSize({ width: 1280, height });
    await expect.poll(boundsMatchHost).toBe(true);
    await expect.poll(() => workspace.evaluate((node) => {
      const body = node.querySelector<HTMLElement>('.dayflow-workspace-body')!;
      const host = node.querySelector<HTMLElement>('[data-testid="dayflow-native-host"]')!;
      const workspaceRect = node.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const style = getComputedStyle(body);
      const contentHeight = body.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      return Math.abs(bodyRect.height - workspaceRect.height) < 0.5 &&
        Math.abs(hostRect.height - contentHeight) < 0.5 && hostRect.height > 0 &&
        hostRect.top >= workspaceRect.top && hostRect.bottom <= workspaceRect.bottom &&
        body.scrollHeight === body.clientHeight;
    })).toBe(true);
  }
});

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
