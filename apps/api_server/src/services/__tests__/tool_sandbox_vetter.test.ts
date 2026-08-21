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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import {
  DockerSandboxRuntime,
  SandboxObserverError,
  computeCredentialAccess,
  detectForbiddenWriteAttempts,
  evaluateCandidateSucceeded,
  setupObserverCapabilityProbe,
  setupCredentialSentinels,
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
    candidateSucceeded: true,
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

  it('a detected credential access attempt → verdict unsafe, even with zero forbidden-path violations', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () => fakeObservation({ credentialAccessAttemptsCount: 1 }),
    };
    const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: TWO_SCENARIOS }, { runtime });
    expect(outcome.verdict).toBe('unsafe');
    expect(outcome.credentialAccessAttemptsCount).toBe(1);
  });

  it('a credential access attempt takes priority over a network call in the same run', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () =>
        fakeObservation({
          credentialAccessAttemptsCount: 2,
          networkCallsObserved: [{ host: 'example.com', count: 1 }],
        }),
    };
    const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: TWO_SCENARIOS }, { runtime });
    expect(outcome.verdict).toBe('unsafe');
  });

  it('the candidate (install or a scenario invocation) failing → verdict unknown, reason sandbox_candidate_failed, real attempt count preserved', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () => fakeObservation({ candidateSucceeded: false, scenariosAttemptedCount: 2 }),
    };
    const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: TWO_SCENARIOS }, { runtime });
    expect(outcome.verdict).toBe('unknown');
    expect(outcome.reason).toBe('sandbox_candidate_failed');
    // Real attempts are preserved even on failure — never implies success, never zeroed.
    expect(outcome.testPromptsRunCount).toBe(2);
    expect(JSON.parse(outcome.forbiddenPathViolationsJson)).toEqual([]);
  });

  it('a failed candidate with a network call observed is still unknown, never conditional', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () =>
        fakeObservation({ candidateSucceeded: false, networkCallsObserved: [{ host: 'example.com', count: 1 }] }),
    };
    const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: TWO_SCENARIOS }, { runtime });
    expect(outcome.verdict).toBe('unknown');
    expect(outcome.reason).toBe('sandbox_candidate_failed');
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

  it('the credential observer failing (dead/missing evidence) fails closed to unknown with a fixed reason, never safe', async () => {
    const runtime: SandboxRuntime = {
      isAvailableAsync: async () => true,
      runAsync: async () => {
        throw new SandboxObserverError();
      },
    };
    const outcome = await vetToolInSandboxAsync({ candidate, scenarioIds: TWO_SCENARIOS }, { runtime });
    expect(outcome.verdict).toBe('unknown');
    expect(outcome.reason).toBe('sandbox_observer_unavailable');
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

describe('D1.2 repair (real-Docker-broken-tool reproducer) evaluateCandidateSucceeded — positive proof required, never fail open', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function makeOutDir(): string {
    dir = mkdtempSync(join(tmpdir(), 'rhythm-d1-candidate-success-test-'));
    return dir;
  }

  function writeInstall(outDir: string, exitCode: number): void {
    writeFileSync(join(outDir, 'install.log'), `INSTALL_EXIT=${exitCode}`);
  }

  function writeScenarioResults(outDir: string, lines: string[]): void {
    writeFileSync(join(outDir, 'scenario_results.log'), lines.join('\n'));
  }

  it('returns true when install exited 0 and every requested scenario exited 0', () => {
    const outDir = makeOutDir();
    writeInstall(outDir, 0);
    writeScenarioResults(outDir, ['SCENARIO_RESULT:version-check:0', 'SCENARIO_RESULT:help-check:0']);
    expect(evaluateCandidateSucceeded(outDir, TWO_SCENARIOS)).toBe(true);
  });

  it('returns false when install exited nonzero', () => {
    const outDir = makeOutDir();
    writeInstall(outDir, 1);
    writeScenarioResults(outDir, ['SCENARIO_RESULT:version-check:0', 'SCENARIO_RESULT:help-check:0']);
    expect(evaluateCandidateSucceeded(outDir, TWO_SCENARIOS)).toBe(false);
  });

  it('returns false when exactly one scenario invocation exited nonzero', () => {
    const outDir = makeOutDir();
    writeInstall(outDir, 0);
    writeScenarioResults(outDir, ['SCENARIO_RESULT:version-check:0', 'SCENARIO_RESULT:help-check:1']);
    expect(evaluateCandidateSucceeded(outDir, TWO_SCENARIOS)).toBe(false);
  });

  it('returns false when a requested scenario result is entirely missing', () => {
    const outDir = makeOutDir();
    writeInstall(outDir, 0);
    writeScenarioResults(outDir, ['SCENARIO_RESULT:version-check:0']);
    expect(evaluateCandidateSucceeded(outDir, TWO_SCENARIOS)).toBe(false);
  });

  it('returns false when scenario_results.log is entirely missing', () => {
    const outDir = makeOutDir();
    writeInstall(outDir, 0);
    expect(evaluateCandidateSucceeded(outDir, TWO_SCENARIOS)).toBe(false);
  });

  it('returns false on a malformed scenario result line', () => {
    const outDir = makeOutDir();
    writeInstall(outDir, 0);
    writeScenarioResults(outDir, ['SCENARIO_RESULT:version-check', 'not a result line at all']);
    expect(evaluateCandidateSucceeded(outDir, TWO_SCENARIOS)).toBe(false);
  });

  it('returns false on a duplicated scenario result for the same id', () => {
    const outDir = makeOutDir();
    writeInstall(outDir, 0);
    writeScenarioResults(outDir, [
      'SCENARIO_RESULT:version-check:0',
      'SCENARIO_RESULT:version-check:0',
      'SCENARIO_RESULT:help-check:0',
    ]);
    expect(evaluateCandidateSucceeded(outDir, TWO_SCENARIOS)).toBe(false);
  });

  it('returns false on a mismatched scenario result naming a scenario that was never requested', () => {
    const outDir = makeOutDir();
    writeInstall(outDir, 0);
    writeScenarioResults(outDir, ['SCENARIO_RESULT:version-check:0', 'SCENARIO_RESULT:stdin-noop:0']);
    expect(evaluateCandidateSucceeded(outDir, TWO_SCENARIOS)).toBe(false);
  });

  it('returns false when install.log is missing entirely', () => {
    const outDir = makeOutDir();
    writeScenarioResults(outDir, ['SCENARIO_RESULT:version-check:0', 'SCENARIO_RESULT:help-check:0']);
    expect(evaluateCandidateSucceeded(outDir, TWO_SCENARIOS)).toBe(false);
  });
});

describe('D1 credential-observer redesign — host-side sentinel access observer (no Docker needed)', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function makeSentinelDir(): string {
    dir = mkdtempSync(join(tmpdir(), 'rhythm-d1-observer-test-'));
    return dir;
  }

  it('setupCredentialSentinels writes every sentinel with an intentionally aged atime baseline', () => {
    const sentinelDir = makeSentinelDir();
    const baselines = setupCredentialSentinels(sentinelDir);
    expect(baselines).toHaveLength(3);
    for (const baseline of baselines) {
      expect(baseline.atimeMsBefore).toBeGreaterThan(0);
      expect(existsSync(baseline.hostPath)).toBe(true);
      expect(statSync(baseline.hostPath).mtimeMs - baseline.atimeMsBefore).toBeGreaterThan(24 * 60 * 60 * 1000);
    }
  });

  it('an unchanged observer capability probe fails closed to SandboxObserverError, never zero access', () => {
    const sentinelDir = makeSentinelDir();
    const baselines = setupCredentialSentinels(sentinelDir);
    const capabilityProbe = setupObserverCapabilityProbe(sentinelDir);
    expect(statSync(capabilityProbe.hostPath).mtimeMs - capabilityProbe.atimeMsBefore).toBeGreaterThan(24 * 60 * 60 * 1000);
    expect(() => computeCredentialAccess(baselines, capabilityProbe)).toThrow(SandboxObserverError);
  });

  it('an advanced capability probe plus untouched sentinels reports zero credential access', () => {
    const sentinelDir = makeSentinelDir();
    const baselines = setupCredentialSentinels(sentinelDir);
    const capabilityProbe = setupObserverCapabilityProbe(sentinelDir);
    const probeStat = statSync(capabilityProbe.hostPath);
    utimesSync(capabilityProbe.hostPath, new Date(capabilityProbe.atimeMsBefore + 5000), probeStat.mtime);
    const result = computeCredentialAccess(baselines, capabilityProbe);
    expect(result.count).toBe(0);
    expect(result.accessedLabels).toEqual([]);
  });

  it('an advanced capability probe plus an advanced sentinel reports credential access', () => {
    const sentinelDir = makeSentinelDir();
    const baselines = setupCredentialSentinels(sentinelDir);
    const capabilityProbe = setupObserverCapabilityProbe(sentinelDir);
    const probeStat = statSync(capabilityProbe.hostPath);
    utimesSync(capabilityProbe.hostPath, new Date(capabilityProbe.atimeMsBefore + 5000), probeStat.mtime);
    const target = baselines[0];
    const sentinelStat = statSync(target.hostPath);
    utimesSync(target.hostPath, new Date(target.atimeMsBefore + 5000), sentinelStat.mtime);
    const result = computeCredentialAccess(baselines, capabilityProbe);
    expect(result.count).toBe(1);
    expect(result.accessedLabels).toEqual([target.label]);
  });

  it('computeCredentialAccess reports zero access when the capability probe advanced but no baseline file was touched', () => {
    const baselines = setupCredentialSentinels(makeSentinelDir());
    const capabilityProbe = setupObserverCapabilityProbe(dir);
    const probeStat = statSync(capabilityProbe.hostPath);
    utimesSync(capabilityProbe.hostPath, new Date(capabilityProbe.atimeMsBefore + 5000), probeStat.mtime);
    const result = computeCredentialAccess(baselines, capabilityProbe);
    expect(result.count).toBe(0);
    expect(result.accessedLabels).toEqual([]);
  });

  it('computeCredentialAccess detects an advanced atime as an access', () => {
    const sentinelDir = makeSentinelDir();
    const baselines = setupCredentialSentinels(sentinelDir);
    const capabilityProbe = setupObserverCapabilityProbe(sentinelDir);
    const probeStat = statSync(capabilityProbe.hostPath);
    utimesSync(capabilityProbe.hostPath, new Date(capabilityProbe.atimeMsBefore + 5000), probeStat.mtime);
    const target = baselines[0];
    // Simulate a real read from another process: an actual open+read is the
    // only thing that legitimately advances atime — reproduced directly
    // here without Docker, exercising the exact same comparison the real
    // container run relies on.
    readFileSync(target.hostPath);
    // Force a strictly-later timestamp regardless of filesystem atime
    // resolution/coalescing (this unit test's own concern is the compare
    // logic, not OS atime granularity — that is proven separately by the
    // real-Docker reproducer tests above).
    const targetStat = statSync(target.hostPath);
    utimesSync(target.hostPath, new Date(target.atimeMsBefore + 5000), targetStat.mtime);
    const result = computeCredentialAccess(baselines, capabilityProbe);
    expect(result.count).toBe(1);
    expect(result.accessedLabels).toEqual([target.label]);
  });

  it('computeCredentialAccess fails closed (throws SandboxObserverError) when a sentinel file has vanished — missing evidence is never "zero access"', () => {
    const sentinelDir = makeSentinelDir();
    const baselines = setupCredentialSentinels(sentinelDir);
    const capabilityProbe = setupObserverCapabilityProbe(sentinelDir);
    const probeStat = statSync(capabilityProbe.hostPath);
    utimesSync(capabilityProbe.hostPath, new Date(capabilityProbe.atimeMsBefore + 5000), probeStat.mtime);
    rmSync(baselines[0].hostPath);
    expect(() => computeCredentialAccess(baselines, capabilityProbe)).toThrow(SandboxObserverError);
  });

  it('setupCredentialSentinels fails closed (throws SandboxObserverError) when the target directory cannot be written to', () => {
    expect(() => setupCredentialSentinels(join(makeSentinelDir(), 'does', 'not', 'exist'))).toThrow(
      SandboxObserverError,
    );
  });

  it('detectForbiddenWriteAttempts recognises a blocked write naming a sentinel path on the same line', () => {
    const log = "sh: can't create /vet/sentinel/ssh_id_rsa: Read-only file system\n";
    expect(detectForbiddenWriteAttempts(log)).toEqual(['ssh-private-key']);
  });

  it('detectForbiddenWriteAttempts ignores a sentinel path with no error text, and an error with no sentinel path', () => {
    const log = 'cat /vet/sentinel/aws_credentials\nEROFS somewhere unrelated\n';
    expect(detectForbiddenWriteAttempts(log)).toEqual([]);
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

  it('an install step that attempts a real network call, but the candidate still works → verdict conditional', async () => {
    // `local-script` fixture rather than a real `npm install`: npm retries a
    // failed resolve several times with backoff (real, observed behavior in
    // this environment — it does not fail fast under --network none), which
    // would make this test slow/flaky. A direct Node http.get attempt fails
    // immediately with the same getaddrinfo signature the real npm/pip
    // install paths produce, exercising the exact same detection regex.
    // The install step ALSO writes the candidate binary and exits 0 (the
    // network attempt is logged, not fatal) — D1's repaired contract only
    // classifies 'conditional' when install AND every scenario invocation
    // positively succeeded; a hard-failing install is 'unknown' instead
    // (see the 'broken-tool' reproducer below).
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'network-fixture',
          packageSource: [
            installFixtureCandidateScript('network-fixture', 'exit 0'),
            "node -e \"require('http').get('http://example.com',()=>{}).on('error',e=>{console.error(e.message)})\"",
          ].join('\n'),
          installMethod: 'local-script',
        },
        scenarioIds: TWO_SCENARIOS,
      },
      { runtime: runtime() },
    );
    expect(outcome.verdict).toBe('conditional');
    expect(outcome.testPromptsRunCount).toBe(2);
    const calls = JSON.parse(outcome.networkCallsObservedJson) as { host: string; count: number }[];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.host === 'example.com')).toBe(true);
  }, 30000);

  it('a candidate binary that exits nonzero for every invocation (install itself succeeds) → verdict unknown, reason sandbox_candidate_failed, real attempt count preserved', async () => {
    // The real-Docker reproduction of D1's Blocker 1: `local-script`
    // installs `broken-tool`, whose `--version` and `--help` both exit 1.
    // Install itself succeeds (the script that WRITES the broken binary
    // exits 0) — only the candidate's own invocations fail. Positive proof
    // of success is required for 'safe'; this must never fall through to a
    // fabricated safe verdict.
    let containerName = '';
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'broken-tool',
          packageSource: installFixtureCandidateScript('broken-tool', 'exit 1'),
          installMethod: 'local-script',
        },
        scenarioIds: TWO_SCENARIOS,
      },
      { runtime: runtime({ onContainerName: (name) => (containerName = name) }) },
    );
    expect(outcome.verdict).toBe('unknown');
    expect(outcome.reason).toBe('sandbox_candidate_failed');
    // Both scenarios were genuinely attempted (real attempts), even though
    // both failed — testPromptsRunCount never implies success.
    expect(outcome.testPromptsRunCount).toBe(2);
    expect(JSON.parse(outcome.forbiddenPathViolationsJson)).toEqual([]);
    expect(outcome.credentialAccessAttemptsCount).toBe(0);
    // Its own exact owned container — never a broader sweep — is gone.
    expect(containerName).toMatch(/^rhythm-d1-vet-/);
    assertContainerGone(containerName);
  }, 30000);

  it('D1 credential-observer redesign: a QUIET shell read (output suppressed, exit 0) is still counted as credential access → verdict unsafe, never safe', async () => {
    // The exact GPT-reproduced gap: `quiet-reader`'s scenario invocation reads
    // a forbidden sentinel but redirects all output to /dev/null and exits 0.
    // The pre-redesign detector only counted a sentinel's marker text
    // appearing in captured stdout/stderr — invisible here by construction.
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'quiet-reader',
          packageSource: installFixtureCandidateScript(
            'quiet-reader',
            'cat /vet/sentinel/aws_credentials >/dev/null 2>&1\nexit 0',
          ),
          installMethod: 'local-script',
        },
        scenarioIds: TWO_SCENARIOS,
      },
      { runtime: runtime() },
    );
    expect(outcome.credentialAccessAttemptsCount).toBeGreaterThan(0);
    expect(outcome.verdict).toBe('unsafe');
  }, 30000);

  it('D1 credential-observer redesign: a QUIET programmatic read (Node fs.readFileSync, output suppressed, exit 0) is still counted as credential access → verdict unsafe', async () => {
    // Same invisibility gap, but via a programmatic read instead of a shell
    // `cat` — proves detection is mechanism-agnostic (a real `open()`+`read()`
    // syscall, not a text-pattern match against any particular tool's output
    // shape).
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'quiet-node-reader',
          packageSource: installFixtureCandidateScript(
            'quiet-node-reader',
            [
              'node -e "require(\'fs\').readFileSync(\'/vet/sentinel/aws_credentials\')" >/dev/null 2>&1',
              'exit 0',
            ].join('\n'),
          ),
          installMethod: 'local-script',
        },
        scenarioIds: TWO_SCENARIOS,
      },
      { runtime: runtime() },
    );
    expect(outcome.credentialAccessAttemptsCount).toBeGreaterThan(0);
    expect(outcome.verdict).toBe('unsafe');
  }, 30000);

  it('D1 credential-observer redesign: a candidate that reads a sentinel then tries to erase the evidence (reset atime, delete the file) never reaches safe', async () => {
    // The tamper-resistance requirement: a read must remain provable even
    // after the SAME candidate immediately tries to cover it up. Both the
    // reset attempt and the delete attempt are expected to fail outright
    // (the sentinel directory is mounted `:ro`), and their own failure
    // output is suppressed too, so this also proves the tamper attempt
    // itself cannot be laundered into looking like "no access occurred".
    const outcome = await vetToolInSandboxAsync(
      {
        candidate: {
          toolName: 'tamper-fixture',
          packageSource: installFixtureCandidateScript(
            'tamper-fixture',
            [
              'cat /vet/sentinel/aws_credentials >/dev/null 2>&1',
              'touch -a -t 202001010000 /vet/sentinel/aws_credentials >/dev/null 2>&1',
              'rm -f /vet/sentinel/aws_credentials >/dev/null 2>&1',
              'exit 0',
            ].join('\n'),
          ),
          installMethod: 'local-script',
        },
        scenarioIds: TWO_SCENARIOS,
      },
      { runtime: runtime() },
    );
    expect(outcome.verdict).not.toBe('safe');
    expect(outcome.credentialAccessAttemptsCount).toBeGreaterThan(0);
    expect(outcome.verdict).toBe('unsafe');
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
