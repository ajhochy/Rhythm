/**
 * D1.2 (#1427) repair — proves the exact `docker run` invocation carries
 * every required hardening flag, without needing a real Docker daemon.
 * `node:child_process` is mocked so this runs fast and deterministically
 * everywhere; `tool_sandbox_vetter.test.ts`'s real-Docker suite separately
 * proves these flags are actually compatible with genuine container runs.
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnCalls: { command: string; args: string[] }[] = [];
const spawnSyncCalls: { command: string; args: string[] }[] = [];

vi.mock('node:child_process', () => {
  return {
    spawn: (command: string, args: string[]) => {
      spawnCalls.push({ command, args });
      const proc = new EventEmitter() as EventEmitter & { kill: (signal?: string) => void };
      proc.kill = () => {};
      queueMicrotask(() => proc.emit('close', 0, null));
      return proc;
    },
    spawnSync: (command: string, args: string[] = []) => {
      spawnSyncCalls.push({ command, args });
      if (args[0] === 'info') return { status: 0 };
      return { status: 0 };
    },
  };
});

describe('D1.2 DockerSandboxRuntime — docker run hardening flags (mocked child_process)', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
    spawnSyncCalls.length = 0;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('includes every required hardening flag and preserves --pull never', async () => {
    const { DockerSandboxRuntime } = await import('../tool_sandbox_vetter');
    const runtime = new DockerSandboxRuntime();
    await runtime.runAsync(
      { toolName: 'example-tool', packageSource: 'exit 0', installMethod: 'local-script' },
      ['version-check', 'help-check'],
    ).catch(() => {
      // The mocked run never produces real observation files, so
      // verifyEvidenceComplete legitimately throws after `docker run` —
      // this test only cares about the args `docker run` was invoked with.
    });

    expect(spawnCalls.length).toBe(1);
    const { command, args } = spawnCalls[0];
    expect(command).toBe('docker');
    expect(args[0]).toBe('run');

    function flagValue(flag: string): string | undefined {
      const i = args.indexOf(flag);
      return i >= 0 ? args[i + 1] : undefined;
    }

    expect(args).toContain('--rm');
    expect(flagValue('--pull')).toBe('never');
    expect(flagValue('--network')).toBe('none');
    expect(args).toContain('--cap-drop');
    expect(flagValue('--cap-drop')).toBe('ALL');
    expect(args).toContain('--security-opt');
    expect(flagValue('--security-opt')).toBe('no-new-privileges');
    expect(args).toContain('--pids-limit');
    expect(args).toContain('--memory');
    expect(args).toContain('--cpus');
    expect(args).toContain('--read-only');
    expect(args).toContain('--tmpfs');
    expect(flagValue('--tmpfs')).toMatch(/^\/tmp:/);
    expect(flagValue('--user')).toBe('node');
    expect(args).toContain('--name');
    expect(flagValue('--name')).toMatch(/^rhythm-d1-vet-/);
    expect(args).toContainEqual(expect.stringMatching(/:\/vet:rw$/));
    expect(args).toContainEqual(expect.stringMatching(/:\/vet\/sentinel:ro$/));
  });

  it('kills and force-removes only the exact container name it created, never a broader sweep', async () => {
    const { DockerSandboxRuntime } = await import('../tool_sandbox_vetter');
    const runtime = new DockerSandboxRuntime();
    let containerName = '';
    await runtime
      .runAsync(
        { toolName: 'example-tool', packageSource: 'exit 0', installMethod: 'local-script' },
        ['version-check', 'help-check'],
      )
      .catch(() => {});

    const nameFromRun = spawnCalls[0].args[spawnCalls[0].args.indexOf('--name') + 1];
    containerName = nameFromRun;

    const teardownCalls = spawnSyncCalls.filter((c) => c.args[0] === 'kill' || (c.args[0] === 'rm' && c.args.includes('-f')));
    expect(teardownCalls.length).toBe(2);
    for (const call of teardownCalls) {
      // The exact container name, and ONLY that name — never a `--filter`/prefix-based sweep.
      expect(call.args).toContain(containerName);
      expect(call.args.join(' ')).not.toContain('--filter');
    }
  });
});
