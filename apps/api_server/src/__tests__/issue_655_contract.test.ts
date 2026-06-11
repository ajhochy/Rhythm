/**
 * Contract test for issue #655 — Opencode engine bricks when a stale opencode
 * orphan holds :4096. The api_server must reclaim the port (kill the stale
 * opencode process) before spawning a fresh engine, and must NOT kill a
 * non-opencode process holding the port.
 *
 * The port-probe + stale-detection logic is exposed as a pure-ish function
 * `reclaimStalePortForOpencode(port, deps)` where `deps` injects the
 * `lsof` / `ps` / `kill` / port-free boundary so the OS calls are mocked.
 *
 * CONTRACT TESTS — these must FAIL before implementation (the function does
 * not exist yet) and PASS after.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  reclaimStalePortForOpencode,
  OPENCODE_ENGINE_PORT,
  type StalePortDeps,
} from '../services/opencode_client_service';

/**
 * Build a deps double. By default: nothing is listening on the port.
 * Override individual fns per test.
 */
function makeDeps(overrides: Partial<StalePortDeps> = {}): {
  deps: StalePortDeps;
  calls: { killed: Array<{ pid: number; signal: string }> };
} {
  const calls = { killed: [] as Array<{ pid: number; signal: string }> };
  const deps: StalePortDeps = {
    lookupPidOnPort: vi.fn().mockResolvedValue(null),
    getCommandForPid: vi.fn().mockResolvedValue(''),
    killPid: vi.fn().mockImplementation(async (pid: number, signal: string) => {
      calls.killed.push({ pid, signal });
    }),
    isPortFree: vi.fn().mockResolvedValue(true),
    waitMs: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { deps, calls };
}

describe('issue-655-c1: reclaim a stale opencode orphan holding :4096', () => {
  it('kills the stale opencode process and reports the port reclaimed', async () => {
    let portHeld = true;
    const { deps } = makeDeps({
      lookupPidOnPort: vi.fn().mockResolvedValue(99123),
      getCommandForPid: vi
        .fn()
        .mockResolvedValue('opencode serve --port=4096 --hostname=127.0.0.1'),
      // After a kill the port frees up.
      isPortFree: vi.fn().mockImplementation(async () => !portHeld),
      killPid: vi.fn().mockImplementation(async () => {
        portHeld = false;
      }),
    });

    const result = await reclaimStalePortForOpencode(OPENCODE_ENGINE_PORT, deps);

    expect(result.reclaimed).toBe(true);
    expect(result.killedPid).toBe(99123);
    // It actually issued a kill against the stale PID.
    expect(deps.killPid).toHaveBeenCalledWith(99123, expect.any(String));
    expect(deps.killPid).toHaveBeenCalledTimes(1);
    // No error thrown — the engine can proceed to spawn.
    expect(result.error).toBeUndefined();
  });

  it('escalates SIGTERM -> SIGKILL when the process does not exit on the first signal', async () => {
    let killCount = 0;
    const { deps } = makeDeps({
      lookupPidOnPort: vi.fn().mockResolvedValue(42),
      getCommandForPid: vi.fn().mockResolvedValue('opencode serve --port=4096'),
      // Port only frees after the second (SIGKILL) attempt.
      isPortFree: vi.fn().mockImplementation(async () => killCount >= 2),
      killPid: vi.fn().mockImplementation(async () => {
        killCount += 1;
      }),
    });

    const result = await reclaimStalePortForOpencode(OPENCODE_ENGINE_PORT, deps);

    expect(result.reclaimed).toBe(true);
    const signals = (deps.killPid as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[1],
    );
    expect(signals).toContain('SIGTERM');
    expect(signals).toContain('SIGKILL');
  });
});

describe('issue-655-c2: a NON-opencode process holding :4096 is not killed', () => {
  it('throws a clear error naming the occupying PID and command, and never kills it', async () => {
    const { deps } = makeDeps({
      lookupPidOnPort: vi.fn().mockResolvedValue(5555),
      getCommandForPid: vi
        .fn()
        .mockResolvedValue('/usr/local/bin/node some-other-server.js'),
    });

    await expect(
      reclaimStalePortForOpencode(OPENCODE_ENGINE_PORT, deps),
    ).rejects.toThrow(/5555/);

    // The error message must also name the occupying command.
    await expect(
      reclaimStalePortForOpencode(OPENCODE_ENGINE_PORT, deps),
    ).rejects.toThrow(/some-other-server\.js/);

    // It must NOT have attempted to kill the foreign process.
    expect(deps.killPid).not.toHaveBeenCalled();
  });
});

describe('issue-655-c3: port-probe + stale-detection logic uses the lsof/ps boundary', () => {
  it('no-ops cleanly when the port is free (lsof returns no pid)', async () => {
    const { deps } = makeDeps({
      lookupPidOnPort: vi.fn().mockResolvedValue(null),
    });

    const result = await reclaimStalePortForOpencode(OPENCODE_ENGINE_PORT, deps);

    expect(result.reclaimed).toBe(false);
    expect(deps.lookupPidOnPort).toHaveBeenCalledWith(OPENCODE_ENGINE_PORT);
    // Free port: no command lookup, no kill.
    expect(deps.getCommandForPid).not.toHaveBeenCalled();
    expect(deps.killPid).not.toHaveBeenCalled();
  });

  it('consults the ps boundary (getCommandForPid) only after a pid is found', async () => {
    const { deps } = makeDeps({
      lookupPidOnPort: vi.fn().mockResolvedValue(7),
      getCommandForPid: vi.fn().mockResolvedValue('opencode serve --port=4096'),
      isPortFree: vi.fn().mockResolvedValue(true),
    });

    await reclaimStalePortForOpencode(OPENCODE_ENGINE_PORT, deps);

    expect(deps.getCommandForPid).toHaveBeenCalledWith(7);
  });

  it('defaults OPENCODE_ENGINE_PORT to 4096', () => {
    expect(OPENCODE_ENGINE_PORT).toBe(4096);
  });
});
