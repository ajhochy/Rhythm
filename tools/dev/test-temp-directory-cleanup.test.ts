import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, test } from 'vitest';

const owned = path.dirname(process.env.DB_PATH!);
console.log(`TEMP_CLEANUP_OWNED=${JSON.stringify(owned)}`);

test('setup root remains usable through passing or failing assertions', () => {
  fs.writeFileSync(path.join(owned, 'active'), 'active');
  assert.equal(fs.readFileSync(path.join(owned, 'active'), 'utf8'), 'active');
  if (process.env.RHYTHM_TEMP_CLEANUP_FAIL === '1') assert.fail('intentional cleanup lifecycle failure');
});

afterAll(() => {
  assert.equal(fs.readFileSync(path.join(owned, 'active'), 'utf8'), 'active');
  console.log('TEMP_CLEANUP_TEARDOWN_ACTIVE');
});
