// Regression: Slice 6 must publish a self-validating, deterministic coverage matrix.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { generate } from '../generate-desktop-parity-matrix.mjs';
import { loadAndValidate, requiredTaxonomy, validate } from '../validate-desktop-parity-matrix.mjs';

const root = resolve(import.meta.dirname, '../../..');

test('Slice 6 coverage matrix artifacts and validator are published', () => {
  for (const path of [
    'docs/ai/coverage/react-electron/README.md',
    'docs/ai/coverage/react-electron/source-inventory.jsonl',
    'docs/ai/coverage/react-electron/behaviors.json',
    'docs/ai/coverage/react-electron/mappings.csv',
    'docs/ai/contracts/desktop-parity-matrix.md',
    'tools/validation/validate-desktop-parity-matrix.mjs',
  ]) {
    assert.equal(existsSync(resolve(root, path)), true, `missing ${path}`);
  }
});

const complete = () => ({
  sources: [{ sourceId: 'api:tests/example.mjs:L1', surface: 'api', path: 'tests/example.mjs', anchor: 'L1', line: 1, title: 'works', kind: 'test_declaration', parserLimitations: 'line parser' }],
  behaviors: { taxonomy: [...requiredTaxonomy], behaviors: [
    { behaviorId: 'behavior:nav-a11y', taxonomy: 'nav-a11y', actor: 'user', precondition: 'ready', action: 'navigate', outcome: 'visible state', failure: 'error', security: 'isolated', layers: ['unit'], journeys: ['desktop'], status: 'planned', owner: 'owner', rationale: 'gap is planned' },
    { behaviorId: 'behavior:terminal-pty', taxonomy: 'terminal-pty', actor: 'user', precondition: 'ready', action: 'open terminal', outcome: 'not claimed', failure: 'deferred', security: 'isolated', layers: ['manual'], journeys: ['desktop'], status: 'deferred', owner: 'owner', rationale: 'explicitly deferred' },
    ...[...requiredTaxonomy].filter(taxonomy => !['nav-a11y', 'terminal-pty'].includes(taxonomy)).map(taxonomy => ({ behaviorId: `behavior:${taxonomy}`, taxonomy, actor: 'user', precondition: 'ready', action: 'exercise', outcome: 'visible state', failure: 'error', security: 'isolated', layers: ['unit'], journeys: ['desktop'], status: 'planned', owner: 'owner', rationale: 'gap is planned' })),
  ] },
  mappings: [{ sourceId: 'api:tests/example.mjs:L1', behaviorId: 'behavior:nav-a11y', disposition: 'retained_unit', rationale: 'declared unit test', owner: 'owner' }],
});

test('validator accepts a complete matrix', () => {
  assert.deepEqual(validate(complete()).errors, []);
});

test('validator catches duplicate, unknown, missing, invalid, rationale, and Terminal failures', () => {
  const fixture = complete();
  fixture.sources.push({ ...fixture.sources[0] });
  fixture.sources.push({ ...fixture.sources[0], sourceId: 'api:tests/unmapped.mjs:L2', anchor: 'L2', line: 2 });
  fixture.mappings = [{ ...fixture.mappings[0], behaviorId: 'behavior:unknown', disposition: 'imaginary', rationale: '' }];
  fixture.behaviors.behaviors[0].status = 'deferred';
  fixture.behaviors.behaviors.find(behavior => behavior.taxonomy === 'terminal-pty').status = 'planned';
  fixture.behaviors.behaviors[0].layers = ['browser'];
  fixture.behaviors.behaviors[0].outcome = '';
  fixture.behaviors.taxonomy = ['nav-a11y', 'terminal-pty'];
  const errors = validate(fixture).errors.join('\n');
  for (const expected of ['duplicate source', 'unknown behavior', 'invalid disposition', 'lacks rationale', 'source missing mapping', 'invalid layer', 'missing outcome', 'missing required taxonomy', 'non-Terminal', 'Terminal/PTTY']) assert.match(errors, new RegExp(expected));
});

test('generator is deterministic across two scans', async () => {
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), 'parity-matrix-'));
  await writeFile(resolve(fixtureRoot, 'README.md'), 'manual smoke check\n');
  await writeFile(resolve(fixtureRoot, 'package.json'), '{}\n');
  const first = await generate({ root: fixtureRoot, out: 'matrix' });
  const firstFiles = await Promise.all(['source-inventory.jsonl', 'behaviors.json', 'mappings.csv'].map(file => readFile(resolve(fixtureRoot, 'matrix', file), 'utf8')));
  const second = await generate({ root: fixtureRoot, out: 'matrix' });
  const secondFiles = await Promise.all(['source-inventory.jsonl', 'behaviors.json', 'mappings.csv'].map(file => readFile(resolve(fixtureRoot, 'matrix', file), 'utf8')));
  assert.deepEqual(secondFiles, firstFiles);
  assert.deepEqual(second.counts, first.counts);
  assert.equal(first.counts.sources, 1);
});

test('fresh scan byte-matches the published hermetic corpus', async () => {
  const output = resolve(await mkdtemp(resolve(tmpdir(), 'parity-fresh-')), 'matrix');
  await generate({ root, out: output });
  for (const file of ['source-inventory.jsonl', 'mappings.csv', 'behaviors.json']) {
    assert.equal(
      await readFile(resolve(output, file), 'utf8'),
      await readFile(resolve(root, 'docs/ai/coverage/react-electron', file), 'utf8'),
      `published ${file} is stale or includes mutable execution evidence`,
    );
  }
});

test('published matrix validates and rejects malformed CSV completion', async () => {
  assert.deepEqual((await loadAndValidate(resolve(root, 'docs/ai/coverage/react-electron'))).errors, []);
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), 'parity-csv-'));
  await writeFile(resolve(fixtureRoot, 'source-inventory.jsonl'), `${JSON.stringify(complete().sources[0])}\n`);
  await writeFile(resolve(fixtureRoot, 'behaviors.json'), JSON.stringify(complete().behaviors));
  await writeFile(resolve(fixtureRoot, 'mappings.csv'), 'sourceId,behaviorId,disposition,rationale,owner\nnot-json\n');
  assert.match((await loadAndValidate(fixtureRoot)).errors.join('\n'), /malformed CSV row 2/);
});
