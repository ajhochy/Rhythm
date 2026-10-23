import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attestPrivateEngineListener } from '../org_evaluation_managed_engine_owner';

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'rhythm-private-owner-'));
  const pinned = join(root, 'opencode');
  let child: ReturnType<typeof spawn> | null = null;
  let unrelated: ReturnType<typeof spawn> | null = null;
  try {
    copyFileSync(process.execPath, pinned); chmodSync(pinned, 0o500);
    const binarySha256 = createHash('sha256').update(readFileSync(pinned)).digest('hex');
    child = spawn(pinned, ['-e', `require('node:net').createServer().listen(0,'127.0.0.1',function(){ console.log(this.address().port); });`],
      { stdio: ['ignore','pipe','pipe'] });
    const port = await new Promise<number>((resolve, reject) => {
      let output = '';
      child!.stdout!.on('data', (bytes) => {
        output += bytes.toString('utf8');
        const match = output.match(/^(\d+)\n/);
        if (match) resolve(Number(match[1]));
      });
      child!.once('error', reject);
      setTimeout(() => reject(Error('Owned listener failed to boot')), 5000).unref();
    });
    const binding = { enginePort: port, workerPid: process.pid, pinnedBinary: pinned, binarySha256 };
    const actual = attestPrivateEngineListener(binding);
    assert.equal(actual.enginePid, child.pid);
    unrelated = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
    assert.ok(unrelated.pid);
    assert.throws(() => attestPrivateEngineListener({ ...binding, workerPid: unrelated!.pid! }),
      /not descended/);
    assert.throws(() => attestPrivateEngineListener({ ...binding, binarySha256: '0'.repeat(64) }),
      /binary changed/);

    const policyPath = join(root, 'deny-binary.sb');
    writeFileSync(policyPath, `(version 1)\n(allow default)\n(allow file-write* (subpath "${root}"))\n(deny file-write* (literal "${pinned}"))\n`);
    const chmod = spawnSync('/usr/bin/sandbox-exec', ['-f', policyPath, '/bin/chmod', '700', pinned],
      { encoding: 'utf8', timeout: 5000 });
    assert.notEqual(chmod.status, 0, 'same-UID child must not chmod the staged engine');
    const overwrite = spawnSync('/usr/bin/sandbox-exec', ['-f', policyPath, '/bin/sh', '-c',
      `printf hacked > '${pinned}'`], { encoding: 'utf8', timeout: 5000 });
    assert.notEqual(overwrite.status, 0, 'same-UID child must not overwrite the staged engine');
    const remove = spawnSync('/usr/bin/sandbox-exec', ['-f', policyPath, '/bin/rm', pinned],
      { encoding: 'utf8', timeout: 5000 });
    assert.notEqual(remove.status, 0, 'same-UID child must not unlink the staged engine');
    const replacement = join(root, 'replacement');
    writeFileSync(replacement, 'replacement');
    const replace = spawnSync('/usr/bin/sandbox-exec', ['-f', policyPath, '/bin/mv', '-f', replacement, pinned],
      { encoding: 'utf8', timeout: 5000 });
    assert.notEqual(replace.status, 0, 'same-UID child must not replace the staged engine');
    assert.equal(createHash('sha256').update(readFileSync(pinned)).digest('hex'), binarySha256);
    const writable = join(root, 'owned-write.txt');
    const write = spawnSync('/usr/bin/sandbox-exec', ['-f', policyPath, '/bin/sh', '-c',
      `printf ok > '${writable}'`], { encoding: 'utf8', timeout: 5000 });
    assert.equal(write.status, 0, 'private worker root remains writable');
    assert.equal(readFileSync(writable, 'utf8'), 'ok');

  } finally {
    if (child?.pid) child.kill('SIGKILL');
    if (unrelated?.pid) unrelated.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
}
const describeOs = process.platform === 'darwin' && process.env.RHYTHM_EVAL_MANAGED_OS === '1' ? describe : describe.skip;
describeOs('private managed engine ownership on macOS', () => {
  it('owned_engine_process', async () => { await main(); }, 60_000);
});
