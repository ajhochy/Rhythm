// Real installed Electron smoke. No routed HTTP, fake preload or fixture renderer.
// Parent launches the candidate with --remote-debugging-port=0 and provides its
// PID/userData. Only the owned candidate is attached. No chat is submitted.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from '../../web/node_modules/playwright/index.mjs';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const outputDir = resolve(process.env.RHYTHM_HERMES_SMOKE_EVIDENCE ?? '/tmp/rhythm-hermes-desktop-smoke');
let browser, host, desktop, desktopNetwork, nativePid;
const rendererErrors = [];
const chatWrites = [];
const watchedPages = new WeakSet();
let originalDraft = '';
const draft = `Unsent Hermes Desktop embedding check ${Date.now()}`;

function captureNativeWindow(name) {
  const script = `import CoreGraphics
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
for window in windows {
  if window[kCGWindowOwnerPID as String] as? Int == ${nativePid},
     window[kCGWindowLayer as String] as? Int == 0,
     let number = window[kCGWindowNumber as String] as? Int {
    print(number)
  }
}`;
  const ids = execFileSync('/usr/bin/swift', ['-e', script], { encoding: 'utf8', timeout: 20_000 }).trim().split('\n').filter(Boolean);
  assert.equal(ids.length, 1, 'Exactly one visible candidate window must exist for native visual proof');
  execFileSync('/usr/sbin/screencapture', ['-x', '-l', ids[0], resolve(outputDir, name)], { timeout: 10_000 });
}

before(async () => {
  if (!live) return;
  const userData = process.env.RHYTHM_LIVE_ELECTRON_USER_DATA;
  const pid = Number(process.env.RHYTHM_LIVE_ELECTRON_PID);
  assert.ok(userData && Number.isSafeInteger(pid) && pid > 0, 'Provide parent-owned candidate PID and userData');
  nativePid = pid;
  const [port] = (await readFile(resolve(userData, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
  assert.match(port, /^\d+$/);
  const listeners = execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim();
  assert.equal(listeners, String(pid), 'CDP must belong to the parent-launched candidate');
  const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim();
  assert.match(command, /\/Contents\/MacOS\/(Rhythm|Electron)$/, 'Expected an actual Electron native executable');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15_000 });
  const context = browser.contexts()[0];
  const observe = page => {
    if (watchedPages.has(page)) return;
    watchedPages.add(page);
    const isDesktop = () => page.url().includes('/renderer/index.html');
    page.on('pageerror', error => { if (isDesktop()) rendererErrors.push(error.message); });
    page.on('console', message => { if (isDesktop() && message.type() === 'error') rendererErrors.push(`${message.text()} (${message.location().url?.split('?')[0] ?? ''})`); });
  };
  context.on('page', observe);
  context.pages().forEach(observe);
  const candidates = context.pages().filter(page => /^rhythm:\/\/app\/index\.html/.test(page.url()));
  assert.equal(candidates.length, 1, 'Expected exactly one actual Rhythm host renderer');
  host = candidates[0];
  host.setDefaultTimeout(15_000);
  await host.locator('#main-content').waitFor({ state: 'visible' });
  if (!host.url().endsWith('#/hermes')) {
    await host.getByTestId('nav-more').click();
    await host.getByRole('menuitem', { name: 'Hermes', exact: true }).click();
  }
  // Dashboard substitution must fail: the correct child loads bundled Desktop
  // HTML and its typed native preload, never a loopback dashboard page.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    desktop = context.pages().find(page => {
      try { const url = new URL(page.url()); return url.protocol === 'file:' && url.pathname.endsWith('/renderer/index.html') && url.searchParams.get('embedded') === '1'; }
      catch { return false; }
    });
    if (desktop) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(desktop, 'The Hermes tab must contain the real packaged Desktop renderer');
  desktop.setDefaultTimeout(20_000);
  observe(desktop);
  desktopNetwork = await context.newCDPSession(desktop);
  await desktopNetwork.send('Network.enable');
  desktopNetwork.on('Network.webSocketFrameSent', frame => {
    try {
      const packet = JSON.parse(frame.response.payloadData);
      if (/^(?:prompt\.submit|chat\.send|session\.(?:send|create)|message\.send)$/.test(packet.method ?? '')) chatWrites.push(packet.method);
    } catch { /* Binary frames do not carry gateway JSON requests. */ }
  });
  await mkdir(outputDir, { recursive: true });
}, { timeout: 100_000 });

test('issue-1542-desktop-c7: signed Rhythm restores its login, signer and local runtime', { skip: !live, timeout: 30_000 }, async () => {
  const receipt = await host.evaluate(async () => {
    const session = await window.rhythmShell.auth.currentSession();
    const capability = await window.rhythmShell.humanApproval.capability();
    const runtime = await window.rhythmShell.agentServer.status();
    // Never send credentials, capability bytes or user details to test output.
    return { authenticated: Boolean(session?.sessionToken && session?.user), signerReady: typeof capability === 'string' && capability.length > 20, status: runtime.status, failureReason: runtime.failureReason };
  });
  assert.equal(receipt.authenticated, true);
  assert.equal(receipt.signerReady, true);
  assert.equal(receipt.status, 'ready');
  assert.equal(receipt.failureReason, null);
});

test('issue-1542-desktop-c2: real Desktop sidebar and native connection are usable', { skip: !live, timeout: 90_000 }, async () => {
  const region = await host.getByRole('region', { name: 'Hermes Desktop workspace' }).boundingBox();
  assert.ok(region && region.width >= 300 && region.height >= 300, 'Rhythm must allocate a usable visible region to actual Desktop');
  assert.equal(await host.getByRole('heading', { name: 'Hermes', exact: true }).count(), 0, 'The redundant outer Hermes header must be removed');
  assert.equal(await host.getByRole('button', { name: 'Ask Hermes about my dashboard', exact: true }).count(), 0);
  await desktop.getByRole('textbox', { name: 'Search sessions' }).waitFor({ state: 'visible', timeout: 60_000 });
  assert.ok(await desktop.getByRole('button', { name: /^New session/ }).first().isVisible());
  assert.ok(await desktop.getByRole('button', { name: 'Open settings', exact: true }).isVisible());
  await desktop.getByRole('button', { name: 'Profiles', exact: true }).waitFor({ state: 'visible', timeout: 60_000 });
  await desktop.getByRole('button', { name: /^Gateway ready$/ }).waitFor({ state: 'visible', timeout: 60_000 });
  assert.ok(await desktop.getByRole('button', { name: 'Profiles', exact: true }).isVisible());
  const connection = await desktop.evaluate(async () => {
    const bridge = window.hermesDesktop;
    if (!bridge) return null;
    const result = await bridge.getConnection();
    // Deliberately do not return credentials or the authenticated WebSocket URL.
    return { hasApi: typeof bridge.api === 'function', mode: result?.mode, hasBaseUrl: typeof result?.baseUrl === 'string' };
  });
  assert.ok(connection, 'Real Hermes Desktop preload must be available');
  assert.equal(connection.hasApi, true, 'Desktop API bridge must be live');
  assert.equal(connection.hasBaseUrl, true, 'Desktop must resolve a real gateway connection');
  await desktop.screenshot({ path: resolve(outputDir, 'desktop-in-rhythm.png') });
  captureNativeWindow('native-desktop-in-rhythm.png');
  assert.deepEqual(rendererErrors, [], 'Desktop must not report renderer/IPC errors');
});

test('issue-1542-desktop-c10: actual saved history opens through the Desktop sidebar', { skip: !live, timeout: 60_000 }, async () => {
  const allProjects = desktop.getByRole('button', { name: 'All projects', exact: true });
  if (await allProjects.isVisible()) await allProjects.click();
  const sessions = await desktop.evaluate(async () => {
    const data = await window.hermesDesktop.api({ path: '/api/sessions?limit=20&min_messages=2&archived=exclude' });
    return data.sessions.map(({ id, title }) => ({ id, title })).filter(row => row.title && row.title !== 'Run native embedding rhythm smoke test');
  });
  assert.ok(sessions.length > 0, 'The real configured Hermes workspace must return saved conversations');
  let opened = false;
  for (const session of sessions) {
    const row = desktop.getByText(session.title, { exact: true }).first();
    if (!await row.isVisible()) continue;
    await row.click();
    await desktop.locator('[data-role="user"], [data-role="assistant"]').first().waitFor({ state: 'visible' });
    opened = true;
    break;
  }
  assert.equal(opened, true, 'At least one actual saved conversation must open and display its transcript');
  assert.deepEqual(chatWrites, [], 'Reading existing history must not submit a message');
  await desktop.screenshot({ path: resolve(outputDir, 'saved-session.png') });
});

test('issue-1542-desktop-c3: an unsent draft survives real Rhythm tab navigation', { skip: !live, timeout: 60_000 }, async () => {
  await desktop.getByRole('button', { name: /^New session/ }).first().click();
  const composer = desktop.locator('[contenteditable="true"]').first();
  await composer.waitFor({ state: 'visible' });
  originalDraft = await composer.innerText();
  assert.equal(originalDraft.trim(), '', 'Smoke requires a new empty draft; will not overwrite an existing draft');
  await composer.click();
  await desktop.keyboard.type(draft);
  assert.equal(await composer.innerText(), draft);
  const url = desktop.url();
  await host.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await host.waitForURL('**#/dashboard');
  assert.equal(desktop.isClosed(), false, 'Hiding the tab must preserve its live renderer');
  captureNativeWindow('native-dashboard-with-hermes-hidden.png');
  await host.getByTestId('nav-more').click();
  await host.getByRole('menuitem', { name: 'Hermes', exact: true }).click();
  await host.waitForURL('**#/hermes');
  assert.equal(desktop.url(), url, 'Returning must not reload Hermes Desktop');
  assert.equal(await composer.innerText(), draft, 'The visible draft must survive');
  await desktop.screenshot({ path: resolve(outputDir, 'draft-after-tab-switch.png') });
  await composer.click();
  await desktop.keyboard.press('Meta+A');
  await desktop.keyboard.press('Backspace');
  assert.equal((await composer.innerText()).trim(), '');
  assert.deepEqual(chatWrites, [], 'Typing/switching must not send a message');
});

test('issue-1542-desktop-c4: the scoped Rhythm bridge opens an unsent draft in actual Desktop', { skip: !live, timeout: 60_000 }, async () => {
  // The user removed the outer header/action. Exercise the preserved public
  // preload boundary, without adding replacement chrome or faking the child.
  const result = await host.evaluate(() => window.rhythmShell.hermesView.sendIntent({
    v: 1, type: 'new-chat', context: 'Rhythm native draft smoke: review this synthetic context before sending.'
  }));
  assert.equal(result.ok, true);
  const composer = desktop.locator('[contenteditable="true"]').first();
  await desktop.waitForFunction(() => /Rhythm/i.test(document.querySelector('[contenteditable="true"]')?.textContent ?? ''));
  const text = await composer.innerText();
  assert.match(text, /Rhythm/i);
  assert.ok(text.length > 20, 'The actual composer must contain useful context');
  assert.deepEqual(chatWrites, [], 'Context handoff must never submit the draft');
  assert.deepEqual(rendererErrors, [], 'No renderer or missing-native-handler errors');
  await desktop.screenshot({ path: resolve(outputDir, 'rhythm-context-unsent.png') });
  await composer.click();
  await desktop.keyboard.press('Meta+A');
  await desktop.keyboard.press('Backspace');
});

test('issue-1542-desktop-c8: real native files, git, PTY and camera denial', { skip: !live, timeout: 90_000 }, async () => {
  const workspace = await realpath(await mkdtemp(resolve(tmpdir(), 'rhythm-hermes-native-tools-')));
  try {
    execFileSync('/usr/bin/git', ['init', '--initial-branch=smoke', workspace], { stdio: 'pipe' });
    await writeFile(resolve(workspace, 'proof.txt'), 'original native file\n');
    execFileSync('/usr/bin/git', ['add', 'proof.txt'], { cwd: workspace });
    execFileSync('/usr/bin/git', ['-c', 'user.name=Rhythm Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-m', 'synthetic native tool fixture'], { cwd: workspace, stdio: 'pipe' });
    const receipt = await desktop.evaluate(async workspace => {
      const bridge = window.hermesDesktop;
      const listing = await bridge.readDir(workspace);
      const before = await bridge.readFileText(`${workspace}/proof.txt`);
      await bridge.writeTextFile(`${workspace}/proof.txt`, 'changed by actual Desktop IPC\n');
      const after = await bridge.readFileText(`${workspace}/proof.txt`);
      const git = await bridge.git.repoStatus(workspace);
      const terminal = await bridge.terminal.start({ cwd: workspace, cols: 80, rows: 24 });
      let unsubscribe;
      let timer;
      try {
        await new Promise((resolve, reject) => {
          let output = '';
          timer = setTimeout(() => reject(new Error('Real native PTY did not execute its synthetic command')), 30_000);
          unsubscribe = bridge.terminal.onData(terminal.id, chunk => {
            output += String(chunk);
            if (output.includes('RHYTHM_PTY_EXECUTED')) resolve();
          });
          // Split the marker so terminal echo cannot satisfy the assertion.
          void bridge.terminal.write(terminal.id, "printf '%s%s\\n' 'RHYTHM_PTY_' 'EXECUTED' > pty-proof.txt; cat pty-proof.txt\r").catch(reject);
        });
      } finally {
        clearTimeout(timer);
        unsubscribe?.();
        await bridge.terminal.dispose(terminal.id);
      }
      let cameraDenied = false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (error) { cameraDenied = error.name === 'NotAllowedError'; }
      return { entries: listing.entries.map(entry => entry.name), before: before.text, after: after.text, git, cameraDenied };
    }, workspace);
    assert.ok(receipt.entries.includes('proof.txt'));
    assert.equal(receipt.before, 'original native file\n');
    assert.equal(receipt.after, 'changed by actual Desktop IPC\n');
    assert.equal(receipt.git.branch, 'smoke');
    assert.ok(receipt.git.files.some(file => file.path === 'proof.txt' && file.unstaged));
    assert.equal(await readFile(resolve(workspace, 'pty-proof.txt'), 'utf8'), 'RHYTHM_PTY_EXECUTED\n');
    assert.equal(receipt.cameraDenied, true, 'The embedded view must deny camera access');
    assert.deepEqual(rendererErrors, [], 'Native tool use must not produce renderer or IPC errors');
    assert.deepEqual(chatWrites, [], 'Native tool checks must not send a chat message');
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

after(async () => {
  // CDP attachment close disconnects this test client. Parent owns app lifetime.
  await desktopNetwork?.detach();
  await browser?.close();
});
