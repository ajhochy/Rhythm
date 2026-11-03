/** No model or API server: boots the compiled private receiver child process. */
import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { startPrivateManagedBridgeAsync as StartBridge } from '../org_evaluation_managed_bridge_parent';

const describeProcess = process.env.RHYTHM_EVAL_MANAGED_PROCESS === '1' ? describe : describe.skip;
describeProcess('compiled private managed receiver process', () => {
  it('binds a parent-owned worker PID and reaps its narrow listener', async () => {
    const workerRoot = mkdtempSync('/private/tmp/rhythm-bridge-process-');
    try {
      const dbPath = join(workerRoot, 'rhythm.db');
      const db = new Database(dbPath); db.pragma('foreign_keys = ON'); db.close();
      const workspacePath = join(workerRoot, 'workspace'); mkdirSync(workspacePath);
      const pinnedBinary = join(workerRoot, 'opencode'); copyFileSync(process.execPath, pinnedBinary);
      const compiled = require(join(__dirname, '../../../dist/services/org_evaluation_managed_bridge_parent.js')) as
        { startPrivateManagedBridgeAsync: typeof StartBridge };
      const bridge = await compiled.startPrivateManagedBridgeAsync({ workerRoot, dbPath,
        workspacePath, pinnedBinary, enginePort: 62125, ownerUserId: 900000001 });
      await bridge.bindWorker(process.pid);
      expect(await bridge.close()).toEqual([]);
      await expect(fetch(bridge.baseURL, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
    } finally { rmSync(workerRoot, { recursive: true, force: true }); }
  }, 30_000);
});
