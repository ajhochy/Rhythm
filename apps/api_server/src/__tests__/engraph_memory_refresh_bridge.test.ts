import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { EngraphMemoryRefreshBridge } from '../services/engraph_memory_refresh_bridge';
import {
  observeCanonicalMutations,
  publishCanonicalMutation,
  registerCanonicalMutationSink,
} from '../services/memory_canonical_mutation';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function root() { const value = mkdtempSync(path.join(tmpdir(), 'engraph-bridge-')); roots.push(value); return value; }

describe('Engraph canonical refresh bridge', () => {
  it('retains a rejected intent, ORs destructive state, and clears only after current admission', () => {
    const memoryDir = root();
    const calls: Array<{ memoryDir: string; destructive: boolean }> = [];
    let accept = false;
    let timer: (() => void) | undefined;
    const bridge = new EngraphMemoryRefreshBridge({ requestMemoryRefresh: (request) => { calls.push(request); return accept; } }, {
      setTimer: ((fn: () => void) => { timer = fn; return { unref() {} }; }) as unknown as typeof setTimeout,
      clearTimer: (() => {}) as unknown as typeof clearTimeout,
    });
    bridge.publish({ memoryDir, destructive: false });
    bridge.publish({ memoryDir, destructive: true });
    expect(calls).toEqual([{ memoryDir, destructive: false }, { memoryDir, destructive: true }]);
    accept = true;
    timer?.();
    expect(calls.at(-1)).toEqual({ memoryDir, destructive: true });
    bridge.dispose();
  });

  it('isolates observer failures and protects a replacement default sink from an old disposer', () => {
    const received: string[] = [];
    const old = registerCanonicalMutationSink(() => received.push('old'));
    const replacement = registerCanonicalMutationSink(() => received.push('new'));
    const stopObserver = observeCanonicalMutations(() => { throw new Error('observer failure'); });
    old();
    publishCanonicalMutation({ memoryDir: '/tmp/fixture', destructive: false });
    expect(received).toEqual(['new']);
    stopObserver(); replacement();
  });

  it('does not admit after disposal', () => {
    const memoryDir = root();
    let calls = 0;
    const bridge = new EngraphMemoryRefreshBridge({ requestMemoryRefresh: () => { calls++; return false; } });
    bridge.dispose();
    bridge.publish({ memoryDir, destructive: true });
    expect(calls).toBe(0);
  });
});
