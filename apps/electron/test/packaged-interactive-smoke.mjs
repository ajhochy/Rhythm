// Opt-in, actual hardened package. Owns sandbox up/status/down; never uses live ports.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '../../web/node_modules/playwright/index.mjs';

if (process.env.RHYTHM_LIVE_E2E !== '1') {
  console.log('SKIP: set RHYTHM_LIVE_E2E=1 for packaged interactive smoke');
  process.exit(0);
}
const root = resolve(import.meta.dirname, '../../..');
const sb = '/private/tmp/rhythm-electron-interactive-probe';
const fixture = '/private/tmp/rhythm-e02-fixture-20260911-phase0-57ba71255a';
const binary = resolve(root, 'apps/electron/dist/Rhythm.app/Contents/MacOS/Rhythm');
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME,
  RHYTHM_APPROVED_FIXTURE_ROOT: fixture,
  RHYTHM_LIVE_DB_PATH: `${fixture}/rhythm.db`,
  RHYTHM_SANDBOX_OPENCODE_CONFIG: `${fixture}/opencode.json`,
  RHYTHM_SANDBOX_DIR: sb,
  RHYTHM_SANDBOX_API_PORT: '4098', RHYTHM_SANDBOX_ENGINE_PORT: '4097',
  RHYTHM_SANDBOX_GATEWAY_PORT: '4099',
};
const sandbox = (action) => execFileSync(resolve(root, 'tools/dev/sandbox.sh'), [action], {
  cwd: root, env, stdio: 'inherit', timeout: action === 'up' ? 600_000 : 60_000,
});
const listeners = () => [4098, 4097].map((port) => {
  const pid = execFileSync('/usr/sbin/lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 5000 }).trim();
  assert.match(pid, /^\d+$/, `expected one listener on ${port}`);
  return pid;
});
assert.equal(existsSync(sb), false, 'refuse to adopt an existing sandbox');
assert.ok(existsSync(binary), 'rebuild the candidate package first');
let child;
let browser;
let deadline;
try {
  sandbox('up');
  sandbox('status');
  const before = listeners();
  assert.deepEqual(before, ['api_server.pid', 'opencode_engine.pid'].map((name) => readFileSync(`${sb}/${name}`, 'utf8').trim()));

  // ponytail: hardened Electron disables main-process inspection. Native AX observes
  // only this candidate PID; missing accessibility permission fails, never earns PASS.
  writeFileSync(`${sb}/window.swift`, `
import AppKit
import ApplicationServices
let pid = pid_t(CommandLine.arguments[1])!
guard let app = NSRunningApplication(processIdentifier: pid) else { fatalError("candidate exited") }
if CommandLine.arguments.last == "quit" {
  guard app.terminate() else { fatalError("candidate refused graceful quit") }
  exit(0)
}
guard AXIsProcessTrusted() else { fatalError("UNVERIFIED: accessibility permission required for native window/dialog checks") }
func attr(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success else { return nil }
  return value
}
let target = AXUIElementCreateApplication(pid)
guard let windows = attr(target, kAXWindowsAttribute) as? [AXUIElement], windows.count == 1 else {
  fatalError("expected exactly one candidate window, no native dialog")
}
let window = windows[0]
guard let children = attr(window, kAXChildrenAttribute) as? [AXUIElement] else { fatalError("UNVERIFIED: window children unreadable") }
guard attr(window, kAXSubroleAttribute) as? String == kAXStandardWindowSubrole,
      attr(window, kAXMinimizedAttribute) as? Bool == false,
      !app.isHidden,
      !children.contains(where: { ["AXSheet", "AXDialog"].contains(attr($0, kAXRoleAttribute) as? String ?? "") || attr($0, kAXSubroleAttribute) as? String == "AXDialog" }) else {
  fatalError("candidate hidden/minimized or native dialog/sheet present")
}
let onscreen = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
guard onscreen.contains(where: { ($0[kCGWindowOwnerPID as String] as? Int) == Int(pid) && ($0[kCGWindowLayer as String] as? Int) == 0 }) else {
  fatalError("candidate has no visible normal window")
}
print("visible standard window; no native dialog/sheet")
`);
  execFileSync('/usr/bin/swiftc', ['-module-cache-path', `${sb}/swift-cache`, `${sb}/window.swift`, '-o', `${sb}/window-check`], { timeout: 120_000 });
  const native = (action = 'check') => execFileSync(`${sb}/window-check`, [String(child.pid), action], { encoding: 'utf8', timeout: 10_000 }).trim();
  const childEnv = {
    PATH: `${sb}/bin:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: `${sb}/home`,
    XDG_CONFIG_HOME: `${sb}/home/.config`, XDG_DATA_HOME: `${sb}/home/.local/share`,
    XDG_CACHE_HOME: `${sb}/home/.cache`, TMPDIR: `${sb}/tmp`,
    RHYTHM_SHELL_USER_DATA: `${sb}/electron-user-data`,
    RHYTHM_LIVE_API_URL: 'http://127.0.0.1:4098',
    RHYTHM_LIVE_ENGINE_URL: 'http://127.0.0.1:4097',
    RHYTHM_PRODUCTION_API_URL: 'http://127.0.0.1:4098',
  };
  child = spawn(binary, ['--interactive-smoke', '--allow-test-runtime-ports', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], {
    cwd: sb, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output = (output + data).slice(-32_768); });
  child.stderr.on('data', (data) => { output = (output + data).slice(-32_768); });
  let spawnError;
  child.on('error', (error) => { spawnError = error; });
  // Hard backstop signals only the child we spawned; finally still tears down the sandbox.
  deadline = setTimeout(() => child.kill('SIGKILL'), 60_000);
  let endpoint;
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, 'candidate exited before CDP readiness');
    assert.equal(child.signalCode, null, 'candidate was signaled before CDP readiness');
    endpoint = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];
    const activePort = `${childEnv.RHYTHM_SHELL_USER_DATA}/DevToolsActivePort`;
    if (!endpoint && existsSync(activePort)) {
      const [port, path] = readFileSync(activePort, 'utf8').trim().split('\n');
      assert.match(port, /^\d+$/);
      assert.match(path, /^\/devtools\/browser\/[\w-]+$/);
      endpoint = `ws://127.0.0.1:${port}${path}`;
    }
    if (endpoint) break;
    await delay(100);
  }
  assert.ok(endpoint, `UNVERIFIED: packaged Chromium CDP unavailable\n${output}`);
  browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 10_000 });
  page.setDefaultTimeout(5000);
  await page.waitForURL('rhythm://app/index.html#/agents');
  await page.waitForFunction(() => !!window.rhythmShell?.gateway);
  const gateway = await page.evaluate(() => ({ api: window.rhythmShell.gateway.apiBase, engine: window.rhythmShell.gateway.engineBase }));
  assert.deepEqual(gateway, { api: childEnv.RHYTHM_LIVE_API_URL, engine: childEnv.RHYTHM_LIVE_ENGINE_URL });
  assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
  console.log(`PASS packaged route=${page.url()} api=${gateway.api} engine=${gateway.engine}`);
  // Real user input must update a real app control, not an injected test button.
  const control = page.getByRole('button', { name: 'Dashboard', exact: true });
  await control.click();
  await page.waitForURL('**#/dashboard');
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.waitForURL('rhythm://app/index.html#/agents');
  const start = Date.now();
  for (let i = 0; i < 6; i++) {
    assert.equal(child.exitCode, null, 'interactive smoke auto-exited');
    assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
    console.log(`native sample ${i + 1}: ${native()}`);
    await delay(1000);
  }
  console.log(`PASS real Dashboard/Agents navigation; remained interactive/open for ${Date.now() - start}ms`);
  native('quit');
  for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await delay(100);
  assert.equal(child.exitCode, 0, 'candidate must exit gracefully with code 0');
  assert.equal(child.signalCode, null, 'candidate must not require a signal');
  clearTimeout(deadline);
  await delay(1000);
  const after = listeners();
  assert.deepEqual(after, before, 'candidate exit changed sandbox listener PIDs');
  console.log(`PASS graceful exit=0; API4098 PID ${before[0]}→${after[0]}; engine4097 PID ${before[1]}→${after[1]}`);
} finally {
  clearTimeout(deadline);
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await delay(1000);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await browser?.close().catch(() => {});
  sandbox('down');
}
