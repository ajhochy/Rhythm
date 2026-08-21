import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { generate } from '../generate-desktop-parity-matrix.mjs';

const root = resolve(import.meta.dirname, '../../..');

test('Flutter parity rows come from origin/main rather than the working tree', async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'parity-flutter-ref-test-'));
  const output = resolve(temporaryRoot, 'matrix');
  const originOnlyPath = 'apps/desktop_flutter/test/features/live_artifacts/live_artifacts_data_source_csp_test.dart';
  try {
    assert.equal(existsSync(resolve(root, originOnlyPath)), false, `${originOnlyPath} unexpectedly exists in the working tree`);
    const result = await generate({ root, out: output });
    const rows = (await readFile(resolve(output, 'source-inventory.jsonl'), 'utf8')).trimEnd().split('\n').map(JSON.parse);
    const behaviors = JSON.parse(await readFile(resolve(output, 'behaviors.json'), 'utf8'));

    assert.ok(rows.some(row => row.surface === 'flutter' && row.path === originOnlyPath));
    assert.ok(rows.filter(row => row.surface === 'flutter').every(row => row.path.startsWith('apps/desktop_flutter/')));
    assert.deepEqual(behaviors.flutterReference, result.flutterReference);
    assert.equal(result.flutterReference.ref, 'origin/main');
    assert.match(result.flutterReference.commit, /^[0-9a-f]{40}$/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('an unresolvable Flutter parity ref fails loudly', async () => {
  const previous = process.env.RHYTHM_PARITY_FLUTTER_REF;
  process.env.RHYTHM_PARITY_FLUTTER_REF = 'refs/heads/parity-ref-that-does-not-exist';
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'parity-flutter-ref-failure-test-'));
  try {
    await assert.rejects(
      generate({ root, out: resolve(temporaryRoot, 'matrix') }),
      /Unable to resolve Flutter parity ref "refs\/heads\/parity-ref-that-does-not-exist"/,
    );
  } finally {
    if (previous === undefined) delete process.env.RHYTHM_PARITY_FLUTTER_REF;
    else process.env.RHYTHM_PARITY_FLUTTER_REF = previous;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
