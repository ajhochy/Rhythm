import assert from 'node:assert/strict';
import { chmodSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createQualificationFixture, readQualificationFixture } from './qualification_fixture.mjs';
import { qualificationHermesHostOptions } from '../../apps/electron/src/qualification-hermes-runtime.mjs';
import { profileKeyFor } from '../../apps/electron/src/colony-preferences.mjs';

test('fixture readback stays bound to private exact-build bytes on every read', (t) => {
  const revision = 'a'.repeat(40), manifestPath = createQualificationFixture(revision, { hermesRuntimeRoot: null }), root = dirname(manifestPath);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const read = () => readQualificationFixture(manifestPath, revision);
  assert.equal(read().manifest.dbPath, join(root, 'rhythm.db'));
  const colony = JSON.parse(readFileSync(join(root, 'electron-user-data', 'colony', 'profiles', profileKeyFor('http://127.0.0.1:4001', '1'), 'preferences.json'), 'utf8'));
  assert.deepEqual(colony, { v: 1, enabled: true, sources: { rhythm: { enabled: true, paths: { database: join(root, 'rhythm.db') } } } });
  assert.throws(() => readQualificationFixture(manifestPath, 'b'.repeat(40)), /binding/);
  const tokenPath = join(root, 'actor-token');
  chmodSync(tokenPath, 0o644); assert.throws(read, /private owned/); chmodSync(tokenPath, 0o600);
  const token = readFileSync(tokenPath); rmSync(tokenPath);
  writeFileSync(join(root, 'other-token'), token, { mode: 0o600 }); symlinkSync(join(root, 'other-token'), tokenPath);
  assert.throws(read, /private owned/);
  rmSync(tokenPath); writeFileSync(tokenPath, token, { mode: 0o600 });
  const m = read().manifest; m.syntheticActor.expiresAt = new Date(Date.now() - 1).toISOString();
  writeFileSync(manifestPath, JSON.stringify(m)); assert.throws(read, /expired/);
});

test('attested private Hermes runtime seeds a normal two-message history read', {
  skip: !process.env.RHYTHM_QUALIFICATION_HERMES_RUNTIME_ROOT,
}, (t) => {
  const revision = 'a'.repeat(40);
  const manifestPath = createQualificationFixture(revision, { hermesRuntimeRoot: process.env.RHYTHM_QUALIFICATION_HERMES_RUNTIME_ROOT });
  const root = dirname(manifestPath);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { manifest } = readQualificationFixture(manifestPath, revision);
  assert.equal(qualificationHermesHostOptions(root).backendExecutablePath,
    join(process.env.RHYTHM_QUALIFICATION_HERMES_RUNTIME_ROOT, '.venv', 'bin', 'hermes'));
  assert.equal(statSync(join(root, 'hermes-home', 'state.db')).isFile(), true);
});
