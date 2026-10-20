import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { loadQualificationSyntheticActor } from '../src/agent-server.mjs';

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
