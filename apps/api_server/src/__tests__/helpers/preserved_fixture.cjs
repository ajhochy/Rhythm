'use strict';
// Test-only lifecycle. No filesystem interception, sockets or permission issuer.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function preserving(env = process.env) {
  if (env.RHYTHM_TEST_PRESERVE_FIXTURES === undefined || env.RHYTHM_TEST_PRESERVE_FIXTURES === '0') return false;
  if (env.RHYTHM_TEST_PRESERVE_FIXTURES !== '1') throw Error('invalid fixture preservation flag');
  if (env.NODE_ENV !== 'test') throw Error('preserving fixtures require NODE_ENV=test');
  return true;
}

function ownedFixture(fixture) {
  const root = process.env.RHYTHM_TEST_FIXTURE_ROOT;
  if (!root || !path.isAbsolute(root) || fs.realpathSync(root) !== root ||
      !/^\/(private\/tmp|private\/var\/folders|var\/folders)\/.+/.test(root)) throw Error('unsafe fixture root');
  const info = fs.lstatSync(fixture);
  if (fs.realpathSync(fixture) !== fixture || info.uid !== process.getuid() ||
      !info.isDirectory() || !(fixture === root || fixture.startsWith(root + path.sep))) throw Error('unowned fixture');
  return info;
}

function finishFixture(fixture, legacyCleanup) {
  if (!preserving()) return legacyCleanup();
  ownedFixture(fixture);
  fs.writeFileSync(path.join(fixture, '.retained-fixture.json'), JSON.stringify({
    preserved: true, path: fixture, uid: process.getuid(), entryCount: fs.readdirSync(fixture).length,
  }) + '\n', { flag: 'wx', mode: 0o600 });
}

function testServerPort(env = process.env) {
  if (env.RHYTHM_TEST_SERVER_PORT === undefined) return 0;
  if (env.NODE_ENV !== 'test' || env.RHYTHM_TEST_SERVER_PORT !== '4796') throw Error('invalid finite test listener port');
  return 4796;
}

// The one assertion-bearing symlink transition cannot be replaced with a no-op.
// Publish exact owned action for existing external tool review; never invoke a
// denied rename/unlink ourselves. Continue only after its actual retained result.
async function preserveForSymlink(source, legacyUnlink) {
  if (!preserving()) return legacyUnlink();
  const fixture = path.dirname(path.dirname(path.dirname(source)));
  ownedFixture(fixture);
  const info = fs.lstatSync(source);
  if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1 || fs.realpathSync(source) !== source)
    throw Error('unsafe symlink-transition source');
  const bytes = fs.readFileSync(source);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const archive = path.join(fixture, 'retained-before-symlink-selectTasks.ts');
  if (fs.existsSync(archive)) throw Error('symlink-transition archive exists');
  const request = { operation: 'renameatx_np(RENAME_EXCL)', source, destination: archive,
    dev: info.dev, ino: info.ino, size: info.size, sha256, approvalIssued: false };
  fs.writeFileSync(path.join(fixture, '.symlink-retention-action.json'), JSON.stringify(request) + '\n', { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (!fs.existsSync(source) && fs.existsSync(archive)) {
      const retained = fs.lstatSync(archive);
      if (!retained.isFile() || retained.uid !== info.uid || retained.dev !== info.dev || retained.ino !== info.ino ||
          retained.size !== info.size || crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== sha256)
        throw Error('symlink archive identity mismatch');
      // This verifies bytes, NOT an approval. External action must have genuine
      // review; source test does not issue or simulate a native/human grant.
      return;
    }
    if (fs.existsSync(source)) {
      const current = fs.lstatSync(source);
      if (current.dev !== info.dev || current.ino !== info.ino ||
          crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex') !== sha256)
        throw Error('symlink source changed before reviewed retention');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('BLOCKED: exact owned symlink retention action requires genuine external review; no move attempted');
}

module.exports = { preserving, finishFixture, testServerPort, preserveForSymlink };
