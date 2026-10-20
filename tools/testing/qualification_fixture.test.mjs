import assert from 'node:assert/strict';
import { chmodSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createQualificationFixture, readQualificationFixture } from './qualification_fixture.mjs';

test('fixture readback stays bound to private exact-build bytes on every read', (t) => {
  const revision = 'a'.repeat(40), manifestPath = createQualificationFixture(revision), root = dirname(manifestPath);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const read = () => readQualificationFixture(manifestPath, revision);
  assert.equal(read().manifest.dbPath, join(root, 'rhythm.db'));
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
