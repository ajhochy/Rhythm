/**
 * D1.2 (#1427) — tool_sandbox_vetter.ts.
 *
 * Three layers:
 *  - Fake-runtime tests: fast, deterministic coverage of the fail-closed
 *    orchestration logic (Docker unavailable, invalid scenario selection,
 *    runtime throws, verdict classification, fixed sanitized reasons).
 *  - `verifyEvidenceComplete` unit tests: proves a missing/corrupt
 *    observation artifact is rejected without touching Docker at all.
 *  - Real DockerSandboxRuntime tests: exercise the actual container
 *    lifecycle (install, genuine scenario invocation, sentinel-based
 *    forbidden-path/credential-access detection, network-attempt detection
 *    under `--network none`, timeout/terminated fail-closed, unconditional
 *    exact-name-only teardown) against the real local Docker daemon using
 *    the already-pulled `node:22-alpine` image (`installMethod:
 *    'local-script'` fixtures — no network pull, no real package registry
 *    hit needed).
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import {
  DockerSandboxRuntime,
  vetToolInSandboxAsync,
  verifyEvidenceComplete,
  type DockerSandboxRuntimeOptions,
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
    scenariosAttemptedCount: 2,
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

const TWO_SCENARIOS = ['version-check', 'help-check'];
const THREE_SCENARIOS = ['version-check', 'help-check', 'stdin-noop'];

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
    const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: TWO_SCENARIOS }, { runtime });
    expect(outcome.verdict).toBe('unknown');
    expect(outcome.reason).toBe('sandbox_unavailable');
    expect(outcome.testPromptsRunCount).toBe(0);
    expect(outcome.sandboxDurationMs).toBe(0);
    expect(ran).toBe(false);
  });

  it('a safe run (zero violations) → verdict safe', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () => fakeObservation({ scenariosAttemptedCount: 2 }),
    };
    const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: TWO_SCENARIOS }, { runtime });
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
    const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: TWO_SCENARIOS }, { runtime });
    expect(outcome.verdict).toBe('unsafe');
    expect(JSON.parse(outcome.forbiddenPathViolationsJson)).toEqual(['ssh-private-key']);
  });

  it('a run with unexpected network calls (and no forbidden-path touch) → verdict conditional', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () => fakeObservation({ networkCallsObserved: [{ host: 'registry.npmjs.org', count: 1 }] }),
    };
    const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: TWO_SCENARIOS }, { runtime });
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
    const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: TWO_SCENARIOS }, { runtime });
    expect(outcome.verdict).toBe('unsafe');
  });

  it('testPromptsRunCount reflects the ACTUAL attempted count, not the requested array length', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      // 3 scenarios requested, but only 1 was genuinely attempted before some interruption.
      runAsync: async () => fakeObservation({ scenariosAttemptedCount: 1 }),
    };
    const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: THREE_SCENARIOS }, { runtime });
    expect(outcome.testPromptsRunCount).toBe(1);
  });

  it('the runtime throwing mid-run fails closed to unknown with a FIXED sanitized reason, never raw exception text', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () => {
        throw new Error('container crashed with token sk-abcdefghijklmnopqrstuvwx leaked in output');
      },
    };
    const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: TWO_SCENARIOS }, { runtime });
    expect(outcome.verdict).toBe('unknown');
    expect(outcome.reason).toBe('sandbox_error');
    expect(outcome.reason).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    expect(JSON.stringify(outcome)).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });

  it('never places raw prompt text anywhere in the outcome', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () => fakeObservation(),
    };
    const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: TWO_SCENARIOS }, { runtime });
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('version-check');
    expect(serialized).not.toContain('help-check');
  });

  for (const invalid of [
    { label: 'zero scenarios', scenarioIds: [] as string[] },
    { label: 'one scenario (below the 2-3 bound)', scenarioIds: ['version-check'] },
    { label: 'four scenarios (above the 2-3 bound)', scenarioIds: ['version-check', 'help-check', 'stdin-noop', 'version-check'] },
    { label: 'an unrecognised scenario id', scenarioIds: ['version-check', 'totally-made-up-scenario'] },
    { label: 'a duplicated scenario id', scenarioIds: ['version-check', 'version-check'] },
  ]) {
    it(`rejects ${invalid.label} → verdict unknown, reason invalid_scenario_ids, no runtime call`, async () => {
      let called = false;
      const runtime: SandboxRuntime = {
        isAvailableAsync: async () => {
          called = true;
          return true;
        },
        runAsync: async () => fakeObservation(),
      };
      const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: invalid.scenarioIds }, { runtime });
      expect(outcome.verdict).toBe('unknown');
      expect(outcome.reason).toBe('invalid_scenario_ids');
      expect(called).toBe(false);
    });
  }

  it('an unrecognised scenario id is never echoed back anywhere in the outcome', async () => {
    const secretShapedId = 'sk-abcdefghijklmnopqrstuvwx';
    const outcome = await vetToolInSandboxAsync(
      { candidate, scenarioIds: ['version-check', secretShapedId] },
      { runtime: { isAvailableAsync: async () => true, runAsync: async () => fakeObservation() } },
    );
    expect(JSON.stringify(outcome)).not.toContain(secretShapedId);
  });
});

describe('D1.2 verifyEvidenceComplete — never trust a missing/corrupt observation artifact', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function makeOutDir(): string {
    dir = mkdtempSync(join(tmpdir(), 'rhythm-d1-evidence-test-'));
    return dir;
  }

  it('throws when install.log is entirely missing', () => {
    const outDir = makeOutDir();
    expect(() => verifyEvidenceComplete(outDir)).toThrow();
  });

  it('throws when install.log never reached the INSTALL_EXIT marker (a killed/incomplete run)', () => {
    const outDir = makeOutDir();
    writeFileSync(join(outDir, 'install.log'), 'partial output, container was killed mid-install');
    expect(() => verifyEvidenceComplete(outDir)).toThrow();
  });

  it('throws when sentinel_after.sha256 is missing entirely', () => {
    const outDir = makeOutDir();
    writeFileSync(join(outDir, 'install.log'), 'INSTALL_EXIT=0');
    expect(() => verifyEvidenceComplete(outDir)).toThrow();
  });

  it('throws when sentinel_after.sha256 is short (missing a sentinel entry)', () => {
    const outDir = makeOutDir();
    writeFileSync(join(outDir, 'install.log'), 'INSTALL_EXIT=0');
    writeFileSync(join(outDir, 'sentinel_after.sha256'), 'MISSING /vet/sentinel/ssh_id_rsa\n');
    expect(() => verifyEvidenceComplete(outDir)).toThrow();
  });

  it('does not throw when both artifacts are complete', () => {
    const outDir = makeOutDir();
    writeFileSync(join(outDir, 'install.log'), 'INSTALL_EXIT=0');
    writeFileSync(
      join(outDir, 'sentinel_after.sha256'),
      ['/vet/sentinel/ssh_id_rsa', '/vet/sentinel/aws_credentials', '/vet/sentinel/docker_config']
        .map((p) => `MISSING ${p}`)
        .join('\n'),
    );
    expect(() => verifyEvidenceComplete(outDir)).not.toThrow();
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

/** Writes a `/vet/bin/<toolName>` fixture executable during the local-script install step. */
function installFixtureCandidateScript(toolName: string, body: string): string {
  return [
    'mkdir -p /vet/bin',
    `cat <<'RHYTHM_FIXTURE_EOF' > /vet/bin/${toolName}`,
    '#!/bin/sh',
    body,
    'RHYTHM_FIXTURE_EOF',
    `chmod +x /vet/bin/${toolName}`,
  ].join('\n');
}

describeDocker('D1.2 DockerSandboxRuntime — real container lifecycle', () => {
  let scratchRoot: string;
  const ownedContainerNames: string[] = [];

  function trackContainerName(name: string): void {
    ownedContainerNames.push(name);
  }

  function assertContainerGone(name: string): void {
    const ps = execFileSync('docker', ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'])
      .toString()
      .trim();
    expect(ps).toBe('');
  }

  // Isolated per-suite scratch root, created here rather than assumed to
  // pre-exist — `tmpdir()` is guaranteed to exist on every platform this
  // runs on, unlike a hardcoded absolute path.
  const scratchParent = join(tmpdir(), 'rhythm-d1-sandbox-tests');
  mkdirSync(scratchParent, { recursive: true });
  scratchRoot = mkdtempSync(join(scratchParent, 'run-'));

  afterAll(() => {
    // Tear down only this suite's OWN scratch path — never a sweep of
    // anything else that might live under the OS tmp dir.
    rmSync(scratchRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    // Only ever remove containers this test suite itself created, by their
    // exact tracked name — never a prefix-wide sweep that could touch an
    // unrelated live container.
    for (const name of ownedContainerNames.splice(0)) {
      try {
        execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
      } catch {
        // already removed by the module's own unconditional teardown — expected.
      }
    }
  });

  function runtime(extra: DockerSandboxRuntimeOptions = {}): DockerSandboxRuntime {
    return new DockerSandboxRuntime({ scratchRoot, onContainerName: trackContainerName, ...extra });
  }

  it('isAvailableAsync is true against the real local Docker daemon', async () => {
    expect(await runtime().isAvailableAsync()).toBe(true);
  });

  it('a bogus docker binary reports unavailable (real ENOENT path, not a stub)', async () => {
    const bogus = new DockerSandboxRuntime({ dockerBinary: `docker-does-not-exist-${randomBytes(4).toString('hex')}` });
    expect(await bogus.isAvailableAsync()).toBe(false);
  });

  it('a well-behaved candidate → verdict safe, zero violations, every scenario genuinely invoked', async () => {
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'safe-fixture',
          packageSource: installFixtureCandidateScript('safe-fixture', 'exit 0'),
          installMethod: 'local-script',
        },
        scenarioIds: THREE_SCENARIOS,
      },
      { runtime: runtime() },
    );
    expect(outcome.verdict).toBe('safe');
    expect(JSON.parse(outcome.forbiddenPathViolationsJson)).toEqual([]);
    expect(JSON.parse(outcome.networkCallsObservedJson)).toEqual([]);
    expect(outcome.credentialAccessAttemptsCount).toBe(0);
    expect(outcome.sandboxDurationMs).toBeGreaterThan(0);
    // The core D1.2 repair proof: all 3 requested scenarios were genuinely
    // invoked inside the container, not merely counted from the request.
    expect(outcome.testPromptsRunCount).toBe(3);
  }, 30000);

  it('a candidate that overwrites a forbidden sentinel path → verdict unsafe', async () => {
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'unsafe-fixture',
          packageSource: 'echo pwned >> /vet/sentinel/ssh_id_rsa',
          installMethod: 'local-script',
        },
        scenarioIds: TWO_SCENARIOS,
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
        scenarioIds: TWO_SCENARIOS,
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
        scenarioIds: TWO_SCENARIOS,
      },
      { runtime: runtime() },
    );
    expect(outcome.verdict).toBe('conditional');
    const calls = JSON.parse(outcome.networkCallsObservedJson) as { host: string; count: number }[];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.host === 'example.com')).toBe(true);
  }, 30000);

  it('the container is always torn down by its exact name, even after a well-behaved run', async () => {
    let containerName = '';
    await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'teardown-fixture',
          packageSource: 'echo done',
          installMethod: 'local-script',
        },
        scenarioIds: TWO_SCENARIOS,
      },
      { runtime: runtime({ onContainerName: (name) => (containerName = name) }) },
    );
    expect(containerName).toMatch(/^rhythm-d1-vet-/);
    assertContainerGone(containerName);
  }, 30000);

  it('a container killed on timeout fails closed to unknown (never safe) and is torn down by its exact name', async () => {
    let containerName = '';
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'hanging-fixture',
          // Sleeps well past the short test timeout below, on every
          // invocation (install AND each scenario command) — the run
          // script can never reach its sentinel-rehash step.
          packageSource: installFixtureCandidateScript('hanging-fixture', 'sleep 30') + '\nsleep 30',
          installMethod: 'local-script',
        },
        scenarioIds: TWO_SCENARIOS,
      },
      {
        runtime: runtime({
          timeoutMs: 2500,
          onContainerName: (name) => (containerName = name),
        }),
      },
    );
    expect(outcome.verdict).toBe('unknown');
    expect(outcome.reason).toBe('sandbox_terminated');
    expect(containerName).toMatch(/^rhythm-d1-vet-/);
    assertContainerGone(containerName);
  }, 20000);

  it('an unsupported install method fails closed to unknown rather than silently skipping', async () => {
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'bogus-method-fixture',
          packageSource: 'example',
          installMethod: 'curl | sh',
        },
        scenarioIds: TWO_SCENARIOS,
      },
      { runtime: runtime() },
    );
    expect(outcome.verdict).toBe('unknown');
    expect(outcome.reason).toBe('unsupported_install_method');
  }, 30000);

  it('an unsafe toolName fails closed to unknown without ever building a shell command from it', async () => {
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'evil; rm -rf /',
          packageSource: 'example',
          installMethod: 'npm install',
        },
        scenarioIds: TWO_SCENARIOS,
      },
      { runtime: runtime() },
    );
    expect(outcome.verdict).toBe('unknown');
    expect(outcome.reason).toBe('unsafe_tool_name');
  }, 30000);
});
