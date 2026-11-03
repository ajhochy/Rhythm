import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { readQualificationFixture } from './qualification_fixture.mjs';

const requiredPorts = [4001, 4096, 4002];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = file => {
  const s = lstatSync(file);
  return { dev: s.dev, ino: s.ino, uid: s.uid, mode: s.mode & 0o777,
    ...(s.isFile() ? { nlink: s.nlink } : {}) };
};
const same = (a, b) => Object.keys(a).every(key => a[key] === b[key]);

/** This authority exists only in the invocation that created the fixture. */
export function captureCreatedFixture(manifestPath, revision) {
  const { manifest } = readQualificationFixture(manifestPath, revision);
  const root = manifest.fixtureRoot;
  if (dirname(root) !== '/private/tmp' || !/^rhythm-ai-fixture-[A-Za-z0-9]+$/.test(basename(root))
    || resolve(root) !== root || realpathSync(root) !== root || manifestPath !== join(root, 'manifest.json'))
    throw new Error('Synthetic cleanup requires a canonical newly created fixture root');
  return Object.freeze({ root, manifestPath, revision, uid: process.getuid(),
    rootIdentity: identity(root), manifestIdentity: identity(manifestPath),
    manifestSha256: digest(readFileSync(manifestPath)) });
}

async function portIsFree(port) {
  const refused = await new Promise(resolvePort => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolvePort(false); });
    socket.once('timeout', () => { socket.destroy(); resolvePort(false); });
    socket.once('error', error => resolvePort(error.code === 'ECONNREFUSED'));
  });
  if (!refused) return false;
  return new Promise(resolvePort => {
    const server = createServer();
    server.once('error', () => resolvePort(false));
    // Packaged API, gateway and engine bind this address. A wildcard probe
    // also conflicts with unrelated Tailscale listeners on other interfaces.
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () =>
      server.close(() => resolvePort(true)));
  });
}

function assertTreeOwned(root, uid, device) {
  const visit = file => {
    const s = lstatSync(file);
    if (s.uid !== uid || s.dev !== device) throw new Error(`Synthetic fixture cleanup refused foreign file: ${file}`);
    // Child links are removed as directory entries. Never follow their targets.
    if (s.isSymbolicLink() || s.isFile()) return;
    if (s.isDirectory()) {
      for (const child of readdirSync(file)) visit(join(file, child));
    } else throw new Error(`Synthetic fixture cleanup refused special file: ${file}`);
  };
  visit(root);
}

/** A failed run retains its evidence. A successful run with uncertain authority fails loudly. */
export async function cleanupCreatedFixture(authority, {
  synthetic, status, signal, ports = requiredPorts, checkPorts = portIsFree,
  drainMs = 10_000, pollMs = 250,
} = {}) {
  if (!synthetic || status !== 0 || signal) return false;
  if (!authority || authority.uid !== process.getuid() || dirname(authority.root) !== '/private/tmp'
    || !/^rhythm-ai-fixture-[A-Za-z0-9]+$/.test(basename(authority.root))
    || authority.manifestPath !== join(authority.root, 'manifest.json'))
    throw new Error('Synthetic fixture cleanup refused missing creator authority');
  const deadline = Date.now() + drainMs;
  while (true) {
    let busyPort;
    for (const port of ports) {
      if (!await checkPorts(port)) { busyPort = port; break; }
    }
    if (busyPort === undefined) break;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Synthetic fixture cleanup refused: runtime port ${busyPort} is busy or unknown after ${drainMs} ms`);
    await sleep(Math.min(pollMs, remaining));
  }
  const { manifest } = readQualificationFixture(authority.manifestPath, authority.revision);
  if (manifest.fixtureRoot !== authority.root || realpathSync(authority.root) !== authority.root
    || !same(authority.rootIdentity, identity(authority.root))
    || !same(authority.manifestIdentity, identity(authority.manifestPath))
    || digest(readFileSync(authority.manifestPath)) !== authority.manifestSha256)
    throw new Error('Synthetic fixture cleanup refused changed root or manifest');
  assertTreeOwned(authority.root, authority.uid, authority.rootIdentity.dev);
  // Repeat the critical identity checks immediately before removing this exact path.
  if (!same(authority.rootIdentity, identity(authority.root))
    || !same(authority.manifestIdentity, identity(authority.manifestPath))
    || digest(readFileSync(authority.manifestPath)) !== authority.manifestSha256)
    throw new Error('Synthetic fixture cleanup refused changed root or manifest');
  rmSync(authority.root, { recursive: true, force: false });
  return true;
}
