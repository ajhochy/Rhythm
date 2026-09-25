import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

type Bounds = { height: number; width: number; x: number; y: number };
type Receipt = { action: string; payload?: unknown };
type AttachOutcome =
  | { ok: boolean; reason?: string; version?: string; source?: 'installed' | 'factory'; fallbackReason?: string }
  | 'throw';
type InstallOutcome = { ok: boolean; reason?: string; cancelled?: boolean; version?: string } | 'throw';
type FixtureWindow = Window & {
  __hermesCalls: Receipt[];
  __hermesNativeChildren(): number;
  __resolveHermesAttach?(): void;
};

/**
 * Shell-fixture checks for the renderer-to-preload boundary. Native signed-app
 * tests, rather than these fixtures, prove that the attached child is the real
 * Hermes Desktop renderer.
 */
async function mockHermesDesktop(
  page: Page,
  options: {
    attachOutcomes?: AttachOutcome[];
    attachPending?: boolean;
    enabled?: boolean;
    installOutcomes?: InstallOutcome[];
    missingHost?: boolean;
  } = {},
) {
  await page.addInitScript((options) => {
    const calls: Receipt[] = [];
    const outcomes = options.attachOutcomes?.length ? options.attachOutcomes : [{ ok: true }];
    let attachAttempt = 0;
    let nativeChildren = 0;
    const installOutcomes = options.installOutcomes?.length ? options.installOutcomes : [{ ok: true }];
    let installAttempt = 0;

    let resolvePendingAttach: (() => void) | undefined;
    const pendingAttach = options.attachPending
      ? new Promise<void>((resolve) => { resolvePendingAttach = resolve; })
      : undefined;
    const attach = async () => {
      calls.push({ action: 'attach' });
      await pendingAttach;
      const outcome = outcomes[Math.min(attachAttempt++, outcomes.length - 1)];

      if (outcome === 'throw') {
        throw new Error('fixture attach rejected');
      }
      if (!outcome.ok) {
        return outcome;
      }

      // Rhythm's main process returns the existing attachment after a hash-route
      // remount. The shell must not mint a second child from resize callbacks.
      nativeChildren ||= 1;
      return {
        attachment: 'fixture-native-child',
        ok: true,
        ...(outcome.version ? { version: outcome.version } : {}),
        ...(outcome.source ? { source: outcome.source } : {}),
        ...(outcome.fallbackReason ? { fallbackReason: outcome.fallbackReason } : {}),
      };
    };
    const installUpdate = async () => {
      calls.push({ action: 'install' });
      const outcome = installOutcomes[Math.min(installAttempt++, installOutcomes.length - 1)];
      if (outcome === 'throw') throw new Error('fixture install rejected');
      return outcome;
    };

    Object.assign(window, {
      __hermesCalls: calls,
      __hermesNativeChildren: () => nativeChildren,
      __resolveHermesAttach: () => resolvePendingAttach?.(),
      rhythmShell: {
        hermes: { enabled: options.enabled ?? true },
        ...(options.missingHost
          ? {}
          : {
              hermesView: {
                attach,
                detach: async () => {
                  calls.push({ action: 'detach' });
                  return true;
                },
                sendIntent: async (intent: unknown) => {
                  calls.push({ action: 'intent', payload: intent });
                  return { ok: true };
                },
                setBounds: async (bounds: unknown) => {
                  calls.push({ action: 'bounds', payload: bounds });
                  return true;
                },
                installUpdate,
              },
            }),
      },
    });
  }, options);
}

test('a disabled direct route explains that Hermes is off and never invokes the native host', async ({ page }) => {
  await mockHermesDesktop(page, { enabled: false });
  await openPage(page, '/hermes');

  await expect(page.getByRole('heading', { name: 'Hermes is turned off in this Rhythm build' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Hermes Desktop workspace' })).toHaveCount(0);
  expect(await receipts(page, 'attach')).toEqual([]);

  for (const button of await page.locator('.hermes-state').getByRole('button').all()) {
    if (await button.isVisible()) await button.click();
  }
  expect(await receipts(page, 'attach')).toEqual([]);
});

test('an unresolved native attachment exposes an accessible opening state until it succeeds', async ({ page }) => {
  await mockHermesDesktop(page, { attachPending: true });
  await openPage(page, '/hermes');

  const host = page.getByRole('region', { name: 'Hermes Desktop workspace' });
  const openingStatus = host.getByRole('status');
  await expect(host).toHaveAttribute('aria-busy', 'true');
  await expect(openingStatus).toHaveText('Opening Hermes Desktop…');

  await page.evaluate(() => (window as unknown as FixtureWindow).__resolveHermesAttach?.());
  await expect(host).not.toHaveAttribute('aria-busy', 'true');
  await expect(openingStatus).toHaveCount(0);
});

const receipts = (page: Page, action: string) =>
  page.evaluate(
    (action) => (window as unknown as FixtureWindow).__hermesCalls.filter((call) => call.action === action),
    action,
  );

const nativeChildCount = (page: Page) =>
  page.evaluate(() => (window as unknown as FixtureWindow).__hermesNativeChildren());

async function lastBounds(page: Page): Promise<Bounds | undefined> {
  return (await receipts(page, 'bounds')).at(-1)?.payload as Bounds | undefined;
}

async function expectVisibleBounds(page: Page, host: ReturnType<Page['locator']>, after = 0) {
  await page.clock.runFor(50);
  await expect.poll(async () => (await receipts(page, 'bounds')).length).toBeGreaterThan(after);
  const expected = await host.boundingBox();

  if (!expected) {
    throw new Error('Hermes host did not have a visible layout box.');
  }

  expect(await lastBounds(page)).toEqual(expected);
}

test('browser and disabled-shell routes keep Hermes out of navigation and explain their unavailable state', async ({ page }) => {
  await openPage(page, '/hermes');

  await expect(page.locator('[data-testid="nav-hermes"], [data-testid="nav-hermes-overflow"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Hermes Desktop could not open' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('does not include the Hermes Desktop host');
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.getByRole('alert')).toContainText('does not include the Hermes Desktop host');
  await expect(page.getByText('RHYTHM_HERMES_ENABLED=1', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask Hermes about my dashboard' })).toHaveCount(0);
  await expect(page.getByTestId('page-hermes')).not.toHaveAttribute('data-hermes-state');

  await mockHermesDesktop(page, { enabled: false, missingHost: true });
  await openPage(page, '/hermes');
  await expect(page.locator('[data-testid="nav-hermes"], [data-testid="nav-hermes-overflow"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Hermes is turned off in this Rhythm build' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await receipts(page, 'attach')).toEqual([]);
});

test('the Hermes tab attaches the native Desktop child once and reports the exact visible bounds', async ({ page }) => {
  await mockHermesDesktop(page);
  await openPage(page, '/hermes');

  await expect(page.getByTestId('nav-hermes')).toBeAttached();
  await expect(page.getByRole('region', { name: 'Hermes Desktop workspace' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hermes' })).toHaveCount(0);
  await expect(page.getByText('Your local Hermes workspace.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask Hermes about my dashboard' })).toHaveCount(0);

  const host = page.locator('[data-hermes-host]');
  await expectVisibleBounds(page, host);
  const attachmentsBeforeResize = (await receipts(page, 'attach')).length;
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('scroll'));
  });
  await page.clock.runFor(50);

  expect(await receipts(page, 'attach')).toHaveLength(attachmentsBeforeResize);
  expect(await nativeChildCount(page)).toBe(1);
});

test('1570-e: a fallback attach result states which Hermes version is running and why in a status region', async ({ page }) => {
  await mockHermesDesktop(page, {
    attachOutcomes: [{
      ok: true,
      version: '0.20.5',
      source: 'factory',
      fallbackReason: 'Hermes 0.20.6 failed to start; running the bundled 0.20.5',
    }],
  });
  await openPage(page, '/hermes');

  await expect(page.getByRole('region', { name: 'Hermes Desktop workspace' })).toBeVisible();
  const notice = page.locator('.hermes-fallback-notice');
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(notice).toHaveText('Hermes 0.20.6 failed to start; running the bundled 0.20.5');
});

test('1570-e: a clean attach with no fallback shows no fallback notice', async ({ page }) => {
  await mockHermesDesktop(page, { attachOutcomes: [{ ok: true, version: '0.20.6', source: 'installed' }] });
  await openPage(page, '/hermes');

  await expect(page.getByRole('region', { name: 'Hermes Desktop workspace' })).toBeVisible();
  await expect(page.locator('.hermes-fallback-notice')).toHaveCount(0);
});

test('1570-e: installing a Hermes update opens the native picker via IPC and reports the result; a cancelled dialog changes nothing visible', async ({ page }) => {
  await mockHermesDesktop(page, { installOutcomes: [{ ok: false, cancelled: true }, { ok: true, version: '0.20.7' }] });
  await openPage(page, '/hermes');

  const button = page.getByRole('button', { name: 'Install Hermes update…' });
  await expect(button).toBeVisible();

  await button.click();
  await expect.poll(async () => (await receipts(page, 'install')).length).toBe(1);
  await expect(page.getByText('installed', { exact: false })).toHaveCount(0);

  await button.click();
  await expect(page.getByText('Hermes 0.20.7 installed. It will be used next time Hermes opens.')).toBeVisible();
  expect(await receipts(page, 'install')).toHaveLength(2);
});

test('switching Rhythm tabs hides the child without detaching it and restores the same native child on return', async ({ page }) => {
  await mockHermesDesktop(page);
  await openPage(page, '/hermes');
  const host = page.locator('[data-hermes-host]');

  await expectVisibleBounds(page, host);
  const boundsBeforeHide = (await receipts(page, 'bounds')).length;
  const attachmentsBeforeHide = (await receipts(page, 'attach')).length;
  await page.evaluate(() => {
    window.location.hash = '/tasks';
  });
  await expect(host).toHaveCount(0);
  await expect.poll(async () => await lastBounds(page)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  expect(await receipts(page, 'detach')).toEqual([]);
  expect(await nativeChildCount(page)).toBe(1);

  await page.evaluate(() => {
    window.location.hash = '/hermes';
  });
  await expect(host).toBeVisible();
  await expectVisibleBounds(page, host, boundsBeforeHide);
  expect((await receipts(page, 'attach')).length).toBeGreaterThan(attachmentsBeforeHide);
  expect(await nativeChildCount(page)).toBe(1);
});

test('a rejected attach explains the failure and Retry mounts the Desktop host again', async ({ page }) => {
  await mockHermesDesktop(page, {
    attachOutcomes: [
      { ok: false, reason: 'Pinned Hermes Desktop artifact is missing. Rebuild the Rhythm package.' },
      { ok: false, reason: 'Pinned Hermes Desktop artifact is missing. Rebuild the Rhythm package.' },
      { ok: true },
    ],
  });
  await openPage(page, '/hermes');

  await expect(page.getByRole('heading', { name: 'Hermes Desktop could not open' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Pinned Hermes Desktop artifact is missing');
  const attemptsBeforeRetry = (await receipts(page, 'attach')).length;
  expect(attemptsBeforeRetry).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Hermes Desktop workspace' })).toBeVisible();
  await expectVisibleBounds(page, page.locator('[data-hermes-host]'));
  expect((await receipts(page, 'attach')).length).toBeGreaterThan(attemptsBeforeRetry);
  expect(await nativeChildCount(page)).toBe(1);
});

test('the Desktop host remains keyboard-focusable and accessible at narrow RTL enlarged text', async ({ page }) => {
  await mockHermesDesktop(page);
  await page.setViewportSize({ width: 640, height: 900 });
  await openPage(page, '/hermes');
  const host = page.getByRole('region', { name: 'Hermes Desktop workspace' });

  await expect(host).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
    document.documentElement.style.fontSize = '200%';
    document.getElementById('main-content')?.focus();
  });
  await page.keyboard.press('Tab');
  await expect(host).toBeFocused();

  const result = await new AxeBuilder({ page }).include('.hermes-page').analyze();
  expect(result.violations).toEqual([]);
  const widths = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
});
