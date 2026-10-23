import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, verify } from 'node:crypto';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { loadQualificationSyntheticActor } from '../src/agent-server.mjs';
import { createQualificationFixture, readQualificationFixture } from '../../../tools/testing/qualification_fixture.mjs';

function fixture(t) {
  const root = mkdtempSync('/private/tmp/rhythm-synthetic-actor-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const token = randomBytes(32).toString('hex');
  const tokenPath = join(root, 'actor-token');
  const manifestPath = join(root, 'manifest.json');
  const buildIdentityPath = join(root, 'build-identity.json');
  const userDataPath = join(root, 'electron-user-data');
  mkdirSync(userDataPath, { mode: 0o700 });
  writeFileSync(tokenPath, token, { mode: 0o600 });
  writeFileSync(buildIdentityPath, JSON.stringify({ schemaVersion: 1, sourceRevision: 'a'.repeat(40) }));
  const manifest = { schemaVersion: 1, sourceRevision: 'a'.repeat(40), fixtureRoot: root,
    dbPath: join(root, 'rhythm.db'), ownerId: 'invented-owner', ownerUserId: 123,
    tokenSha256: createHash('sha256').update(token).digest('hex'),
    publicUserSeed: { id: 123, name: 'Invented owner', email: 'invented@example.invalid', googleSub: 'qualification-fixture:owner', timezone: 'UTC' },
    syntheticActor: { tokenPath, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } };
  const save = () => { writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 }); chmodSync(manifestPath, 0o600); };
  save();
  return { root, token, tokenPath, manifestPath, buildIdentityPath, userDataPath, manifest, save };
}

function addApprovalSigner(f) {
  const signerDir = join(f.root, 'approval-signer');
  mkdirSync(signerDir, { mode: 0o700 });
  const privateKeyPath = join(signerDir, 'key.pk8');
  const capabilityPath = join(signerDir, 'capability');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const keyBytes = privateKey.export({ format: 'der', type: 'pkcs8' });
  const capability = randomBytes(32).toString('base64url');
  const jwk = publicKey.export({ format: 'jwk' });
  const publicPoint = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64');
  writeFileSync(privateKeyPath, keyBytes, { mode: 0o600 });
  writeFileSync(capabilityPath, capability, { mode: 0o600 });
  f.manifest.syntheticActor.approvalSigner = {
    privateKeyPath, privateKeySha256: createHash('sha256').update(keyBytes).digest('hex'),
    capabilityPath, capabilitySha256: createHash('sha256').update(capability).digest('hex'), publicKey: publicPoint,
  };
  f.save();
  return { signerDir, privateKeyPath, capabilityPath, capability, publicPoint };
}

test('synthetic approval identity loads only from exact private fixture files', async (t) => {
  const f = fixture(t);
  const signerFiles = addApprovalSigner(f);
  const read = () => loadQualificationSyntheticActor({ manifestPath: f.manifestPath,
    buildIdentityPath: f.buildIdentityPath, userDataPath: f.userDataPath });
  const actor = read();
  assert.equal(typeof actor.approvalSigner?.capability, 'function');
  assert.equal(typeof actor.approvalSigner?.signDecision, 'function');
  assert.equal(typeof actor.approvalSigner?.capabilityMaterial, 'function');
  assert.equal(await actor.approvalSigner.capability(), signerFiles.capability);
  const material = await actor.approvalSigner.capabilityMaterial();
  assert.equal(material.humanApprovalPublicKey, signerFiles.publicPoint);
  assert.equal(material.humanApprovalCapabilitySha256, createHash('sha256').update(signerFiles.capability).digest('hex'));
  const decision = { approvalId: 'owned-card', status: 'rejected', decisionNonce: 'owned-nonce', payloadDigest: null };
  const signed = await actor.approvalSigner.signDecision(decision);
  assert.equal(signed.capability, signerFiles.capability);
  const raw = Buffer.from(signerFiles.publicPoint, 'base64');
  const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256',
    x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.equal(verify('sha256', Buffer.from('rhythm-human-approval-v1\nowned-card\nrejected\nowned-nonce\n'),
    publicKey, Buffer.from(signed.signature, 'base64')), true);
  assert.equal(verify('sha256', Buffer.from('rhythm-human-approval-v1\nowned-card\nrejected\nother-nonce\n'),
    publicKey, Buffer.from(signed.signature, 'base64')), false);
  await assert.rejects(actor.approvalSigner.signDecision({ ...decision, approvalId: '../other' }), /Invalid approval decision/);
  await assert.rejects(actor.approvalSigner.signDecision({ ...decision, decisionNonce: '../other' }), /Invalid approval decision/);
});

test('fixture creator signer is accepted by the exact-build Electron actor and ordinary signature verifier', async (t) => {
  const revision = 'a'.repeat(40);
  const manifestPath = createQualificationFixture(revision);
  const root = dirname(manifestPath);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const buildIdentityPath = join(root, 'build-identity.json');
  writeFileSync(buildIdentityPath, JSON.stringify({ schemaVersion: 1, sourceRevision: revision }), { mode: 0o600 });
  const { manifest } = readQualificationFixture(manifestPath, revision);
  assert.equal(manifest.sourceRevision, revision);
  assert.throws(() => readQualificationFixture(manifestPath, 'b'.repeat(40)), /authority binding invalid/);
  const actor = loadQualificationSyntheticActor({ manifestPath, buildIdentityPath,
    userDataPath: join(root, 'electron-user-data') });
  assert.equal(actor.ownerUserId, manifest.ownerUserId);
  const material = await actor.approvalSigner.capabilityMaterial();
  assert.equal(material.humanApprovalPublicKey, manifest.syntheticActor.approvalSigner.publicKey);
  const decision = { approvalId: 'owned-creator-card', status: 'approved', decisionNonce: 'creator-nonce', payloadDigest: null };
  const signed = await actor.approvalSigner.signDecision(decision);
  const raw = Buffer.from(material.humanApprovalPublicKey, 'base64');
  const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256',
    x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  const canonical = Buffer.from('rhythm-human-approval-v1\nowned-creator-card\napproved\ncreator-nonce\n');
  assert.equal(verify('sha256', canonical, publicKey, Buffer.from(signed.signature, 'base64')), true);
  assert.equal(createHash('sha256').update(signed.capability).digest('hex'), material.humanApprovalCapabilitySha256);
  chmodSync(manifest.syntheticActor.approvalSigner.capabilityPath, 0o644);
  await assert.rejects(actor.approvalSigner.signDecision(decision), /qualification approval identity ownership/);
  assert.throws(() => readQualificationFixture(manifestPath, revision), /private owned canonical files/);
  assert.equal(readFileSync(manifestPath, 'utf8').includes('approvalSigner'), true);
});

test('synthetic approval identity rechecks private file modes, links, bytes and immutable manifest', async (t) => {
  const f = fixture(t);
  const files = addApprovalSigner(f);
  const signer = loadQualificationSyntheticActor({ manifestPath: f.manifestPath,
    buildIdentityPath: f.buildIdentityPath, userDataPath: f.userDataPath }).approvalSigner;
  chmodSync(files.privateKeyPath, 0o644);
  await assert.rejects(signer.capability(), /qualification approval identity ownership/);
  chmodSync(files.privateKeyPath, 0o600);
  const originalCapability = join(files.signerDir, 'capability-original');
  renameSync(files.capabilityPath, originalCapability);
  symlinkSync(originalCapability, files.capabilityPath);
  await assert.rejects(signer.capability(), /qualification approval identity ownership/);
  rmSync(files.capabilityPath);
  renameSync(originalCapability, files.capabilityPath);
  linkSync(files.capabilityPath, join(files.signerDir, 'capability-hardlink'));
  await assert.rejects(signer.capability(), /qualification approval identity ownership/);
  rmSync(join(files.signerDir, 'capability-hardlink'));
  writeFileSync(files.capabilityPath, randomBytes(32).toString('base64url'));
  await assert.rejects(signer.capability(), /qualification approval identity changed/);
  writeFileSync(files.capabilityPath, files.capability);
  writeFileSync(f.manifestPath, `${JSON.stringify(f.manifest)}\n`, { mode: 0o600 });
  await assert.rejects(signer.capability(), /qualification approval authority changed/);
});

test('synthetic approval identity refuses a mismatched public point or expired actor', async (t) => {
  const wrongPoint = fixture(t);
  addApprovalSigner(wrongPoint);
  wrongPoint.manifest.syntheticActor.approvalSigner.publicKey = Buffer.alloc(65, 1).toString('base64');
  wrongPoint.save();
  assert.throws(() => loadQualificationSyntheticActor({ manifestPath: wrongPoint.manifestPath,
    buildIdentityPath: wrongPoint.buildIdentityPath, userDataPath: wrongPoint.userDataPath }), /qualification approval public point/);

  const expiring = fixture(t);
  addApprovalSigner(expiring);
  expiring.manifest.syntheticActor.expiresAt = new Date(Date.now() + 250).toISOString();
  expiring.save();
  const signer = loadQualificationSyntheticActor({ manifestPath: expiring.manifestPath,
    buildIdentityPath: expiring.buildIdentityPath, userDataPath: expiring.userDataPath }).approvalSigner;
  await new Promise((resolve) => setTimeout(resolve, 300));
  await assert.rejects(signer.capability(), /qualification synthetic actor scope|qualification approval authority/);
});

test('synthetic actor is accepted only from exact-build private fixture state', (t) => {
  const f = fixture(t);
  const read = () => loadQualificationSyntheticActor({ manifestPath: f.manifestPath,
    buildIdentityPath: f.buildIdentityPath, userDataPath: f.userDataPath });
  assert.deepEqual(read(), { token: f.token, ownerUserId: 123, fixtureRoot: f.root });
  f.manifest.sourceRevision = 'b'.repeat(40); f.save();
  assert.throws(read, /qualification/i);
  f.manifest.sourceRevision = 'a'.repeat(40); f.save();
  chmodSync(f.tokenPath, 0o644);
  assert.throws(read, /qualification/i);
  chmodSync(f.tokenPath, 0o600);
  assert.throws(() => loadQualificationSyntheticActor({ manifestPath: f.manifestPath,
    buildIdentityPath: f.buildIdentityPath, userDataPath: join(f.root, 'other-user-data') }), /qualification/i);
  const savedAuth = join(f.userDataPath, 'auth-session.bin');
  writeFileSync(savedAuth, 'do not import account state', { mode: 0o600 });
  assert.throws(read, /regular account state/);
  rmSync(savedAuth);
  f.manifest.syntheticActor.expiresAt = new Date(Date.now() - 1_000).toISOString(); f.save();
  assert.throws(read, /qualification/i);
});
