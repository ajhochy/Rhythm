import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DAYFLOW_DESIGNATED_REQUIREMENT,
  findNestedCodeSignTargets,
  stageDayflowDesktopArtifact,
  validateDayflowDesktopArtifact,
} from '../src/dayflow-desktop-artifact.mjs';

async function withTemp(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-dayflow-artifact-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function makeDayflowApp(root, { plist = {}, notices = false } = {}) {
  const app = path.join(root, 'Dayflow.app');
  await mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  await mkdir(path.join(app, 'Contents', 'Frameworks'), { recursive: true });
  await writeFile(path.join(app, 'Contents', 'Info.plist'), 'fixture plist');
  await writeFile(path.join(app, 'Contents', 'MacOS', 'Dayflow'), 'upstream executable');
  await chmod(path.join(app, 'Contents', 'MacOS', 'Dayflow'), 0o755);
  await writeFile(path.join(app, 'Contents', 'Frameworks', 'Marker'), 'framework marker');
  await symlink('Marker', path.join(app, 'Contents', 'Frameworks', 'Current'));
  if (notices) {
    await mkdir(path.join(app, 'Contents', 'Resources'), { recursive: true });
    await writeFile(path.join(app, 'Contents', 'Resources', 'NOTICE'), 'upstream dependency notice');
    await writeFile(path.join(app, 'Contents', 'Resources', 'user-token.txt'), 'not a notice');
  }
  return { app, plist: {
    CFBundleIdentifier: 'teleportlabs.com.Dayflow',
    CFBundleShortVersionString: '2.6.0',
    CFBundleVersion: '133',
    ...plist,
  } };
}

function fakeMacVerification(plist, { failExactVerify = false, calls = [] } = {}) {
  return async (command, args) => {
    calls.push([command, args]);
    if (command === 'plutil') return { stdout: JSON.stringify(plist) };
    if (command === 'codesign' && args[0] === '-d') {
      return { stderr: 'Identifier=teleportlabs.com.Dayflow\nTeamIdentifier=L75WYD8X4Y\n' };
    }
    if (command === 'lipo') return { stdout: 'arm64\n' };
    if (command === 'codesign' && args.includes('--verify') && failExactVerify) throw new Error('signature invalid');
    return { stdout: '' };
  };
}

test('Dayflow bundling requires an explicit artifact path', async () => {
  await assert.rejects(
    validateDayflowDesktopArtifact({ appRoot: '', targetArch: 'arm64', execute: async () => ({ stdout: '' }) }),
    /RHYTHM_DAYFLOW_APP_DIR/,
  );
});

test('Dayflow bundling rejects identity/version/build/architecture mismatches before staging', async () => {
  await withTemp(async (root) => {
    const { app, plist } = await makeDayflowApp(root, { plist: { CFBundleVersion: '132' } });
    await assert.rejects(
      validateDayflowDesktopArtifact({ appRoot: app, targetArch: 'arm64', execute: fakeMacVerification(plist) }),
      /CFBundleVersion mismatch/,
    );
    await assert.rejects(
      validateDayflowDesktopArtifact({ appRoot: app, targetArch: 'x64', execute: fakeMacVerification({ ...plist, CFBundleVersion: '133' }) }),
      /supports only arm64 packaging/,
    );
  });
});

test('Dayflow bundling fails closed when exact signature verification fails', async () => {
  await withTemp(async (root) => {
    const { app, plist } = await makeDayflowApp(root);
    await assert.rejects(
      validateDayflowDesktopArtifact({ appRoot: app, targetArch: 'arm64', execute: fakeMacVerification(plist, { failExactVerify: true }) }),
      /exact designated requirement verification failed/,
    );
  });
});

test('Dayflow staging preserves upstream symlinks, copies only the app, and validates the staged copy again', async () => {
  await withTemp(async (root) => {
    const sourceRoot = path.join(root, 'source');
    await mkdir(sourceRoot);
    const { app, plist } = await makeDayflowApp(sourceRoot, { notices: true });
    await mkdir(path.join(sourceRoot, 'Library', 'Application Support'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'Library', 'Application Support', 'journal.sqlite'), 'never package user data');
    const calls = [];
    const staged = await stageDayflowDesktopArtifact({
      resources: path.join(root, 'Rhythm.app', 'Contents', 'Resources'),
      appRoot: app,
      targetArch: 'arm64',
      execute: fakeMacVerification(plist, { calls }),
    });
    assert.equal(staged.appRoot, path.join(root, 'Rhythm.app', 'Contents', 'Resources', 'dayflow-desktop', 'Dayflow.app'));
    assert.ok((await lstat(path.join(staged.appRoot, 'Contents', 'Frameworks', 'Current'))).isSymbolicLink());
    assert.equal((await stat(path.join(staged.appRoot, 'Contents', 'MacOS', 'Dayflow'))).mode & 0o777, 0o755);
    assert.equal(await readFile(path.join(staged.root, 'legal', 'upstream-app-notices', 'Contents', 'Resources', 'NOTICE'), 'utf8'), 'upstream dependency notice');
    await assert.rejects(lstat(path.join(staged.root, 'legal', 'upstream-app-notices', 'Contents', 'Resources', 'user-token.txt')));
    assert.match(await readFile(path.join(staged.root, 'legal', 'LICENSE'), 'utf8'), /Copyright \(c\) 2025 Jerry Liu/);
    assert.match(await readFile(path.join(staged.root, 'legal', 'THIRD-PARTY-NOTICES.txt'), 'utf8'), /bundled third-party notices/i);
    assert.ok(JSON.parse(await readFile(path.join(staged.root, 'legal', 'notice-sources.json'), 'utf8')).length > 0);
    assert.ok(JSON.parse(await readFile(path.join(staged.root, 'legal', 'Package.resolved'), 'utf8')).pins.length > 0);
    await assert.rejects(lstat(path.join(root, 'Rhythm.app', 'Contents', 'Resources', 'Library', 'Application Support', 'journal.sqlite')));
    const exactVerifications = calls.filter(([command, args]) => command === 'codesign' && args.includes('--verify'));
    assert.equal(exactVerifications.length, 2, 'source and staged copies must both receive exact signature verification');
    assert.ok(exactVerifications.every(([, args]) => args.includes(`=${DAYFLOW_DESIGNATED_REQUIREMENT}`)));
    assert.ok(exactVerifications.every(([, args]) => !args.includes(DAYFLOW_DESIGNATED_REQUIREMENT)));
    assert.equal(calls.filter(([command]) => command === 'spctl').length, 2, 'source and staged copies must both receive Gatekeeper assessment');
  });
});

test('production signing traversal skips a sibling symlink alias into Dayflow while retaining real siblings', async () => {
  await withTemp(async (root) => {
    const resources = path.join(root, 'Rhythm.app', 'Contents', 'Resources');
    const dayflow = path.join(resources, 'dayflow-desktop', 'Dayflow.app');
    const dayflowExecutable = path.join(dayflow, 'Contents', 'MacOS', 'Dayflow');
    const opencode = path.join(resources, 'opencode_bin', 'opencode');
    const approvalHelper = path.join(resources, 'human-approval', 'rhythm-approval-signer');
    const hermesHelper = path.join(resources, 'hermes-desktop', 'host', 'native-helper');
    const colonyHelper = path.join(resources, 'colony-desktop', 'server', 'native-helper');
    const frameworkBinary = path.join(resources, 'Frameworks', 'Real.framework', 'Versions', 'A', 'Real');
    for (const binary of [dayflowExecutable, opencode, approvalHelper, hermesHelper, colonyHelper, frameworkBinary]) {
      await mkdir(path.dirname(binary), { recursive: true });
      await writeFile(binary, Buffer.from([0xfe, 0xed, 0xfa, 0xcf]));
    }
    await symlink(dayflowExecutable, path.join(resources, 'dayflow-executable-alias'));
    const targets = await findNestedCodeSignTargets(resources, { excludedRoots: [dayflow] });
    assert.ok(targets.includes(opencode));
    assert.ok(targets.includes(approvalHelper));
    assert.ok(targets.includes(hermesHelper));
    assert.ok(targets.includes(colonyHelper));
    assert.ok(targets.includes(frameworkBinary));
    assert.ok(targets.includes(path.join(resources, 'Frameworks', 'Real.framework')));
    assert.ok(!targets.some((target) => target === dayflow || target.startsWith(`${dayflow}${path.sep}`)));
    assert.ok(!targets.includes(path.join(resources, 'dayflow-executable-alias')));
  });
});

test('package and production sign flows stage/validate Dayflow without deep re-signing it', async () => {
  const packageSource = await readFile(new URL('../scripts/package-mac.mjs', import.meta.url), 'utf8');
  const signSource = await readFile(new URL('../scripts/sign-and-notarize-mac.mjs', import.meta.url), 'utf8');
  assert.match(packageSource, /stageDayflowDesktopArtifact\(\{ resources, execute: run \}\)/);
  assert.match(packageSource, /Do not use --deep here: it would re-sign the independently verified upstream Dayflow\.app/);
  assert.match(signSource, /excludedRoots: \[dayflowDesktopArtifact\]/);
  assert.match(signSource, /validateDayflowDesktopArtifact\(\{ appRoot: dayflowDesktopArtifact, execute: run \}\)/);
  assert.ok(signSource.indexOf('validateDayflowDesktopArtifact({ appRoot: dayflowDesktopArtifact, execute: run })') < signSource.indexOf('await codesign(artifact, { deep: false })'));
});
