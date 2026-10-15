import { DAYFLOW_EXPORT_CONTRACT_REASON, DAYFLOW_EXPORT_CONTRACT_STATUS } from './export_contract';
import type { DayflowFixtureExport, DayflowSource } from './types';
import { normalizeDayflowV260TimelineDetailed } from './normalize';
import { spawn } from 'node:child_process';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export class DayflowSourceError extends Error {}

export interface DayflowReadRequest { date: string; timeZone: string; sourceNamespace: string; }
export interface QualifiedDayflowSnapshot { request: DayflowReadRequest; schemaVersion: 1; dayBoundaryHour: 4; cardCount: number; qualified: true; raw: unknown; observations: ReturnType<typeof normalizeDayflowV260TimelineDetailed>; }
export interface DayflowExecutionScope { fixtureDatabasePath: string; homeDir: string; tempDir: string; networkIsolation: 'enforced'; telemetryIsolation: 'enforced'; }
export interface DayflowRunner { run(executable: string, argv: readonly string[], options: { signal?: AbortSignal; timeoutMs: number; maxStdoutBytes: number; maxStderrBytes: number; environment?: Readonly<Record<string, string>> }): Promise<{ exitCode: number; stdout: string; stderr: string }>; }
export interface VerifiedDayflowArtifact { executable: string; canonicalPath: string; fileIdentity: string; digest: string; bundleId: 'teleportlabs.com.Dayflow'; version: '2.6.0'; build: 133; signingFingerprint: string; }
export interface DayflowArtifactVerifier { verify(bundlePath: string): Promise<VerifiedDayflowArtifact>; }

/** Enforces the selected app-bundle layout before platform signature checks. */
export async function verifyPinnedDayflowArtifact(bundlePath: string, verifier: DayflowArtifactVerifier) {
  const canonicalBundle = realpathSync(bundlePath);
  const expectedHelper = join(canonicalBundle, 'Contents', 'Helpers', 'dayflow');
  const executable = realpathSync(expectedHelper);
  // The bundle may be selected through a symlink, but its executable may not:
  // otherwise a trusted bundle can be swapped for an arbitrary helper after
  // selection. Keep the exact, server-derived helper path as the binding.
  if (!canonicalBundle.endsWith('.app') || executable !== expectedHelper || relative(canonicalBundle, executable).startsWith('..') || !lstatSync(expectedHelper).isFile()) throw new DayflowSourceError('Dayflow selected artifact is invalid.');
  const artifact = await verifier.verify(canonicalBundle);
  if (artifact.bundleId !== 'teleportlabs.com.Dayflow' || artifact.version !== '2.6.0' || artifact.build !== 133 || artifact.canonicalPath !== canonicalBundle || artifact.executable !== expectedHelper || !artifact.digest || !artifact.fileIdentity || !artifact.signingFingerprint) throw new DayflowSourceError('Dayflow selected artifact is not the pinned release.');
  return artifact;
}

/** Fixed, offline-only argv contract. It is exposed for fake-runner tests only. */
export function pinnedTimelineArgv(request: DayflowReadRequest): readonly ['timeline', string, '--json', '--detailed'] {
  if (!isCalendarDay(request.date) || !request.sourceNamespace.trim()) throw new DayflowSourceError('Dayflow read request is invalid.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: request.timeZone }); } catch { throw new DayflowSourceError('Dayflow read timezone is invalid.'); }
  return ['timeline', request.date, '--json', '--detailed'];
}

/** Validates a fake runner response; this function cannot spawn a process. */
export function qualifyPinnedV260Snapshot(request: DayflowReadRequest, result: { exitCode: number; stdout: string; stderr: string }): QualifiedDayflowSnapshot {
  const raw = parseDayflowV260Result(result) as { schema_version?: unknown; date?: unknown; time_zone?: unknown; day_boundary_hour?: unknown; cards?: unknown };
  if (raw.schema_version !== 1 || raw.date !== request.date || raw.time_zone !== request.timeZone || raw.day_boundary_hour !== 4 || !Array.isArray(raw.cards)) throw new DayflowSourceError('Dayflow snapshot does not match its requested qualified day.');
  let observations: ReturnType<typeof normalizeDayflowV260TimelineDetailed>; try { observations = normalizeDayflowV260TimelineDetailed(raw, request.sourceNamespace); } catch { throw new DayflowSourceError('Dayflow snapshot cards are invalid.'); }
  const ids = new Set(observations.observations.map((item) => item.recordId)); if (ids.size !== observations.observations.length) throw new DayflowSourceError('Dayflow snapshot contains duplicate record IDs.');
  return { request: structuredClone(request), schemaVersion: 1, dayBoundaryHour: 4, cardCount: raw.cards.length, qualified: true, raw, observations };
}

function isCalendarDay(value: string) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!m) return false; const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return date.getUTCFullYear() === +m[1] && date.getUTCMonth() === +m[2] - 1 && date.getUTCDate() === +m[3]; }

/** Parses bounded caller-supplied JSON. It never executes a program or reads a path. */
export function readBoundedJson(stdout: string, maxBytes: number): unknown {
  if (Buffer.byteLength(stdout, 'utf8') > maxBytes) throw new DayflowSourceError('Dayflow export is too large.');
  try { return JSON.parse(stdout) as unknown; }
  catch { throw new DayflowSourceError('Dayflow export is malformed JSON.'); }
}

/** Offline fake-runner result gate for the pinned command. Nonzero/empty output is never an empty day. */
export function parseDayflowV260Result(result: { exitCode: number; stdout: string; stderr: string }, maxBytes = 1_000_000): unknown {
  if (result.exitCode !== 0) throw new DayflowSourceError('Dayflow timeline command failed.');
  if (!result.stdout.trim()) throw new DayflowSourceError('Dayflow timeline produced no JSON output.');
  return readBoundedJson(result.stdout, maxBytes);
}

/** Bounded fixed-argv process runner. The source does not construct it by default. */
export const DAYFLOW_RUNNER_ENV = Object.freeze({ PATH: '/usr/bin:/bin', HOME: '/var/empty', TMPDIR: '/var/empty', LANG: 'C', LC_ALL: 'C' });

/**
 * The reader never inherits the server environment. A reviewed runner must
 * assert that its process sandbox actually blocks network and telemetry; this
 * code deliberately does not invent undocumented Dayflow command flags.
 */
export function fixtureExecutionEnvironment(scope: DayflowExecutionScope): Readonly<Record<string, string>> {
  for (const path of [scope.fixtureDatabasePath, scope.homeDir, scope.tempDir]) if (!isAbsolute(path)) throw new DayflowSourceError('Dayflow execution scope is invalid.');
  if (!lstatSync(scope.fixtureDatabasePath).isFile() || !statSync(scope.homeDir).isDirectory() || !statSync(scope.tempDir).isDirectory() || scope.networkIsolation !== 'enforced' || scope.telemetryIsolation !== 'enforced') throw new DayflowSourceError('Dayflow execution scope is invalid.');
  return Object.freeze({ PATH: '/usr/bin:/bin', HOME: scope.homeDir, TMPDIR: scope.tempDir, DAYFLOW_DB: scope.fixtureDatabasePath, LANG: 'C', LC_ALL: 'C' });
}

/**
 * Bounded synthetic-fixture runner. It has no inherited environment, shell,
 * stdin, journal path, or retry behavior. Termination is deliberately awaited
 * through `close`: a child that ignores TERM receives KILL, and no later
 * request can race an owned reader that is still closing its descriptors.
 */
export const nodeProcessDayflowRunner: DayflowRunner = { run(executable, argv, options) { return new Promise((resolve, reject) => {
  if (options.signal?.aborted) { reject(new DayflowSourceError('Dayflow reader cancelled.')); return; }
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(executable, [...argv], { shell: false, cwd: dirname(executable), env: options.environment ?? DAYFLOW_RUNNER_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    reject(new DayflowSourceError('Dayflow reader failed.'));
    return;
  }
  let stdout = ''; let stderr = ''; let outBytes = 0; let errBytes = 0;
  let terminal: DayflowSourceError | undefined; let settled = false; let closed = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const outDecoder = new StringDecoder('utf8'); const errDecoder = new StringDecoder('utf8');
  const finish = (exitCode = child.exitCode ?? 1) => {
    if (settled) return;
    settled = true; clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
    options.signal?.removeEventListener('abort', onAbort);
    // Never retain or surface partial raw export/diagnostic data after a
    // terminal condition (including byte-bound overflow).
    if (terminal) { stdout = ''; stderr = ''; reject(terminal); return; }
    resolve({ exitCode, stdout: stdout + outDecoder.end(), stderr: stderr + errDecoder.end() });
  };
  const stop = (reason: string) => {
    if (terminal || closed) return;
    terminal = new DayflowSourceError(reason);
    try { child.kill('SIGTERM'); } catch { /* close/error settles below */ }
    killTimer = setTimeout(() => { if (!closed) { try { child.kill('SIGKILL'); } catch { /* close/error settles below */ } } }, 500);
    killTimer.unref?.();
  };
  const onAbort = () => stop('Dayflow reader cancelled.');
  const timer = setTimeout(() => stop('Dayflow reader timed out.'), options.timeoutMs);
  timer.unref?.();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  child.stdout!.on('data', (chunk: Buffer) => { outBytes += chunk.length; if (outBytes > options.maxStdoutBytes) { stop('Dayflow export is too large.'); return; } if (!terminal) stdout += outDecoder.write(chunk); });
  child.stderr!.on('data', (chunk: Buffer) => { errBytes += chunk.length; if (errBytes > options.maxStderrBytes) { stop('Dayflow diagnostic is too large.'); return; } if (!terminal) stderr += errDecoder.write(chunk); });
  child.on('error', () => {
    terminal ??= new DayflowSourceError('Dayflow reader failed.');
    // A spawn failure has no process to await; normal process failures still
    // arrive at close, preserving the close-before-settle invariant.
    if (child.pid === undefined) finish();
  });
  child.on('close', (code) => { closed = true; finish(code ?? 1); });
}); } };

/** Fail-closed placeholder until a reviewed source contract supplies fixed argv and schema. */
export class DayflowCliSource implements DayflowSource {
  constructor(private readonly options?: { artifact: VerifiedDayflowArtifact; revalidate: () => Promise<VerifiedDayflowArtifact>; runner: DayflowRunner; sourceVersion: 'v2.6.0'; executionScope?: DayflowExecutionScope }) {}
  /** The inert server default has no binding and is never a ready source. */
  hasVerifiedBinding() { return Boolean(this.options); }
  async read(): Promise<DayflowFixtureExport> {
    throw new DayflowSourceError(`${DAYFLOW_EXPORT_CONTRACT_STATUS}: ${DAYFLOW_EXPORT_CONTRACT_REASON}`);
  }
  async readDay(request: DayflowReadRequest, signal?: AbortSignal) {
    if (!this.options || this.options.sourceVersion !== 'v2.6.0') throw new DayflowSourceError(`${DAYFLOW_EXPORT_CONTRACT_STATUS}: ${DAYFLOW_EXPORT_CONTRACT_REASON}`);
    const artifact = await this.options.revalidate();
    if (artifact.canonicalPath !== this.options.artifact.canonicalPath || artifact.executable !== this.options.artifact.executable || artifact.digest !== this.options.artifact.digest || artifact.fileIdentity !== this.options.artifact.fileIdentity || artifact.signingFingerprint !== this.options.artifact.signingFingerprint) throw new DayflowSourceError('Dayflow source changed.');
    if (!this.options.executionScope) throw new DayflowSourceError('Dayflow execution scope is required.');
    const environment = fixtureExecutionEnvironment(this.options.executionScope);
    const result = await this.options.runner.run(artifact.executable, pinnedTimelineArgv(request), { signal, timeoutMs: 10_000, maxStdoutBytes: 1_000_000, maxStderrBytes: 64_000, environment });
    return qualifyPinnedV260Snapshot(request, result);
  }
}
