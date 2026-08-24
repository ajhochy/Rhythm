// Ports the Electron/React reference client to have Flutter's exact "the desktop app spawns and
// owns the local api_server" behavior (apps/desktop_flutter/lib/app/core/server/
// api_server_service.dart + agent_server_controller.dart) — apps/electron had none of this before;
// every renderer live-mode call previously assumed some OTHER process (usually
// `tools/dev/sandbox.sh`) was already running api_server.
//
// Production Electron is another client for the same local Rhythm runtime, not a permanent test
// sandbox. It therefore discovers/reuses Flutter's canonical API/engine ports and local database.
// Hermetic smoke runs remain isolated by their explicit RHYTHM_LIVE_* URLs plus isolated HOME and
// RHYTHM_SHELL_USER_DATA; main.mjs never starts this service for --smoke runs.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { capabilityMaterial } from './human-approval-main-signer.mjs';

const run = promisify(execFile);
const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {'nodeNotFound' | 'bundleNotFound' | 'spawnThrew' | 'healthCheckTimeout' | 'lostConnection' | 'approvalCredentialsUnavailable'} AgentServerFailureReason
 * @typedef {{ status: 'starting' | 'ready' | 'failed', failureReason: AgentServerFailureReason | null, stderrTail: string | null, errorMessage: string | null }} AgentServerStatus
 * @typedef {{ executable: string, args: string[], workingDir: string, mcpRolesDir: string | undefined }} ServerEntry
 */

export const AGENT_SERVER_PORT = 4001;
export const AGENT_SERVER_ENGINE_PORT = 4096;
export const AGENT_SERVER_BASE_URL = `http://127.0.0.1:${AGENT_SERVER_PORT}`;
const SANDBOX_MARKER = '--rhythm-sandbox=';

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

/** @param {string} baseUrl */
export async function checkHealth(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch { return false; }
}

/** api_server_service.dart:331-396 — best-effort; a leftover orphaned api_server from a crashed
 * previous run holds the port forever otherwise. Never touches a live tools/dev/sandbox.sh instance
 * (SANDBOX_MARKER) or anything that isn't unambiguously an orphaned (ppid===1) `node` process.
 * @param {number} port
 */
export async function killOrphanIfPresent(port) {
  try {
    const { stdout: lsofOut } = await run('lsof', ['-iTCP:' + port, '-sTCP:LISTEN', '-n', '-P']);
    const lines = lsofOut.trim().split('\n').slice(1);
    for (const line of lines) {
      const fields = line.trim().split(/\s+/);
      const [command, pid] = fields;
      if (!command?.includes('node') || !pid) continue;
      let psLine;
      try {
        const { stdout } = await run('ps', ['-o', 'ppid=,command=', '-p', pid]);
        psLine = stdout.trim();
      } catch { continue; }
      const ppid = psLine.trim().split(/\s+/)[0];
      if (ppid !== '1') continue;
      if (psLine.includes(SANDBOX_MARKER)) {
        process.stderr.write(`[agent-server] refusing to kill sandbox-marked orphan PID ${pid}\n`);
        continue;
      }
      process.stderr.write(`[agent-server] killing orphan PID ${pid} (${psLine}) to reclaim :${port}\n`);
      try { process.kill(Number(pid), 'SIGTERM'); } catch { /* already gone */ }
      await new Promise((r) => setTimeout(r, 500));
      break;
    }
  } catch { /* lsof found nothing listening — nothing to reclaim */ }
}

const STDERR_MAX_LINES = 20;
const STDERR_MAX_LINE_CHARS = 200;

export class AgentServerService {
  /** @type {import('node:child_process').ChildProcess | undefined} */
  #process;
  /** @type {string[]} */
  #stderrLines = [];
  /** @type {'starting' | 'ready' | 'failed'} */
  #status = 'starting';
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

  async start() {
    this.#stderrLines = [];
    this.#status = 'starting';
    this.#failureReason = undefined;
    this.#errorMessage = undefined;
    this.#emit();

    let material;
    try {
      material = await capabilityMaterial();
    } catch (error) {
      this.#setFailed('approvalCredentialsUnavailable', 'Rhythm could not unlock its human-approval Keychain identity. Unlock your Mac and try again.');
      return this.status;
    }

    await killOrphanIfPresent(AGENT_SERVER_PORT);

    if (await checkHealth(AGENT_SERVER_BASE_URL)) {
      this.#status = 'ready';
      this.#emit();
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
      this.#setFailed('spawnThrew', "Couldn't start the CLI server process. See technical details below.");
      this.#appendStderr(error instanceof Error ? error.message : String(error));
      return this.status;
    }

    this.#process.stdout?.on('data', (/** @type {Buffer} */ chunk) => process.stdout.write(`[api_server] ${chunk}`));
    this.#process.stderr?.on('data', (/** @type {Buffer} */ chunk) => {
      process.stderr.write(`[api_server] ${chunk}`);
      for (const line of String(chunk).split('\n')) if (line.trim()) this.#appendStderr(line);
    });
    this.#process.on('exit', (/** @type {number | null} */ code) => {
      process.stderr.write(`[agent-server] api_server exited with code ${code}\n`);
      this.#process = undefined;
    });

    const ready = await this.#waitForReady();
    if (!ready) {
      this.#setFailed('healthCheckTimeout', "The CLI server started but didn't respond in time. See technical details below.");
      return this.status;
    }
    this.#status = 'ready';
    this.#emit();
    return this.status;
  }

  /** api_server_service.dart:398-412 — 40 attempts x 200ms, ~8s total. */
  async #waitForReady() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((r) => setTimeout(r, 200));
      if (await checkHealth(AGENT_SERVER_BASE_URL)) return true;
    }
    return false;
  }

  markLostConnection() {
    if (this.#status === 'ready') this.#setFailed('lostConnection', 'The agent server stopped responding. Restart to bring it back.');
  }

  /** api_server_service.dart:134-151 — SIGTERM, race a 2s timer against real exit, SIGKILL if still alive. */
  async stopGracefully() {
    const proc = this.#process;
    if (!proc) return;
    proc.kill('SIGTERM');
    await Promise.race([
      new Promise((r) => proc.once('exit', r)),
      new Promise((r) => setTimeout(r, 2_000)),
    ]);
    if (this.#process === proc) { try { proc.kill('SIGKILL'); } catch { /* already gone */ } }
  }

  stop() {
    try { this.#process?.kill('SIGTERM'); } catch { /* already gone */ }
    this.#process = undefined;
  }
}
