import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { attestPrivateEngineListener } from '../org_evaluation_managed_engine_owner';

async function main() {
  const root = mkdtempSync('/private/tmp/rhythm-sandbox-descendant-');
  const pinnedBinary = join(root, 'opencode');
  let worker: ReturnType<typeof spawn> | null = null;
  try {
    copyFileSync(process.execPath, pinnedBinary); chmodSync(pinnedBinary, 0o500);
    const binarySha256 = createHash('sha256').update(readFileSync(pinnedBinary)).digest('hex');
    const policy = join(root, 'worker.sb');
    writeFileSync(policy, `(version 1)\n(allow default)\n`);
    const engineCode = `require('node:net').createServer().listen(0,'127.0.0.1',function(){ console.log(this.address().port); });`;
    const workerCode = `const {spawn}=require('node:child_process'); const c=spawn(${JSON.stringify(pinnedBinary)},['-e',${JSON.stringify(engineCode)}]); c.stdout.on('data', b=>process.stdout.write(c.pid+':'+b)); process.on('SIGTERM',()=>{c.kill('SIGKILL'); process.exit(0)});`;
    worker = spawn('/usr/bin/sandbox-exec', ['-f', policy, process.execPath, '-e', workerCode],
      { stdio: ['ignore','pipe','pipe'], detached: true });
    const { enginePid, port } = await new Promise<{ enginePid: number; port: number }>((resolve, reject) => {
      let output = '';
      worker!.stdout!.on('data', bytes => {
        output += bytes.toString('utf8');
        const match = output.match(/^(\d+):(\d+)\n/);
        if (match) resolve({ enginePid: Number(match[1]), port: Number(match[2]) });
      });
      worker!.once('error', reject);
      setTimeout(() => reject(Error('Sandbox descendant listener did not boot')), 5000).unref();
    });
    const attested = attestPrivateEngineListener({ enginePort: port,
      workerPid: worker.pid!, pinnedBinary, binarySha256 });
    assert.equal(attested.enginePid, enginePid);

  } finally {
    if (worker?.pid) { try { process.kill(-worker.pid, 'SIGKILL'); } catch { /* already exited */ } }
    rmSync(root, { recursive: true, force: true });
  }
}
const describeOs = process.platform === 'darwin' && process.env.RHYTHM_EVAL_MANAGED_OS === '1' ? describe : describe.skip;
describeOs('private managed engine ownership on macOS', () => {
  it('sandbox_descendant', async () => { await main(); }, 60_000);
});
