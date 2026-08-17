import { expect, test } from '@playwright/test';
import { openPage } from './helpers';

// post-m1-p9-c1b (fixture half): canonical desktop access states, bounded diagnostics, and the
// pairing QR/device-inventory lifecycle built on top of them. Fixture mode drives the state machine
// entirely client-side (no network), so these assert against `data-access-state` — the canonical
// wire value (apps/api_server/src/services/tailscale_serve_service.ts:8-13) — never display copy.

test('post-m1-p9-c1b: React Mobile Access exposes missing/loggedOut/wrongTarget/healthy as distinct canonical states, not display strings', async ({ page }) => {
  await openPage(page, 'mobile-access', '?scenario=missing');
  await expect(page.getByTestId('mobile-access-diagnostic')).toHaveAttribute('data-access-state', 'missing');
  await expect(page.getByTestId('mobile-access-message')).toHaveText('Tailscale is not installed on this Mac.');
  await expect(page.getByTestId('mobile-access-enable')).toHaveCount(0);
  await expect(page.getByTestId('mobile-access-gateway-url')).toHaveCount(0);

  await openPage(page, 'mobile-access', '?scenario=loggedOut');
  await expect(page.getByTestId('mobile-access-diagnostic')).toHaveAttribute('data-access-state', 'loggedOut');
  await expect(page.getByTestId('mobile-access-enable')).toHaveCount(0);

  await openPage(page, 'mobile-access', '?scenario=wrongTarget');
  await expect(page.getByTestId('mobile-access-diagnostic')).toHaveAttribute('data-access-state', 'wrongTarget');
  await expect(page.getByTestId('mobile-access-gateway-url')).toBeVisible();
  await expect(page.getByTestId('mobile-access-enable')).toBeVisible();
  await expect(page.getByTestId('mobile-access-pairing')).toHaveCount(0);

  await page.getByTestId('mobile-access-enable').click();
  await expect(page.getByTestId('mobile-access-diagnostic')).toHaveAttribute('data-access-state', 'healthy');
  await expect(page.getByTestId('mobile-access-pairing')).toBeVisible();

  await openPage(page, 'mobile-access', '?scenario=healthy');
  await expect(page.getByTestId('mobile-access-diagnostic')).toHaveAttribute('data-access-state', 'healthy');
  await expect(page.getByTestId('mobile-access-enable')).toHaveCount(0);
});

test('post-m1-p9-c1c: pairing QR carries exactly gatewayUrl/pairingCode, expires, and regenerates a distinct one-time code', async ({ page }) => {
  await openPage(page, 'mobile-access', '?scenario=healthy');
  await page.getByTestId('mobile-access-generate-pairing').click();

  const firstPayload = await page.getByTestId('mobile-access-pairing-payload').textContent();
  const parsedFirst = JSON.parse(firstPayload ?? '{}');
  expect(Object.keys(parsedFirst).sort()).toEqual(['gatewayUrl', 'pairingCode']);
  expect(parsedFirst.gatewayUrl).toBe('https://fixture-mac.example.ts.net');
  expect(typeof parsedFirst.pairingCode).toBe('string');
  await expect(page.getByTestId('mobile-access-pairing-countdown')).toContainText('Expires in');

  await page.getByTestId('mobile-access-regenerate-pairing').click();
  const secondPayload = await page.getByTestId('mobile-access-pairing-payload').textContent();
  const parsedSecond = JSON.parse(secondPayload ?? '{}');
  expect(parsedSecond.pairingCode).not.toBe(parsedFirst.pairingCode);

  // Expiry: fast-forward the fake clock installed by openPage past the fixture TTL.
  await page.clock.fastForward(5_000);
  await expect(page.getByTestId('mobile-access-pairing-expired')).toBeVisible();
  await expect(page.getByTestId('mobile-access-pairing-offer')).toHaveCount(0);
  await page.getByTestId('mobile-access-pairing-dismiss').click();
  await expect(page.getByTestId('mobile-access-pairing-expired')).toHaveCount(0);
  await expect(page.getByTestId('mobile-access-generate-pairing')).toBeVisible();
});

test('post-m1-p9-c1c: a consumed pairing code dismisses the offer and the new device appears in the paired-device list', async ({ page }) => {
  await openPage(page, 'mobile-access', '?scenario=healthy');
  await expect(page.getByTestId('mobile-access-devices')).toContainText("AJ's iPhone");
  const before = await page.getByTestId('mobile-access-devices').locator('li').count();

  await page.getByTestId('mobile-access-generate-pairing').click();
  await page.getByTestId('mobile-access-fixture-simulate-pair').click();

  await expect(page.getByTestId('mobile-access-pairing-consumed')).toBeVisible();
  await expect(page.getByTestId('mobile-access-pairing-offer')).toHaveCount(0);
  await expect(page.getByTestId('mobile-access-devices').locator('li')).toHaveCount(before + 1);
  await page.getByTestId('mobile-access-pairing-dismiss').click();
  await expect(page.getByTestId('mobile-access-generate-pairing')).toBeVisible();
});

test('post-m1-p9-c1e: desktop lists paired devices with id/name/createdAt/revokedAt and revoke retires one without touching the others', async ({ page }) => {
  await openPage(page, 'mobile-access', '?scenario=healthy');
  const seed = page.getByTestId('mobile-access-device-fixture-device-seed-1');
  await expect(seed).toBeVisible();
  await expect(seed).toContainText("AJ's iPhone");
  await expect(page.getByTestId('mobile-access-device-created-fixture-device-seed-1')).toHaveText('2026-08-10T12:00:00.000Z');
  await expect(page.getByTestId('mobile-access-device-revoked-fixture-device-seed-1')).toHaveCount(0);

  await page.getByTestId('mobile-access-device-revoke-fixture-device-seed-1').click();
  await expect(page.getByTestId('mobile-access-device-revoked-fixture-device-seed-1')).toBeVisible();
  await expect(page.getByTestId('mobile-access-device-revoke-fixture-device-seed-1')).toHaveCount(0);
});
