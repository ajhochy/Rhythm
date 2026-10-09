import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DAYFLOW_RUNNER_ENV, DayflowCliSource, DayflowSourceError, fixtureExecutionEnvironment, nodeProcessDayflowRunner, qualifyPinnedV260Snapshot, verifyPinnedDayflowArtifact } from '../integrations/dayflow/cli_source';
import { MacOSCodeSignTool, MacOSPinnedDayflowValidator, PinnedDayflowArtifactVerifier } from '../integrations/dayflow/artifact_verifier';

const roots: string[] = [];
const fixture = (body: string) => { const root = mkdtempSync(join(tmpdir(), 'dayflow-runner-')); roots.push(root); const file = join(root, 'fixture.sh'); writeFileSync(file, `#!/bin/sh\n${body}\n`); chmodSync(file, 0o700); return file; };
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const request = { date: '2026-10-01', timeZone: 'UTC', sourceNamespace: 'test-namespace' };
const valid = JSON.stringify({ schema_version: 1, date: '2026-10-01', time_zone: 'UTC', day_boundary_hour: 4, cards: [{ record_id: 1, start: '2026-10-01T08:00:00+00:00', summary: 'synthetic' }] });
const source = (executable: string) => { const artifact = { executable, canonicalPath: '/synthetic/Dayflow.app', fileIdentity: 'test', digest: 'test', bundleId: 'teleportlabs.com.Dayflow' as const, version: '2.6.0' as const, build: 133 as const, signingFingerprint: 'test' }; const scopeRoot = mkdtempSync(join(tmpdir(), 'dayflow-scope-')); roots.push(scopeRoot); const home = join(scopeRoot, 'home'); const temp = join(scopeRoot, 'tmp'); const database = join(scopeRoot, 'fixture.db'); mkdirSync(home); mkdirSync(temp); writeFileSync(database, 'synthetic only'); return new DayflowCliSource({ artifact, revalidate: async () => artifact, runner: nodeProcessDayflowRunner, sourceVersion: 'v2.6.0', executionScope: { fixtureDatabasePath: database, homeDir: home, tempDir: temp, networkIsolation: 'enforced', telemetryIsolation: 'enforced' } }); };

describe('Dayflow pinned runner (synthetic executable fixtures only)', () => {
  it('uses bounded fixed argv and accepts only a matching snapshot', async () => {
    const reader = source(fixture(`printf '%s' '${valid}'`));
    await expect(reader.readDay(request)).resolves.toMatchObject({ qualified: true, cardCount: 1, request });
  });
  it('rejects nonzero, empty, malformed, wrong day/zone and duplicate IDs', async () => {
    for (const body of ["echo bad >&2; exit 2", ':', "printf '{'", `printf '%s' '${JSON.stringify({ ...JSON.parse(valid), date: '2026-10-02' })}'`, `printf '%s' '${JSON.stringify({ ...JSON.parse(valid), time_zone: 'America/New_York' })}'`, `printf '%s' '${JSON.stringify({ ...JSON.parse(valid), cards: [...JSON.parse(valid).cards, { ...JSON.parse(valid).cards[0] }] })}'`]) {
      const reader = source(fixture(body));
      await expect(reader.readDay(request)).rejects.toBeInstanceOf(DayflowSourceError);
    }
  });
  it('cancels and bounds streamed stdout/stderr without retaining raw output', async () => {
    const huge = source(fixture("head -c 1100000 /dev/zero"));
    await expect(huge.readDay(request)).rejects.toBeInstanceOf(DayflowSourceError);
    const slow = source(fixture('sleep 2')); const controller = new AbortController(); controller.abort();
    await expect(slow.readDay(request, controller.signal)).rejects.toBeInstanceOf(DayflowSourceError);
  });
  it('uses exactly fixed argv and environment, starts nothing after pre-abort, and maps spawn failures safely', async () => {
    const probe = fixture("printf '%s|%s|%s|%s|%s|%s|%s|%s' \"$#\" \"$1\" \"$2\" \"$3\" \"$4\" \"$PATH\" \"$HOME\" \"$TMPDIR\"");
    await expect(nodeProcessDayflowRunner.run(probe, ['timeline', request.date, '--json', '--detailed'], { timeoutMs: 1_000, maxStdoutBytes: 1_000, maxStderrBytes: 1_000 })).resolves.toMatchObject({ stdout: `4|timeline|${request.date}|--json|--detailed|${DAYFLOW_RUNNER_ENV.PATH}|${DAYFLOW_RUNNER_ENV.HOME}|${DAYFLOW_RUNNER_ENV.TMPDIR}` });
    const marker = join(mkdtempSync(join(tmpdir(), 'dayflow-preabort-')), 'started'); roots.push(join(marker, '..'));
    const controller = new AbortController(); controller.abort();
    await expect(nodeProcessDayflowRunner.run(fixture(`touch '${marker}'`), [], { signal: controller.signal, timeoutMs: 1_000, maxStdoutBytes: 1_000, maxStderrBytes: 1_000 })).rejects.toThrow(/cancelled/i);
    expect(existsSync(marker)).toBe(false);
    await expect(nodeProcessDayflowRunner.run(join(marker, 'missing'), [], { timeoutMs: 100, maxStdoutBytes: 1_000, maxStderrBytes: 1_000 })).rejects.toThrow(/failed/i);
    const nonExecutable = join(mkdtempSync(join(tmpdir(), 'dayflow-nonexec-')), 'plain'); roots.push(join(nonExecutable, '..')); writeFileSync(nonExecutable, 'not executable');
    await expect(nodeProcessDayflowRunner.run(nonExecutable, [], { timeoutMs: 100, maxStdoutBytes: 1_000, maxStderrBytes: 1_000 })).rejects.toThrow(/failed/i);
  });
  it('requires an explicit server-owned fixture scope and never inherits ambient secrets', () => {
    const root = mkdtempSync(join(tmpdir(), 'dayflow-explicit-scope-')); roots.push(root); const home = join(root, 'home'); const temp = join(root, 'tmp'); const database = join(root, 'fixture.db'); mkdirSync(home); mkdirSync(temp); writeFileSync(database, 'synthetic');
    expect(fixtureExecutionEnvironment({ fixtureDatabasePath: database, homeDir: home, tempDir: temp, networkIsolation: 'enforced', telemetryIsolation: 'enforced' })).toEqual({ PATH: '/usr/bin:/bin', HOME: home, TMPDIR: temp, DAYFLOW_DB: database, LANG: 'C', LC_ALL: 'C' });
    expect(() => fixtureExecutionEnvironment({ fixtureDatabasePath: database, homeDir: home, tempDir: temp, networkIsolation: 'enforced', telemetryIsolation: 'invalid' as never })).toThrow(/scope/i);
  });
  it('waits for close after TERM is ignored, limits stderr, and preserves UTF-8 across raw byte chunks', async () => {
    await expect(nodeProcessDayflowRunner.run(fixture("trap '' TERM; while :; do :; done"), [], { timeoutMs: 20, maxStdoutBytes: 1_000, maxStderrBytes: 1_000 })).rejects.toThrow(/timed out/i);
    await expect(nodeProcessDayflowRunner.run(fixture('head -c 65000 /dev/zero >&2'), [], { timeoutMs: 1_000, maxStdoutBytes: 1_000, maxStderrBytes: 64_000 })).rejects.toThrow(/diagnostic.*large/i);
    await expect(nodeProcessDayflowRunner.run(fixture("printf '\\342'; printf '\\202\\254'"), [], { timeoutMs: 1_000, maxStdoutBytes: 3, maxStderrBytes: 1_000 })).resolves.toMatchObject({ stdout: '€' });
  });
  it('never invokes a process in the default disabled source', async () => {
    await expect(new DayflowCliSource().read()).rejects.toThrow('adapter_not_ready');
    expect(() => qualifyPinnedV260Snapshot(request, { exitCode: 0, stdout: valid, stderr: '' })).not.toThrow();
  });
  it('fails closed on replacement before spawn and on artifact manifest/signature mismatch', async () => {
    const executable = fixture(`printf '%s' '${valid}'`); const artifact = { executable, canonicalPath: '/synthetic/Dayflow.app', fileIdentity: 'one', digest: 'one', bundleId: 'teleportlabs.com.Dayflow' as const, version: '2.6.0' as const, build: 133 as const, signingFingerprint: 'one' };
    const reader = new DayflowCliSource({ artifact, revalidate: async () => ({ ...artifact, digest: 'replaced' }), runner: nodeProcessDayflowRunner, sourceVersion: 'v2.6.0' }); await expect(reader.readDay(request)).rejects.toThrow('changed');
    const root = mkdtempSync(join(tmpdir(), 'dayflow-app-')); roots.push(root); const helper = join(root, 'Dayflow.app', 'Contents', 'Helpers'); mkdirSync(helper, { recursive: true }); writeFileSync(join(helper, 'dayflow'), 'fixture'); chmodSync(join(helper, 'dayflow'), 0o700);
    const verifier = new PinnedDayflowArtifactVerifier({ bundleId: 'teleportlabs.com.Dayflow', version: '2.6.0', build: 133, signingFingerprint: 'a'.repeat(40), helperDigest: 'b'.repeat(64) }, { inspect: async () => ({ bundleId: 'teleportlabs.com.Dayflow', version: '2.6.0', build: 133, signingFingerprint: 'a'.repeat(40), helperSignatureValid: true, appSignatureValid: true }) }); await expect(verifier.verify(join(root, 'Dayflow.app'))).rejects.toBeInstanceOf(DayflowSourceError);
  });
  it('uses injected fixed-argument codesign results and the actual helper bytes for a trusted release', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dayflow-signed-app-')); roots.push(root); const helperDir = join(root, 'Dayflow.app', 'Contents', 'Helpers'); mkdirSync(helperDir, { recursive: true }); const helper = join(helperDir, 'dayflow'); writeFileSync(helper, 'synthetic trusted helper'); chmodSync(helper, 0o700);
    const digest = createHash('sha256').update('synthetic trusted helper').digest('hex'); const fingerprint = 'c'.repeat(40);
    const commands: string[][] = []; const codesign = new MacOSCodeSignTool({ run: async (argv) => { commands.push([...argv]); return { exitCode: 0, stderr: argv[0] === '-d' ? `CDHash=${fingerprint}\n` : '' }; } });
    const trusted = { bundleId: 'teleportlabs.com.Dayflow' as const, version: '2.6.0' as const, build: 133 as const, signingFingerprint: fingerprint, helperDigest: digest };
    const artifact = await new PinnedDayflowArtifactVerifier(trusted, new MacOSPinnedDayflowValidator(trusted, codesign)).verify(join(root, 'Dayflow.app'));
    expect(artifact.digest).toBe(digest); expect(commands).toEqual([['--verify', '--strict', '--verbose=2', artifact.canonicalPath], ['--verify', '--strict', '--verbose=2', artifact.executable], ['-d', '--verbose=4', artifact.executable]]);
  });
});
