/**
 * #1096 WP1 — device-local Engraph backend manager.
 *
 * Turns the operator-managed Engraph HTTP service assumed by #1093/#1095 into
 * something a nontechnical staff member can turn on from Settings, with no
 * shell and no environment variables. This file owns:
 *
 *  - DISCOVERY: find an `engraph` binary on PATH / common Homebrew locations,
 *    or validate a user-selected path. Never bundles/auto-installs it.
 *  - PATH/OWNERSHIP SAFETY: a Rhythm-only Engraph HOME (this app's Application
 *    Support dir), scoped to index ONLY Rhythm's canonical agent-memory
 *    directory. `~/.engraph` (the user's normal, global Engraph state) is
 *    NEVER read, written, or touched — see `engraphHomeDir()` below: Engraph
 *    resolves all of its own state under `$HOME/.engraph`, so spawning it
 *    with a Rhythm-only `HOME` env override sandboxes it completely (verified
 *    against the real `engraph` 1.7.2 binary during this work).
 *  - PROCESS OWNERSHIP: a private-home nonce reservation and verified OS
 *    start/command/process-group identities bind the detached relay to its
 *    backend. Unknown/foreign markers fail closed; never signal by name or port.
 *  - SERVICE CONTRACT: spawns `engraph serve --http --read-only` bound to
 *    127.0.0.1 with a freshly generated, never-persisted, read-only API key.
 *    `--read-only` disables Engraph's write MCP tools; the read-permission
 *    API key additionally makes every write REST endpoint 403 regardless
 *    (verified against the real binary). No write/index-arbitrary-path/admin
 *    capability is ever exposed through this seam.
 *  - HEALTH GATE: `checkHealthNow()` performs a REAL authenticated
 *    `/api/search` call with a 1-second budget. Process/port existence is
 *    never treated as "healthy" — only a successful authenticated search is.
 *  - CONFIG PERSISTENCE: see engraph_manager_config_store.ts. No secret or
 *    memory content is ever persisted there.
 *
 * Every failure path (missing binary, spawn failure, index failure, timeout,
 * malformed response, permission denial) leaves `getRetrievalClient()`
 * returning a client whose `search()` always resolves `[]` — the existing
 * `getRelevantMemoriesSemantic` FTS fallback in memory_retrieval.ts is
 * untouched and always wins.
 */
import { spawn, execFile, execFileSync, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import {
  mkdirSync, realpathSync, statSync, accessSync, constants as fsConstants,
  writeFileSync, chmodSync, readFileSync, existsSync, rmSync, linkSync, renameSync, lstatSync,
} from 'fs';
import { randomBytes, createHash } from 'crypto';
import { homedir } from 'os';
import net from 'net';
import path from 'path';
import { logger } from '../utils/logger';
import { getSemanticSearchBudgetMs, resolveMemoryDirPath } from '../config/env';
import { EngraphHttpClient, type EngraphClient } from './engraph_client';
import {
  EngraphManagerConfigStore,
  type EngraphDiscoverySource,
  type EngraphFailureCategory,
  type EngraphLifecycleState,
} from './engraph_manager_config_store';

const execFileAsync = promisify(execFile);

/** Homebrew install locations checked in addition to PATH (MVP: no bundling). */
const COMMON_BINARY_LOCATIONS = ['/opt/homebrew/bin/engraph', '/usr/local/bin/engraph'];
const HEALTH_CHECK_BUDGET_MS = 1_000;
// ponytail: a freshly spawned real Engraph process can take longer than 1s to
// finish loading its embedding model into memory (or, on a first run in a
// fresh HOME, to finish a one-time model download) before it starts
// listening — this is startup latency, not the steady-state health contract.
// Poll with the same strict 1s-budget health check until this deadline;
// bump if a much larger memory-vault / much slower first-run model fetch is
// observed in practice.
const STARTUP_HEALTH_TIMEOUT_MS = 45_000;
const STARTUP_HEALTH_POLL_MS = 500;
const INDEX_TIMEOUT_MS = 120_000;
const VALIDATE_TIMEOUT_MS = 5_000;
const STOP_GRACE_MS = 3_000;
/** Probe text for the health-gate search — never a real user query. */
const HEALTH_PROBE_QUERY = 'rhythm-engraph-health-check';
type Identity = { pid: number; start: string; command: string; pgid: number; ppid: number };
type OwnerMarker = {
  version: 1; nonce: string; state: 'starting' | 'serving'; home: string; root: string;
  binary: string; configHash: string; port: number; owner: Identity;
  relay?: Identity; child?: Identity; indexStarting?: boolean; indexRelay?: Identity; indexChild?: Identity;
};
const PROCESS_LIST_ARGS = ['-axo', 'pid=,ppid=,pgid=,lstart=,command='];

function parseProcessList(stdout: string): Identity[] {
  const result: Identity[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/);
    if (!match) continue;
    const [, pid, ppid, pgid, start, command] = match;
    const parsed = { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), start, command };
    if (parsed.pid > 1 && parsed.ppid >= 0 && parsed.pgid > 1 && !parsed.command.includes('\n')) result.push(parsed);
  }
  return result;
}

function inspectProcessesSync(): Identity[] | null {
  try {
    const stdout = execFileSync('/bin/ps', PROCESS_LIST_ARGS, { encoding: 'utf8', timeout: 1_000 });
    return parseProcessList(stdout);
  } catch { return null; }
}

function listProcessesSync(): Identity[] {
  return inspectProcessesSync() ?? [];
}

function fromSnapshot(expected: Identity | undefined, processes: readonly Identity[]): Identity | null {
  if (!expected) return null;
  return processes.find((process) => process.pid === expected.pid) ?? null;
}

function matchesSnapshot(
  expected: Identity | undefined,
  commandPart: string,
  processes: readonly Identity[],
  allowReparent = false,
): boolean {
  const actual = fromSnapshot(expected, processes);
  return !!actual && actual.start === expected!.start && actual.command === expected!.command &&
    actual.pgid === expected!.pgid && (allowReparent || actual.ppid === expected!.ppid) &&
    actual.command.includes(commandPart);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isServeProcess(process: Identity, binary: string): boolean {
  const invocation = process.command.slice(process.command.lastIndexOf(binary));
  return invocation.startsWith(binary) &&
    new RegExp(`^${escapeRegExp(binary)}\\s+serve(?:\\s|$)`).test(invocation) &&
    /(?:^|\s)--http(?:\s|$)/.test(invocation) &&
    /(?:^|\s)--port\s+\d+(?:\s|$)/.test(invocation) &&
    /(?:^|\s)--host\s+127\.0\.0\.1(?:\s|$)/.test(invocation);
}

// ps start time + full command prevent PID recycling or substitution from
// authorizing a signal. A failed/ambiguous probe is never an ownership proof.
function identity(pid: number): Identity | null {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    const opts = { encoding: 'utf8' as const, timeout: 1_000 };
    const start = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], opts).trim();
    const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], opts).trim();
    const pgid = Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'pgid='], opts).trim());
    const ppid = Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], opts).trim());
    return start && command && !command.includes('\n') && pgid > 1 && ppid >= 0 ? { pid, start, command, pgid, ppid } : null;
  } catch { return null; }
}

function matches(expected: Identity | undefined, commandPart: string, allowReparent = false): boolean {
  const actual = expected && identity(expected.pid);
  return !!actual && actual.start === expected!.start && actual.command === expected!.command &&
    actual.pgid === expected!.pgid && (allowReparent || actual.ppid === expected!.ppid) && actual.command.includes(commandPart);
}

function gone(expected: Identity | undefined): boolean {
  if (!expected || !Number.isSafeInteger(expected.pid) || expected.pid <= 1) return false;
  try { process.kill(expected.pid, 0); }
  catch (err) { return (err as NodeJS.ErrnoException).code === 'ESRCH'; }
  // EPERM, failed ps probes and unexpected identity results are ambiguous.
  const actual = identity(expected.pid);
  return !!actual && actual.start !== expected.start;
}

function markerAt(lock: string): OwnerMarker | null {
  try {
    if (!lstatSync(lock).isFile()) return null;
    const value = JSON.parse(readFileSync(lock, 'utf8')) as OwnerMarker;
    return value.version === 1 && /^[a-f0-9]{48}$/.test(value.nonce) ? value : null;
  } catch { return null; }
}

function publish(lock: string, marker: OwnerMarker, exclusive: boolean): void {
  const temp = `${lock}.${marker.nonce}.${randomBytes(6).toString('hex')}`;
  writeFileSync(temp, JSON.stringify(marker), { flag: 'wx', mode: 0o600 });
  try {
    if (exclusive) linkSync(temp, lock);
    else renameSync(temp, lock);
  } finally { rmSync(temp, { force: true }); }
}

async function reapVerifiedOrphan(lock: string, marker: OwnerMarker): Promise<boolean> {
  const same = () => markerAt(lock)?.nonce === marker.nonce;
  const relayLive = () => matches(marker.relay, marker.nonce);
  const childLive = () => matches(marker.child, marker.binary, !relayLive());
  if (relayLive()) {
    if (!childLive() || !same()) return false;
    if (marker.relay!.pgid !== marker.relay!.pid || marker.child!.pgid !== marker.relay!.pid) return false;
    try { process.kill(-marker.relay!.pid, 'SIGTERM'); } catch { return false; }
  } else if (gone(marker.relay) && childLive()) {
    // The relay died first. Signal only the child whose PID/start/command
    // still match this marker (never a process found by name or port).
    if (!same() || !marker.relay || marker.child!.pgid !== marker.relay.pid) return false;
    try { process.kill(marker.child!.pid, 'SIGTERM'); } catch { return false; }
  } else if (!gone(marker.relay)) return false;
  if (marker.child && !childLive() && !gone(marker.child)) return false;
  if (!marker.child && !gone(marker.owner)) return false;
  const deadline = Date.now() + STOP_GRACE_MS;
  while (childLive() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  if (childLive() && same()) {
    try {
      if (relayLive()) process.kill(-marker.relay!.pid, 'SIGKILL');
      else if (gone(marker.relay)) process.kill(marker.child!.pid, 'SIGKILL');
    } catch { return false; }
  }
  for (let i = 0; i < 10 && childLive(); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  if ((marker.relay && !gone(marker.relay)) || (marker.child && !gone(marker.child))) return false;
  if (same()) rmSync(lock, { force: true });
  return !existsSync(lock);
}

// ponytail: one detached process group per relay; its child inherits that
// group. TERM is bounded even for a backend that deliberately ignores it.
const SERVE_RELAY = `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const [binary, port, lock, parent, nonce] = process.argv.slice(1);
const ident = (pid) => {
  try {
    const opts = { encoding: 'utf8', timeout: 1000 };
    const start = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], opts).trim();
    const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], opts).trim();
    const pgid = Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'pgid='], opts).trim());
    const ppid = Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], opts).trim());
    return start && command && pgid > 1 && ppid >= 0 ? { pid, start, command, pgid, ppid } : null;
  } catch { return null; }
};
const current = () => { try { return JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { return null; } };
const owned = () => { const m = current(); return m && m.version === 1 && m.nonce === nonce &&
  (m.state === 'starting' && m.owner.pid === Number(parent) || m.relay?.pid === process.pid) ? m : null; };
const reservation = owned();
const parentIdentity = ident(Number(parent));
if (!reservation || !parentIdentity || parentIdentity.start !== reservation.owner.start ||
    parentIdentity.command !== reservation.owner.command || parentIdentity.pgid !== reservation.owner.pgid ||
    parentIdentity.ppid !== reservation.owner.ppid) process.exit(1);
const child = spawn(binary, ['serve', '--http', '--read-only', '--port', port, '--host', '127.0.0.1'],
  { env: { HOME: process.env.HOME, PATH: process.env.PATH }, stdio: 'ignore' });
let stopping = false;
const release = () => { if (owned()?.relay?.pid === process.pid) try { fs.rmSync(lock); } catch {} };
const stop = () => {
  if (stopping) return;
  stopping = true;
  if (child.exitCode !== null) { release(); process.exit(0); }
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    // The relay is this group's leader. Never signal a group if its child or
    // marker no longer belongs to this exact instance.
    const m = owned();
    const actual = child.pid && ident(child.pid);
    if (m?.relay?.pid === process.pid && actual && m.child?.start === actual.start &&
        m.child.command === actual.command && actual.pgid === process.pid && actual.command.includes(binary)) {
       child.kill('SIGKILL');
    }
    // If identity cannot be proven, leave the marker for operator review.
    else process.exit(1);
  }, 3000);
  timer.unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
const watch = setInterval(() => { if (process.ppid !== Number(parent)) stop(); }, 250);
child.on('error', () => { release(); process.exit(1); });
child.on('exit', () => { release(); process.exit(0); });
try {
   const currentReservation = owned();
   if (!currentReservation || currentReservation.relay || !child.pid) throw Error('owner marker changed');
  const relay = ident(process.pid), backend = ident(child.pid);
  if (!relay || !backend || relay.pgid !== process.pid || backend.pgid !== process.pid ||
      backend.ppid !== process.pid || !backend.command.includes(binary)) throw Error('process identity unavailable');
  const temp = lock + '.' + nonce + '.' + randomBytes(6).toString('hex');
   fs.writeFileSync(temp, JSON.stringify({ ...currentReservation, relay, child: backend }), { flag: 'wx', mode: 0o600 });
  try { if (!owned() || current().relay) throw Error('owner marker changed'); fs.renameSync(temp, lock); }
  finally { try { fs.rmSync(temp); } catch {} }
} catch { stop(); }
`;

// The index command is supervised by the same detached-relay pattern as the
// long-lived server. Its exact relay/child identities live in the reservation
// while indexing, so a killed parent cannot leave an invisible index worker
// and another manager cannot mistake the reservation for childless.
const INDEX_RELAY = `
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const [binary, vaultPath, rebuild, lock, parent, nonce] = process.argv.slice(1);
const ident = (pid) => {
  try {
    const opts = { encoding: 'utf8', timeout: 1000 };
    const start = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], opts).trim();
    const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], opts).trim();
    const pgid = Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'pgid='], opts).trim());
    const ppid = Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], opts).trim());
    return start && command && pgid > 1 && ppid >= 0 ? { pid, start, command, pgid, ppid } : null;
  } catch { return null; }
};
const current = () => { try { return JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { return null; } };
const owned = () => { const m = current(); return m && m.version === 1 && m.nonce === nonce &&
  m.state === 'starting' && m.owner.pid === Number(parent) &&
  (!m.indexRelay || m.indexRelay.pid === process.pid) ? m : null; };
const write = (marker) => {
  const temp = lock + '.' + nonce + '.' + randomBytes(6).toString('hex');
  fs.writeFileSync(temp, JSON.stringify(marker), { flag: 'wx', mode: 0o600 });
  try {
    if (!owned()) throw Error('owner marker changed');
    fs.renameSync(temp, lock);
  } finally { try { fs.rmSync(temp); } catch {} }
};
const reservation = owned();
const parentIdentity = ident(Number(parent));
if (!reservation || !parentIdentity || parentIdentity.start !== reservation.owner.start ||
    parentIdentity.command !== reservation.owner.command || parentIdentity.pgid !== reservation.owner.pgid ||
    parentIdentity.ppid !== reservation.owner.ppid) process.exit(1);
const args = ['index', vaultPath];
if (rebuild === '1') args.push('--rebuild');
const child = spawn(binary, args, {
  env: { HOME: process.env.HOME, PATH: process.env.PATH },
  stdio: 'ignore',
});
let stopping = false;
let finished = false;
let watch;
const clearIdentity = () => {
  const m = owned();
  if (!m || (m.indexRelay && m.indexRelay.pid !== process.pid) ||
      (m.indexChild && m.indexChild.pid !== child.pid)) return;
  const next = { ...m };
  delete next.indexStarting;
  delete next.indexRelay;
  delete next.indexChild;
  try { write(next); } catch {}
};
const finish = (code) => {
  if (finished) return;
  finished = true;
  if (watch) clearInterval(watch);
  clearIdentity();
  process.exit(code ?? 1);
};
const stop = () => {
  if (stopping) return;
  stopping = true;
  if (child.exitCode !== null) { finish(child.exitCode); return; }
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    const m = owned();
    const actual = child.pid && ident(child.pid);
    if (m?.indexRelay?.pid === process.pid && actual && m.indexChild?.start === actual.start &&
        m.indexChild.command === actual.command && actual.pgid === process.pid && actual.command.includes(binary)) {
      child.kill('SIGKILL');
    } else process.exit(1);
  }, 3000);
  timer.unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
watch = setInterval(() => { if (process.ppid !== Number(parent)) stop(); }, 250);
child.on('error', () => finish(1));
child.on('exit', (code) => finish(code));
try {
  const relay = ident(process.pid), indexChild = child.pid && ident(child.pid);
  if (!relay || !indexChild || relay.pgid !== process.pid || indexChild.pgid !== process.pid ||
      indexChild.ppid !== process.pid || !indexChild.command.includes(binary)) {
    if (child.exitCode !== null) finish(child.exitCode);
    else throw Error('process identity unavailable');
  } else {
    const m = owned();
    if (!m || m.indexRelay || m.indexChild) throw Error('owner marker changed');
    const next = { ...m, indexRelay: relay, indexChild };
    delete next.indexStarting;
    write(next);
  }
} catch { stop(); }
`;
const managedByHome = new Map<string, EngraphManager>();

export interface EngraphBinaryCandidate {
  path: string;
  source: EngraphDiscoverySource;
}

export interface EngraphValidationResult {
  ok: boolean;
  version?: string;
  reason?: 'not_found' | 'not_executable' | 'unexpected_output' | 'exec_failed';
}

export interface EngraphHealthResult {
  ok: boolean;
  category?: EngraphFailureCategory;
  message?: string;
  latencyMs?: number;
}

export interface EngraphManagerStatus {
  backendCount: number;
  backendOwnership: 'owned' | 'reused' | 'foreign' | 'none';
  backends: Array<{
    pid: number;
    classification: 'owned' | 'reused' | 'foreign' | 'stray';
    state: 'healthy' | 'unhealthy' | 'unknown';
    action: 'disable' | 'inspect-manually';
  }>;
  enabled: boolean;
  state: EngraphLifecycleState;
  executablePath: string | null;
  discoverySource: EngraphDiscoverySource | null;
  version: string | null;
  approvedMemoryRoot: string | null;
  engraphHomeDir: string;
  lastHealthyAt: string | null;
  lastFailureCategory: EngraphFailureCategory | null;
  lastFailureMessage: string | null;
}

type ExecFileImpl = (
  file: string,
  args: string[],
  opts: { timeout?: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal },
) => Promise<{ stdout: string; stderr: string }>;

// ---------------------------------------------------------------------------
// Pure / injectable helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export function isExecutableFile(candidate: string): boolean {
  try {
    const st = statSync(candidate);
    if (!st.isFile()) return false;
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Check PATH + known Homebrew locations. Never bundles/auto-installs. */
export function discoverEngraphCandidates(
  pathEnv: string = process.env.PATH ?? '',
  commonLocations: readonly string[] = COMMON_BINARY_LOCATIONS,
): EngraphBinaryCandidate[] {
  const found: EngraphBinaryCandidate[] = [];
  const seen = new Set<string>();
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, 'engraph');
    if (!seen.has(candidate) && isExecutableFile(candidate)) {
      found.push({ path: candidate, source: 'path' });
      seen.add(candidate);
    }
  }
  for (const candidate of commonLocations) {
    if (!seen.has(candidate) && isExecutableFile(candidate)) {
      found.push({ path: candidate, source: 'homebrew' });
      seen.add(candidate);
    }
  }
  return found;
}

/**
 * Treat `candidatePath` as UNTRUSTED input (discovered or user-selected):
 * resolve symlinks, confirm it is a real executable file, then confirm it
 * actually runs and self-identifies as `engraph <version>` via a fixed
 * `--version` invocation (execFile — no shell interpretation). Anything that
 * doesn't match is rejected rather than persisted.
 */
export async function validateEngraphBinary(
  candidatePath: string,
  execFileImpl: ExecFileImpl = execFileAsync as unknown as ExecFileImpl,
): Promise<EngraphValidationResult> {
  let real: string;
  try {
    real = realpathSync(candidatePath);
  } catch {
    return { ok: false, reason: 'not_found' };
  }
  if (!isExecutableFile(real)) return { ok: false, reason: 'not_executable' };
  try {
    const { stdout } = await execFileImpl(real, ['--version'], { timeout: VALIDATE_TIMEOUT_MS });
    const match = stdout.trim().match(/^engraph (\d+\.\d+\.\d+)/);
    if (!match) return { ok: false, reason: 'unexpected_output' };
    return { ok: true, version: match[1] };
  } catch {
    return { ok: false, reason: 'exec_failed' };
  }
}

/** Resolve Rhythm's canonical, symlink-resolved agent-memory root — the ONLY
 *  directory the MVP ever indexes. Creates it if absent (mirrors the
 *  existing `resolveMemoryDirPath()` write-path convention). */
export function resolveApprovedMemoryRoot(): string {
  const dir = resolveMemoryDirPath();
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

/**
 * Defense-in-depth confinement guard: true only when `candidate`, after
 * resolving symlinks, is EXACTLY the approved agent-memory root. Rejects
 * traversal (`..`), a symlink that escapes the root, a parent/sibling/whole-
 * vault folder, and any nonexistent path. The manager itself never accepts a
 * caller-supplied vault path at all (no folder picker in the MVP) — this
 * guard exists so that invariant is independently testable and to mirror the
 * confinement style of `mapEngraphFileToSourceId` in engraph_client.ts.
 */
export function isWithinApprovedMemoryRoot(candidate: string): boolean {
  const approved = resolveApprovedMemoryRoot();
  try {
    return realpathSync(path.resolve(candidate)) === approved;
  } catch {
    return false;
  }
}

/** Strip anything resembling a filesystem path or an Engraph API key from an
 *  error message before it is logged, persisted, or returned via the API. */
export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/eg_[a-f0-9]+/gi, '<redacted>')
    .replace(/(\/[^\s"']+)/g, '<path>')
    .slice(0, 300);
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error('could not allocate a free port'));
      });
    });
  });
}

// ---------------------------------------------------------------------------
// EngraphManager
// ---------------------------------------------------------------------------

export interface EngraphManagerDeps {
  configStore?: EngraphManagerConfigStore;
  spawnFn?: typeof spawn;
  execFileImpl?: ExecFileImpl;
  fetchImpl?: typeof fetch;
  discover?: (pathEnv?: string) => EngraphBinaryCandidate[];
  processListSync?: () => Identity[];
  homeDir?: string;
}

export class EngraphManager {
  private readonly store: EngraphManagerConfigStore;
  private readonly spawnFn: typeof spawn;
  private readonly execFileImpl: ExecFileImpl;
  private readonly injectedExecFile: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly discoverFn: (pathEnv?: string) => EngraphBinaryCandidate[];
  private readonly processListSync: () => Identity[];
  private readonly homeDirOverride?: string;

  /** Exact spawned relay handle; group fallback requires matching marker and OS identity. */
  private child: ChildProcess | null = null;
  private childPid: number | null = null;
  private port: number | null = null;
  /** Generated fresh on every (re)start; never persisted. */
  private apiKey: string | null = null;
  private version: string | null = null;
  /** True only once a real authenticated 1s search has succeeded post-spawn. */
  private ready = false;
  private inFlight: Promise<{ ok: boolean; reason?: string }> | null = null;
  private reusedFrom: EngraphManager | null = null;
  private generation = 0;
  private startAbort: AbortController | null = null;
  private reservation: OwnerMarker | null = null;
  private indexProcess: ChildProcess | null = null;
  private closed = false;

  constructor(deps: EngraphManagerDeps = {}) {
    this.store = deps.configStore ?? new EngraphManagerConfigStore();
    this.spawnFn = deps.spawnFn ?? spawn;
    this.execFileImpl = deps.execFileImpl ?? (execFileAsync as unknown as ExecFileImpl);
    this.injectedExecFile = deps.execFileImpl !== undefined;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.discoverFn = deps.discover ?? discoverEngraphCandidates;
    this.processListSync = deps.processListSync ?? listProcessesSync;
    this.homeDirOverride = deps.homeDir;
  }

  private engraphHomeDir(): string {
    return (
      this.homeDirOverride ??
      process.env.RHYTHM_ENGRAPH_HOME_DIR ??
      path.join(homedir(), 'Library', 'Application Support', 'Rhythm', 'engraph-home')
    );
  }

  getStatus(): EngraphManagerStatus {
    const cfg = this.store.read();
    const home = this.engraphHomeDir();
    const lock = path.join(home, '.engraph', 'serve.owner');
    const marker = markerAt(lock);
    const processes = this.processListSync();
    const reused = this.reusedFrom;
    const reusedReservation = reused?.reservation;
    const reuseIsCurrent = !!reused && managedByHome.get(home) === reused && reused.ready && reused.child !== null &&
      (reused.spawnFn !== spawn || (!!marker && !!reusedReservation && marker.nonce === reusedReservation.nonce &&
        marker.relay?.pgid === marker.relay?.pid && marker.child?.pgid === marker.relay?.pid &&
        matchesSnapshot(marker.relay, marker.nonce, processes) &&
        matchesSnapshot(marker.child, marker.binary, processes)));
    if (reused && !reuseIsCurrent) {
      this.reusedFrom = null;
      if (!this.child) {
        this.ready = false;
        this.port = null;
        this.apiKey = null;
      }
    }
    const binary = cfg.executablePath ?? marker?.binary;
    const serveProcesses = binary
      ? processes.filter((process) => isServeProcess(process, binary))
      : [];
    const own = this.reservation;
    const backends: EngraphManagerStatus['backends'] = serveProcesses.map((process) => {
      const markerChild = marker?.child?.pid === process.pid &&
        matchesSnapshot(marker.child, marker.binary, processes, true);
      const owned = !!markerChild && !!own && marker!.nonce === own.nonce && marker!.home === own.home &&
        marker!.root === own.root && marker!.binary === own.binary && marker!.configHash === own.configHash;
      const reusedBackend = !!markerChild && reuseIsCurrent && !!reusedReservation &&
        marker!.nonce === reusedReservation.nonce;
      const classification = owned ? 'owned' : reusedBackend ? 'reused' : markerChild ? 'foreign' : 'stray';
      const manager = classification === 'reused' ? reused : this;
      return {
        pid: process.pid,
        classification,
        state: classification === 'owned' || classification === 'reused'
          ? manager?.ready ? 'healthy' : 'unhealthy'
          : 'unknown',
        action: classification === 'owned' || classification === 'reused' ? 'disable' : 'inspect-manually',
      };
    });
    // Injected process handles deliberately do not exist in the real process
    // table. Preserve their unit-test lifecycle semantics without weakening
    // real status discovery.
    if (this.spawnFn !== spawn && this.ready && this.child && this.childPid && backends.length === 0) {
      backends.push({
        pid: this.childPid,
        classification: reuseIsCurrent ? 'reused' : 'owned',
        state: 'healthy',
        action: 'disable',
      });
    }
    const current = backends.find((backend) => backend.classification === 'owned' || backend.classification === 'reused');
    const backendOwnership: EngraphManagerStatus['backendOwnership'] = current
      ? current.classification === 'owned' ? 'owned' : 'reused'
      : backends.length > 0 || existsSync(lock) ? 'foreign' : 'none';
    return {
      backendCount: backends.length,
      backendOwnership,
      backends,
      enabled: cfg.enabled,
      state: cfg.state,
      executablePath: cfg.executablePath,
      discoverySource: cfg.discoverySource,
      version: this.version,
      approvedMemoryRoot: cfg.approvedMemoryRoot,
      engraphHomeDir: home,
      lastHealthyAt: cfg.lastHealthyAt,
      lastFailureCategory: cfg.lastFailureCategory,
      lastFailureMessage: cfg.lastFailureMessage,
    };
  }

  discover(): EngraphBinaryCandidate[] {
    return this.discoverFn();
  }

  /** Validate a user-selected binary path and persist it ONLY if valid. */
  async chooseBinary(candidatePath: string): Promise<{ ok: boolean; reason?: string }> {
    const result = await validateEngraphBinary(candidatePath, this.execFileImpl);
    if (!result.ok) {
      this.store.write({
        state: 'error',
        lastFailureCategory: 'binary_invalid',
        lastFailureMessage: `selected executable failed validation (${result.reason ?? 'unknown'})`,
      });
      return { ok: false, reason: result.reason };
    }
    this.version = result.version ?? null;
    this.store.write({
      executablePath: realpathSync(candidatePath),
      discoverySource: 'user-selected',
      state: 'discovering',
      lastFailureCategory: null,
      lastFailureMessage: null,
    });
    return { ok: true };
  }

  /** Persist a discovered (not user-typed) candidate — same validation path. */
  async chooseDiscovered(candidate: EngraphBinaryCandidate): Promise<{ ok: boolean; reason?: string }> {
    const result = await this.chooseBinary(candidate.path);
    if (result.ok) this.store.write({ discoverySource: candidate.source });
    return result;
  }

  async enable(): Promise<{ ok: boolean; reason?: string }> {
    if (this.closed) return { ok: false, reason: 'cancelled' };
    this.store.write({ enabled: true });
    return this.ensureStarted();
  }

  async disable(): Promise<void> {
    this.cancelStart();
    await this.stopManagedProcess();
    this.store.write({ enabled: false, state: 'disabled' });
  }

  async retry(): Promise<{ ok: boolean; reason?: string }> {
    return this.ensureStarted();
  }

  async rebuild(): Promise<{ ok: boolean; reason?: string }> {
    if (this.closed) return { ok: false, reason: 'cancelled' };
    this.cancelStart();
    await this.stopManagedProcess();
    this.store.write({ enabled: true });
    return this.ensureStarted({ rebuild: true });
  }

  /** Non-blocking startup hook — fire-and-forget, never awaited by boot. */
  ensureStartedIfEnabled(): void {
    const cfg = this.store.read();
    if (cfg.enabled && cfg.executablePath) {
      this.ensureStarted().catch((err) => {
        logger.warn(`[EngraphManager] startup ensureStarted failed (non-fatal): ${sanitizeErrorMessage(err)}`);
      });
    }
  }

  /** Real authenticated 1-second-budget search — the ONLY thing that can mark
   *  the managed service healthy. Process/port existence is never enough. */
  async checkHealthNow(): Promise<EngraphHealthResult> {
    if (!this.port || !this.apiKey) {
      this.ready = false;
      return { ok: false, category: 'health_check_failed', message: 'no managed service is running' };
    }
    const startedAt = Date.now();
    try {
      const response = await this.fetchImpl(`http://127.0.0.1:${this.port}/api/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ query: HEALTH_PROBE_QUERY, top_n: 1 }),
        signal: this.startAbort ? AbortSignal.any([AbortSignal.timeout(HEALTH_CHECK_BUDGET_MS), this.startAbort.signal]) : AbortSignal.timeout(HEALTH_CHECK_BUDGET_MS),
      });
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        this.ready = false;
        const category: EngraphFailureCategory =
          response.status === 401 || response.status === 403 ? 'permission_denied' : 'health_check_failed';
        return { ok: false, category, message: `search responded ${response.status}`, latencyMs };
      }
      const body: unknown = await response.json();
      const isArrayShaped =
        Array.isArray(body) ||
        (!!body && typeof body === 'object' && Array.isArray((body as { results?: unknown }).results));
      if (!isArrayShaped) {
        this.ready = false;
        return { ok: false, category: 'health_check_failed', message: 'malformed search response', latencyMs };
      }
      if (this.startAbort?.signal.aborted) return { ok: false, category: 'health_check_failed', message: 'start cancelled' };
      // Health alone does not authorize a backend whose process identity is
      // still being verified by the startup path.
      if (this.reservation?.state !== 'starting') this.ready = true;
      this.store.write({ lastHealthyAt: new Date().toISOString() });
      return { ok: true, latencyMs };
    } catch (err) {
      this.ready = false;
      const name = (err as { name?: string } | undefined)?.name;
      const category: EngraphFailureCategory = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'health_check_failed';
      return { ok: false, category, message: sanitizeErrorMessage(err) };
    }
  }

  /**
   * The client fed to memory_retrieval.ts. Returns a client pointed at the
   * managed, authenticated loopback service ONLY once this manager is enabled
   * and has passed a real health check. Otherwise falls back to a plain
   * `new EngraphHttpClient()` — the pre-existing #1093/#1095 operator-managed
   * client, which reads `ENGRAPH_MEMORY_URL` and fails closed to `[]` when
   * that's unset. This makes the manager purely ADDITIVE: an operator who
   * never turns the manager on (its default state) gets byte-for-byte the
   * same behavior as before this feature existed, while an unavailable/
   * unhealthy managed service is indistinguishable, from the retrieval seam's
   * point of view, from Engraph being absent — the existing FTS fallback
   * always wins either way.
   */
  getRetrievalClient(): EngraphClient {
    // Step 3: both the managed client and the fallback client use the
    // configurable prompt-path budget (getSemanticSearchBudgetMs(), default
    // 500ms) as their search timeout. This is the steady-state budget, kept
    // separate from HEALTH_CHECK_BUDGET_MS/startup/index timeouts above.
    const budgetMs = getSemanticSearchBudgetMs();
    if (!this.ready || !this.port || !this.apiKey) return new EngraphHttpClient(undefined, undefined, budgetMs);
    return new EngraphHttpClient(`http://127.0.0.1:${this.port}`, this.fetchImpl, budgetMs, this.apiKey);
  }

  // -- lifecycle internals ---------------------------------------------------

  private async ensureStarted(opts: { rebuild?: boolean } = {}): Promise<{ ok: boolean; reason?: string }> {
    if (this.closed) return { ok: false, reason: 'cancelled' };
    if (this.inFlight) return this.inFlight;
    const generation = this.generation;
    const run = this._doStart(opts).finally(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private cancelStart(): void {
    this.generation++;
    this.startAbort?.abort();
  }

  private releaseReservation(): void {
    const own = this.reservation;
    if (!own) return;
    const lock = path.join(own.home, '.engraph', 'serve.owner');
    const current = markerAt(lock);
    if (current?.nonce === own.nonce && current.state === 'starting' && !current.relay &&
        !current.indexStarting && !current.indexRelay && !current.indexChild) {
      rmSync(lock, { force: true });
    }
    this.reservation = null;
  }

  private async _doStart(opts: { rebuild?: boolean }): Promise<{ ok: boolean; reason?: string }> {
    const generation = this.generation;
    const abort = new AbortController();
    this.startAbort = abort;
    const cancelled = () => generation !== this.generation || abort.signal.aborted;
    const stopped = () => ({ ok: false, reason: 'cancelled' });
    try {
    const cfg = this.store.read();
    if (!cfg.enabled) return { ok: false, reason: 'disabled' };
    if (!cfg.executablePath || !isExecutableFile(cfg.executablePath)) {
      return this._fail('binary_not_found', 'no valid Engraph executable is configured');
    }

    let approvedRoot: string;
    try {
      approvedRoot = resolveApprovedMemoryRoot();
    } catch (err) {
      return this._fail('permission_denied', `could not resolve the agent-memory directory: ${sanitizeErrorMessage(err)}`);
    }
    const home = this.engraphHomeDir();
    const existing = managedByHome.get(home);
    if (existing && existing !== this && existing.inFlight) await existing.inFlight;
    if (cancelled()) return stopped();
    const existingMarker = existing?.reservation && markerAt(path.join(home, '.engraph', 'serve.owner'));
    const verifiedReuse = existing?.spawnFn !== spawn || (!!existingMarker &&
      existingMarker.state === 'serving' && existingMarker.nonce === existing?.reservation?.nonce &&
      existingMarker.root === approvedRoot && existingMarker.binary === cfg.executablePath &&
      matches(existingMarker.relay, existingMarker.nonce) && matches(existingMarker.child, existingMarker.binary));
    if (existing && existing !== this && existing.ready && existing.store.read().approvedMemoryRoot === approvedRoot &&
        existing.store.read().executablePath === cfg.executablePath && verifiedReuse &&
        await existing.checkHealthNow().then((h) => h.ok) && !cancelled()) {
      this.reusedFrom = existing;
      this.port = existing.port;
      this.apiKey = existing.apiKey;
      this.version = existing.version;
      this.ready = true;
      this.store.write({ approvedMemoryRoot: approvedRoot, state: 'ready' });
      return { ok: true };
    }
    if ((this.child || this.reusedFrom) && this.ready && await this.checkHealthNow().then((h) => h.ok) && !cancelled()) return { ok: true };
    if (this.reusedFrom) {
      // The previously reused owner is no longer current/healthy. This
      // manager is about to reserve and spawn its own backend, so no later
      // status/disable path may keep delegating to the obsolete owner.
      this.reusedFrom = null;
      this.ready = false;
      this.port = null;
      this.apiKey = null;
    }
    this.store.write({ approvedMemoryRoot: approvedRoot, state: 'indexing' });
    try {
      mkdirSync(path.join(home, '.engraph'), { recursive: true });
    } catch (err) {
      return this._fail('permission_denied', `could not create the Rhythm-only Engraph home: ${sanitizeErrorMessage(err)}`);
    }
    const lock = path.join(home, '.engraph', 'serve.owner');
    if (this.spawnFn === spawn) {
      const old = markerAt(lock);
      if (existsSync(lock)) {
        // A starting owner still alive may be another in-flight manager or
        // another process. Never erase its reservation or signal it.
        if (old && old.home === home && old.root === approvedRoot && old.binary === cfg.executablePath &&
            old.state === 'starting' && !old.relay && !old.child && !old.indexStarting &&
            !old.indexRelay && !old.indexChild &&
            gone(old.owner) &&
            (!old.configHash || (() => { try {
              return createHash('sha256').update(readFileSync(path.join(home, '.engraph', 'config.toml'))).digest('hex') === old.configHash;
            } catch { return false; } })())) {
          if (markerAt(lock)?.nonce === old.nonce) rmSync(lock, { force: true });
        }
      }
      if (existsSync(lock)) {
        let configHash: string | null = null;
        try { configHash = createHash('sha256').update(readFileSync(path.join(home, '.engraph', 'config.toml'))).digest('hex'); } catch { /* unverified */ }
        if (!old || old.home !== home || old.root !== approvedRoot || old.binary !== cfg.executablePath ||
            !old.configHash || old.configHash !== configHash || !old.port ||
            (old.relay && (!old.child || !old.relay.command.includes(old.nonce) || !old.child.command.includes(old.binary)))) {
          return this._fail('spawn_failed', 'an Engraph owner marker has unverified ownership; refusing to replace it');
        }
        if (!gone(old.owner) || !await reapVerifiedOrphan(lock, old)) {
          return this._fail('spawn_failed', 'another owner is running or ownership could not be verified');
        }
      }
      if (!existsSync(lock)) {
        const processes = inspectProcessesSync();
        if (!processes) {
          return this._fail('spawn_failed', 'could not inspect existing Engraph processes; refusing to spawn');
        }
        const strays = processes.filter((process) => isServeProcess(process, cfg.executablePath!));
        if (strays.length > 0) {
          return this._fail(
            'spawn_failed',
            'an unmarked Engraph backend may use this managed home; inspect it manually before retrying',
          );
        }
      }
      if (cancelled()) return stopped();
      try {
        const owner = identity(process.pid);
        if (!owner) throw Error('owner identity unavailable');
        this.reservation = { version: 1, nonce: randomBytes(24).toString('hex'), state: 'starting',
          home, root: approvedRoot, binary: cfg.executablePath, configHash: '', port: 0, owner };
        publish(lock, this.reservation, true);
        managedByHome.set(home, this);
      } catch {
        this.reservation = null;
        return this._fail('spawn_failed', 'an Engraph owner marker already exists; refusing to overwrite it');
      }
    }

    // On a fresh unowned start, publish same-home ownership before awaiting
    // validation. Concurrent starts are then ordered by their reservation,
    // not by how quickly independent --version probes happen to return.
    const binaryValidation = await validateEngraphBinary(cfg.executablePath, this.execFileImpl);
    if (!binaryValidation.ok) {
      return this._fail(
        'binary_invalid',
        `configured Engraph executable failed validation (${binaryValidation.reason ?? 'unknown'})`,
      );
    }
    this.version = binaryValidation.version ?? null;

    // Fresh port + credentials every (re)start; never persisted to disk in
    // Rhythm's own config store (only into Engraph's own config.toml, under
    // the Rhythm-only HOME, mode 0600).
    let port: number;
    try {
      port = await findFreePort();
    } catch (err) {
      return this._fail('spawn_failed', `could not allocate a loopback port: ${sanitizeErrorMessage(err)}`);
    }
    if (cancelled()) return stopped();
    const apiKey = `eg_${randomBytes(24).toString('hex')}`;
    try {
      this._writeEngraphConfig(home, approvedRoot, port, apiKey);
      if (this.reservation) {
        this.reservation.port = port;
        this.reservation.configHash = createHash('sha256').update(readFileSync(path.join(home, '.engraph', 'config.toml'))).digest('hex');
        if (markerAt(lock)?.nonce !== this.reservation.nonce) return this._fail('spawn_failed', 'owner marker changed during configuration');
        publish(lock, this.reservation, false);
      }
    } catch (err) {
      return this._fail('permission_denied', `could not configure Engraph: ${sanitizeErrorMessage(err)}`);
    }

    try {
      await this._runIndex(cfg.executablePath, home, approvedRoot, opts.rebuild === true);
    } catch (err) {
      if (cancelled()) return stopped();
      return this._fail('index_failed', `indexing the agent-memory directory failed: ${sanitizeErrorMessage(err)}`);
    }
    if (cancelled()) return stopped();

    this.store.write({ state: 'starting' });
    this.port = port;
    this.apiKey = apiKey;
    try {
      await this._spawnServe(cfg.executablePath, home, port);
    } catch (err) {
      this.port = null;
      this.apiKey = null;
      if (cancelled()) return stopped();
      return this._fail('spawn_failed', `failed to start the managed service: ${sanitizeErrorMessage(err)}`);
    }

    if (cancelled()) { await this.stopOwnedChild(); return stopped(); }

    const health = await this._waitForHealthy(STARTUP_HEALTH_TIMEOUT_MS);
    if (!health.ok) {
      await this.stopOwnedChild();
      if (cancelled()) return stopped();
      return this._fail(health.category ?? 'health_check_failed', health.message ?? 'health check failed');
    }
    if (cancelled()) { await this.stopOwnedChild(); return stopped(); }
    if (this.reservation) {
      const verify = (): { marker?: OwnerMarker; reason: string; retryable: boolean } => {
        const marker = markerAt(lock);
        if (!marker) return { reason: 'marker_unavailable', retryable: true };
        if (marker.nonce !== this.reservation!.nonce) return { reason: 'marker_nonce_mismatch', retryable: false };
        if (marker.configHash !== this.reservation!.configHash) return { reason: 'config_hash_mismatch', retryable: false };
        if (!marker.relay || !marker.child) return { reason: 'marker_incomplete', retryable: true };
        let processes: Identity[];
        try { processes = this.processListSync(); }
        catch { return { reason: 'os_probe_unavailable', retryable: true }; }
        if (!fromSnapshot(marker.relay, processes)) return { reason: 'relay_probe_unavailable', retryable: true };
        if (!matchesSnapshot(marker.relay, marker.nonce, processes)) return { reason: 'relay_identity_mismatch', retryable: false };
        if (!fromSnapshot(marker.child, processes)) return { reason: 'child_probe_unavailable', retryable: true };
        if (!matchesSnapshot(marker.child, cfg.executablePath!, processes)) return { reason: 'child_identity_mismatch', retryable: false };
        return { marker, reason: 'verified', retryable: false };
      };
      let proof = verify();
      for (let attempt = 1; !proof.marker && proof.retryable && attempt < 3; attempt++) {
        if (cancelled() || !this.child || this.child.exitCode !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 75));
        if (cancelled()) break;
        proof = verify();
      }
      if (cancelled()) { await this.stopOwnedChild(); return stopped(); }
      if (!proof.marker) {
        await this.stopOwnedChild();
        return this._fail('spawn_failed', `managed backend identity could not be verified (${proof.reason})`);
      }
      this.reservation = { ...proof.marker, state: 'serving' };
      publish(lock, this.reservation, false);
      this.ready = true;
    }
    this.store.write({ state: 'ready', lastFailureCategory: null, lastFailureMessage: null });
    managedByHome.set(home, this);
    return { ok: true };
    } finally {
      if (this.startAbort === abort) this.startAbort = null;
      if (!this.ready || cancelled()) {
        this.ready = false;
        this.releaseReservation();
        if (managedByHome.get(this.engraphHomeDir()) === this && !this.child) managedByHome.delete(this.engraphHomeDir());
      }
    }
  }

  /**
   * Poll the strict 1s-budget health check on a fixed interval until it
   * passes or `deadlineMs` elapses. Only retries connection-level failures
   * (`health_check_failed`/`timeout` — plausibly the process still starting
   * up); a `permission_denied` or other categorized failure returns
   * immediately, since waiting cannot fix a real auth/config problem.
   */
  private async _waitForHealthy(deadlineMs: number): Promise<EngraphHealthResult> {
    const deadline = Date.now() + deadlineMs;
    let last: EngraphHealthResult = { ok: false, category: 'health_check_failed', message: 'not checked yet' };
    for (;;) {
      if (this.startAbort?.signal.aborted) return { ok: false, category: 'health_check_failed', message: 'start cancelled' };
      if (this.child && (this.child.exitCode != null || this.child.signalCode != null)) return { ok: false, category: 'health_check_failed', message: 'managed service exited' };
      last = await this.checkHealthNow();
      if (last.ok) return last;
      if (last.category !== 'health_check_failed' && last.category !== 'timeout') return last;
      if (Date.now() >= deadline) return last;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, STARTUP_HEALTH_POLL_MS);
        this.startAbort?.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(undefined); }, { once: true });
      });
    }
  }

  private _fail(category: EngraphFailureCategory, message: string): { ok: false; reason: string } {
    this.ready = false;
    this.store.write({ state: 'error', lastFailureCategory: category, lastFailureMessage: message });
    logger.warn(`[EngraphManager] ${message}`);
    return { ok: false, reason: category };
  }

  private _writeEngraphConfig(home: string, vaultPath: string, port: number, apiKey: string): void {
    const configDir = path.join(home, '.engraph');
    mkdirSync(configDir, { recursive: true });
    const toml = [
      `vault_path = ${JSON.stringify(vaultPath)}`,
      'top_n = 10',
      'exclude = [".obsidian/", "node_modules/", ".git/"]',
      'intelligence = false',
      '',
      '[http]',
      `port = ${port}`,
      'host = "127.0.0.1"',
      'rate_limit = 60',
      '',
      '[[http.api_keys]]',
      `key = ${JSON.stringify(apiKey)}`,
      'name = "rhythm"',
      'permissions = "read"',
      '',
    ].join('\n');
    const configPath = path.join(configDir, 'config.toml');
    writeFileSync(configPath, toml, { encoding: 'utf8', mode: 0o600 });
    try {
      chmodSync(configPath, 0o600);
    } catch {
      /* best-effort on non-posix */
    }
  }

  private async _runIndex(binary: string, home: string, vaultPath: string, rebuild: boolean): Promise<void> {
    const args = rebuild ? ['index', vaultPath, '--rebuild'] : ['index', vaultPath];
    if (this.spawnFn !== spawn || this.injectedExecFile) {
      // Fixed argv, no shell — execFile never invokes a shell to interpret args.
      await this.execFileImpl(binary, args, {
        timeout: INDEX_TIMEOUT_MS,
        env: { HOME: home, PATH: process.env.PATH ?? '' },
        signal: this.startAbort?.signal,
      });
      return;
    }
    const reservation = this.reservation;
    if (!reservation) throw new Error('index reservation unavailable');
    const lock = path.join(home, '.engraph', 'serve.owner');
    this.reservation = { ...reservation, indexStarting: true };
    if (markerAt(lock)?.nonce !== reservation.nonce) throw new Error('owner marker changed before indexing');
    publish(lock, this.reservation, false);
    try {
      await new Promise<void>((resolve, reject) => {
        const relay = this.spawnFn(process.execPath, [
          '-e', INDEX_RELAY, binary, vaultPath, rebuild ? '1' : '0', lock, String(process.pid), reservation.nonce,
        ], {
          env: { HOME: home, PATH: process.env.PATH ?? '' },
          stdio: 'ignore',
          detached: true,
        });
        this.indexProcess = relay;
        let settled = false;
        let timedOut = false;
        const signal = this.startAbort?.signal;
        const cleanup = () => {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
          if (this.indexProcess === relay) this.indexProcess = null;
        };
        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        };
        const abort = () => {
          try { relay.kill('SIGTERM'); } catch { /* already gone */ }
        };
        const timeout = setTimeout(() => {
          timedOut = true;
          abort();
        }, INDEX_TIMEOUT_MS);
        relay.once('error', fail);
        relay.once('exit', (code, exitSignal) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (code === 0 && !signal?.aborted && !timedOut) resolve();
          else reject(new Error(
            signal?.aborted ? 'index cancelled' : timedOut ? 'index timed out' :
              `index relay exited (code=${code} signal=${exitSignal})`,
          ));
        });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    } finally {
      const deadline = Date.now() + STOP_GRACE_MS + 500;
      for (;;) {
        const current = markerAt(lock);
        if (current?.nonce !== reservation.nonce || current.state !== 'starting' ||
            current.home !== reservation.home || current.root !== reservation.root ||
            current.binary !== reservation.binary || current.configHash !== reservation.configHash) break;
        const indexExited = !!current.indexRelay && !!current.indexChild &&
          gone(current.indexRelay) && gone(current.indexChild);
        if (indexExited || (current.indexStarting && !current.indexRelay && !current.indexChild)) {
          const next = { ...current };
          delete next.indexStarting;
          if (indexExited) {
            delete next.indexRelay;
            delete next.indexChild;
          }
          if (markerAt(lock)?.nonce === reservation.nonce) publish(lock, next, false);
          break;
        }
        if (!current.indexRelay || !current.indexChild || Date.now() >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }

  private _spawnServe(binary: string, home: string, port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const relay = this.spawnFn === spawn;
      const lock = path.join(home, '.engraph', 'serve.owner');
      const child = this.spawnFn(relay ? process.execPath : binary, relay ? ['-e', SERVE_RELAY, binary, String(port), lock, String(process.pid), this.reservation!.nonce] : [
        'serve', '--http', '--read-only',
        '--port', String(port),
        '--host', '127.0.0.1',
      ], {
        // Rhythm-only HOME sandbox: Engraph resolves ALL of its own state
        // (config.toml, sqlite db, models) under `$HOME/.engraph` — pointing
        // HOME at our own Application Support subdir means the real
        // `~/.engraph` is never read, written, or migrated.
        env: { HOME: home, PATH: process.env.PATH ?? '' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: relay,
      });
      this.child = child;
      this.childPid = child.pid ?? null;

      let settled = false;
      const onError = (err: Error) => {
        if (settled) return;
        settled = true;
        this.child = null;
        this.childPid = null;
        reject(err);
      };
      child.once('error', onError);
      child.once('exit', (code, signal) => {
        logger.info(`[EngraphManager] managed engraph process exited (code=${code} signal=${signal})`);
        if (this.child === child) {
          if (managedByHome.get(home) === this) managedByHome.delete(home);
          this.child = null;
          this.childPid = null;
          this.ready = false;
        }
      });

      // Readiness is proven by the subsequent authenticated health check, not
      // by parsing stdout — just confirm the process didn't immediately die.
      setTimeout(() => {
        if (settled) return;
        settled = true;
        child.removeListener('error', onError);
        resolve();
      }, 300);
    });
  }

  /** Stop the exact spawned relay; reap an orphan only with full marker/OS identity. */
  private async stopManagedProcess(): Promise<void> {
    this.cancelStart();
    if (this.inFlight) await this.inFlight;
    if (this.reusedFrom) {
      const owner = this.reusedFrom;
      this.reusedFrom = null;
      await owner.stopManagedProcess();
      this.ready = false;
      this.port = null;
      this.apiKey = null;
    }
    await this.stopOwnedChild();
  }

  private async stopOwnedChild(): Promise<void> {
    const child = this.child;
    if (!child || child.pid !== this.childPid) {
      const own = this.reservation;
      const lock = own && path.join(own.home, '.engraph', 'serve.owner');
      const marker = lock && markerAt(lock);
      if (lock && marker && own && marker.nonce === own.nonce && marker.home === own.home &&
          marker.root === own.root && marker.binary === own.binary && marker.configHash === own.configHash &&
           marker.relay && marker.child && gone(marker.relay)) {
        await reapVerifiedOrphan(lock, marker);
      }
      this.child = null;
      this.childPid = null;
      this.ready = false;
      this.port = null;
      this.apiKey = null;
      this.releaseReservation();
      return;
    }
    const own = this.reservation;
    const marker = own && markerAt(path.join(own.home, '.engraph', 'serve.owner'));
    const verifiedGroup = this.spawnFn === spawn && !!own && !!marker && marker.nonce === own.nonce &&
      marker.home === own.home && marker.root === own.root && marker.binary === own.binary &&
      marker.configHash === own.configHash && marker.relay?.pid === child.pid &&
      marker.relay?.pgid === child.pid && marker.child?.pgid === child.pid &&
      matches(marker.relay, marker.nonce) && matches(marker.child, marker.binary);
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const timer = setTimeout(finish, STOP_GRACE_MS + 500);
      child.once('exit', () => { clearTimeout(timer); finish(); });
      try {
        child.kill('SIGTERM');
      } catch {
        finish();
        return;
      }
      const escalate = setTimeout(() => {
        if (this.spawnFn !== spawn && done) return;
        try {
          // A detached relay may have died while its backend ignored TERM.
          // Only its positively identified group can be escalated.
          if (verifiedGroup && marker && matches(marker.relay, marker.nonce) && matches(marker.child, marker.binary)) {
            process.kill(-child.pid!, 'SIGKILL');
          } else if (verifiedGroup && marker && gone(marker.relay) && matches(marker.child, marker.binary, true)) {
            process.kill(marker.child!.pid, 'SIGKILL');
          } else if (this.spawnFn !== spawn) child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        if (this.spawnFn !== spawn) finish();
      }, STOP_GRACE_MS);
      escalate.unref?.();
    });
    if (this.spawnFn === spawn && own) {
      const lock = path.join(own.home, '.engraph', 'serve.owner');
      const current = markerAt(lock);
      if (current?.nonce === own.nonce && current.relay && current.child && gone(current.relay) && gone(current.child)) {
        rmSync(lock, { force: true });
      }
    }
    this.child = null;
    if (managedByHome.get(this.engraphHomeDir()) === this) managedByHome.delete(this.engraphHomeDir());
    this.childPid = null;
    this.ready = false;
    this.port = null;
    this.apiKey = null;
    this.releaseReservation();
  }

  /** Await cancellation and verified child exit; callers can await shutdown. */
  async shutdown(): Promise<void> {
    this.closed = true;
    this.cancelStart();
    try {
      await this.stopManagedProcess();
    } catch (err) {
      logger.warn(`[EngraphManager] shutdown failed (non-fatal): ${sanitizeErrorMessage(err)}`);
    }
  }
}

export const engraphManager = new EngraphManager();
