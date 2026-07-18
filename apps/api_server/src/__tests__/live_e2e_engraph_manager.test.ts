/**
 * #1096 WP1 — required live behavioral test for the device-local Engraph
 * backend manager (AGENTS.md "Behavioral verification gate").
 *
 * Drives the REAL entry point for this feature — EngraphManager's own public
 * lifecycle methods — against a REAL OS child process (no mocked spawn/
 * execFile), a REAL loopback HTTP listener, and REAL Bearer-token
 * enforcement:
 *
 *   1. configure a valid local Engraph binary against a fixture canonical
 *      agent-memory directory;
 *   2. start it through Rhythm (`enable()` → discover→validate→index→
 *      spawn→health-gate, exactly as the `/engraph-manager/enable` route
 *      would trigger);
 *   3. verify a real semantic query succeeds through the managed service in
 *      <=1s (`checkHealthNow()`, which performs a real authenticated
 *      `/api/search` call — not just a port probe);
 *   4. force unavailability the SAME way the Settings UI would (`disable()`
 *      — never an out-of-band kill by PID/port) and verify the SAME
 *      retrieval seam (`getRetrievalClient().search(...)`) safely returns
 *      `[]` with no thrown error, so `memory_retrieval.ts`'s FTS fallback is
 *      never at risk of a broken prompt.
 *
 * Fast/deterministic by default: exercises the checked-in fake `engraph`
 * binary fixture (fixtures/fake_engraph_bin.js), which implements just
 * enough of the real 1.7.2 CLI/HTTP contract (verified against the real
 * binary during this work — see docs/ai/runs/) to prove the manager's own
 * spawn/health/ownership code, without depending on the ~20MB binary or its
 * ~300MB first-run model download.
 *
 * OPTIONAL real-binary run: set RHYTHM_LIVE_ENGRAPH_BIN to a real installed
 * `engraph` executable to run the identical assertions against it. This
 * portion is opt-in (most CI/dev machines won't have the binary installed —
 * it is deliberately never bundled) and is the "real-binary manual handoff"
 * this issue calls for when a real binary isn't available in the sandbox.
 *
 * Run:
 *   RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_engraph_manager.test.ts
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_ENGRAPH_BIN=/path/to/real/engraph npx vitest run \
 *     src/__tests__/live_e2e_engraph_manager.test.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngraphManager } from '../services/engraph_manager';
import { EngraphManagerConfigStore } from '../services/engraph_manager_config_store';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const FAKE_BIN = join(__dirname, 'fixtures', 'fake_engraph_bin.js');
const REAL_BIN = process.env.RHYTHM_LIVE_ENGRAPH_BIN?.trim();

function runsAgainst(label: string, binaryPath: string, timeoutMs: number) {
  describe(label, () => {
    let scratchDir: string;
    let vaultDir: string;
    let memoryRoot: string;
    let homeDir: string;
    const originalEnv = { ...process.env };

    beforeEach(() => {
      scratchDir = mkdtempSync(join(tmpdir(), 'engraph-live-'));
      vaultDir = join(scratchDir, 'vault');
      memoryRoot = join(vaultDir, 'AGENT-MEMORY');
      homeDir = join(scratchDir, 'engraph-home');
      mkdirSync(memoryRoot, { recursive: true });
      writeFileSync(join(memoryRoot, 'fact.md'), '# fact\nThe on-call rotation starts Monday.\n');
      process.env.MEMORY_VAULT_PATH = vaultDir;
      process.env.MEMORY_VAULT_SUBDIR = 'AGENT-MEMORY';
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      rmSync(scratchDir, { recursive: true, force: true });
    });

    it(
      'starts through Rhythm, proves a real <=1s authenticated search, then falls back to FTS-safe [] once disabled',
      async () => {
        const configStore = new EngraphManagerConfigStore(join(scratchDir, 'config.json'));
        const manager = new EngraphManager({ configStore, homeDir });

        const chosen = await manager.chooseBinary(binaryPath);
        expect(chosen.ok).toBe(true);

        const started = await manager.enable();
        expect(started).toEqual({ ok: true });
        expect(configStore.read().state).toBe('ready');

        // The health gate IS a real authenticated search, not a port probe —
        // assert it actually completed inside the 1-second budget.
        const health = await manager.checkHealthNow();
        expect(health.ok).toBe(true);
        expect(health.latencyMs).toBeLessThanOrEqual(1_000);

        // The exact seam memory_retrieval.ts consumes: a real hit comes back.
        const hits = await manager.getRetrievalClient().search('on-call rotation', 5);
        expect(hits.length).toBeGreaterThan(0);

        // Force unavailability the SAFE way (never an out-of-band PID/port
        // kill) — this is the only path the Settings UI (WP2) will ever call.
        await manager.disable();
        expect(configStore.read().enabled).toBe(false);

        // The SAME retrieval call now safely resolves [] — no thrown error,
        // no broken prompt construction; memory_retrieval.ts's FTS fallback
        // takes over unconditionally.
        await expect(manager.getRetrievalClient().search('on-call rotation', 5)).resolves.toEqual([]);
      },
      timeoutMs,
    );
  });
}

describeLive('live E2E — #1096 Engraph backend manager', () => {
  runsAgainst('fake engraph binary fixture (fast, offline, always runs when RHYTHM_LIVE_E2E=1)', FAKE_BIN, 15_000);

  if (REAL_BIN) {
    runsAgainst(`real engraph binary at RHYTHM_LIVE_ENGRAPH_BIN=${REAL_BIN}`, REAL_BIN, 120_000);
  } else {
    it.skip('real-binary run — set RHYTHM_LIVE_ENGRAPH_BIN to an installed `engraph` executable to enable', () => {});
  }
});
