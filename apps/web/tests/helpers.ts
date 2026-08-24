import { expect, type Page } from '@playwright/test';

export async function openFixture(page: Page, hash = '#/agents') {
  await page.clock.install({ time: new Date('2026-08-12T15:48:00-07:00') });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') await route.continue(); else await route.abort('blockedbyclient');
  });
  await page.goto(`/${hash}`);
  const route = hash.replace(/^#/, '').split('?')[0];
  const fixtureState = new URLSearchParams(hash.split('?')[1] ?? '').get('state');
  const readinessTestId = route === '/profiles'
    ? fixtureState && fixtureState !== 'ready' ? `tool-state-${fixtureState}` : 'profile-create'
    : route === '/endpoint-map'
      ? 'endpoint-table'
      : route.startsWith('/tools/')
        ? `tool-page-${route.split('/')[2]}`
        : route === '/agents' || route === '/'
          ? 'composer-input'
          : 'route-not-found';
  await expect(page.getByTestId(readinessTestId)).toBeVisible();
}

// Page-route entry for the non-Agents destination pages (issues 2001–2009).
// Installs the same deterministic environment as openFixture (fixed clock,
// reduced motion, loopback-only network) but leaves page readiness to the
// caller: contract tests assert their own page behavior so they stay red
// while a route still renders ModulePlaceholder.
export async function openPage(page: Page, path: string, search = '') {
  // Each call is a fresh deep-link document load. Without the blank hop, a second
  // openPage inside one test that changes only the hash/query is a same-document
  // navigation: the page component never remounts and mount-time ?state= reads go stale.
  if (page.url() !== 'about:blank') await page.goto('about:blank');
  await page.clock.install({ time: new Date('2026-08-12T15:48:00-07:00') });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') await route.continue(); else await route.abort('blockedbyclient');
  });
  await page.goto(`/#/${path.replace(/^\/+/, '')}${search}`);
  await expect(page.locator('#main-content')).toBeAttached();
}

export async function chooseDemo(page: Page, state: string) {
  await page.getByTestId('account-button').click();
  await page.getByTestId('demo-states-button').click();
  await page.getByTestId(`demo-${state}`).click();
  await expect(page.getByTestId('toast-status')).toContainText(`Demo state: ${state}`);
}

export async function resetFixtures(page: Page) {
  await page.getByTestId('account-button').click();
  await page.getByTestId('demo-states-button').click();
  await page.getByTestId('fixture-reset').click();
  await expect(page.getByTestId('toast-status')).toContainText('reset');
  await expect(page.getByRole('heading', { name: 'Sunday service handoff' })).toBeVisible();
}
