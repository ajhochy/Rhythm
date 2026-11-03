// @ts-nocheck -- Runtime dependencies are deliberately injected in focused tests
// and include Electron/OS callback shapes that do not have a stable public type.
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { constants as fsConstants } from 'node:fs';
import { open as openFs, readdir as readdirFs, realpath as realpathFs, stat as statFs } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

const execFileDefault = promisify(execFileCallback);
const APP_EXECUTABLE = path.join('Applications', 'Open Design.app', 'Contents', 'MacOS', 'Open Design');
const MAX_RUNTIME_ROOTS = 8;
const MAX_NAMESPACES = 32;
const MAX_SCANNED_RUNTIMES = 64;
const MAX_RUNTIME_CANDIDATES = 25;
const MAX_IDENTITY_BYTES = 32 * 1024;
const MAX_HEALTH_BYTES = 64 * 1024;
const DISCOVERY_DEADLINE_MS = 10_000;
const HTTP_DEADLINE_MS = 3_000;
const OS_TIMEOUT_MS = 3_000;

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * The literal production form `http://127.0.0.1:<port>` (no trailing slash,
 * path, credentials, or alternative IPv4 spelling). Returns the normalised
 * `URL.origin` and the explicit numeric port, which survives URL's
 * default-port elision (`:80` → `http://127.0.0.1`).
 */
export function parseOpenDesignUrl(value) {
  if (typeof value !== 'string') return null;
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(value);
  const port = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  try {
    const url = new URL(value);
    return url.hostname === '127.0.0.1' && Number(url.port || 80) === port ? { origin: url.origin, port } : null;
  } catch { return null; }
}

export function canonicalOpenDesignOrigin(value) {
  return parseOpenDesignUrl(value)?.origin ?? null;
}

/** Installed app executables Rhythm trusts: system and current user's Applications. */
export function trustedOpenDesignExecutables(home = homedir()) {
  return [path.join('/', APP_EXECUTABLE), path.join(home, APP_EXECUTABLE)];
}

/** Exactly one canonical integer `pid`; alternate or nested fields are not accepted. */
function readIdentityPid(value) {
  const pid = value?.pid;
  return Number.isInteger(pid) && pid > 1 && pid <= 2_147_483_647 ? pid : null;
}

function safeIdentity(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_IDENTITY_BYTES) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

/**
 * Reads at most `limit` bytes from a regular, non-symlink file. Reading
 * `limit + 1` bytes (rather than trusting a prior stat) closes the growth race.
 */
export async function readBoundedFile(file, limit) {
  const handle = await openFs(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) return null;
    const buffer = Buffer.alloc(limit + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    return total > limit ? null : buffer.subarray(0, total).toString('utf8');
  } finally { await handle.close(); }
}

function psRecord(stdout) {
  const match = String(stdout).trim().match(/^(\d+)\s+(\d+)\s+(.+)$/m);
  if (!match) return null;
  return { pid: Number(match[1]), ppid: Number(match[2]), executable: match[3].trim() };
}

async function processRecord(pid, execFile) {
  try {
    const { stdout } = await execFile('/bin/ps', ['-p', String(pid), '-o', 'pid=,ppid=,comm='], { timeout: OS_TIMEOUT_MS, maxBuffer: 4096 });
    return psRecord(stdout);
  } catch { return null; }
}

async function isExactProcess(pid, executable, execFile) {
  const record = await processRecord(pid, execFile);
  return Boolean(record && record.pid === pid && record.executable === executable);
}

async function descendsFrom(pid, rootPid, execFile) {
  let current = pid;
  for (let step = 0; step < 12; step += 1) {
    const record = await processRecord(current, execFile);
    if (!record || record.pid !== current) return false;
    if (record.pid === rootPid) return true;
    if (record.ppid < 1 || record.ppid === record.pid) return false;
    current = record.ppid;
  }
  return false;
}

async function listenerPid(port, execFile) {
  try {
    const { stdout } = await execFile('/usr/sbin/lsof', ['-nP', '-a', `-iTCP@127.0.0.1:${port}`, '-sTCP:LISTEN', '-Fp'], { timeout: OS_TIMEOUT_MS, maxBuffer: 4096 });
    const pids = String(stdout).match(/^p(\d+)$/gm) ?? [];
    const parsed = [...new Set(pids.map((line) => Number(line.slice(1))).filter((pid) => Number.isInteger(pid) && pid > 0))];
    return parsed.length === 1 ? parsed[0] : null;
  } catch { return null; }
}

/**
 * One GET, no redirect following (a 3xx is returned as-is and rejected by the
 * caller). An absolute timer destroys the actual request, so a trickling
 * response cannot outlive the deadline; the byte bound also destroys it.
 * `request` is an injectable `http.request`-shaped seam for focused tests.
 */
export function readHtmlHealth(origin, { timeoutMs, request: makeRequest = http.request } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(value);
    };
    const request = makeRequest(`${origin}/`, { method: 'GET', timeout: timeoutMs, headers: { Accept: 'text/html' } }, (response) => {
      let bytes = 0;
      let body = '';
      response.setEncoding?.('utf8');
      response.on('data', (chunk) => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes > MAX_HEALTH_BYTES) { request.destroy(new Error('health response exceeds bound')); finish(reject, new Error('health response exceeds bound')); return; }
        body += chunk;
      });
      response.on('end', () => finish(resolve, { statusCode: response.statusCode ?? 0, contentType: String(response.headers?.['content-type'] ?? ''), body }));
      response.on('error', (error) => finish(reject, error));
    });
    timer = setTimeout(() => {
      request.destroy(new Error('health deadline'));
      finish(reject, new Error('health deadline'));
    }, Math.max(0, timeoutMs));
    request.once('timeout', () => request.destroy(new Error('health request timed out')));
    request.once('error', (error) => finish(reject, error));
    request.once('close', () => finish(reject, new Error('health request closed')));
    request.end();
  });
}

/**
 * Rejects if `promise` does not settle within `ms`. The timer stays referenced
 * (the caller awaits this deadline) and is cleared once either side settles.
 */
function bounded(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), Math.max(0, ms)); });
  return Promise.race([Promise.resolve(promise), deadline]).finally(() => clearTimeout(timer));
}

async function canonicalChild(root, candidate, realpath) {
  try {
    const canonicalRoot = await realpath(root);
    const canonicalCandidate = await realpath(candidate);
    return within(canonicalRoot, canonicalCandidate) ? canonicalCandidate : null;
  } catch { return null; }
}

/** One identity file, only if its canonical path is a direct child of `runtime`; read is byte-bounded. */
async function readContainedIdentity(runtime, name, { realpath, readBounded }) {
  const file = await canonicalChild(runtime, path.join(runtime, name), realpath);
  if (!file || path.dirname(file) !== runtime) return null;
  try { return safeIdentity(await readBounded(file, MAX_IDENTITY_BYTES)); } catch { return null; }
}

async function readIdentityPair(runtime, io) {
  const headless = await readContainedIdentity(runtime, 'headless-root.json', io);
  const web = await readContainedIdentity(runtime, 'web-root.json', io);
  const pid = readIdentityPid(headless);
  // Paired roots: both identity documents must name the same owning process.
  if (!pid || readIdentityPid(web) !== pid) return null;
  const url = parseOpenDesignUrl(web.url);
  return url && typeof headless.executablePath === 'string' ? { pid, executable: headless.executablePath, ...url } : null;
}

function isHtmlHealth(health) {
  return health?.statusCode === 200 && typeof health.contentType === 'string' && /^text\/html\s*(?:;|$)/i.test(health.contentType)
    && typeof health.body === 'string' && Buffer.byteLength(health.body, 'utf8') <= MAX_HEALTH_BYTES
    && /<title\b[^>]*>\s*OpenDesign\s*<\/title>/i.test(health.body);
}

function unavailable() { return { state: 'unavailable', code: 'unavailable' }; }

/**
 * Discovers, but never launches, configures, stops, or sends a request beyond a
 * bounded read-only health GET to an already-running installed OpenDesign web UI.
 * The whole scan has an absolute deadline; late results are discarded.
 */
export async function discoverOpenDesignRuntime(options = {}) {
  const home = options.homeDir ?? homedir();
  const supportRoot = options.supportRoot ?? path.join(home, 'Library', 'Application Support');
  const readdir = options.readdir ?? readdirFs;
  const realpath = options.realpath ?? realpathFs;
  const stat = options.stat ?? statFs;
  const readBounded = options.readBounded ?? readBoundedFile;
  const execFile = options.execFile ?? execFileDefault;
  const readHealth = options.readHealth ?? readHtmlHealth;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? DISCOVERY_DEADLINE_MS);
  const trusted = trustedOpenDesignExecutables(home);
  const io = { realpath, readBounded };
  const expired = () => now() >= deadline;

  const scan = async () => {
    let roots;
    try { roots = await readdir(supportRoot, { withFileTypes: true }); } catch { return unavailable(); }
    const runtimes = [];
    for (const entry of roots.filter((item) => item?.isDirectory?.() && !item?.isSymbolicLink?.() && /^Open Design(?:\s.*)?$/.test(item.name)).slice(0, MAX_RUNTIME_ROOTS)) {
      const appRoot = await canonicalChild(supportRoot, path.join(supportRoot, entry.name), realpath);
      if (!appRoot) continue;
      let namespaces;
      try { namespaces = await readdir(path.join(appRoot, 'namespaces'), { withFileTypes: true }); } catch { continue; }
      for (const namespace of namespaces.filter((item) => item?.isDirectory?.() && !item?.isSymbolicLink?.()).slice(0, MAX_NAMESPACES)) {
        if (runtimes.length >= MAX_SCANNED_RUNTIMES || expired()) break;
        const runtime = await canonicalChild(appRoot, path.join(appRoot, 'namespaces', namespace.name, 'runtime'), realpath);
        if (!runtime) continue;
        try { runtimes.push({ runtime, mtime: Number((await stat(runtime)).mtimeMs) || 0 }); } catch { /* skip */ }
      }
    }
    runtimes.sort((left, right) => right.mtime - left.mtime);
    for (const { runtime } of runtimes.slice(0, MAX_RUNTIME_CANDIDATES)) {
      if (expired()) return unavailable();
      const identity = await readIdentityPair(runtime, io);
      if (!identity || !trusted.includes(identity.executable)) continue;
      // The trusted path must be the canonical installed executable, not a link to elsewhere.
      try { if (await realpath(identity.executable) !== identity.executable) continue; } catch { continue; }
      if (!await isExactProcess(identity.pid, identity.executable, execFile)) continue;
      const activeListenerPid = await listenerPid(identity.port, execFile);
      if (!activeListenerPid || !await descendsFrom(activeListenerPid, identity.pid, execFile)) continue;
      const timeoutMs = Math.min(HTTP_DEADLINE_MS, deadline - now());
      if (timeoutMs <= 0) return unavailable();
      let health;
      try { health = await bounded(readHealth(identity.origin, { timeoutMs }), timeoutMs); } catch { continue; }
      if (!isHtmlHealth(health) || expired()) continue;
      // Re-verify identity owner and listener after the network round trip.
      const again = await readIdentityPair(runtime, io);
      if (!again || again.pid !== identity.pid || again.origin !== identity.origin || again.port !== identity.port || again.executable !== identity.executable) continue;
      if (!await isExactProcess(identity.pid, identity.executable, execFile)) continue;
      if (await listenerPid(identity.port, execFile) !== activeListenerPid || !await descendsFrom(activeListenerPid, identity.pid, execFile)) continue;
      if (expired()) return unavailable();
      return { state: 'ready', origin: identity.origin, identityPid: identity.pid, listenerPid: activeListenerPid };
    }
    return unavailable();
  };
  try { return await bounded(scan(), deadline - now()); } catch { return unavailable(); }
}

export function sameOpenDesignRuntime(left, right) {
  return Boolean(left && right && left.state === 'ready' && right.state === 'ready'
    && left.origin === right.origin && left.identityPid === right.identityPid && left.listenerPid === right.listenerPid);
}
