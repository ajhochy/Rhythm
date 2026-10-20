import { readFileSync } from 'node:fs';
import { test as unverified } from '@playwright/test';
import { test, expect, expectedRevision } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';

const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI tools] private owner pins Dayflow, reloads, and resets only its preference';

if (!manifestPath) {
  unverified(title, () => { throw new Error('UNVERIFIED: explicit disposable synthetic actor manifest required'); });
} else test(title, async ({ page }) => {
  const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
  expect(manifest.syntheticActor, 'pin writes require the private synthetic actor').toBeDefined();
  const token = readFileSync(manifest.syntheticActor.tokenPath, 'utf8');
  const auth = await fetch('http://127.0.0.1:4001/auth/me', {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
  });
  expect(auth.status).toBe(200);
  const me = await auth.json() as { user: { id: number; email: string } };
  expect(me.user).toMatchObject({ id: manifest.ownerUserId, email: manifest.publicUserSeed.email });
  const key = `rhythm.agent-tools.pins.${me.user.id}`;
  let original: string | null | undefined;
  let toggled: string | null | undefined;
  const readKey = () => page.evaluate((name) => window.localStorage.getItem(name), key);
  const navCount = async () => await page.getByTestId('nav-dayflow').count()
    + await page.getByTestId('nav-dayflow-overflow').count();
  try {
    await page.goto('rhythm://app/index.html#/tools/agent-tools');
    await expect(page.getByTestId('agent-tools-catalog')).toBeVisible();
    const native = await page.evaluate(async () => await (window as unknown as {
      rhythmShell?: { auth?: { currentSession?: () => Promise<{ user: { id: number } } | null> } }
    }).rhythmShell?.auth?.currentSession?.());
    expect(native?.user.id).toBe(me.user.id);
    original = await readKey();
    const pin = page.getByTestId('agent-tool-pin-dayflow');
    const wasPinned = await pin.isChecked();
    await pin.click();
    await expect(pin).toBeChecked({ checked: !wasPinned });
    toggled = await readKey();
    expect(toggled).not.toBe(original);
    expect(Array.isArray(JSON.parse(toggled!))).toBe(true);
    expect((JSON.parse(toggled!) as string[]).includes('dayflow')).toBe(!wasPinned);
    expect(await navCount()).toBe(wasPinned ? 0 : 1);

    await page.reload();
    await expect(page.getByTestId('agent-tools-catalog')).toBeVisible();
    expect(await readKey()).toBe(toggled);
    await expect(page.getByTestId('agent-tool-pin-dayflow')).toBeChecked({ checked: !wasPinned });
    expect(await navCount()).toBe(wasPinned ? 0 : 1);

    await page.getByTestId('agent-tools-reset-pins').click();
    expect(await readKey()).toBeNull();
    await expect(page.getByTestId('agent-tool-pin-dayflow')).not.toBeChecked();
    expect(await navCount()).toBe(0);
  } finally {
    if (original !== undefined && page.url().startsWith('rhythm://app/')) {
      const current = await readKey();
      expect([original, toggled, null], 'refuse to replace a preference changed outside this case').toContain(current);
      await page.evaluate(({ name, value }) => {
        if (value === null) window.localStorage.removeItem(name);
        else window.localStorage.setItem(name, value);
        window.dispatchEvent(new CustomEvent('rhythm:agent-tool-pins-changed', { detail: { key: name } }));
      }, { name: key, value: original });
      expect(await readKey()).toBe(original);
    }
  }
});
