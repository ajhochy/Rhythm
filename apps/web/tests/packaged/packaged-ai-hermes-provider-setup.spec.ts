import type { Page } from '@playwright/test';
import { test as unverified } from '@playwright/test';
import { test as base, expect, expectedRevision } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI Hermes] private bundled native provider setup cards match backend fields';

const test = base.extend<{ guestAudit: string[] }>({
  guestAudit: [async ({ page }, use) => {
    const errors: string[] = [];
    const observed = new Map<Page, (error: Error) => void>();
    const browser = page.context().browser()!;
    const observe = (candidate: Page) => {
      if (observed.has(candidate)) return;
      const listener = (error: Error) => {
        if (candidate.url().includes('/hermes-desktop/renderer/index.html')) errors.push(error.message);
      };
      observed.set(candidate, listener);
      candidate.on('pageerror', listener);
    };
    browser.contexts().forEach(context => { context.pages().forEach(observe); context.on('page', observe); });
    try { await use(errors); } finally {
      browser.contexts().forEach(context => context.off('page', observe));
      observed.forEach((listener, candidate) => candidate.off('pageerror', listener));
      expect(errors, 'uncaught error in the actual Hermes renderer').toEqual([]);
    }
  }, { auto: true }],
});

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: explicit disposable synthetic actor manifest required'); });
} else {
  test(title, async ({ page }) => {
    const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
    expect(manifest.syntheticActor).toBeDefined();
    await page.goto('rhythm://app/index.html#/hermes');
    const findGuests = () => page.context().browser()!.contexts().flatMap(context => context.pages()).filter(candidate => {
      const url = new URL(candidate.url());
      return url.protocol === 'file:' && url.pathname.endsWith('/hermes-desktop/renderer/index.html')
        && url.searchParams.get('embedded') === '1';
    });
    await expect.poll(() => findGuests().length, { timeout: 60_000,
      message: 'the pinned Hermes Desktop guest did not attach' }).toBe(1);
    const desktop = findGuests()[0];
    await expect(desktop.getByRole('button', { name: /^Gateway needs setup$/ })).toBeVisible({ timeout: 60_000 });
    const onboarding = desktop.getByRole('heading', { name: "Let's get you setup with Hermes Agent" });
    if (await onboarding.isVisible()) {
      await desktop.getByRole('button', { name: "I'll choose a provider later" }).click();
      await expect(onboarding).toBeHidden();
    }

    // The guest bridge reaches the real private Python backend. Keep values out
    // of Playwright results: only exact setup-field membership and set state.
    const fields = await desktop.evaluate(async () => {
      const vars = await (window as any).hermesDesktop.api({ path: '/api/env' });
      return Object.fromEntries(['ANTHROPIC_API_KEY', 'AWS_REGION', 'AWS_PROFILE',
        'VERTEX_CREDENTIALS_PATH', 'AZURE_FOUNDRY_API_KEY'].map(name => [name, {
        present: Object.hasOwn(vars, name),
        providerTagged: typeof vars[name]?.provider === 'string' && vars[name].provider.length > 0,
        isSet: Boolean(vars[name]?.is_set),
      }]));
    }) as Record<string, { present: boolean; providerTagged: boolean; isSet: boolean }>;
    for (const [name, field] of Object.entries(fields)) {
      expect(field.present, `${name} missing from the actual backend env catalog`).toBe(true);
      expect(field.providerTagged, `${name} lacks a provider tag`).toBe(true);
      expect(field.isSet, `${name} unexpectedly set in the private fixture`).toBe(false);
    }

    await desktop.evaluate(() => { window.location.hash = '#/settings?tab=providers&pview=keys'; });
    for (const label of ['Anthropic', 'AWS Bedrock', 'Google Vertex AI', 'Azure Foundry']) {
      await expect(desktop.getByText(label, { exact: true }), `${label} setup card is hidden`).toBeVisible();
    }
    await expect(desktop.getByPlaceholder(/AWS region/i)).toBeVisible();
    await expect(desktop.getByRole('textbox', { name: /^Path to a Google Cloud service account JSON for Vertex AI/ })).toBeVisible();
    await expect(desktop.getByText('No provider API keys available.', { exact: true })).toBeHidden();
  });
}
