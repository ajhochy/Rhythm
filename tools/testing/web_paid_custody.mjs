import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { readQualificationFixture, provisionQualificationFixtureModelLoan,
  provisionQualificationFixtureAnthropicModelLoan } from './qualification_fixture.mjs';

export const checkoutRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = /^[a-f0-9]{64}$/;
const fail = category => { throw new Error(`custody ${category}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fileIdentity = st => ({ dev: st.dev, ino: st.ino, uid: st.uid, mode: st.mode, size: st.size, mtimeMs: st.mtimeMs });

/** Never include source bytes, filenames or caught exception text in errors. */
export function stableOwnedBytes(file, { privateFile = false } = {}) {
  try {
    if (typeof file !== 'string' || resolve(file) !== file || realpathSync(file) !== file) fail('file rejected');
    const st = lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.uid !== process.getuid()
      || (st.mode & (privateFile ? 0o077 : 0o022)) !== 0) fail('file rejected');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fileIdentity(fstatSync(fd)), bytes = readFileSync(fd);
      if (!same(before, fileIdentity(fstatSync(fd))) || !same(before, fileIdentity(lstatSync(file)))) fail('file rejected');
      return { bytes, identity: before };
    } finally { closeSync(fd); }
  } catch { fail('file rejected'); }
}

export function captureSourceHashes(paths) {
  return paths.map(path => {
    const { bytes, identity } = stableOwnedBytes(path);
    return { path, identity, sha256: hash(bytes) };
  });
}
export function assertSourceHashes(snapshot) {
  try {
    if (!Array.isArray(snapshot) || !snapshot.length) fail('source changed');
    for (const source of snapshot) {
      const current = stableOwnedBytes(source.path);
      if (!same(source.identity, current.identity) || source.sha256 !== hash(current.bytes)) fail('source changed');
    }
  } catch { fail('source changed'); }
}

export function currentCheckoutIdentity(root = checkoutRoot) {
  try {
    if (root !== checkoutRoot || realpathSync(root) !== root) fail('checkout rejected');
    const git = args => execFileSync('git', args, { cwd: root, encoding: null, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
    const sourceRevision = git(['rev-parse', 'HEAD']).toString().trim();
    // This generated authority stamp is bound separately in the artifact receipt.
    const scope = ['apps', 'tools', 'packages', 'package.json', 'package-lock.json', 'bun.lock', 'bun.lockb',
      ':(exclude)apps/api_server/build-identity.json'];
    const digest = createHash('sha256').update(sourceRevision).update(git(['diff', '--binary', 'HEAD', '--', ...scope]));
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...scope]).toString().split('\0').filter(Boolean).sort();
    for (const name of untracked) digest.update(name).update('\0').update(stableOwnedBytes(join(root, name)).bytes).update('\0');
    return { checkoutRoot: root, sourceRevision, sourceSha256: digest.digest('hex') };
  } catch { fail('checkout rejected'); }
}

const forbiddenEnvironment = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG_DIR',
  'RHYTHM_OPENAI_ACCOUNTS_FILE', 'RHYTHM_ACCOUNTS_FILE', 'RHYTHM_DECISION_ROUTER_FILE', 'RHYTHM_QUALIFICATION_FIXTURE_MANIFEST',
  'RHYTHM_SANDBOX_ENGINE_DIR', 'RHYTHM_SANDBOX_PREBUILT_INTAKE', 'RHYTHM_SANDBOX_PRESERVE_FILES', 'RHYTHM_WEB_CLOUD_CREDENTIAL_PATH'];
export function assertInvocation(plan, identity, environment = process.env) {
  for (const key of forbiddenEnvironment) if (environment[key] !== undefined && environment[key] !== '') fail('environment rejected');
  if (!plan || plan.checkoutRoot !== identity.checkoutRoot || plan.sourceRevision !== identity.sourceRevision
    || !/^[a-f0-9]{40}$/.test(plan.sourceRevision) || !hex.test(plan.sourceSha256) || plan.sourceSha256 !== identity.sourceSha256
    || !Array.isArray(plan.caseIds) || !plan.caseIds.length || new Set(plan.caseIds).size !== plan.caseIds.length
    || plan.caseIds.some(id => ![91, 92, 93, 94, 108, 109, 110, 118].includes(id))
    || !['openai', 'anthropic'].includes(plan.provider)
    || plan.caseIds.includes(110) && plan.caseIds.length !== 1
    || plan.caseIds.includes(118) && (plan.caseIds.length !== 1 || plan.provider !== 'anthropic')
    || !plan.caseIds.includes(118) && plan.provider !== 'openai') fail('invocation rejected');
}

export function assertLoanWindow(loan, now = Date.now()) {
  if (!loan || ![loan.issuedAt, loan.stopAt, loan.expires, now].every(Number.isSafeInteger)
    || loan.issuedAt > now || loan.stopAt <= now || loan.stopAt <= loan.issuedAt
    || loan.stopAt > loan.issuedAt + 600_000 || loan.stopAt > loan.expires - 1_200_000) fail('deadline rejected');
}

/** Only this adapter calls the unchanged access-only loan provisioners. */
export async function issuePaidLoan(options) {
  try {
    if (!['openai', 'anthropic'].includes(options.provider)) fail('loan rejected');
    const paths = options.provider === 'anthropic' ? [options.sourceAccountsPath]
      : [options.sourceAccountsPath, options.sourceDecisionPath, options.sourceGridPath];
    const sourceHashes = captureSourceHashes(paths);
    const result = options.provider === 'anthropic'
      ? provisionQualificationFixtureAnthropicModelLoan(options) : provisionQualificationFixtureModelLoan(options);
    assertSourceHashes(sourceHashes);
    const { manifest } = readQualificationFixture(options.manifestPath, options.expectedRevision);
    assertLoanWindow(manifest.syntheticActor.modelLoan, options.now ?? Date.now());
    return { ...result, issuedAt: manifest.syntheticActor.modelLoan.issuedAt, sourceHashes };
  } catch { fail('loan rejected'); }
}

/** Creator identity deliberately survives loan expiry; runtime auth does not. */
export function captureOwnedRoot(root) {
  try {
    if (dirname(root) !== '/private/tmp' || !/^(rhythm-ai-fixture-|rhythm-web-paid-)[A-Za-z0-9-]+$/.test(basename(root))
      || realpathSync(root) !== root) fail('cleanup refused');
    const st = lstatSync(root);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o700) fail('cleanup refused');
    return { root, dev: st.dev, ino: st.ino, uid: st.uid };
  } catch { fail('cleanup refused'); }
}
export function scrubOwnedRoot(owner, { stopped, portsFree }) {
  try {
    if (stopped !== true || portsFree !== true || !same(owner, captureOwnedRoot(owner.root))) fail('cleanup refused');
    const visit = file => {
      const st = lstatSync(file);
      if (st.uid !== owner.uid || st.dev !== owner.dev) fail('cleanup refused');
      if (st.isSymbolicLink() || st.isFile()) return;
      if (!st.isDirectory()) fail('cleanup refused');
      for (const name of readdirSync(file)) visit(join(file, name));
    };
    visit(owner.root);
    if (!same(owner, captureOwnedRoot(owner.root))) fail('cleanup refused');
    rmSync(owner.root, { recursive: true, force: false });
  } catch { fail('cleanup refused'); }
}

export function assertSameProcess(expected, observed) {
  if (!expected || !observed || !Number.isSafeInteger(expected.pid) || expected.pid <= 1
    || !expected.start || !expected.executable || expected.uid !== process.getuid()
    || ['pid', 'start', 'executable', 'uid'].some(key => expected[key] !== observed[key])) fail('process changed');
}
export function processIdentity(pid) {
  try {
    if (!Number.isSafeInteger(pid) || pid <= 1) fail('process changed');
    const exec = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const start = exec('/usr/bin/python3', ['-I', join(checkoutRoot, 'tools/dev/sandbox_api_recovery.py'), 'inspect-start', String(pid)]);
    const executable = exec('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn']).split('\n').find(line => line.startsWith('n'))?.slice(1);
    const uid = Number(exec('/bin/ps', ['-p', String(pid), '-o', 'uid=']));
    const result = { pid, start, executable, uid };
    assertSameProcess(result, result);
    return result;
  } catch { fail('process changed'); }
}
export function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    fail('process changed');
  }
}
export async function stopExactProcess(owner, { graceMs = 2000 } = {}) {
  if (!owner) return;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGKILL']) {
    if (!processIsAlive(owner.pid)) return;
    assertSameProcess(owner, processIdentity(owner.pid));
    process.kill(owner.pid, signal);
    const until = Date.now() + graceMs;
    while (processIsAlive(owner.pid) && Date.now() < until) await sleep(25);
  }
  if (processIsAlive(owner.pid)) fail('process stop failed');
}
export function watchdogReason({ now, monotonicNow, issuedAt, stopAt, monotonicStart, parentAlive }) {
  if (!parentAlive) return 'parent-exit';
  if (![now, monotonicNow, issuedAt, stopAt, monotonicStart].every(Number.isFinite)
    || stopAt <= issuedAt || stopAt > issuedAt + 600_000 || now >= stopAt
    || monotonicNow - monotonicStart >= stopAt - issuedAt) return 'deadline';
  return null;
}
export async function watchOwnedChild({ parent, child, loan, monotonicStart }, onStop, { pollMs = 100 } = {}) {
  while (true) {
    let parentAlive = processIsAlive(parent.pid);
    if (parentAlive) {
      try { assertSameProcess(parent, processIdentity(parent.pid)); } catch { parentAlive = false; }
    }
    const reason = watchdogReason({ ...loan, now: Date.now(), monotonicNow: Number(process.hrtime.bigint() / 1_000_000n), monotonicStart, parentAlive });
    if (reason) { await stopExactProcess(child); await onStop(reason); return reason; }
    await sleep(pollMs);
  }
}

/** Runtime adapters are fixed by the checked-in runner, never supplied by a CLI command. */
export async function runPaidLifecycle(plan, adapters) {
  let context, prepared = false, result, failed = false;
  try {
    await adapters.validate(plan);
    await adapters.build(plan);
    prepared = true;
    context = await adapters.prepare(plan);
    const loan = await adapters.issue(plan, context);
    await adapters.start(plan, context, loan);
    result = await adapters.run(plan, context, loan);
  } catch { failed = true; }
  if (prepared) {
    try { await adapters.stop(context); } catch { fail('cleanup failed'); }
    try { await adapters.scrub(context); } catch { fail('cleanup failed'); }
  }
  if (failed) fail('run failed');
  return result;
}

export function digestArtifact(target) {
  const st = lstatSync(target);
  if (st.isFile()) return hash(stableOwnedBytes(target).bytes);
  if (!st.isDirectory() || st.isSymbolicLink() || realpathSync(target) !== target) fail('artifact rejected');
  const digest = createHash('sha256');
  const visit = (directory, prefix = '') => {
    for (const name of readdirSync(directory).sort()) {
      if (name === 'node_modules') continue;
      const file = join(directory, name), rel = prefix + name, entry = lstatSync(file);
      if (entry.isSymbolicLink()) fail('artifact rejected');
      if (entry.isDirectory()) visit(file, `${rel}/`);
      else if (entry.isFile()) digest.update(rel).update('\0').update(stableOwnedBytes(file).bytes).update('\0');
      else fail('artifact rejected');
    }
  };
  visit(target);
  return digest.digest('hex');
}
export function artifactPaths(root = checkoutRoot) {
  return { api: join(root, 'apps/api_server/dist'), mcp: join(root, 'apps/mcp_server/dist'), web: join(root, 'apps/web/dist-web'),
    engine: join(root, 'apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode') };
}
export function validatePaidReceipt(receiptPath, { checkoutRoot: expectedRoot = checkoutRoot, expectedRevision, now = Date.now() } = {}) {
  try {
    const receipt = JSON.parse(stableOwnedBytes(receiptPath, { privateFile: true }).bytes.toString());
    if (receipt.schemaVersion !== 1 || receipt.kind !== 'web-paid-custody-v1' || expectedRoot !== checkoutRoot
      || receipt.checkoutRoot !== expectedRoot || receipt.sourceRevision !== expectedRevision
      || receiptPath !== join(receipt.fixtureRoot, 'web-paid-custody.json')
      || receipt.manifestPath !== join(receipt.fixtureRoot, 'manifest.json')
      || !Number.isSafeInteger(receipt.builtAt) || receipt.builtAt > receipt.issuedAt) fail('receipt rejected');
    assertInvocation(receipt, currentCheckoutIdentity(expectedRoot), {});
    captureOwnedRoot(receipt.fixtureRoot);
    captureOwnedRoot(receipt.sourceRoot);
    assertLoanWindow(receipt, now);
    for (const [key, path] of Object.entries(artifactPaths(expectedRoot))) {
      if (receipt.artifacts?.[key]?.path !== path || receipt.artifacts[key].sha256 !== digestArtifact(path)) fail('receipt rejected');
    }
    if (digestArtifact(receipt.sourceRoot) !== receipt.sourceRootSha256) fail('receipt rejected');
    if (hash(stableOwnedBytes(join(expectedRoot, 'apps/api_server/build-identity.json')).bytes) !== receipt.apiBuildIdentitySha256) fail('receipt rejected');
    if (receipt.orgSeedReceiptSha256 && hash(stableOwnedBytes(join(receipt.fixtureRoot, 'paid-org-seed.json'), { privateFile: true }).bytes) !== receipt.orgSeedReceiptSha256) fail('receipt rejected');
    const { manifest } = readQualificationFixture(receipt.manifestPath, expectedRevision);
    if (manifest.fixtureRoot !== receipt.fixtureRoot || manifest.dbPath !== join(receipt.fixtureRoot, 'rhythm.db')
      || manifest.syntheticActor?.modelLoan?.stopAt !== receipt.stopAt) fail('receipt rejected');
    return receipt;
  } catch { fail('receipt rejected'); }
}
