import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { qualificationHermesHostOptions, snapshotQualificationHermesRuntime } from '../src/qualification-hermes-runtime.mjs';

function fixture(t) {
  const runtimeRoot = mkdtempSync('/private/tmp/rhythm-hermes-runtime-');
  const fixtureRoot = mkdtempSync('/private/tmp/rhythm-hermes-actor-');
  t.after(() => { rmSync(runtimeRoot, { recursive: true, force: true }); rmSync(fixtureRoot, { recursive: true, force: true }); });
  const git = (...args) => execFileSync('git', ['-C', runtimeRoot, ...args], { stdio: 'ignore' });
  git('init', '-q');
  writeFileSync(join(runtimeRoot, '.gitignore'), '.venv/\n.uv-python/\n');
  writeFileSync(join(runtimeRoot, 'pyproject.toml'), '[project]\nname = "hermes-agent"\nversion = "0.20.4"\n');
  writeFileSync(join(runtimeRoot, 'uv.lock'), '[[package]]\nname = "hermes-agent"\nversion = "0.20.4"\n');
  writeFileSync(join(runtimeRoot, 'web_server.py'), 'SCHEMA = {}\n');
  git('add', '.');
  git('-c', 'user.name=Qualification', '-c', 'user.email=qualification@example.invalid', 'commit', '-qm', 'fixture');
  const revision = execFileSync('git', ['-C', runtimeRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const pythonDirectory = join(runtimeRoot, '.uv-python', 'cpython-3.12', 'bin');
  const venvBin = join(runtimeRoot, '.venv', 'bin');
  const site = join(runtimeRoot, '.venv', 'lib', 'python3.12', 'site-packages', 'hermes_agent-0.20.4.dist-info');
  mkdirSync(pythonDirectory, { recursive: true }); mkdirSync(venvBin, { recursive: true }); mkdirSync(site, { recursive: true });
  const pythonExecutablePath = join(pythonDirectory, 'python3.12');
  writeFileSync(pythonExecutablePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  symlinkSync(pythonExecutablePath, join(venvBin, 'python'));
  const backendExecutablePath = join(venvBin, 'hermes');
  writeFileSync(backendExecutablePath, `#!${join(venvBin, 'python')}\nprint("test")\n`, { mode: 0o700 });
  writeFileSync(join(site, 'METADATA'), 'Name: hermes-agent\nVersion: 0.20.4\n');
  writeFileSync(join(site, 'direct_url.json'), JSON.stringify({ url: pathToFileURL(runtimeRoot).href, dir_info: { editable: true } }));
  const runtimeManifestPath = join(fixtureRoot, 'hermes-runtime.json');
  const actorManifestPath = join(fixtureRoot, 'manifest.json');
  const manifest = snapshotQualificationHermesRuntime(runtimeRoot, revision);
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(runtimeManifestPath, bytes, { mode: 0o600 });
  mkdirSync(join(fixtureRoot, 'home'), { mode: 0o700 });
  const actor = { fixtureRoot, syntheticActor: { hermesRuntime: {
    manifestPath: runtimeManifestPath, manifestSha256: createHash('sha256').update(bytes).digest('hex'),
  } } };
  const saveActor = () => writeFileSync(actorManifestPath, JSON.stringify(actor), { mode: 0o600 });
  saveActor();
  return { runtimeRoot, fixtureRoot, revision, backendExecutablePath, runtimeManifestPath, actor, saveActor };
}

test('an exact private pinned runtime grants only its staged executable and homes', (t) => {
  const f = fixture(t);
  assert.deepEqual(qualificationHermesHostOptions(f.fixtureRoot, f.revision), {
    childHome: join(f.fixtureRoot, 'home'), hermesHome: join(f.fixtureRoot, 'hermes-home'),
    backendExecutablePath: f.backendExecutablePath,
  });
  f.actor.syntheticActor.hermesRuntime = undefined; f.saveActor();
  assert.throws(() => qualificationHermesHostOptions(f.fixtureRoot, f.revision), /Qualification Hermes runtime unavailable/);
});

test('each attach rejects changed manifest, executable, dependency, or source bytes', (t) => {
  const f = fixture(t);
  const read = () => qualificationHermesHostOptions(f.fixtureRoot, f.revision);
  assert.equal(read().backendExecutablePath, f.backendExecutablePath);
  writeFileSync(f.backendExecutablePath, '#!/bin/sh\nexit 1\n');
  assert.throws(read, /Qualification Hermes runtime unavailable/);
  writeFileSync(f.backendExecutablePath, `#!${join(f.runtimeRoot, '.venv', 'bin', 'python')}\nprint("test")\n`);
  assert.equal(read().backendExecutablePath, f.backendExecutablePath);
  const metadataPath = join(f.runtimeRoot, '.venv', 'lib', 'python3.12', 'site-packages', 'hermes_agent-0.20.4.dist-info', 'METADATA');
  writeFileSync(metadataPath, 'Name: hermes-agent\nVersion: 9.9.9\n');
  assert.throws(read, /Qualification Hermes runtime unavailable/);
  writeFileSync(metadataPath, 'Name: hermes-agent\nVersion: 0.20.4\n');
  assert.equal(read().backendExecutablePath, f.backendExecutablePath);
  writeFileSync(join(f.runtimeRoot, 'web_server.py'), 'SCHEMA = {"changed": True}\n');
  assert.throws(read, /Qualification Hermes runtime unavailable/);
});

test('private manifest and interpreter must retain their exact owned paths', (t) => {
  const f = fixture(t);
  const read = () => qualificationHermesHostOptions(f.fixtureRoot, f.revision);
  chmodSync(f.runtimeManifestPath, 0o644);
  assert.throws(read, /Qualification Hermes runtime unavailable/);
  chmodSync(f.runtimeManifestPath, 0o600);
  f.actor.syntheticActor.hermesRuntime.manifestSha256 = '0'.repeat(64); f.saveActor();
  assert.throws(read, /Qualification Hermes runtime unavailable/);
});

test('an interpreter link cannot escape the hashed runtime trees', (t) => {
  const f = fixture(t);
  const pythonLink = join(f.runtimeRoot, '.venv', 'bin', 'python');
  rmSync(pythonLink);
  symlinkSync('/bin/sh', pythonLink);
  assert.throws(() => qualificationHermesHostOptions(f.fixtureRoot, f.revision), /Qualification Hermes runtime unavailable/);
});
