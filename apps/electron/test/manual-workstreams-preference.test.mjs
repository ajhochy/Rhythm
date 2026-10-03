import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createManualWorkstreamsPreference,
  manualWorkstreamsPreferenceStatus,
  parseManualWorkstreamsPreference,
} from '../src/manual-workstreams-preference.mjs';

test('manual workstreams preference defaults safely off and accepts only its one boolean key', () => {
  assert.equal(parseManualWorkstreamsPreference(null), false);
  assert.equal(parseManualWorkstreamsPreference({}), false);
  assert.equal(parseManualWorkstreamsPreference({ manualWorkstreams: false }), false);
  assert.equal(parseManualWorkstreamsPreference({ manualWorkstreams: true }), true);
  assert.equal(parseManualWorkstreamsPreference({ manualWorkstreams: true, extra: true }), false);
  assert.equal(parseManualWorkstreamsPreference({ manualWorkstreams: 'true' }), false);
});

test('manual workstreams preference is atomically stored 0600 and malformed or unreadable local state stays off', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'rhythm-manual-workstreams-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'manual-workstreams-preference.json');
  const preference = createManualWorkstreamsPreference({ configPath: path });
  assert.equal(preference.load(), false);

  await writeFile(path, '{not-json');
  assert.equal(preference.load(), false);
  await preference.save(true);
  assert.equal(preference.load(), true);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { manualWorkstreams: true });
  assert.equal((await stat(path)).mode & 0o777, 0o600);

  await rm(path);
  await mkdir(path);
  assert.equal(preference.load(), false, 'a non-readable config path must fail closed');
});

test('manual workstreams status exposes only configured state and a captured owned launch, never an adopted receipt', () => {
  const owned = manualWorkstreamsPreferenceStatus({
    configured: true,
    runtime: {
      ownership: 'electron',
      owned: true,
      manualWorkstreamsLaunch: {
        configured: false,
        source: 'environment_override',
        workstreamsEnabled: false,
        managedContextExports: true,
      },
    },
  });
  assert.deepEqual(owned, {
    configured: true,
    effective: {
      source: 'environment_override',
      workstreamsEnabled: false,
      managedContextExports: true,
      enabled: false,
    },
    pendingRelaunch: false,
  });
  const adopted = manualWorkstreamsPreferenceStatus({
    configured: true,
    runtime: {
      ownership: 'external',
      owned: false,
      manualWorkstreamsLaunch: owned.effective,
    },
  });
  assert.deepEqual(adopted.effective, {
    source: 'adopted_runtime', workstreamsEnabled: null, managedContextExports: null, enabled: null,
  });
  assert.equal(adopted.pendingRelaunch, true);
  assert.doesNotMatch(JSON.stringify(owned), /path|token|secret/i);
});
