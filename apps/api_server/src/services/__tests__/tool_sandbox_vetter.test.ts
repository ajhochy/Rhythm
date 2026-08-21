/**
 * D1.2 (#1427) — tool_sandbox_vetter.ts.
 *
 * Two layers:
 *  - Fake-runtime tests: fast, deterministic coverage of the fail-closed
 *    orchestration logic (Docker unavailable, runtime throws, verdict
 *    classification) — no real Docker involved.
 *  - Real DockerSandboxRuntime tests: exercise the actual container
 *    lifecycle (install, sentinel-based forbidden-path/credential-access
 *    detection, network-attempt detection under `--network none`,
 *    unconditional teardown) against the real local Docker daemon using the
 *    already-pulled `node:22-alpine` image (`installMethod: 'local-script'`
 *    fixtures — no network pull, no real package registry hit needed).
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DockerSandboxRuntime,
  vetToolInSandboxAsync,
  type SandboxRunObservation,
  type SandboxRuntime,
  type ToolVettingCandidate,
} from '../tool_sandbox_vetter';

function fakeObservation(overrides: Partial<SandboxRunObservation> = {}): SandboxRunObservation {
  return {
    forbiddenPathViolations: [],
    networkCallsObserved: [],
    fileSystemWritesObserved: [],
    credentialAccessAttemptsCount: 0,
    sandboxDurationMs: 42,
    ...overrides,
  };
}

const candidate: ToolVettingCandidate = {
  toolName: 'example-tool',
  toolVersion: '1.0.0',
  packageSource: 'example-tool',
  installMethod: 'npm install',
};

describe('D1.2 vetToolInSandboxAsync — fake runtime (fail-closed orchestration)', () => {
  it('Docker unavailable → verdict unknown, reason sandbox_unavailable, no install attempted', async () => {
    let ran = false;
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => false,
      runAsync: async () => {
        ran = true;
        return fakeObservation();
      },
    };
    const outcome = await vetToolInSandboxAsync({ candidate, testPrompts: ['p1'] }, { runtime });
    expect(outcome.verdict).toBe('unknown');
    expect(outcome.reason).toBe('sandbox_unavailable');
    expect(outcome.testPromptsRunCount).toBe(0);
    expect(outcome.sandboxDurationMs).toBe(0);
    expect(ran).toBe(false);
  });

  it('a safe run (zero violations) → verdict safe', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () => fakeObservation(),
    };
    const outcome = await vetToolInSandboxAsync({ candidate, testPrompts: ['p1', 'p2'] }, { runtime });
    expect(outcome.verdict).toBe('safe');
    expect(outcome.reason).toBeNull();
    expect(outcome.testPromptsRunCount).toBe(2);
    expect(JSON.parse(outcome.forbiddenPathViolationsJson)).toEqual([]);
  });

  it('a run touching a forbidden path → verdict unsafe with violations listed', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () => fakeObservation({ forbiddenPathViolations: ['ssh-private-key'] }),
    };
    const outcome = await vetToolInSandboxAsync({ candidate, testPrompts: [] }, { runtime });
    expect(outcome.verdict).toBe('unsafe');
    expect(JSON.parse(outcome.forbiddenPathViolationsJson)).toEqual(['ssh-private-key']);
  });

  it('a run with unexpected network calls (and no forbidden-path touch) → verdict conditional', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () => fakeObservation({ networkCallsObserved: [{ host: 'registry.npmjs.org', count: 1 }] }),
    };
    const outcome = await vetToolInSandboxAsync({ candidate, testPrompts: [] }, { runtime });
    expect(outcome.verdict).toBe('conditional');
    expect(JSON.parse(outcome.networkCallsObservedJson)).toEqual([{ host: 'registry.npmjs.org', count: 1 }]);
  });

  it('forbidden-path violation takes priority over a network call in the same run', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () =>
        fakeObservation({
          forbiddenPathViolations: ['aws-credentials'],
          networkCallsObserved: [{ host: 'example.com', count: 1 }],
        }),
    };
    const outcome = await vetToolInSandboxAsync({ candidate, testPrompts: [] }, { runtime });
    expect(outcome.verdict).toBe('unsafe');
  });

  it('the runtime throwing mid-run fails closed to unknown, never a fabricated safe', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () => {
        throw new Error('container crashed');
      },
    };
    const outcome = await vetToolInSandboxAsync({ candidate, testPrompts: [] }, { runtime });
    expect(outcome.verdict).toBe('unknown');
    expect(outcome.reason).toContain('sandbox_error');
  });

  it('never places raw prompt text anywhere in the outcome', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () => fakeObservation(),
    };
    const secretPrompt = 'super secret prompt text token=sk-abcdefghijklmnopqrstuvwx';
    const outcome = await vetToolInSandboxAsync({ candidate, testPrompts: [secretPrompt] }, { runtime });
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('super secret prompt text');
    expect(serialized).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });
});

function dockerDaemonReachable(): boolean {
  try {
    execFileSync('docker', ['info'], { timeout: 5000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = dockerDaemonReachable();
const describeDocker = dockerAvailable ? describe : describe.skip;

describeDocker('D1.2 DockerSandboxRuntime — real container lifecycle', () => {
  let scratchRoot: string;

  beforeAll(() => {
    scratchRoot = mkdtempSync(join('/private/tmp/rhythm-si-d1-sonnet', 'docker-vet-tests-'));
  });

  afterAll(() => {
    rmSync(scratchRoot, { recursive: true, force: true });
    // Defensive sweep: guarantee no `rhythm-d1-vet-*` container survives this
    // suite regardless of individual test outcomes (the module's own
    // unconditional teardown is exercised directly by the test below; this
    // is belt-and-suspenders cleanup for the test run itself).
    try {
      const ids = execFileSync('docker', ['ps', '-a', '--filter', 'name=rhythm-d1-vet-', '--format', '{{.ID}}'])
        .toString()
        .trim();
      if (ids) {
        execFileSync('docker', ['rm', '-f', ...ids.split('\n')]);
      }
    } catch {
      // best-effort only
    }
  });

  function runtime(): DockerSandboxRuntime {
    return new DockerSandboxRuntime({ scratchRoot });
  }

  it('isAvailableAsync is true against the real local Docker daemon', async () => {
    expect(await runtime().isAvailableAsync()).toBe(true);
  });

  it('a bogus docker binary reports unavailable (real ENOENT path, not a stub)', async () => {
    const bogus = new DockerSandboxRuntime({ dockerBinary: `docker-does-not-exist-${randomBytes(4).toString('hex')}` });
    expect(await bogus.isAvailableAsync()).toBe(false);
  });

  it('a well-behaved candidate → verdict safe, zero violations', async () => {
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'safe-fixture',
          packageSource: 'echo "installed cleanly"; exit 0',
          installMethod: 'local-script',
        },
        testPrompts: ['hello'],
      },
      { runtime: runtime() },
    );
    expect(outcome.verdict).toBe('safe');
    expect(JSON.parse(outcome.forbiddenPathViolationsJson)).toEqual([]);
    expect(JSON.parse(outcome.networkCallsObservedJson)).toEqual([]);
    expect(outcome.credentialAccessAttemptsCount).toBe(0);
    expect(outcome.sandboxDurationMs).toBeGreaterThan(0);
  }, 30000);

  it('a candidate that overwrites a forbidden sentinel path → verdict unsafe', async () => {
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'unsafe-fixture',
          packageSource: "echo pwned >> /vet/sentinel/ssh_id_rsa",
          installMethod: 'local-script',
        },
        testPrompts: [],
      },
      { runtime: runtime() },
    );
    expect(outcome.verdict).toBe('unsafe');
    expect(JSON.parse(outcome.forbiddenPathViolationsJson)).toContain('ssh-private-key');
  }, 30000);

  it('a candidate that reads a forbidden sentinel path is counted as a credential access attempt', async () => {
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'credential-probing-fixture',
          packageSource: 'cat /vet/sentinel/aws_credentials',
          installMethod: 'local-script',
        },
        testPrompts: [],
      },
      { runtime: runtime() },
    );
    expect(outcome.credentialAccessAttemptsCount).toBeGreaterThanOrEqual(1);
    // A read alone (no write) must not itself be a forbidden-path violation.
    expect(JSON.parse(outcome.forbiddenPathViolationsJson)).toEqual([]);
  }, 30000);

  it('an install step that attempts a real network call → verdict conditional', async () => {
    // `local-script` fixture rather than a real `npm install`: npm retries a
    // failed resolve several times with backoff (real, observed behavior in
    // this environment — it does not fail fast under --network none), which
    // would make this test slow/flaky. A direct Node http.get attempt fails
    // immediately with the same getaddrinfo signature the real npm/pip
    // install paths produce, exercising the exact same detection regex.
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'network-fixture',
          packageSource:
            "node -e \"require('http').get('http://example.com',()=>{}).on('error',e=>{console.error(e.message);process.exit(1)})\"",
          installMethod: 'local-script',
        },
        testPrompts: [],
      },
      { runtime: runtime() },
    );
    expect(outcome.verdict).toBe('conditional');
    const calls = JSON.parse(outcome.networkCallsObservedJson) as { host: string; count: number }[];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.host === 'example.com')).toBe(true);
  }, 30000);

  it('the container is always torn down, even after a timing-sensitive run', async () => {
    const containerRt = runtime();
    await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'teardown-fixture',
          packageSource: 'echo done',
          installMethod: 'local-script',
        },
        testPrompts: [],
      },
      { runtime: containerRt },
    );
    const ps = execFileSync('docker', ['ps', '-a', '--filter', 'name=rhythm-d1-vet-', '--format', '{{.Names}}'])
      .toString()
      .trim();
    expect(ps).toBe('');
  }, 30000);

  it('an unsupported install method fails closed to unknown rather than silently skipping', async () => {
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'bogus-method-fixture',
          packageSource: 'example',
          installMethod: 'curl | sh',
        },
        testPrompts: [],
      },
      { runtime: runtime() },
    );
    expect(outcome.verdict).toBe('unknown');
  }, 30000);
});
