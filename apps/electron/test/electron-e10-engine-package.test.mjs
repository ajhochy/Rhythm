import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '../../..');
const script = await readFile(resolve(root, 'apps/electron/scripts/package-mac.mjs'), 'utf8');
const version = `0.0.0-rhythm-${'a'.repeat(40)}`;

// Regression: ambient/stale/stock/wrong-CPU engines reach the published app.
test('e10-c2: fresh fork assembly rejects stale output and pins vendored build identity', async (t) => {
  assert.match(script, /export async function buildAndStageFork/, 'packaging has no tested fork assembly boundary');
  const { buildAndStageFork } = await import('../scripts/package-mac.mjs');
  const fixture = await mkdtemp(resolve(tmpdir(), 'rhythm-e10-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const electronRoot = resolve(fixture, 'apps/electron');
  const forkRoot = resolve(fixture, 'apps/opencode_fork/packages/opencode');
  const source = resolve(forkRoot, `dist/opencode-darwin-${process.arch}/bin/opencode`);
  const resources = resolve(fixture, 'Rhythm.app/Contents/Resources');
  const destination = resolve(resources, 'opencode_bin/opencode');
  const cFile = resolve(fixture, 'engine.c');
  const binary = resolve(fixture, 'engine');
  const stock = resolve(fixture, 'stock');
  await mkdir(electronRoot, { recursive: true });
  await writeFile(cFile, `#include <stdio.h>\nint main(void) { puts("${version}"); return 0; }\n`);
  await run('clang', [cFile, '-o', binary]);
  await writeFile(cFile, '#include <stdio.h>\nint main(void) { puts("1.14.49"); return 0; }\n');
  await run('clang', [cFile, '-o', stock]);
  for (const state of ['missing', 'non-executable', 'wrong-arch', 'stock', 'stale', 'valid']) {
    await t.test(state === 'valid' ? 'e10-c1: executable at the discovery path has exact fork bytes/version' : `e10-c3: reject ${state} before resource publication`, async () => {
      await rm(resources, { recursive: true, force: true });
      await mkdir(dirname(source), { recursive: true });
      await writeFile(source, 'stale artifact');
      let built = false;
      const boundary = async (command, args, options) => {
        if (command === 'git') return { stdout: args[0] === 'rev-parse' ? 'a'.repeat(40) : '' };
        if (command === 'bun') {
          assert.equal(options.cwd, forkRoot);
          assert.deepEqual(args, ['run', 'build', '--single', '--skip-install']);
          assert.equal(options.env.OPENCODE_CHANNEL, 'rhythm');
          assert.equal(options.env.OPENCODE_VERSION, version);
          assert.equal(options.env.OPENCODE_RELEASE, '');
          await assert.rejects(access(source), 'old output must be removed before the build');
          built = true;
          if (state === 'missing' || state === 'stale') return { stdout: '' };
          await mkdir(dirname(source), { recursive: true });
          await cp(state === 'stock' ? stock : binary, source);
          if (state === 'non-executable') await chmod(source, 0o644);
          if (state === 'wrong-arch') {
            const bytes = await readFile(source);
            // Change the actual Mach-O CPU header, not the architecture validator/tool.
            bytes.writeUInt32LE(process.arch === 'arm64' ? 0x01000007 : 0x0100000c, 4);
            bytes.writeUInt32LE(process.arch === 'arm64' ? 3 : 0, 8);
            await writeFile(source, bytes);
          }
          return { stdout: '' };
        }
        return run(command, args, options);
      };
      const assemble = () => buildAndStageFork({ electronRoot, resources, run: boundary });
      if (state === 'valid') {
        await assemble();
        await access(destination, constants.X_OK);
        assert.deepEqual(await readFile(destination), await readFile(binary));
        assert.equal((await run(destination, ['--version'])).stdout.trim(), version);
      } else {
        await assert.rejects(assemble, state === 'wrong-arch' ? /architecture/ : state === 'stock' ? /identity/ : /ENOENT|executable/);
        await assert.rejects(access(destination));
      }
      assert.equal(built, true);
    });
  }
});

test('e10-c4: signing discovers extensionless engine and verifies its signature', async () => {
  const signing = await readFile(resolve(root, 'apps/electron/scripts/sign-and-notarize-mac.mjs'), 'utf8');
  assert.match(signing, /opencode_bin\/opencode/);
  assert.match(signing, /await isMachO\(full\)/);
  assert.match(signing, /await codesign\(target\)/);
  assert.match(signing, /'--verify', '--strict', engine/);
});

test('e10-c5: native release jobs cannot relabel one architecture as both', async () => {
  const workflow = await readFile(resolve(root, '.github/workflows/electron_release.yml'), 'utf8');
  assert.match(workflow, /arch: arm64\s+runner: macos-14/);
  assert.match(workflow, /arch: x64\s+runner: macos-15-intel/);
  assert.match(workflow, /runs-on: \$\{\{ matrix.runner \}\}/);
  assert.match(workflow, /RHYTHM_PACKAGE_ARCH: \$\{\{ matrix.arch \}\}/);
  assert.match(workflow, /oven-sh\/setup-bun@v2/);
  assert.match(workflow, /bun install --frozen-lockfile/);
  assert.match(workflow, /Rhythm-\$\{\{ matrix.arch \}\}\.zip/);
});

test('e10-c6: existing API, Node and addon assembly remains wired before publication', () => {
  assert.match(script, /buildAndStageFork\(\{ electronRoot, resources \}\)/);
  assert.ok(script.indexOf('await buildAndStageFork') < script.indexOf("await run('npm'"));
  for (const token of ['opencode_plugins', 'config_seeds', 'vendor', 'resources', 'package-lock.json', 'better-sqlite3', 'node-pty', 'cp(process.execPath, packagedNode)', 'rename(stagingArtifact, artifact)']) {
    assert.ok(script.includes(token), token);
  }
  assert.doesNotMatch(script, /which.*opencode|\/usr\/local\/bin\/opencode/);
});
