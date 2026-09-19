import { expect, test, type Locator, type Page } from '@playwright/test';
import { openFixture, openPage } from './helpers';

async function dragBy(page: Page, splitter: Locator, deltaX: number, deltaY: number) {
  await splitter.scrollIntoViewIfNeeded();
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
    if (sessionStorage.getItem('splitter-tests-initialized') === 'true') return;
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('layout.')) localStorage.removeItem(key);
    }
    sessionStorage.setItem('splitter-tests-initialized', 'true');
  });
});

const routeCoverage = [
  { name: 'Agents', path: '/agents', key: 'layout.agents.rail', orientation: 'vertical' },
  { name: 'Dashboard', path: '/dashboard', key: 'layout.shell.navigation', orientation: 'horizontal' },
  { name: 'Planner week', path: '/planner', key: 'layout.planner.day-1', orientation: 'vertical' },
  { name: 'Tasks list detail', path: '/tasks/task/task-service-handoff', key: 'layout.tasks.detail', orientation: 'vertical' },
  { name: 'Tasks board', path: '/tasks/board', key: 'layout.shell.navigation', orientation: 'horizontal' },
  { name: 'Rhythms', path: '/rhythms', key: 'layout.rhythms.detail', orientation: 'vertical' },
  { name: 'Projects templates', path: '/projects/templates', key: 'layout.list-inspector.projects', orientation: 'vertical' },
  { name: 'Projects instances', path: '/projects/instances', key: 'layout.list-inspector.projects', orientation: 'vertical' },
  { name: 'Messages', path: '/messages', key: 'layout.list-inspector.conversations', orientation: 'vertical' },
  { name: 'Facilities reservations', path: '/facilities', key: 'layout.list-inspector.facility-reservations', orientation: 'vertical' },
  { name: 'Facilities rooms', path: '/facilities/rooms', key: 'layout.list-inspector.facility-rooms', orientation: 'vertical' },
  { name: 'Automations', path: '/automations', key: 'layout.list-inspector.automation-rules', orientation: 'vertical' },
  { name: 'Integrations', path: '/integrations', key: 'layout.list-inspector.integrations', orientation: 'vertical' },
  { name: 'Profiles', path: '/profiles', key: 'layout.profiles.rail', orientation: 'vertical' },
  { name: 'Endpoint Map', path: '/endpoint-map', key: 'layout.shell.navigation', orientation: 'horizontal' },
  { name: 'Hermes', path: '/hermes', key: 'layout.hermes.status-width', orientation: 'vertical' },
  { name: 'Mobile Access', path: '/mobile-access', key: 'layout.shell.navigation', orientation: 'horizontal' },
  { name: 'Settings', path: '/settings', key: 'layout.shell.navigation', orientation: 'horizontal' },
  { name: 'Brain tool', path: '/tools/brain', key: 'layout.list-inspector.agent-memories', orientation: 'vertical' },
  { name: 'Deep Research tool', path: '/tools/deep-research', key: 'layout.list-inspector.research-projects', orientation: 'vertical' },
  { name: 'Tasks tool', path: '/tools/tasks', key: 'layout.list-inspector.scheduled-agent-jobs', orientation: 'vertical' },
  { name: 'Webhooks tool', path: '/tools/webhooks', key: 'layout.list-inspector.webhook-endpoints', orientation: 'vertical' },
  { name: 'Skills tool', path: '/tools/skills', key: 'layout.list-inspector.skills', orientation: 'vertical' },
  { name: 'Playbooks tool', path: '/tools/playbooks', key: 'layout.list-inspector.playbooks', orientation: 'vertical' },
  { name: 'Cookbook tool', path: '/tools/cookbook', key: 'layout.list-inspector.cookbook-recipes', orientation: 'vertical' },
  { name: 'Review Queue tool', path: '/tools/review', key: 'layout.list-inspector.organization-proposals', orientation: 'vertical' },
  { name: 'Report Card tool', path: '/tools/report-card', key: 'layout.list-inspector.agent-report-cards', orientation: 'vertical' },
  { name: 'Email tool', path: '/tools/email', key: 'layout.list-inspector.email-signals', orientation: 'vertical' },
  { name: 'Gallery tool', path: '/tools/gallery', key: 'layout.list-inspector.creative-media-artifacts', orientation: 'vertical' },
  { name: 'Agent Settings tool', path: '/tools/agent-settings', key: 'layout.list-inspector.agent-settings-sections', orientation: 'vertical' },
  { name: 'Unknown route recovery', path: '/missing-route', key: 'layout.shell.navigation', orientation: 'horizontal' },
] as const;

test.describe('shared Splitter', () => {
  for (const route of routeCoverage) {
    test(`${route.name} exposes a bounded separator whose size persists`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openPage(page, route.path);
      const splitter = page.locator(`[role="separator"][data-storage-key="${route.key}"]`).first();
      await expect(splitter).toBeVisible();
      await expect(splitter).toHaveAttribute('aria-orientation', route.orientation);
      const before = Number(await splitter.getAttribute('aria-valuenow'));
      const minimum = Number(await splitter.getAttribute('aria-valuemin'));
      const maximum = Number(await splitter.getAttribute('aria-valuemax'));
      expect(Number.isFinite(before)).toBeTruthy();
      expect(before).toBeGreaterThanOrEqual(minimum);
      expect(before).toBeLessThanOrEqual(maximum);

      await dragBy(page, splitter, route.orientation === 'vertical' ? 32 : 0, route.orientation === 'horizontal' ? 16 : 0);
      const persisted = await page.evaluate((key) => localStorage.getItem(key), route.key);
      expect(persisted).not.toBeNull();
      expect(Number(persisted)).not.toBe(before);

      await page.reload();
      const reopened = page.locator(`[role="separator"][data-storage-key="${route.key}"]`).first();
      await expect(reopened).toBeVisible();
      await expect(reopened).toHaveAttribute('aria-valuenow', persisted!);
    });
  }

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
    await page.evaluate(() => {
      localStorage.setItem('layout.planner.day-1', '200');
      localStorage.setItem('layout.tasks.detail', '432');
      localStorage.setItem('splitter-test.unrelated', 'keep');
    });
    await expect.poll(() => page.evaluate(() => ({
      shell: localStorage.getItem('layout.shell.navigation'),
      rail: localStorage.getItem('layout.agents.rail'),
      planner: localStorage.getItem('layout.planner.day-1'),
      tasks: localStorage.getItem('layout.tasks.detail'),
    }))).toEqual({ shell: '64', rail: '296', planner: '200', tasks: '432' });

    await page.goto('/tests/electron-e40-harness.html#/settings');
    await expect(page.getByTestId('page-settings')).toBeVisible();
    const settingsList = page.getByRole('separator', { name: 'Resize Settings sections list' });
    await settingsList.focus();
    await page.keyboard.press('ArrowRight');
    await expect(settingsList).toHaveAttribute('aria-valuenow', '336');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('layout.list-inspector.settings-sections'))).toBe('336');
    await page.getByTestId('reset-layout').click();
    await expect(settingsList).toHaveAttribute('aria-valuenow', '320');
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('layout.')))).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('splitter-test.unrelated'))).toBe('keep');

    await page.goto('/#/agents');
    await expect(page.getByTestId('shell-navigation-resizer')).toHaveAttribute('aria-valuenow', '48');
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
