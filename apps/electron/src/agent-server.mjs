// Ports the Electron/React reference client to have Flutter's exact "the desktop app spawns and
// owns the local api_server" behavior (apps/desktop_flutter/lib/app/core/server/
// api_server_service.dart + agent_server_controller.dart) — apps/electron had none of this before;
// every renderer live-mode call previously assumed some OTHER process (usually
// `tools/dev/sandbox.sh`) was already running api_server.
//
// D20: Electron exclusively owns its local runtime. Canonical ports/database remain the same,
// but an existing Flutter/other server is a conflict, never an adoption or reclamation target.
// Hermetic smoke runs remain isolated by their explicit RHYTHM_LIVE_* URLs plus isolated HOME and
// RHYTHM_SHELL_USER_DATA; main.mjs never starts this service for --smoke runs.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { capabilityMaterial } from './human-approval-main-signer.mjs';

const run = promisify(execFile);
const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {'nodeNotFound' | 'bundleNotFound' | 'spawnThrew' | 'healthCheckTimeout' | 'lostConnection' | 'approvalCredentialsUnavailable' | 'portConflict' | 'startupFailed' | 'stopFailed'} AgentServerFailureReason
 * @typedef {{ status: 'starting' | 'ready' | 'failed' | 'stopping' | 'stopped', failureReason: AgentServerFailureReason | null, stderrTail: string | null, errorMessage: string | null }} AgentServerStatus
 * @typedef {{ executable: string, args: string[], workingDir: string, mcpRolesDir: string | undefined }} ServerEntry
 */

export const AGENT_SERVER_PORT = 4001;
export const AGENT_SERVER_ENGINE_PORT = 4096;
export const AGENT_SERVER_BASE_URL = `http://127.0.0.1:${AGENT_SERVER_PORT}`;

/** apps/desktop_flutter/lib/app/core/server/api_server_service.dart:487-501 — GUI apps on macOS
 * launch with a minimal PATH, so a bare `which node` misses Homebrew/nvm installs. */
export async function findNode(executablePath = process.execPath) {
  const bundledNode = resolve(dirname(dirname(executablePath)), 'Resources/node/bin/node');
  if (existsSync(bundledNode)) return bundledNode;
  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
    if (existsSync(candidate)) return candidate;
  }
  for (const shell of ['/bin/zsh', '/bin/bash']) {
    try {
      const { stdout } = await run(shell, ['-l', '-c', 'which node']);
      const path = stdout.trim();
      if (path && existsSync(path)) return path;
    } catch { /* try the next shell */ }
  }
  return null;
}

/** api_server_service.dart:548-590: prefer the detached production payload, otherwise walk up to
 * source only for development. A packaged Rhythm executable fails closed when its payload is
 * missing instead of accidentally depending on a nearby checkout.
 * @param {string} nodePath
 * @param {string} executablePath
 * @returns {ServerEntry | null}
 */
export function findServerEntry(nodePath, executablePath = process.execPath) {
  const resourcesDir = resolve(dirname(dirname(executablePath)), 'Resources');
  const packagedApiServer = resolve(resourcesDir, 'api_server');
  const packagedCandidate = resolve(packagedApiServer, 'dist/server.js');
  if (existsSync(packagedCandidate)) {
    return { executable: nodePath, args: [packagedCandidate], workingDir: packagedApiServer, mcpRolesDir: resolve(packagedApiServer, '.mcp-roles') };
  }
  if (basename(executablePath) === 'Rhythm') return null;
  let candidate = electronRoot;
  for (let depth = 0; depth < 12; depth += 1) {
    const apiServerDir = resolve(candidate, 'apps/api_server');
    if (existsSync(join(apiServerDir, 'src/server.ts'))) {
      const npx = existsSync(join(dirname(nodePath), 'npx')) ? join(dirname(nodePath), 'npx') : 'npx';
      return { executable: npx, args: ['tsx', 'src/server.ts'], workingDir: apiServerDir, mcpRolesDir: undefined };
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return null;
}

function dbPath() {
  const supportDir = join(homedir(), 'Library/Application Support/Rhythm');
  return join(supportDir, 'rhythm.db');
}

/**
 * api_server_service.dart:46-92 field-for-field, adapted to this build's optional params (memory
 * vault / relay bearer sourcing does not exist yet in apps/electron — passed through baseEnv only,
 * never fabricated).
 * @param {{ baseEnv: NodeJS.ProcessEnv, port: number, enginePort: number, dbPathValue: string, humanApprovalPublicKey: string, humanApprovalCapabilitySha256: string, mcpRolesDir: string | undefined }} options
 */
export function buildEnvironment({ baseEnv, port, enginePort, dbPathValue, humanApprovalPublicKey, humanApprovalCapabilitySha256, mcpRolesDir }) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) if (key.startsWith('HUMAN_APPROVAL_')) delete env[key];
  env.PORT = String(port);
  env.RHYTHM_OPENCODE_ENGINE_PORT = String(enginePort);
  env.DB_PATH = dbPathValue;
  env.AGENT_LOCAL = 'true';
  env.RHYTHM_LOCAL_RENDERER_ORIGINS = 'rhythm://app';
  env.HUMAN_APPROVAL_PUBLIC_KEY = humanApprovalPublicKey;
  env.HUMAN_APPROVAL_CAPABILITY_SHA256 = humanApprovalCapabilitySha256;
  if (mcpRolesDir && !env.MCP_ROLES_DIR) env.MCP_ROLES_DIR = mcpRolesDir;
  return env;
}

/** @param {string} baseUrl @param {AbortSignal} [signal] */
export async function checkHealth(baseUrl, signal = AbortSignal.timeout(2_000)) {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal });
    return response.ok;
  } catch { return false; }
}

/** Bind rather than HTTP-probe: even a non-HTTP listener is a conflict. No PID discovery.
 * @param {number} port @returns {Promise<boolean>} */
export async function portAvailable(port) {
  // macOS can permit a wildcard bind beside a loopback listener; check both families explicitly.
  for (const host of ['127.0.0.1', '::1']) {
    const available = await new Promise((resolvePromise, reject) => {
    const probe = createServer();
    probe.once('error', (error) => {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EADDRINUSE') resolvePromise(false);
      else reject(error);
    });
      probe.listen({ port, host, exclusive: true }, () => probe.close((error) => error ? reject(error) : resolvePromise(true)));
    });
    if (!available) return false;
  }
  return true;
}

const STDERR_MAX_LINES = 20;
const STDERR_MAX_LINE_CHARS = 200;

export class AgentServerService {
  /** @type {import('node:child_process').ChildProcess | undefined} */
  #process;
  /** @type {string[]} */
  #stderrLines = [];
  /** @type {AgentServerStatus['status']} */
  #status = 'starting';
  /** @type {Promise<AgentServerStatus> | undefined} */
  #starting;
  /** @type {Promise<void> | undefined} */
  #stopping;
  #generation = 0;
  #abort = new AbortController();
  #release = () => {};
  /** @type {AgentServerFailureReason | undefined} */
  #failureReason;
  /** @type {string | undefined} */
  #errorMessage;
  /** @type {Set<(status: AgentServerStatus) => void>} */
  #listeners = new Set();

  /** @returns {AgentServerStatus} */
  get status() { return { status: this.#status, failureReason: this.#failureReason ?? null, stderrTail: this.#stderrTail(), errorMessage: this.#errorMessage ?? null }; }

  /** @param {(status: AgentServerStatus) => void} listener */
  onStatusChange(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }

  #emit() { const snapshot = this.status; for (const listener of this.#listeners) listener(snapshot); }

  /** @param {string} line */
  #appendStderr(line) {
    this.#stderrLines.push(line.slice(0, STDERR_MAX_LINE_CHARS));
    if (this.#stderrLines.length > STDERR_MAX_LINES) this.#stderrLines.shift();
  }

  #stderrTail() { return this.#stderrLines.length ? this.#stderrLines.join('\n') : null; }

  /** @param {AgentServerFailureReason} reason @param {string} errorMessage */
  #setFailed(reason, errorMessage) {
    this.#status = 'failed';
    this.#failureReason = reason;
    this.#errorMessage = errorMessage;
    this.#emit();
  }

  start() {
    if (this.#starting) return this.#starting;
    if (this.#process || this.#stopping) return Promise.resolve(this.status);
    this.#abort = new AbortController();
    this.#starting = this.#start(this.#generation).catch((error) => {
      this.reportStartupFailure(error);
      return this.status;
    }).finally(() => { this.#starting = undefined; });
    return this.#starting;
  }

  /** @param {unknown} error */
  reportStartupFailure(error) {
    this.#appendStderr(error instanceof Error ? error.message : String(error));
    this.#setFailed('startupFailed', 'Rhythm could not start its local runtime. Check disk permissions, then quit and reopen Rhythm to retry.');
  }

  /** @param {number} generation */
  async #start(generation) {
    this.#stderrLines = [];
    this.#status = 'starting';
    this.#failureReason = undefined;
    this.#errorMessage = undefined;
    this.#emit();

    for (const port of [AGENT_SERVER_PORT, AGENT_SERVER_ENGINE_PORT]) {
      if (!await portAvailable(port)) {
        this.#setFailed('portConflict', `Local runtime port ${port} is already in use. Quit Flutter or the other app/server using this port, then reopen Rhythm. Nothing was stopped or adopted.`);
        return this.status;
      }
    }
    if (generation !== this.#generation) return this.status;

    let material;
    try {
      material = await capabilityMaterial();
    } catch (error) {
      this.#setFailed('approvalCredentialsUnavailable', 'Rhythm could not unlock its human-approval Keychain identity. Unlock your Mac and try again.');
      return this.status;
    }

    const nodePath = await findNode();
    if (!nodePath) {
      this.#setFailed('nodeNotFound', "Couldn't find Node.js on this Mac. Install Node 20 or newer from nodejs.org and try again.");
      return this.status;
    }

    const serverInfo = findServerEntry(nodePath);
    if (!serverInfo) {
      this.#setFailed('bundleNotFound', 'The CLI server bundle is missing from this Rhythm install. Please reinstall Rhythm from the latest release.');
      return this.status;
    }

    const targetDbPath = dbPath();
    await mkdir(dirname(targetDbPath), { recursive: true });
    if (generation !== this.#generation) return this.status;

    const env = buildEnvironment({
      baseEnv: process.env,
      port: AGENT_SERVER_PORT,
      enginePort: AGENT_SERVER_ENGINE_PORT,
      dbPathValue: targetDbPath,
      humanApprovalPublicKey: material.humanApprovalPublicKey,
      humanApprovalCapabilitySha256: material.humanApprovalCapabilitySha256,
      mcpRolesDir: serverInfo.mcpRolesDir,
    });

    try {
      this.#process = spawn(serverInfo.executable, [...serverInfo.args, `--parent-pid=${process.pid}`], {
        cwd: serverInfo.workingDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.#appendStderr(error instanceof Error ? error.message : String(error));
      this.#setFailed('spawnThrew', "Couldn't start the local runtime process. Quit and reopen Rhythm to retry. See technical details below.");
      return this.status;
    }

    const proc = this.#process;
    const stdout = (/** @type {Buffer} */ chunk) => { process.stdout.write(`[api_server] ${chunk}`); };
    const stderr = (/** @type {Buffer} */ chunk) => {
      process.stderr.write(`[api_server] ${chunk}`);
      for (const line of String(chunk).split('\n')) if (line.trim()) this.#appendStderr(line);
    };
    const onError = (/** @type {Error} */ error) => {
      this.#appendStderr(error.message);
      if (!proc.pid) this.#release();
      this.#setFailed('spawnThrew', 'The local runtime process failed. Quit and reopen Rhythm to retry.');
    };
    const onExit = (/** @type {number | null} */ code) => {
      const stopping = this.#status === 'stopping';
      this.#release();
      if (stopping) { this.#status = 'stopped'; this.#emit(); }
      else this.#setFailed('lostConnection', `The local runtime exited (${code}). Quit and reopen Rhythm to retry.`);
    };
    this.#release = () => {
      proc.stdout?.off('data', stdout); proc.stderr?.off('data', stderr);
      proc.off('exit', onExit); proc.off('error', onError);
      if (this.#process === proc) this.#process = undefined;
      this.#abort.abort();
    };
    proc.on('error', onError); proc.on('exit', onExit);
    proc.stdout?.on('data', stdout); proc.stderr?.on('data', stderr);

    const ready = await this.#waitForReady();
    if (generation !== this.#generation || this.#process !== proc || this.#status !== 'starting') return this.status;
    if (!ready) {
      await this.stopGracefully();
      this.#setFailed('healthCheckTimeout', 'The local runtime did not respond within 8 seconds. Quit and reopen Rhythm to retry.');
      return this.status;
    }
    this.#status = 'ready';
    this.#emit();
    return this.status;
  }

  /** 8s wall-clock health budget, including requests (previous 40 x (200ms + 2s) could take 88s).
   * Owned-child shutdown can add up to 4s after timeout. No automatic restart. */
  async #waitForReady() {
    const deadline = Date.now() + 8_000;
    while (this.#process && this.#status === 'starting' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, Math.min(200, deadline - Date.now())));
      const remaining = deadline - Date.now();
      if (remaining <= 0 || this.#abort.signal.aborted) break;
      if (await checkHealth(AGENT_SERVER_BASE_URL, AbortSignal.any([this.#abort.signal, AbortSignal.timeout(Math.min(2_000, remaining))]))) return true;
    }
    return false;
  }

  markLostConnection() {
    if (this.#status === 'ready') this.#setFailed('lostConnection', 'The agent server stopped responding. Restart to bring it back.');
  }

  /** Signal only the exact ChildProcess spawned here; retain ownership until observed exit. */
  stopGracefully() {
    if (this.#stopping) return this.#stopping;
    this.#stopping = this.#stopOwned().finally(() => { this.#stopping = undefined; });
    return this.#stopping;
  }

  async #stopOwned() {
    this.#generation++;
    this.#abort.abort();
    const proc = this.#process;
    if (!proc) {
      if (this.#status === 'starting') { this.#status = 'stopped'; this.#emit(); }
      return;
    }
    this.#status = 'stopping'; this.#failureReason = undefined; this.#errorMessage = undefined; this.#emit();
    for (const signal of /** @type {const} */ (['SIGTERM', 'SIGKILL'])) {
      if (this.#process !== proc) return;
      await new Promise((resolvePromise) => {
        const finish = () => { clearTimeout(timer); proc.off('exit', finish); resolvePromise(undefined); };
        const timer = setTimeout(finish, 2_000);
        proc.once('exit', finish);
        try { proc.kill(signal); } catch (error) { this.#appendStderr(String(error)); finish(); }
      });
    }
    if (this.#process === proc) this.#setFailed('stopFailed', 'The owned local runtime did not exit. Quit Rhythm and check the process before reopening.');
  }

  stop() {
    this.#generation++;
    this.#abort.abort();
    if (!this.#process) return;
    this.#status = 'stopping'; this.#emit();
    try { this.#process.kill('SIGTERM'); }
    catch (error) { this.#appendStderr(String(error)); this.#setFailed('stopFailed', 'The owned runtime could not be stopped. Quit Rhythm and check the process before reopening.'); }
  }
}
