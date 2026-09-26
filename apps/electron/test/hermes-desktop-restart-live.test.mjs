// Two-phase native restart proof. The parent owns quit/relaunch between phases.
// Both phases attach to a verified candidate PID; no stored state is injected.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from '../../web/node_modules/playwright/index.mjs';

const live = process.env.RHYTHM_LIVE_E2E === '1' && Boolean(process.env.RHYTHM_HERMES_RESTART_PHASE);

test('issue-1542-desktop-c3: a real unsent draft survives a full signed-app restart', { skip: !live, timeout: 100_000 }, async () => {
  const phase = process.env.RHYTHM_HERMES_RESTART_PHASE;
  assert.ok(phase === 'prepare' || phase === 'verify');
  const userData = process.env.RHYTHM_LIVE_ELECTRON_USER_DATA;
  const pid = Number(process.env.RHYTHM_LIVE_ELECTRON_PID);
  assert.ok(userData && Number.isSafeInteger(pid) && pid > 0);
  const receiptFile = process.env.RHYTHM_HERMES_RESTART_RECEIPT;
  assert.ok(receiptFile, 'Provide a parent-owned receipt path');
  const [port] = (await readFile(resolve(userData, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
  assert.match(port, /^\d+$/);
  const listener = execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim();
  assert.equal(listener, String(pid), 'Attach only to the parent-owned native candidate');
  const executable = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim();
  assert.match(executable, /\/Contents\/MacOS\/Rhythm$/);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const context = browser.contexts()[0];
    const host = context.pages().find(page => /^rhythm:\/\/app\/index\.html/.test(page.url()));
    assert.ok(host);
    await host.locator('#main-content').waitFor({ state: 'visible', timeout: 30_000 });
    if (!host.url().endsWith('#/hermes')) {
      await host.getByTestId('nav-more').click();
      await host.getByRole('menuitem', { name: 'Hermes', exact: true }).click();
    }
    let desktop;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      desktop = context.pages().find(page => page.url().startsWith('file:') && page.url().includes('/renderer/index.html?embedded=1'));
      if (desktop) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(desktop, 'Actual packaged Hermes Desktop must mount');
    await desktop.getByRole('button', { name: /^Gateway ready$/ }).waitFor({ state: 'visible', timeout: 60_000 });
    const composer = desktop.locator('[contenteditable="true"]').first();
    if (phase === 'prepare') {
      await desktop.getByRole('button', { name: /^New session/ }).first().click();
      await composer.waitFor({ state: 'visible' });
      assert.equal((await composer.innerText()).trim(), '', 'Never replace an existing user draft');
      const draft = `Unsent full restart proof ${Date.now()}`;
      await composer.click();
      await desktop.keyboard.type(draft);
      assert.equal(await composer.innerText(), draft);
      // Read-only confirmation that the real input handler has saved this draft,
      // rather than quitting before its normal debounce has completed.
      await desktop.waitForFunction(expected => Object.keys(localStorage).some(key => localStorage.getItem(key)?.includes(expected)), draft);
      await mkdir(dirname(receiptFile), { recursive: true });
      await writeFile(receiptFile, JSON.stringify({ draft, pid, executable, userData }));
      await desktop.screenshot({ path: `${receiptFile}.before.png` });
    } else {
      const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
      assert.notEqual(pid, receipt.pid, 'Verification requires a different app process after quit/relaunch');
      assert.equal(executable, receipt.executable);
      assert.equal(userData, receipt.userData);
      await desktop.waitForFunction(expected => document.querySelector('[contenteditable="true"]')?.textContent === expected, receipt.draft);
      assert.equal(await composer.innerText(), receipt.draft, 'The actual visible composer must restore the unsent draft');
      await desktop.screenshot({ path: `${receiptFile}.after.png` });
      await composer.click();
      await desktop.keyboard.press('Meta+A');
      await desktop.keyboard.press('Backspace');
      assert.equal((await composer.innerText()).trim(), '');
      await desktop.waitForFunction(expected => !Object.keys(localStorage).some(key => localStorage.getItem(key)?.includes(expected)), receipt.draft);
    }
  } finally {
    await browser.close();
  }
});
