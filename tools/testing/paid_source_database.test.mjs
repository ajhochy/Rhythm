import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createQualificationFixture, readQualificationFixture } from './qualification_fixture.mjs';
import { checkoutRoot } from './web_paid_custody.mjs';
import { preparePaidSourceDatabase } from './paid_source_database.mjs';
const Database = createRequire(join(checkoutRoot, 'apps/api_server/package.json'))('better-sqlite3');

test('paid startup source contains exactly the qualified public owner before web host validation, with no auth sessions', async t => {
  const sourceRevision = 'a'.repeat(40);
  const manifestPath = createQualificationFixture(sourceRevision, { hermesRuntimeRoot: null, hermesBackendArtifactRoot: null });
  const sourceRoot = mkdtempSync('/private/tmp/rhythm-web-paid-source-test-'); chmodSync(sourceRoot, 0o700);
  t.after(() => { rmSync(sourceRoot, { recursive: true, force: true }); rmSync(dirname(manifestPath), { recursive: true, force: true }); });
  const { manifest } = readQualificationFixture(manifestPath, sourceRevision);
  const beforeManifest = readFileSync(manifestPath), beforeProfiles = readFileSync(manifest.profileSeedPath);
  mkdirSync(join(sourceRoot, 'skills'), { mode: 0o700 });
  writeFileSync(join(sourceRoot, 'skills', 'synthetic.md'), 'synthetic preboot skill', { mode: 0o400 });
  await preparePaidSourceDatabase({ manifestPath, sourceRevision, sourceRoot });
  const db = new Database(join(sourceRoot, 'rhythm.db'), { readonly: true, fileMustExist: true });
  try {
    assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get()), true,
      'Configured web owner must exist before initializeWebHost, which precedes qualification bootstrap');
    const user = manifest.publicUserSeed;
    assert.deepEqual(db.prepare('SELECT id,name,email,google_sub,timezone FROM users').all(),
      [{ id: user.id, name: user.name, email: user.email, google_sub: user.googleSub, timezone: user.timezone }]);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM sessions').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM agent_sessions').get().count, 0);
  } finally { db.close(); }
  assert.deepEqual(readFileSync(manifestPath), beforeManifest);
  assert.deepEqual(readFileSync(manifest.profileSeedPath), beforeProfiles);
  assert.equal(existsSync(manifest.dbPath), false, 'Preparation must not create or bootstrap the runtime DB');
  assert.equal(readFileSync(join(sourceRoot, 'skills', 'synthetic.md'), 'utf8'), 'synthetic preboot skill');
  assert.equal(readQualificationFixture(manifestPath, sourceRevision).manifest.syntheticActor.modelLoan, undefined);
});

for (const existing of ['source', 'runtime']) test(`paid source preparation refuses an existing ${existing} DB without altering it`, t => {
  const sourceRevision = 'a'.repeat(40);
  const manifestPath = createQualificationFixture(sourceRevision, { hermesRuntimeRoot: null, hermesBackendArtifactRoot: null });
  const sourceRoot = mkdtempSync('/private/tmp/rhythm-web-paid-source-test-'); chmodSync(sourceRoot, 0o700);
  t.after(() => { rmSync(sourceRoot, { recursive: true, force: true }); rmSync(dirname(manifestPath), { recursive: true, force: true }); });
  const dbPath = join(existing === 'source' ? sourceRoot : dirname(manifestPath), 'rhythm.db');
  writeFileSync(dbPath, 'synthetic existing bytes', { mode: 0o600 });
  assert.throws(() => preparePaidSourceDatabase({ manifestPath, sourceRevision, sourceRoot }), /Paid synthetic source database rejected/);
  assert.equal(readFileSync(dbPath, 'utf8'), 'synthetic existing bytes');
  if (existing === 'runtime') assert.equal(existsSync(join(sourceRoot, 'rhythm.db')), false);
});
