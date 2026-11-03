import { test, expect } from '@playwright/test';
import { OwnedWebApprovals } from './owned-web-approval-fixture';

test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires an explicit disposable synthetic sandbox');

test('#55: browser owner pins Cookbook, reloads, and resets only its preference', async ({ page }) => {
  const sandbox = new OwnedWebApprovals();
  const owner = (await sandbox.bootstrap()).owner;
  const key = `rhythm.agent-tools.pins.${owner.id}`;
  let original: string | null | undefined;
  let toggled: string | null | undefined;
  const read = () => page.evaluate(name => localStorage.getItem(name), key);
  const navCount = async () => await page.getByTestId('nav-cookbook').count() + await page.getByTestId('nav-cookbook-overflow').count();
  try {
    await page.goto('/#/tools/agent-tools');
    await expect(page.getByTestId('agent-tools-catalog')).toBeVisible();
    original = await read();
    const foreignKey = `rhythm.agent-tools.pins.${owner.id + 1}`;
    const foreign = await page.evaluate(name => localStorage.getItem(name), foreignKey);
    const pin = page.getByTestId('agent-tool-pin-cookbook');
    await expect(pin).toBeVisible();
    const wasPinned = await pin.isChecked();
    await pin.click();
    await expect(pin).toBeChecked({ checked: !wasPinned });
    toggled = await read();
    expect(toggled).not.toBe(original);
    expect(Array.isArray(JSON.parse(toggled!))).toBe(true);
    expect(JSON.parse(toggled!).includes('cookbook')).toBe(!wasPinned);
    expect(await navCount()).toBe(wasPinned ? 0 : 1);
    await page.reload();
    await expect(page.getByTestId('agent-tools-catalog')).toBeVisible();
    expect(await read()).toBe(toggled);
    await expect(page.getByTestId('agent-tool-pin-cookbook')).toBeChecked({ checked: !wasPinned });
    expect(await navCount()).toBe(wasPinned ? 0 : 1);
    await page.getByTestId('agent-tools-reset-pins').click();
    expect(await read()).toBeNull();
    await expect(page.getByTestId('agent-tool-pin-cookbook')).not.toBeChecked();
    expect(await navCount()).toBe(0);
    expect(await page.evaluate(name => localStorage.getItem(name), foreignKey)).toBe(foreign);
    expect((await sandbox.bootstrap()).owner.id).toBe(owner.id);
  } finally {
    try {
      if (original !== undefined && page.url().startsWith(sandbox.origin)) {
        expect([original, toggled, null]).toContain(await read());
        await page.evaluate(({ name, value }) => {
          if (value === null) localStorage.removeItem(name); else localStorage.setItem(name, value);
          window.dispatchEvent(new CustomEvent('rhythm:agent-tool-pins-changed', { detail: { key: name } }));
        }, { name: key, value: original });
        expect(await read()).toBe(original);
      }
    } finally { await sandbox.cleanup(); }
  }
});
