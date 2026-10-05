import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { verifyPackagedDayflow } from '../scripts/verify-packaged-dayflow.mjs';

const execFileAsync = promisify(execFile);

async function withTemp(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-dayflow-packaged-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function makePackagedRhythm(root, { legalFiles = true } = {}) {
  const appRoot = path.join(root, 'Rhythm.app');
  const dayflowRoot = path.join(appRoot, 'Contents', 'Resources', 'dayflow-desktop', 'Dayflow.app');
  const legalRoot = path.join(appRoot, 'Contents', 'Resources', 'dayflow-desktop', 'legal');
  await mkdir(path.join(appRoot, 'Contents', 'MacOS'), { recursive: true });
  await mkdir(path.join(dayflowRoot, 'Contents', 'MacOS'), { recursive: true });
  await writeFile(path.join(appRoot, 'Contents', 'Info.plist'), 'synthetic Rhythm plist');
  await writeFile(path.join(appRoot, 'Contents', 'MacOS', 'Rhythm'), 'synthetic Rhythm executable');
  await chmod(path.join(appRoot, 'Contents', 'MacOS', 'Rhythm'), 0o755);
  await writeFile(path.join(dayflowRoot, 'Contents', 'Info.plist'), 'synthetic Dayflow plist');
  await writeFile(path.join(dayflowRoot, 'Contents', 'MacOS', 'Dayflow'), 'synthetic Dayflow executable');
  await chmod(path.join(dayflowRoot, 'Contents', 'MacOS', 'Dayflow'), 0o755);
  if (legalFiles) {
    await mkdir(legalRoot, { recursive: true });
    await writeFile(path.join(legalRoot, 'LICENSE'), 'synthetic license');
    await writeFile(path.join(legalRoot, 'NOTICES.md'), 'synthetic notices');
    await writeFile(path.join(legalRoot, 'notice-sources.json'), '{"sources":[]}');
    await writeFile(path.join(legalRoot, 'THIRD-PARTY-NOTICES.txt'), 'synthetic aggregate notices');
    await writeFile(path.join(legalRoot, 'LICENSE-Dayflow.txt'), 'synthetic source license');
  }
  return { appRoot, dayflowRoot, legalRoot };
}

function syntheticMacExecutor({
  failOuterVerify = false,
  outerArchitectures = 'arm64 x86_64',
  outerExecutable = 'Rhythm',
  calls = [],
} = {}) {
  return async (command, args) => {
    calls.push([command, args]);
    const inspectedPath = args.at(-1);
    const isDayflow = typeof inspectedPath === 'string' && inspectedPath.includes('Dayflow.app');
    if (command === 'plutil') {
      return {
        stdout: JSON.stringify(isDayflow
          ? {
              CFBundleIdentifier: 'teleportlabs.com.Dayflow',
              CFBundleShortVersionString: '2.6.0',
              CFBundleVersion: '133',
              CFBundleExecutable: 'Dayflow',
            }
          : {
              CFBundleIdentifier: 'com.example.Rhythm',
              CFBundleShortVersionString: '9.4.1',
              CFBundleVersion: '941',
              CFBundleExecutable: outerExecutable,
            }),
      };
    }
    if (command === 'codesign' && args[0] === '-d') {
      return {
        stderr: isDayflow
          ? 'Identifier=teleportlabs.com.Dayflow\nTeamIdentifier=L75WYD8X4Y\nCDHash=dayflowcdhash\n'
          : 'Identifier=com.example.Rhythm\nTeamIdentifier=RHYTHMTEAM\nCDHash=rhythmcdhash\n',
      };
    }
    if (command === 'lipo') return { stdout: isDayflow ? 'arm64\n' : `${outerArchitectures}\n` };
    if (command === 'codesign' && args.includes('--verify') && !isDayflow && failOuterVerify) {
      throw new Error('outer signature invalid');
    }
    return { stdout: '', stderr: '' };
  };
}

test('synthetic fixture: emits an integrity-only receipt after validating the staged Dayflow and outer app', async () => {
  await withTemp(async (root) => {
    const { appRoot } = await makePackagedRhythm(root);
    const receipt = await verifyPackagedDayflow({
      appRoot,
      execute: syntheticMacExecutor(),
      expectedIdentity: { identifier: 'com.example.Rhythm', teamId: 'RHYTHMTEAM' },
    });

    assert.equal(receipt.status, 'verified');
    assert.equal(receipt.appRoot, appRoot);
    assert.equal(receipt.version, '9.4.1');
    assert.equal(receipt.build, '941');
    assert.equal(receipt.id, 'com.example.Rhythm');
    assert.equal(receipt.team, 'RHYTHMTEAM');
    assert.deepEqual(receipt.architecture, ['arm64', 'x86_64']);
    assert.deepEqual(receipt.legalFiles, {
      root: 'Contents/Resources/dayflow-desktop/legal',
      LICENSE: true,
      'NOTICES.md': true,
      'notice-sources.json': true,
      'THIRD-PARTY-NOTICES.txt': true,
      sourceLicenses: ['LICENSE-Dayflow.txt'],
    });
    assert.equal(receipt.upstreamDayflow.present, true);
    assert.equal(receipt.upstreamDayflow.signature, 'verified');
    assert.equal(receipt.upstreamDayflow.identifier, 'teleportlabs.com.Dayflow');
    assert.equal(receipt.upstreamDayflow.teamId, 'L75WYD8X4Y');
    assert.equal(receipt.outerSignature.status, 'verified');
    assert.equal(receipt.outerApp.cdHash, 'rhythmcdhash');
    assert.equal(receipt.captureGate, 'not_tested');
    assert.equal(receipt.captureGateReason, 'OS capture permission/runtime capture qualification not performed by this verifier');
    assert.equal('launchHealth' in receipt, false);
    assert.equal('capture' in receipt, false);
  });
});

test('synthetic fixture: fails closed when the staged Dayflow companion is absent', async () => {
  await withTemp(async (root) => {
    const { appRoot } = await makePackagedRhythm(root);
    await rm(path.join(appRoot, 'Contents', 'Resources', 'dayflow-desktop', 'Dayflow.app'), { recursive: true });
    await assert.rejects(
      verifyPackagedDayflow({ appRoot, execute: syntheticMacExecutor() }),
      /bundled Dayflow root is missing/,
    );
  });
});

test('synthetic fixture: fails closed on an invalid outer signature', async () => {
  await withTemp(async (root) => {
    const { appRoot } = await makePackagedRhythm(root);
    await assert.rejects(
      verifyPackagedDayflow({ appRoot, execute: syntheticMacExecutor({ failOuterVerify: true }) }),
      /outer Rhythm signature verification failed/,
    );
  });
});

test('synthetic fixture: fails closed when required legal material is missing', async () => {
  await withTemp(async (root) => {
    const { appRoot, legalRoot } = await makePackagedRhythm(root, { legalFiles: false });
    await mkdir(legalRoot, { recursive: true });
    await writeFile(path.join(legalRoot, 'LICENSE'), 'synthetic license');
    await writeFile(path.join(legalRoot, 'NOTICES.md'), 'synthetic notices');
    await writeFile(path.join(legalRoot, 'THIRD-PARTY-NOTICES.txt'), 'synthetic aggregate notices');
    await writeFile(path.join(legalRoot, 'LICENSE-Dayflow.txt'), 'synthetic source license');
    await assert.rejects(
      verifyPackagedDayflow({ appRoot, execute: syntheticMacExecutor() }),
      /notice-sources\.json is missing/,
    );
  });
});

test('synthetic fixture: rejects an x64-only outer app when bundled Dayflow is arm64', async () => {
  await withTemp(async (root) => {
    const { appRoot } = await makePackagedRhythm(root);
    await assert.rejects(
      verifyPackagedDayflow({ appRoot, execute: syntheticMacExecutor({ outerArchitectures: 'x86_64' }) }),
      /outer Rhythm must contain arm64 because bundled Dayflow is arm64/,
    );
  });
});

test('synthetic fixture: rejects a traversing outer executable plist value before hash, signing details, or lipo', async () => {
  await withTemp(async (root) => {
    const { appRoot } = await makePackagedRhythm(root);
    const calls = [];
    await assert.rejects(
      verifyPackagedDayflow({
        appRoot,
        execute: syntheticMacExecutor({
          outerExecutable: '../Resources/dayflow-desktop/Dayflow.app/Contents/MacOS/Dayflow',
          calls,
        }),
      }),
      /CFBundleExecutable must be a single safe basename/,
    );
    assert.deepEqual(calls.map(([command]) => command), ['plutil']);
  });
});

test('synthetic fixture: rejects every other non-basename outer executable plist value before signing details or lipo', async () => {
  await withTemp(async (root) => {
    const { appRoot } = await makePackagedRhythm(root);
    for (const executable of ['.', '..', 'Rhythm\\Helper', '']) {
      const calls = [];
      await assert.rejects(
        verifyPackagedDayflow({ appRoot, execute: syntheticMacExecutor({ outerExecutable: executable, calls }) }),
        /(CFBundleExecutable must be a single safe basename|has no usable CFBundleExecutable)/,
      );
      assert.deepEqual(calls.map(([command]) => command), ['plutil'], `unexpected validation command for ${JSON.stringify(executable)}`);
    }
  });
});

test('synthetic fixture: rejects a symlinked source app root before command validation', async () => {
  await withTemp(async (root) => {
    const realRoot = path.join(root, 'real');
    await mkdir(realRoot);
    const { appRoot } = await makePackagedRhythm(realRoot);
    const linkedRoot = path.join(root, 'Rhythm-link.app');
    await symlink(appRoot, linkedRoot);
    await assert.rejects(
      verifyPackagedDayflow({ appRoot: linkedRoot, execute: syntheticMacExecutor() }),
      /outer app root must be a real directory/,
    );
  });
});

test('CLI fails closed with JSON when an explicit app path is omitted', async () => {
  const script = path.resolve(import.meta.dirname, '../scripts/verify-packaged-dayflow.mjs');
  await assert.rejects(
    execFileAsync(process.execPath, [script]),
    (cause) => {
      assert.equal(cause.code, 1);
      assert.deepEqual(JSON.parse(cause.stdout), {
        status: 'failed',
        error: 'Packaged Dayflow verification requires an explicit absolute Rhythm.app path',
      });
      return true;
    },
  );
});
