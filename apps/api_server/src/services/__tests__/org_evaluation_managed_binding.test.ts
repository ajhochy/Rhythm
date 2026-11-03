import { describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventEmitter as EventEmitterType } from 'node:events';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');
  return { ...original, spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitterType & {
      pid: number; exitCode: number | null; signalCode: string | null;
      stdout: EventEmitterType; stderr: EventEmitterType;
      stdin: { destroyed: boolean; write(value: string): void; end(): void };
    };
    child.pid = 54321; child.exitCode = null; child.signalCode = null;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    let bound = false;
    child.stdin = {
      destroyed: false,
      write(value: string) {
        const message = JSON.parse(value) as { bindWorkerPid?: number };
        queueMicrotask(() => child.stdout.emit('data', Buffer.from(message.bindWorkerPid
          ? JSON.stringify({ bound: true }) + '\n'
          : JSON.stringify({ ready: true, port: 62123 }) + '\n')));
        if (message.bindWorkerPid) bound = true;
      },
      end() {
        this.destroyed = true;
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from(JSON.stringify({ observations: [{ bound }] }) + '\n'));
          child.exitCode = 0;
          child.emit('close', 0, null);
        });
      },
    };
    return child;
  }) };
});

import { startPrivateManagedBridgeAsync } from '../org_evaluation_managed_bridge_parent';

describe('private managed receiver startup protocol', () => {
  it('binds one worker PID before use and closes with one owned receipt', async () => {
    const workerRoot = mkdtempSync('/private/tmp/rhythm-bridge-bind-');
    try {
      const dbPath = join(workerRoot, 'rhythm.db');
      const workspacePath = join(workerRoot, 'workspace');
      const pinnedBinary = join(workerRoot, 'opencode');
      writeFileSync(dbPath, 'copied fixture'); mkdirSync(workspacePath);
      copyFileSync(process.execPath, pinnedBinary);
      const bridge = await startPrivateManagedBridgeAsync({ workerRoot, dbPath,
        workspacePath, pinnedBinary, enginePort: 62124, ownerUserId: 900000001 });
      await bridge.bindWorker(54322);
      await expect(bridge.bindWorker(54322)).rejects.toThrow(/invalid/);
      expect(await bridge.close()).toEqual([{ bound: true }]);
      expect(await bridge.close()).toEqual([{ bound: true }]);
    } finally { rmSync(workerRoot, { recursive: true, force: true }); }
  });
});
