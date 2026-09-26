// Live ownership proof for issue #1542 C5. It starts only a disposable Hermes
// process under a disposable HERMES_HOME, then exercises the final embedded
// artifact in a real Electron 40 renderer. The parent application's process
// and the user's Hermes home are never inspected, written, or signalled.
// It intentionally does not qualify painted UI or externally hosted assets;
// those are covered by the signed native Desktop smoke suite.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const sourceCommit = 'd747cbd9e81870704347738cb702d3f229818557';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = process.env.RHYTHM_HERMES_OWNERSHIP_ARTIFACT_DIR
  ?? resolve(homedir(), 'Applications', 'Rhythm Mega Desktop Candidate.app', 'Contents', 'Resources', 'hermes-desktop');
const electronBinary = process.env.RHYTHM_HERMES_OWNERSHIP_ELECTRON
  ?? resolve(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const hermesBinary = process.env.RHYTHM_HERMES_OWNERSHIP_BINARY
  ?? resolve(homedir(), '.local', 'bin', 'hermes');

function redact(value, token) {
  return String(value).replaceAll(token, '[redacted]').replace(/([?&](?:access_token|token|session_token)=)[^&#\s]+/gi, '$1[redacted]');
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);

  return new Promise(resolveExit => {
    const timer = setTimeout(() => resolveExit(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveExit(true);
    });
  });
}

async function stopProbeOwnedChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }

  if (await waitForExit(child, 10_000)) return;

  try {
    child.kill('SIGKILL');
  } catch {
    return;
  }

  await waitForExit(child, 2_000);
}

async function stopProbeOwnedProcessGroup(child) {
  if (!child.pid) return;
  const processGroup = -child.pid;
  const groupIsAlive = () => {
    try {
      process.kill(processGroup, 0);
      return true;
    } catch {
      return false;
    }
  };
  const waitForGroupExit = async timeoutMs => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!groupIsAlive()) return true;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    }
    return !groupIsAlive();
  };

  try {
    // `runElectron` creates this detached process group itself. Never signal a
    // group derived from an existing process such as the signed candidate.
    process.kill(processGroup, 'SIGTERM');
  } catch {
    return;
  }

  if (await waitForGroupExit(10_000)) return;

  try {
    process.kill(processGroup, 'SIGKILL');
  } catch {
    return;
  }

  await waitForGroupExit(2_000);
}

function waitForReadyPort(child, token) {
  return new Promise((resolvePort, rejectPort) => {
    let output = '';
    const timeout = setTimeout(() => rejectPort(new Error(`Timed out waiting for the probe-owned Hermes backend. Output: ${redact(output, token)}`)), 90_000);
    const onData = chunk => {
      output = `${output}${String(chunk)}`.slice(-8_000);
      const match = /HERMES_(?:BACKEND|DASHBOARD)_READY port=(\d+)/.exec(output);

      if (match) {
        clearTimeout(timeout);
        resolvePort(Number(match[1]));
      }
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      rejectPort(new Error(`Probe-owned Hermes backend exited before readiness (code=${code}, signal=${signal}). Output: ${redact(output, token)}`));
    });
  });
}

function runElectron(binary, script, environment, token) {
  return new Promise((resolveExit, rejectExit) => {
    const { ELECTRON_RUN_AS_NODE: _ignored, ...baseEnvironment } = process.env;
    const child = spawn(binary, [script], {
      detached: true,
      env: { ...baseEnvironment, ...environment },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let settled = false;
    const onData = chunk => { output = `${output}${String(chunk)}`.slice(-16_000); };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const timeout = setTimeout(async () => {
      if (settled) return;
      settled = true;
      await stopProbeOwnedProcessGroup(child);
      rejectExit(new Error(`Electron ownership runner timed out. Output: ${redact(output, token)}`));
    }, 90_000);
    child.once('error', error => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      rejectExit(error);
    });
    child.once('exit', async (code, signal) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      await stopProbeOwnedProcessGroup(child);
      if (code === 0 && signal === null) resolveExit();
      else rejectExit(new Error(`Electron ownership runner exited (code=${code}, signal=${signal}). Output: ${redact(output, token)}`));
    });
  });
}

test('issue-1542-desktop-c5: final native host reuses a published backend and leaves it running', { skip: !live, timeout: 180_000 }, async () => {
  await Promise.all([
    access(electronBinary),
    access(hermesBinary),
    access(resolve(artifactRoot, 'electron', 'embedded-host.mjs')),
    access(resolve(artifactRoot, 'electron', 'preload.cjs')),
    access(resolve(artifactRoot, 'renderer', 'index.html'))
  ]);

  const manifest = JSON.parse(await readFile(resolve(artifactRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sourceCommit, sourceCommit, 'Ownership proof must execute the final signed artifact source.');
  assert.equal(manifest.electronMajor, 40);
  assert.equal(manifest.files?.host, 'electron/embedded-host.mjs');
  assert.equal(manifest.files?.preload, 'electron/preload.cjs');

  const root = await mkdtemp(join(tmpdir(), 'rhythm-hermes-borrowed-'));
  const hermesHome = join(root, 'hermes-home');
  const userData = join(root, 'rhythm-user-data');
  const receiptPath = join(root, 'electron-receipt.json');
  const progressPath = join(root, 'electron-progress.txt');
  const runnerPath = join(root, 'electron-runner.mjs');
  const token = randomBytes(32).toString('base64url');
  let backend;

  try {
    await Promise.all([mkdir(hermesHome), mkdir(userData)]);
    backend = spawn(hermesBinary, ['serve', '--host', '127.0.0.1', '--port', '0'], {
      cwd: hermesHome,
      env: {
        ...process.env,
        HERMES_DESKTOP: '1',
        HERMES_DASHBOARD_SESSION_TOKEN: token,
        HERMES_HOME: hermesHome,
        HOME: root
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const port = await waitForReadyPort(backend, token);
    assert.ok(Number.isInteger(port) && port > 0);
    const baseUrl = `http://127.0.0.1:${port}`;
    const wsUrl = `ws://127.0.0.1:${port}/api/ws?token=${encodeURIComponent(token)}`;
    const before = await fetch(`${baseUrl}/api/status`, { headers: { 'X-Hermes-Session-Token': token } });
    assert.equal(before.status, 200, 'Probe-owned backend must be authenticated before publication.');
    const beforeStatus = await before.json();
    assert.equal(typeof beforeStatus.version, 'string');

    // This is the only descriptor written: a temp-home, owner-published opt-in
    // manifest. The embedded host may read it but never changes it.
    await writeFile(join(hermesHome, 'embedded-runtime.json'), JSON.stringify({
      schemaVersion: 1,
      baseUrl,
      profile: 'default',
      token,
      wsUrl
    }), { mode: 0o600 });
    await chmod(join(hermesHome, 'embedded-runtime.json'), 0o600);

    await writeFile(runnerPath, `
      import { app, BrowserWindow, WebContentsView } from 'electron';
      import { readFile, writeFile } from 'node:fs/promises';
      import { join } from 'node:path';
      import { pathToFileURL } from 'node:url';

      async function run() {
        const artifact = process.env.OWNERSHIP_ARTIFACT;
        const hermesHome = process.env.OWNERSHIP_HERMES_HOME;
        const userData = process.env.OWNERSHIP_USER_DATA;
        const receipt = process.env.OWNERSHIP_RECEIPT;
        const progress = process.env.OWNERSHIP_PROGRESS;
        let host;
        let hostWindow;
        let childView;
        const closeChild = () => {
          if (!childView || childView.webContents.isDestroyed()) return;
          hostWindow?.contentView.removeChildView(childView);
          childView.webContents.close();
        };
      const step = async (name, promise) => {
        console.error(\`ownership-runner:\${name}\`);
        await writeFile(progress, name);
        let timer;
        try {
          return await Promise.race([
            promise,
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(\`Timed out during \${name}.\`)), 25_000); })
          ]);
        } finally {
          clearTimeout(timer);
        }
        };
        try {
        // The disposable user-data directory must not trigger a real macOS
        // Keychain authorization sheet. This does not alter the signed app;
        // it keeps the isolated runner from blocking Electron's main thread.
        app.commandLine.appendSwitch('use-mock-keychain');
        app.setPath('userData', userData);
        app.setPath('sessionData', join(userData, 'session-data'));
        await step('app-ready', app.whenReady());
        const manifest = JSON.parse(await readFile(join(artifact, 'manifest.json'), 'utf8'));
        if (manifest.sourceCommit !== '${sourceCommit}') throw new Error('Runner artifact source mismatch.');
        const { createEmbeddedHermesHost } = await import(pathToFileURL(join(artifact, 'electron', 'embedded-host.mjs')).href);
        hostWindow = new BrowserWindow({ show: false });
        childView = new WebContentsView({
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: join(artifact, 'electron', 'preload.cjs'),
            sandbox: true
          }
        });
        hostWindow.contentView.addChildView(childView);
        childView.setBounds({ x: 0, y: 0, width: 800, height: 600 });
        // C5 needs the signed preload and actual native connection route, not
        // externally hosted fonts or plugin assets. Suppress those requests so
        // a disconnected/cert-constrained test host cannot hold page load open.
        childView.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
        host = await step('host-create', createEmbeddedHermesHost({
          hostWindow,
          webContents: childView.webContents,
          assetRoot: artifact,
          userDataPath: userData,
          hermesHome
        }));
        await step('renderer-load', childView.webContents.loadURL(pathToFileURL(join(artifact, 'renderer', 'index.html')).href + '?embedded=1'));
        const connection = await step('connection-bridge', childView.webContents.executeJavaScript(\`(async () => {
          const value = await window.hermesDesktop.getConnection();
          return { baseUrl: value?.baseUrl, mode: value?.mode, hasWsUrl: typeof value?.wsUrl === 'string' };
        })()\`));
        closeChild();
        await step('host-dispose', host.dispose());
        host = undefined;
        await writeFile(receipt, JSON.stringify({ ok: true, connection }));
        } catch (error) {
        await writeFile(receipt, JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
        process.exitCode = 1;
        } finally {
        closeChild();
        if (host) await host.dispose().catch(() => undefined);
        if (hostWindow && !hostWindow.isDestroyed()) hostWindow.destroy();
        app.quit();
      }
      }
      void run().catch(error => {
        console.error('ownership-runner:unhandled', error);
        process.exitCode = 1;
        app.quit();
      });
    `);

    try {
      await runElectron(electronBinary, runnerPath, {
        OWNERSHIP_ARTIFACT: artifactRoot,
        OWNERSHIP_HERMES_HOME: hermesHome,
        OWNERSHIP_PROGRESS: progressPath,
        OWNERSHIP_RECEIPT: receiptPath,
        OWNERSHIP_USER_DATA: userData,
        HERMES_HOME: hermesHome,
        HOME: root
      }, token);
    } catch (error) {
      const phase = await readFile(progressPath, 'utf8').catch(() => 'unknown');
      const receipt = await readFile(receiptPath, 'utf8').catch(() => 'no runner receipt');
      throw new Error(`${error instanceof Error ? error.message : String(error)} Runner phase: ${phase}. Receipt: ${redact(receipt, token)}`);
    }

    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    assert.deepEqual(receipt.ok, true, receipt.message || 'Electron runner did not complete.');
    assert.equal(receipt.connection.baseUrl, baseUrl, 'The actual native bridge must return the published backend endpoint.');
    assert.equal(receipt.connection.mode, 'local');
    assert.equal(receipt.connection.hasWsUrl, true);
    assert.equal(backend.exitCode, null, 'Disposing the embedded host must not stop a borrowed backend.');
    assert.equal(backend.signalCode, null, 'Disposing the embedded host must not signal a borrowed backend.');

    const after = await fetch(`${baseUrl}/api/status`, { headers: { 'X-Hermes-Session-Token': token } });
    assert.equal(after.status, 200, 'Borrowed backend must remain authenticated and reachable after host disposal.');
    const afterStatus = await after.json();
    assert.equal(afterStatus.version, beforeStatus.version);
  } finally {
    if (backend) await stopProbeOwnedChild(backend);
    await rm(root, { recursive: true, force: true });
  }
});
