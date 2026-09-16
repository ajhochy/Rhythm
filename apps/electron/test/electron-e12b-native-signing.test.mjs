import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { readFile, access } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { generateKeyPairSync, sign, createHash, verify } from 'node:crypto';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFuseFile } from '@electron/fuses';

test('e12b-package-staging: official fuses resolve the framework, not the launcher, at the assembly path', async () => {
  // Regression: .Rhythm.app.tmp bypasses the official macOS bundle resolver.
  const source = await readFile(new URL('../scripts/package-mac.mjs', import.meta.url), 'utf8');
  const name = source.match(/const stagingArtifact = resolve\(distRoot, '([^']+)'\);/)?.[1];
  assert.ok(name, 'bind this check to the actual assembly staging name');
  const bundle = resolve(import.meta.dirname, '../dist', name);
  assert.equal(pathToFuseFile(resolve(bundle, 'Contents/MacOS/Rhythm')),
    resolve(bundle, 'Contents/Frameworks/Electron Framework.framework/Electron Framework'));
  assert.notEqual(name, 'Rhythm.app', 'staging must not overwrite the published bundle');
});

const file = new URL('../src/human-approval-main-signer.mjs', import.meta.url);
const decision = { approvalId: 'approval-test-1', status: 'approved', decisionNonce: 'nonce-test-1', payloadDigest: 'a'.repeat(64) };
const canonical = (d) => ['rhythm-human-approval-v1', d.approvalId, d.status, d.decisionNonce, d.payloadDigest ?? ''].join('\n');
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = keys.publicKey.export({ format: 'jwk' });
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64');
const capability = Buffer.alloc(32, 7).toString('base64url');
const reply = (request) => ({ available: true, publicKey, ...(request.operation === 'public-key' ? {} : { capability }), ...(request.operation === 'sign' ? { signature: sign('sha256', Buffer.from(canonical(request.decision)), keys.privateKey).toString('base64') } : {}) });

async function harness(behavior = (child, request) => { child.stdout.end(JSON.stringify(reply(request))); child.emit('close', 0); }) {
  const calls = [];
  assert.match(await readFile(file, 'utf8'), /import \{ spawn \} from 'node:child_process'/, 'native stdin boundary must replace the legacy CLI before exercising it');
  const context = createContext({ Buffer, URL, console, setTimeout: (fn, ms) => { assert.equal(ms, 10_000); return setTimeout(fn, 20); }, clearTimeout, process: { platform: 'darwin', resourcesPath: '/packaged/Resources', env: { SECRET: 'must-not-inherit' } } });
  const module = new SourceTextModule(await readFile(file, 'utf8'), { context, initializeImportMeta(meta) { meta.url = file.href; } });
  await module.link(async (name) => {
    let values = { ...await import(name) };
    if (name === 'node:child_process') values = { spawn(path, args, options) {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill(signal) { child.killed = signal; } });
      let input = '';
      child.stdin = new Writable({ write(chunk, encoding, done) { input += chunk; done(); }, final(done) { calls.push({ path, args, options, input, child }); done(); queueMicrotask(() => behavior(child, JSON.parse(input))); } });
      return child;
    } };
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  return { signer: module.namespace, calls };
}

test('e12b-c1: exportable private-key/CLI path is absent (regression: PEM leaks in argv)', async () => {
  const source = await readFile(file, 'utf8');
  assert.doesNotMatch(source, /createPrivateKey|generateKeyPairSync|pkcs8|add-generic-password|execFile/);
});

test('e12b-c2: exact canonical bytes round-trip DER and capability registration without argv/env secrets', async () => {
  const { signer, calls } = await harness();
  const material = await signer.capabilityMaterial();
  assert.equal(material.humanApprovalPublicKey, publicKey);
  assert.equal(material.humanApprovalCapabilitySha256, createHash('sha256').update(capability).digest('hex'));
  assert.equal(await signer.capability(), capability);
  for (const d of [decision, { ...decision, status: 'rejected', payloadDigest: null }]) {
    const result = await signer.signDecision(d);
    assert.equal(result.capability, capability);
    assert.equal(verify('sha256', Buffer.from(canonical(d)), keys.publicKey, Buffer.from(result.signature, 'base64')), true);
    assert.equal(verify('sha256', Buffer.from(canonical({ ...d, decisionNonce: 'different' })), keys.publicKey, Buffer.from(result.signature, 'base64')), false);
    assert.equal(calls.at(-1).input, JSON.stringify({ operation: 'sign', decision: d }));
  }
  for (const call of calls) {
    assert.equal(call.path, '/packaged/Resources/human-approval/rhythm-approval-signer');
    assert.equal(JSON.stringify(call.args), '[]');
    assert.equal(call.options.shell, false);
    assert.deepEqual(Object.keys(call.options.env).sort(), ['HOME', 'PATH']);
    assert.equal(JSON.stringify(call.options).includes('must-not-inherit'), false);
  }
});

test('e12b-c3: malformed decision schema cannot reach helper (regression: arbitrary-sign oracle)', async () => {
  const { signer, calls } = await harness();
  for (const d of [null, {}, { ...decision, extra: true }, { ...decision, approvalId: 'x\ny' }, { ...decision, approvalId: 'x'.repeat(129) }, { ...decision, status: 'pending' }, { ...decision, decisionNonce: '' }, { ...decision, decisionNonce: 'a'.repeat(257) }, { ...decision, payloadDigest: 'digest-test-1' }, { ...decision, payloadDigest: undefined }]) {
    await assert.rejects(signer.signDecision(d), /Invalid approval decision/);
  }
  assert.equal(calls.length, 0);
});

test('e12b-c4: malformed/untrusted helper replies fail closed, including invalid/wrong-message DER', async () => {
  for (const output of ['not-json', '{}', JSON.stringify({ ...reply({ operation: 'capability' }), privateKey: 'secret' }), JSON.stringify({ available: true, publicKey: 'AAAA', capability }), JSON.stringify({ available: true, publicKey, capability: 'bad' }), 'x'.repeat(8193)]) {
    const { signer } = await harness((child) => { child.stdout.end(output); child.emit('close', 0); });
    await assert.rejects(signer.capability(), /Human approval helper/);
  }
  for (const signature of [Buffer.alloc(64).toString('base64'), sign('sha256', Buffer.from('wrong'), keys.privateKey).toString('base64')]) {
    const { signer } = await harness((child) => { child.stdout.end(JSON.stringify({ available: true, publicKey, capability, signature })); child.emit('close', 0); });
    await assert.rejects(signer.signDecision(decision), /Human approval helper/);
  }
});

test('e12b-c5: timeout, stderr, nonzero exit and process errors are bounded and redacted', async () => {
  for (const behavior of [() => {}, (child) => child.stderr.end('secret'.repeat(1000)), (child) => child.emit('close', 1), (child) => child.emit('error', new Error('decision-secret')), (child) => child.stdin.emit('error', new Error('decision-secret'))]) {
    const { signer, calls } = await harness(behavior);
    await assert.rejects(signer.capability(), (error) => /Human approval helper/.test(error.message) && !/secret/.test(error.message));
    assert.equal(calls[0].child.killed, 'SIGKILL');
  }
});

test('e12b-c6: unavailable Secure Enclave is explicit, never a software fallback', async () => {
  const { signer } = await harness((child) => { child.stdout.end(JSON.stringify({ available: false, code: 'SECURE_ENCLAVE_UNAVAILABLE' })); child.emit('close', 0); });
  await assert.rejects(signer.capabilityMaterial(), (error) => error.code === 'HUMAN_APPROVAL_UNAVAILABLE');
});

test('e12b-c2: concurrent first-use calls serialize helper creation so registration cannot race signing', async () => {
  const releases = [];
  const { signer, calls } = await harness((child, request) => {
    releases.push(() => { child.stdout.end(JSON.stringify(reply(request))); child.emit('close', 0); });
  });
  const first = signer.capabilityMaterial();
  const second = signer.signDecision(decision);
  await new Promise((done) => setImmediate(done));
  const firstUseCount = calls.length;
  releases.shift()();
  await first;
  await new Promise((done) => setImmediate(done));
  assert.equal(calls.length, 2);
  releases.shift()();
  assert.equal((await second).capability, capability);
  assert.equal(firstUseCount, 1, 'only one helper may own first-use key creation');
});

test('e12b-c7: Swift restricts permanent enclave key, fixed decision schema/digest and public-only export', async () => {
  const path = new URL('../native/HumanApprovalSigner.swift', import.meta.url);
  assert.equal(await access(path).then(() => true, () => false), true, 'native Security.framework source must exist');
  const swift = await readFile(path, 'utf8');
  for (const token of ['import Security', 'kSecAttrTokenIDSecureEnclave', 'kSecAttrIsPermanent', '.privateKeyUsage', 'kSecAttrAccessibleWhenUnlockedThisDeviceOnly', 'com.rhythm.desktop.human-approval.secure-enclave.v2', 'ecdsaSignatureDigestX962SHA256', 'SHA256.hash', 'rhythm-human-approval-v1', 'SECURE_ENCLAVE_UNAVAILABLE', '4097', 'SecCopyErrorMessageString']) {
    if (token === 'SecCopyErrorMessageString') assert.ok(!swift.includes(token), 'never leak native diagnostics');
    else assert.ok(swift.includes(token), token);
  }
  assert.doesNotMatch(swift, /SecItemDelete|Process\(|CommandLine\.arguments|ProcessInfo|PKCS8|pkcs8/);
  assert.equal((swift.match(/SecKeyCopyExternalRepresentation\(/g) ?? []).length, 1);
  assert.match(swift, /SecKeyCopyExternalRepresentation\(publicKey,/);
  assert.match(swift, /Set\(request\.keys\)/);
  assert.match(swift, /Set\(decision\.keys\)/);
  assert.match(swift, /SecCodeCopyGuestWithAttributes/ , 'a raw shell must not bypass E12A by launching the signer');
  assert.match(swift, /SecCodeCheckValidity/);
  assert.match(swift, /com\.rhythm\.desktop/);
  assert.match(swift, /try authorizeParent\(\)/);
  assert.doesNotMatch(swift, /rhythm-electron-human-approval-key|signing-key-v1/, 'legacy signing entry must not be read, overwritten or deleted');
  const migration = await readFile(new URL('../../../docs/ai/runs/2026-09-11-electron-e12b-native-signing.md', import.meta.url), 'utf8');
  assert.match(migration, /public-key re-registration is required/);
  assert.match(migration, /Rolling back to old app code/);
});

test('e12b-c8: package builds native architecture from source; nested signing requires and verifies helper', async () => {
  const pack = await readFile(new URL('../scripts/package-mac.mjs', import.meta.url), 'utf8');
  assert.match(pack, /await buildAndStageApprovalHelper\(\{ electronRoot, resources \}\)/);
  const build = await readFile(new URL('../scripts/build-approval-helper.mjs', import.meta.url), 'utf8');
  for (const token of ['arch !== process.arch', "'arm64', 'x64'", 'HumanApprovalSigner.swift', 'swiftc', '-framework', 'Security', '-archs', 'x86_64', 'rhythm-approval-signer']) assert.ok(build.includes(token), token);
  const signing = await readFile(new URL('../scripts/sign-and-notarize-mac.mjs', import.meta.url), 'utf8');
  assert.match(signing, /targets\.includes\(approvalHelper\)/);
  assert.match(signing, /\['--verify', '--strict', approvalHelper\]/);
});

test('e12b-c12: required official fuses disable alternate loaders before any signing, preserving unpacked app', async () => {
  for (const [script, target, firstSign] of [
    ['package-mac.mjs', 'stagingArtifact', "await run('codesign'"],
    ['sign-and-notarize-mac.mjs', 'artifact', 'for (const target of targets)'],
  ]) {
    const source = await readFile(new URL(`../scripts/${script}`, import.meta.url), 'utf8');
    const call = `await hardenElectronFuses(resolve(${target}, 'Contents/MacOS/Rhythm'));`;
    assert.ok(source.includes(call), 'fuse hardening is mandatory, not an optional packaging flag');
    assert.ok(source.indexOf(call) < source.indexOf(firstSign), 'fuses must precede helper and app signing');
    assert.match(source, /import \{ hardenElectronFuses \} from '.\/harden-electron-fuses.mjs'/);
    if (target === 'stagingArtifact') assert.ok(source.indexOf(call) > source.indexOf('await rename('));
  }
  const path = new URL('../scripts/harden-electron-fuses.mjs', import.meta.url);
  assert.equal(await access(path).then(() => true, () => false), true);
  const policy = await readFile(path, 'utf8');
  assert.match(policy, /from '@electron\/fuses'/);
  for (const name of ['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments', 'OnlyLoadAppFromAsar', 'EnableEmbeddedAsarIntegrityValidation']) {
    assert.ok(policy.includes(`[FuseV1Options.${name}]: false`), name);
  }
  assert.match(policy, /await flipFuses\(executable, config\)/);
  assert.match(policy, /current\[option\] !== FuseState.ENABLE && current\[option\] !== FuseState.DISABLE/);
  assert.match(policy, /verified\[option\] !== FuseState.DISABLE/);
  assert.doesNotMatch(policy, /catch|resetAdHocDarwinSignature: true|writeFile|sentinel/i);
});

test('e12b-c13: account-local flock encloses lookup/create/requery (regression: two helper processes create different keys)', async () => {
  const swift = await readFile(new URL('../native/HumanApprovalSigner.swift', import.meta.url), 'utf8');
  const key = swift.slice(swift.indexOf('func signingKey()'), swift.indexOf('func capability()'));
  assert.match(key, /let lock = try acquireKeyCreationLock\(\)/);
  assert.ok(key.indexOf('try acquireKeyCreationLock()') < key.indexOf('SecItemCopyMatching('));
  assert.match(key, /defer \{[\s\S]*flock\(lock, LOCK_UN\)[\s\S]*close\(lock\)/);
  const lock = swift.slice(swift.indexOf('func acquireKeyCreationLock()'), swift.indexOf('func signingKey()'));
  for (const token of ['getpwuid(getuid())', 'Library/Application Support', 'com.rhythm.desktop.approval-signer', 'key-creation.lock', 'O_NOFOLLOW', 'O_CLOEXEC', '0o600', 'st_uid == getuid()', 'st_nlink == 1', 'S_IFREG', 'LOCK_EX | LOCK_NB', 'DispatchTime.now().uptimeNanoseconds', '5_000_000_000', 'EWOULDBLOCK', 'EINTR', 'usleep(20_000)', 'throw Failure.unavailable', 'close(fd)']) assert.ok(lock.includes(token), token);
  assert.doesNotMatch(lock, /getenv|ProcessInfo|removeItem|unlink|write\(/);
});
