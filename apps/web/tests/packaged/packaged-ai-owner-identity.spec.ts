import { readFileSync } from 'node:fs';
import { test, expect, expectedRevision } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';
import { test as unverified } from '@playwright/test';

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[P0] synthetic signed-in identity appears in the shell account and Agents rail';
if (!manifestPath) {
  // No extended fixture here: it would launch the operator's real saved profile before failing.
  unverified(title, () => { throw new Error('UNVERIFIED: explicit disposable synthetic actor manifest required'); });
} else test(title, async ({ page }) => {
  const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
  expect(manifest.syntheticActor).toBeDefined();
  const token = readFileSync(manifest.syntheticActor!.tokenPath, 'utf8');
  const api = await fetch('http://127.0.0.1:4001/auth/me', {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
  });
  expect(api.status).toBe(200);
  const body = await api.json() as { user: { id: number; name: string; email: string } };
  expect(body.user).toMatchObject({ id: manifest.ownerUserId,
    name: manifest.publicUserSeed.name, email: manifest.publicUserSeed.email });
  const nativeIdentity = await page.evaluate(async () => {
    const bridge = (window as unknown as { rhythmShell?: { auth?: { currentSession?: () => Promise<{ user: { id: number; name: string; email: string } } | null> } } }).rhythmShell?.auth;
    const session = await bridge?.currentSession?.();
    return session ? { id: session.user.id, name: session.user.name, email: session.user.email } : null;
  });
  expect(nativeIdentity).toMatchObject({ id: body.user.id, name: body.user.name, email: body.user.email });
  const trigger = page.getByTestId('account-button');
  await expect(trigger).toContainText(body.user.name);
  const initials = (await trigger.locator('.avatar').textContent())?.trim();
  expect(initials).toMatch(/^[A-Z0-9]{1,2}$/);
  expect(initials).not.toBe('AJ');
  await trigger.click();
  await expect(page.locator('.account-card strong')).toHaveText(body.user.name);
  await expect(page.locator('.account-card .avatar')).toHaveText(initials!);
  await expect(page.getByTestId('rail-agent-settings')).toContainText(body.user.name);
  await expect(page.getByTestId('rail-agent-settings').locator('.avatar')).toHaveText(initials!);
  await expect(trigger).not.toContainText('AJ Hochhalter');
  await expect(page.getByTestId('rail-agent-settings')).not.toContainText('AJ Hochhalter');
});
