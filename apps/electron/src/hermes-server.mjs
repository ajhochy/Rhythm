import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { finished } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { portAvailable } from './agent-server.mjs';

// Official bootstrap, verified against ~/.hermes/hermes-agent/README.md. Never renderer supplied.
export const HERMES_INSTALL_COMMAND = 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash';

/** @typedef {{ state: 'disabled'|'absent'|'starting'|'ready'|'failed'|'stopped', port: number, url: string, reason?: string, pid?: number, version?: string, binaryPath?: string }} Status */
/** @typedef {import('node:child_process').ChildProcess} Child */

/** Resolve symlinks and the official ~/.local/bin shell wrapper without executing its contents.
 * @param {string} binaryPath @param {string} home */
export function hermesInstallDir(binaryPath, home) {
  let executable = binaryPath;
  try {
    executable = realpathSync(binaryPath);
    const wrapper = readFileSync(executable, 'utf8').slice(0, 8_192);
    const target = wrapper.match(/^exec ["']([^"'\n]+\/bin\/hermes)["']\s/m)?.[1];
    if (target && isAbsolute(target)) executable = realpathSync(target);
  } catch { /* An opaque executable still has a location; default is the official installation. */ }
  for (let path = dirname(executable); dirname(path) !== path; path = dirname(path)) {
    if (existsSync(join(path, 'hermes_cli'))) return path;
  }
  return join(home, '.hermes/hermes-agent');
}

/**
 * OS boundaries and timing are injectable so lifecycle tests never bind ports or run Hermes.
 * @param {{
 * env?: NodeJS.ProcessEnv, spawn?: typeof nodeSpawn, fetch?: typeof globalThis.fetch,
 * log?: (text: string) => void, resolveBinary?: () => Promise<string|null>,
 * showConsent?: (options: import('electron').MessageBoxOptions) => Promise<{response: number}>,
 * installLogPath?: string, checkPort?: (port: number) => Promise<boolean>,
 * hasBuiltWeb?: (binaryPath: string) => boolean,
 * graceMs?: number, readyTimeoutMs?: number, pollMs?: number, commandTimeoutMs?: number
 * }} [options]
 */
export function createHermesSupervisor({
  env = process.env, spawn = nodeSpawn, fetch = globalThis.fetch, log = () => {},
  resolveBinary, showConsent = async () => ({ response: 0 }), installLogPath,
  checkPort = portAvailable, hasBuiltWeb,
  graceMs = 3_000, readyTimeoutMs = 60_000, pollMs = 500, commandTimeoutMs = 5_000,
} = {}) {
  const enabled = env.RHYTHM_HERMES_ENABLED !== '0';
  const port = Number(env.RHYTHM_HERMES_PORT ?? '9121');
  const home = env.HOME || homedir();
  const url = `http://127.0.0.1:${port}`;
  const childBaseEnv = { ...env };
  delete childBaseEnv.HERMES_DASHBOARD_SESSION_TOKEN;
  /** @type {Status} */
  let status = { state: enabled ? 'stopped' : 'disabled', port, url };
  /** @type {Set<(snapshot: Status) => void>} */
  const listeners = new Set();
  /** @type {Set<Child>} */
  const owned = new Set();
  /** @type {Child | undefined} */
  let server;
  /** @type {Promise<Status> | undefined} */
  let operation;
  /** @type {Promise<void> | undefined} */
  let stopping;
  let generation = 0;
  let abort = new AbortController();
  let stderr = '';
  /** @type {string | undefined} */
  let sessionToken;
  /** Retained only to redact late buffered output after a child exits. @type {string | undefined} */
  let redactionToken;
  const getStatus = () => ({ ...status });
  const getSessionToken = () => sessionToken;
  /** @param {Status['state']} state @param {Partial<Status>} [details] */
  const publish = (state, details = {}) => {
    status = { port, url, ...details, state };
    for (const listener of listeners) {
      try { listener(getStatus()); } catch { /* Observers cannot interrupt child cleanup. */ }
    }
    return getStatus();
  };
  // Diagnostics cross IPC. Never publish a token printed by Hermes or an installer.
  /** @param {string} value */
  const safeText = (value) => {
    let result = value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    if (redactionToken) result = result.split(redactionToken).join('[redacted]');
    for (const [key, secret] of Object.entries(env)) {
      if (/token|secret|password|api.?key|authorization/i.test(key) && secret) result = result.split(secret).join('[redacted]');
    }
    return result.split(/\r?\n/).map((line) => /token|secret|password|api.?key|authorization|bearer|sk-[a-z0-9]/i.test(line) ? '[redacted sensitive diagnostic]' : line.slice(0, 2_000)).join('\n');
  };
  const tail = () => safeText(stderr.trimEnd().split(/\r?\n/).slice(-50).join('\n'));
  /** @param {string} reason @param {Partial<Status>} [details] */
  const failed = (reason, details = {}) => publish('failed', { ...details, reason });
  /** @param {number} current */
  const active = (current) => current === generation && !abort.signal.aborted;

  /** @param {string} binary @param {string[]} args @param {NodeJS.ProcessEnv} [childEnv] */
  const launch = (binary, args, childEnv = childBaseEnv) => {
    const child = spawn(binary, args, { env: { ...childEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    owned.add(child);
    const release = () => { owned.delete(child); };
    child.once('exit', release);
    child.once('error', () => { if (!child.pid) release(); });
    return child;
  };
  /** @param {Child} child @param {NodeJS.Signals} signal @param {number} timeout */
  const signalAndWait = (child, signal, timeout) => new Promise((resolvePromise) => {
    if (!owned.has(child)) { resolvePromise(undefined); return; }
    const finish = () => { clearTimeout(timer); child.off('exit', finish); resolvePromise(undefined); };
    const timer = setTimeout(finish, timeout);
    child.once('exit', finish);
    try { child.kill(signal); } catch { finish(); }
  });
  /** Signal only children created here. Never use `hermes serve --stop` or discovered PIDs. */
  const stopOwned = async () => {
    const children = [...owned];
    await Promise.all(children.map((child) => signalAndWait(child, 'SIGTERM', graceMs)));
    await Promise.all(children.filter((child) => owned.has(child)).map((child) => signalAndWait(child, 'SIGKILL', graceMs)));
    if (!owned.size) server = undefined;
  };

  /** @param {string} binary @param {string[]} args @param {number} current
   * @param {{ timeout?: number, output?: (text: string) => void }} [options] */
  const command = (binary, args, current, { timeout = commandTimeoutMs, output = () => {} } = {}) => new Promise((resolvePromise, reject) => {
    if (!active(current)) { reject(new Error('stopped')); return; }
    const child = launch(binary, args);
    let stdout = '';
    const signal = abort.signal;
    const timer = timeout ? setTimeout(() => finish(new Error('command-timeout')), timeout) : undefined;
    /** @param {Error} [error] @param {boolean} [terminate] */
    const finish = (error, terminate = true) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancelled);
      child.off('close', closed); child.off('error', errored);
      child.stdout?.off('data', out); child.stderr?.off('data', err);
      if (error) {
        if (terminate && owned.has(child)) child.kill('SIGKILL');
        reject(error);
      } else resolvePromise(stdout);
    };
    const cancelled = () => finish(new Error('stopped'), false);
    const errored = (/** @type {Error} */ error) => finish(error);
    const closed = (/** @type {number|null} */ code) => { owned.delete(child); finish(code === 0 ? undefined : new Error(`command-exit-${code}`)); };
    const out = (/** @type {Buffer} */ chunk) => { stdout = (stdout + String(chunk)).slice(-16_384); output(String(chunk)); };
    const err = (/** @type {Buffer} */ chunk) => output(String(chunk));
    child.stdout?.on('data', out); child.stderr?.on('data', err);
    child.once('error', errored); child.once('close', closed);
    signal.addEventListener('abort', cancelled, { once: true });
  });

  /** @param {number} current */
  const findBinary = async (current) => {
    if (resolveBinary) return resolveBinary();
    try {
      const stdout = await command('/bin/zsh', ['-l', '-c', 'command -v hermes'], current);
      const candidate = stdout.trim().split(/\r?\n/).at(-1);
      if (candidate && isAbsolute(candidate) && existsSync(candidate)) return candidate;
    } catch { /* GUI PATH may not include Hermes; try the official fallback. */ }
    const fallback = join(home, '.local/bin/hermes');
    return existsSync(fallback) ? fallback : null;
  };

  /** @param {number} current */
  const startRun = async (current) => {
    if (!active(current)) return getStatus();
    if (server || owned.size) return getStatus();
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 9119) return failed('invalid-port');
    stderr = '';
    publish('starting');
    const binaryPath = await findBinary(current);
    if (!active(current)) return getStatus();
    if (!binaryPath) return publish('absent');
    const available = await checkPort(port);
    if (!active(current)) return getStatus();
    if (!available) return failed('port-in-use', { binaryPath });
    /** @type {string | undefined} */
    let version;
    try { version = safeText((await command(binaryPath, ['--version'], current)).split(/\r?\n/)[0].trim()) || undefined; }
    catch { /* A CLI without --version may still serve; never block discovery on metadata. */ }
    if (!active(current)) return getStatus();
    // A timed-out discovery child must exit before another process can be owned.
    if (owned.size) return failed('command-stop-failed', { binaryPath, version });
    const args = ['dashboard', '--port', String(port), '--host', '127.0.0.1', '--no-open'];
    if (hasBuiltWeb ? hasBuiltWeb(binaryPath) : existsSync(join(hermesInstallDir(binaryPath, home), 'hermes_cli/web_dist/index.html'))) args.push('--skip-build');
    sessionToken = randomBytes(32).toString('base64url');
    redactionToken = sessionToken;
    let child;
    try { child = launch(binaryPath, args, { ...childBaseEnv, HERMES_DASHBOARD_SESSION_TOKEN: sessionToken }); }
    catch (error) {
      sessionToken = undefined;
      throw error;
    }
    server = child;
    const details = { binaryPath, version, pid: child.pid };
    publish('starting', details);
    child.stderr?.on('data', (chunk) => { stderr = (stderr + String(chunk)).split('\n').slice(-51).join('\n').slice(-110_000); });
    child.stdout?.on('data', (chunk) => { log(safeText(String(chunk))); });
    child.once('error', () => {
      if (active(current)) {
        sessionToken = undefined;
        failed('spawn-failed', { binaryPath, version });
      }
    });
    child.once('exit', (code) => {
      if (server === child) server = undefined;
      if (active(current)) {
        const reason = /address already in use|EADDRINUSE|port.in.use/i.test(stderr) ? 'port-in-use' : `process-exited-${code}${tail() ? `\n${tail()}` : ''}`;
        sessionToken = undefined;
        failed(reason, { binaryPath, version });
      }
    });
    const deadline = Date.now() + readyTimeoutMs;
    while (active(current) && server === child && status.state === 'starting' && Date.now() < deadline) {
      try {
        const response = await fetch(`${url}/api/health`, { method: 'GET', redirect: 'manual', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(Math.max(1, Math.min(2_000, deadline - Date.now())))]) });
        // Any HTTP response proves listening; readiness does not depend on a particular body or status.
        void response.body?.cancel().catch(() => {});
        if (active(current) && server === child && status.state === 'starting') return publish('ready', details);
      } catch { /* Retry until the wall-clock budget expires. */ }
      if (active(current)) await delay(Math.max(1, Math.min(pollMs, deadline - Date.now())), undefined, { signal: abort.signal }).catch(() => {});
    }
    if (active(current) && server === child && status.state === 'starting') {
      const reason = `readiness-timeout${tail() ? `\n${tail()}` : ''}`;
      // Suppress late exit/readiness updates while shutting down this failed attempt.
      const timeoutGeneration = ++generation;
      await stopOwned();
      sessionToken = undefined;
      if (timeoutGeneration !== generation) return getStatus();
      return failed(reason, { binaryPath, version });
    }
    return getStatus();
  };

  const stop = () => {
    if (stopping) return stopping;
    generation++;
    abort.abort();
    stopping = stopOwned().then(() => {
      if (owned.size) failed('stop-failed');
      else {
        sessionToken = undefined;
        publish(enabled ? 'stopped' : 'disabled');
      }
    }).finally(() => { stopping = undefined; });
    return stopping;
  };
  /** @param {(current: number) => Promise<Status>} work */
  const run = (work) => {
    if (!enabled) return Promise.resolve(getStatus());
    if (operation) return operation;
    operation = (async () => {
      if (stopping) await stopping;
      abort = new AbortController();
      const current = generation;
      try { return await work(current); }
      catch { return active(current) ? failed('operation-failed') : getStatus(); }
    })().finally(() => { operation = undefined; });
    return operation;
  };
  const start = () => run(startRun);
  /** @type {Promise<Status>|undefined} */
  let restarting;
  const restart = () => {
    if (!enabled) return Promise.resolve(getStatus());
    if (restarting) return restarting;
    restarting = (async () => {
      const pending = operation;
      await stop();
      await pending;
      return start();
    })().finally(() => { restarting = undefined; });
    return restarting;
  };
  const install = () => run(async (current) => {
    const choice = await showConsent({
      type: 'question', title: 'Install Hermes?', message: 'Install Hermes for your user account?',
      detail: `Rhythm will run this exact command in your login shell:\n\n${HERMES_INSTALL_COMMAND}\n\nInstaller output is saved to hermes-install.log in Rhythm’s user data folder.`,
      buttons: ['Cancel', 'Install Hermes'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (!active(current) || choice.response !== 1) return getStatus();
    if (server || owned.size) return getStatus();
    const path = installLogPath ?? join(env.RHYTHM_SHELL_USER_DATA || join(home, 'Library/Application Support/rhythm-electron-shell'), 'hermes-install.log');
    await mkdir(dirname(path), { recursive: true });
    const file = await open(path, 'a', 0o600);
    let logError = false;
    try {
      await file.chmod(0o600);
      if (!active(current)) return getStatus();
      publish('starting');
      const stream = file.createWriteStream();
      stream.on('error', () => { logError = true; abort.abort(); });
      const drained = finished(stream).catch(() => { logError = true; });
      try {
        await command('/bin/zsh', ['-l', '-c', HERMES_INSTALL_COMMAND], current, { timeout: 0, output: (text) => { stream.write(text); } });
      } finally {
        stream.end();
        await drained;
      }
      if (logError) return failed('install-log-failed');
    } catch {
      if (logError) {
        await stopOwned();
        return current === generation ? failed('install-log-failed') : getStatus();
      }
      return active(current) ? failed('install-failed') : getStatus();
    }
    finally { await file.close(); }
    return startRun(current);
  });
  return {
    start, stop, getStatus, getSessionToken, install, restart,
    /** @param {(snapshot: Status) => void} callback */
    onStatus(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
  };
}
