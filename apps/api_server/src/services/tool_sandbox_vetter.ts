/**
 * D1.2 (#1427) — the isolated tool sandbox vetter.
 *
 * Installs a `tool-install` proposal's candidate tool inside a disposable,
 * network-isolated Docker container, invokes the installed candidate for
 * each selected closed test SCENARIO (never raw prompt text — see
 * `tool_test_scenarios.ts`), observes what it does (forbidden-path writes,
 * credential-shaped file reads, outbound network attempts), and classifies
 * a verdict. NEVER installs on the host — the only place install/invocation
 * logic ever executes is inside the throwaway container built by
 * {@link DockerSandboxRuntime}.
 *
 * Fails CLOSED on every error path — Docker unavailable, invalid scenario
 * selection, an unsafe/unsupported candidate shape, a killed/timed-out
 * container, incomplete/corrupt observation evidence, or a candidate that
 * did not positively succeed (a nonzero install exit, a nonzero scenario
 * invocation exit, or missing/malformed/duplicate/mismatched result
 * evidence — see {@link evaluateCandidateSucceeded}) all return
 * `verdict: 'unknown'` with a FIXED, code-owned reason string. `safe` and
 * `conditional` require POSITIVE proof of success, never silence or an
 * absence of a bad signal — a partial or ambiguous observation is evidence
 * of nothing, not evidence of safety. A detected credential access attempt
 * is always `unsafe`, regardless of install/scenario success. See D1.3's
 * proposal validator (tool_install_proposal_validator.ts) for the durable
 * enforcement that a `verdict: 'unknown'` (or `'unsafe'`) report can never
 * reach approval.
 *
 * Real Docker mechanics (verified by hand against this environment's Docker
 * 29.2.1 + the already-pulled `node:22-alpine` image before being encoded
 * here — see docs/ai/runs/2026-08-20-d1-2-tool-sandbox-vetter.md):
 *   - Forbidden-path violations are detected by pre-seeding known sentinel
 *     files with known content/hash and checking whether their content
 *     changed (or the file vanished) after the run — works under a root
 *     container user, unlike a permission-bit approach.
 *   - Credential ACCESS attempts (reads) are detected independently of the
 *     candidate's own stdout/stderr — a quiet `cat sentinel >/dev/null` or an
 *     `fs.readFileSync` is otherwise invisible to any output-log parser (see
 *     docs/ai/runs/2026-08-21-d1-credential-observer-redesign.md for the real
 *     Docker reproduction). Instead, each sentinel file is written by the
 *     HOST (never by a script running at the candidate's own privilege) into
 *     a directory bind-mounted into the container as its OWN separate
 *     `:ro` (read-only) mount nested under `/vet/sentinel` — distinct from
 *     the `:rw` `/vet` workspace mount the candidate's install/scenario
 *     steps use. The host records each sentinel file's access time (`atime`)
 *     immediately after writing it, and — entirely after the container has
 *     exited, from the HOST's own filesystem view, never from anything the
 *     container wrote — re-reads each sentinel's `atime`: any advance proves
 *     some process inside the container executed a real `open()`+`read()`
 *     against that exact file, regardless of whether it captured, printed,
 *     or discarded the content. Verified by hand against this environment's
 *     Docker Desktop (linuxkit VM, virtiofs-backed bind mounts): a plain
 *     `ls`/`stat` from inside the container does NOT touch atime (no false
 *     positive), while a `cat`/`fs.readFileSync` open does. The read-only
 *     mount also makes this evidence tamper-resistant: an unprivileged
 *     candidate cannot `touch -a` the atime back, delete the sentinel, or
 *     replace it with a look-alike file to erase a read that already
 *     happened — every such attempt fails at the kernel/mount level with
 *     `EROFS`, verified empirically, never merely assumed. (A bare
 *     FIFO-based handshake was tried first and rejected: under this Docker
 *     Desktop bind-mount implementation, a container-side `ls` on the
 *     containing directory alone was observed to spuriously unblock a
 *     host-side FIFO writer with no candidate read at all — an unacceptable
 *     false-positive source. Regular files + atime do not share this
 *     problem, as re-verified above.) Because a write is blocked outright by
 *     the `:ro` mount, a forbidden-path WRITE attempt (as opposed to a read)
 *     is instead recognised from the install/invoke logs' own
 *     "Read-only file system"/"Permission denied" error text naming the
 *     sentinel path — the attempt itself is the violation, whether or not it
 *     would have succeeded absent the mount.
 *   - Network calls are always refused at the kernel level (`--network
 *     none`); "network calls observed" means the install/invocation step's
 *     own network client (npm, pip, curl, the candidate itself, ...)
 *     attempted one and failed with a recognizable resolution/connection
 *     error, which is parsed for the attempted host and discarded — only
 *     the aggregate `{host, count}` list is returned.
 *   - Each selected scenario is genuinely invoked as a SEPARATE command
 *     inside the container (`<toolName> <scenario args>`), unconditionally
 *     followed by a fixed, machine-readable result line
 *     (`SCENARIO_RESULT:<id>:<exitCode>`) — `testPromptsRunCount` is the
 *     number of result lines actually observed after the run, never the
 *     requested array length, so a container killed mid-run under-counts
 *     rather than lying, AND never implies success: install exiting 0 and
 *     every requested scenario's own result line reading exit code 0 is
 *     required before `safe`/`conditional` is even considered.
 *   - The run script reaches its sentinel-rehash step only after every
 *     selected scenario has been attempted; if that step's output is
 *     missing or short, the whole run is treated as EVIDENCE INCOMPLETE
 *     (`verdict: 'unknown'`) rather than trusting a partial/absent
 *     observation as "zero violations found."
 *   - Teardown is unconditional (`docker kill` + `docker rm -f` in a
 *     `finally`) and targets ONLY the exact, randomly-generated container
 *     name this run created — proven necessary by hand: killing the
 *     `docker run` CLI process (e.g. on a timeout) does NOT stop the
 *     container itself (`--rm` only fires when the CONTAINER exits, not
 *     when its client is killed) — an orphaned container survives its
 *     killed client, and a timed-out/signal-killed `docker run` client
 *     process is itself treated as a failed run (`verdict: 'unknown'`),
 *     never as a successful one.
 *   - The container runs hardened: no host mounts beyond the disposable
 *     scratch workspace, `--network none`, `--cap-drop ALL`,
 *     `--security-opt no-new-privileges`, a PID limit, memory/CPU limits, a
 *     read-only root filesystem with only `/vet` (the scratch workspace)
 *     and a small `/tmp` tmpfs writable, and the image's own non-root
 *     `node` user.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ToolSafetyReportInput } from '../models/tool_safety_report';
import { isSafePackageSource, isSafeToolName } from './tool_install_safety';
import {
  TOOL_INSTALL_MAX_TEST_SCENARIOS,
  TOOL_INSTALL_MIN_TEST_SCENARIOS,
  TOOL_TEST_SCENARIOS,
  isToolTestScenarioId,
} from './tool_test_scenarios';

export interface ToolVettingCandidate {
  toolName: string;
  toolVersion?: string | null;
  packageSource: string;
  installMethod: string;
}

export interface ToolVettingInput {
  candidate: ToolVettingCandidate;
  /** Closed scenario identifiers only — see `tool_test_scenarios.ts`. Never prompt text. */
  scenarioIds: string[];
}

export interface SandboxRunObservation {
  forbiddenPathViolations: string[];
  networkCallsObserved: { host: string; count: number }[];
  fileSystemWritesObserved: { path: string; count: number }[];
  credentialAccessAttemptsCount: number;
  /** Scenarios actually attempted inside the container — never the requested count. */
  scenariosAttemptedCount: number;
  /**
   * Positive proof that install exited 0 AND every requested scenario
   * invocation exited 0 — never inferred from silence. `false` on any
   * nonzero exit, or on missing/malformed/duplicate/mismatched result
   * evidence (see {@link evaluateCandidateSucceeded}). Required for `safe`
   * or `conditional`; a `false` here is `unknown` regardless of anything
   * else observed.
   */
  candidateSucceeded: boolean;
  sandboxDurationMs: number;
}

export interface SandboxRuntime {
  isAvailableAsync(): Promise<boolean>;
  runAsync(candidate: ToolVettingCandidate, scenarioIds: string[]): Promise<SandboxRunObservation>;
}

/** The observational subset of {@link ToolSafetyReportInput} this module produces — always fully populated. */
export type ToolVettingOutcome = Required<
  Pick<
    ToolSafetyReportInput,
    | 'verdict'
    | 'reason'
    | 'sandboxDurationMs'
    | 'testPromptsRunCount'
    | 'forbiddenPathViolationsJson'
    | 'networkCallsObservedJson'
    | 'fileSystemWritesObservedJson'
    | 'credentialAccessAttemptsCount'
    | 'evidenceJson'
  >
>;

export interface ToolSandboxVetterDeps {
  runtime?: SandboxRuntime;
}

/**
 * Fixed, code-owned failure reasons. NEVER derived from an exception's own
 * message text — an exception can carry candidate-controlled or Docker
 * daemon-controlled content, and this track's contract is that no raw
 * exception text is ever persisted (see module doc comment).
 */
export type ToolVettingFailureReason =
  | 'sandbox_unavailable'
  | 'invalid_scenario_ids'
  | 'unsafe_tool_name'
  | 'unsafe_package_source'
  | 'unsupported_install_method'
  | 'sandbox_start_failed'
  | 'sandbox_terminated'
  | 'sandbox_evidence_incomplete'
  | 'sandbox_candidate_failed'
  | 'sandbox_observer_unavailable'
  | 'sandbox_error';

/** Thrown for a candidate shape the sandbox refuses to build a command for. */
export class SandboxConfigError extends Error {
  constructor(public readonly code: ToolVettingFailureReason) {
    super(code);
    this.name = 'SandboxConfigError';
  }
}

/** Thrown when the `docker run` client process is killed by a timeout or an external signal. */
export class SandboxTerminatedError extends Error {
  constructor() {
    super('sandbox_terminated');
    this.name = 'SandboxTerminatedError';
  }
}

/** Thrown when `docker run` itself fails to start the container (e.g. exit 125). */
export class SandboxStartError extends Error {
  constructor() {
    super('sandbox_start_failed');
    this.name = 'SandboxStartError';
  }
}

/** Thrown when the run's own observation artifacts are missing or incomplete after the container exits. */
export class SandboxEvidenceError extends Error {
  constructor() {
    super('sandbox_evidence_incomplete');
    this.name = 'SandboxEvidenceError';
  }
}

/**
 * Thrown when the trusted, host-side credential-access observer cannot be
 * set up before the run, or cannot be read back after it — a missing
 * sentinel file, a host filesystem error, or any other failure that means
 * coverage of the install+scenario window cannot be proven. NEVER treated
 * as "no access observed" — always fails closed to `unknown`, never `safe`.
 */
export class SandboxObserverError extends Error {
  constructor() {
    super('sandbox_observer_unavailable');
    this.name = 'SandboxObserverError';
  }
}

function unavailableOutcome(reason: ToolVettingFailureReason): ToolVettingOutcome {
  return {
    verdict: 'unknown',
    reason,
    sandboxDurationMs: 0,
    testPromptsRunCount: 0,
    forbiddenPathViolationsJson: '[]',
    networkCallsObservedJson: '[]',
    fileSystemWritesObservedJson: '[]',
    credentialAccessAttemptsCount: 0,
    evidenceJson: JSON.stringify({ reason }),
  };
}

/**
 * Unsafe signals (a forbidden-path write OR a detected credential access
 * attempt) win regardless of install/scenario success. Otherwise, `safe`/
 * `conditional` require POSITIVE proof the candidate actually succeeded
 * (`candidateSucceeded`) — a failed install or a failed scenario invocation
 * is `unknown`, never `safe`, even with zero other violations observed.
 */
function classifyVerdict(observation: SandboxRunObservation): 'safe' | 'conditional' | 'unsafe' | 'unknown' {
  if (observation.forbiddenPathViolations.length > 0) return 'unsafe';
  if (observation.credentialAccessAttemptsCount > 0) return 'unsafe';
  if (!observation.candidateSucceeded) return 'unknown';
  if (observation.networkCallsObserved.length > 0) return 'conditional';
  return 'safe';
}

/** Map any thrown error to a FIXED, sanitized reason — never the exception's own message text. */
function classifyFailureReason(err: unknown): ToolVettingFailureReason {
  if (err instanceof SandboxConfigError) return err.code;
  if (err instanceof SandboxTerminatedError) return 'sandbox_terminated';
  if (err instanceof SandboxStartError) return 'sandbox_start_failed';
  if (err instanceof SandboxEvidenceError) return 'sandbox_evidence_incomplete';
  if (err instanceof SandboxObserverError) return 'sandbox_observer_unavailable';
  return 'sandbox_error';
}

/** Exactly 2 or 3 distinct, closed scenario identifiers — never fewer, more, or unrecognised. */
function validateScenarioIds(scenarioIds: unknown): scenarioIds is string[] {
  if (!Array.isArray(scenarioIds)) return false;
  if (scenarioIds.length < TOOL_INSTALL_MIN_TEST_SCENARIOS || scenarioIds.length > TOOL_INSTALL_MAX_TEST_SCENARIOS) {
    return false;
  }
  const seen = new Set<string>();
  for (const id of scenarioIds) {
    if (!isToolTestScenarioId(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/**
 * Vet a candidate tool. Fails CLOSED on every error path — see module doc
 * comment. `unknown` is the only verdict a failure path may ever produce.
 */
export async function vetToolInSandboxAsync(
  input: ToolVettingInput,
  deps: ToolSandboxVetterDeps = {},
): Promise<ToolVettingOutcome> {
  if (!validateScenarioIds(input.scenarioIds)) {
    return unavailableOutcome('invalid_scenario_ids');
  }

  const runtime = deps.runtime ?? new DockerSandboxRuntime();

  let available: boolean;
  try {
    available = await runtime.isAvailableAsync();
  } catch {
    available = false;
  }
  if (!available) {
    return unavailableOutcome('sandbox_unavailable');
  }

  let observation: SandboxRunObservation;
  try {
    observation = await runtime.runAsync(input.candidate, input.scenarioIds);
  } catch (err) {
    return unavailableOutcome(classifyFailureReason(err));
  }

  const verdict = classifyVerdict(observation);
  return {
    verdict,
    // 'sandbox_candidate_failed' is the only fixed reason a positively-run
    // observation (as opposed to a thrown infra error) can produce — see
    // classifyVerdict. testPromptsRunCount below is NEVER zeroed here: it
    // reflects real attempts even when candidateSucceeded is false.
    reason: verdict === 'unknown' ? 'sandbox_candidate_failed' : null,
    sandboxDurationMs: observation.sandboxDurationMs,
    testPromptsRunCount: observation.scenariosAttemptedCount,
    forbiddenPathViolationsJson: JSON.stringify(observation.forbiddenPathViolations),
    networkCallsObservedJson: JSON.stringify(observation.networkCallsObserved),
    fileSystemWritesObservedJson: JSON.stringify(observation.fileSystemWritesObserved),
    credentialAccessAttemptsCount: observation.credentialAccessAttemptsCount,
    evidenceJson: JSON.stringify({
      toolName: input.candidate.toolName,
      installMethod: input.candidate.installMethod,
      verdict,
      forbiddenPathViolationCount: observation.forbiddenPathViolations.length,
      networkCallCount: observation.networkCallsObserved.length,
      credentialAccessAttemptsCount: observation.credentialAccessAttemptsCount,
      scenariosAttemptedCount: observation.scenariosAttemptedCount,
    }),
  };
}

// ── DockerSandboxRuntime — the real, production runtime ─────────────────────

const SANDBOX_IMAGE = 'node:22-alpine';
const SANDBOX_TIMEOUT_MS = 60_000;
const SANDBOX_MEMORY_LIMIT = '256m';
const SANDBOX_CPU_LIMIT = '1';
const SANDBOX_PIDS_LIMIT = '128';

/**
 * Closed set of install methods this runtime knows how to translate into a
 * concrete sandbox command. `local-script` is a TEST-ONLY escape hatch (the
 * "package source" is treated as literal, pre-vetted script content) — never
 * accepted by the production proposal validator (tool_install_proposal_validator.ts),
 * so a real proposal can never smuggle arbitrary shell content through it.
 */
const INSTALL_COMMAND_BUILDERS: Record<string, (packageSource: string) => string> = {
  'npm install': (pkg) => `npm install ${pkg} --no-audit --no-fund`,
  'pip install': (pkg) => `pip install ${pkg}`,
  'local-script': (pkg) => pkg,
};

/** Fail closed BEFORE building any shell command from a caller-controlled string. */
function validateCandidateForSandbox(candidate: ToolVettingCandidate): void {
  if (!isSafeToolName(candidate.toolName)) {
    throw new SandboxConfigError('unsafe_tool_name');
  }
  if (!(candidate.installMethod in INSTALL_COMMAND_BUILDERS)) {
    throw new SandboxConfigError('unsupported_install_method');
  }
  if (candidate.installMethod !== 'local-script' && !isSafePackageSource(candidate.packageSource)) {
    throw new SandboxConfigError('unsafe_package_source');
  }
}

function buildInstallScript(candidate: ToolVettingCandidate): string {
  const builder = INSTALL_COMMAND_BUILDERS[candidate.installMethod];
  return builder(candidate.packageSource);
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Each selected scenario is invoked as its OWN command, unconditionally
 * followed by a fixed, machine-readable result line — `;`, never `&&`, so
 * one scenario's non-zero exit never suppresses the next scenario's attempt
 * or its own result line. The line carries only the closed scenario ID and
 * its exit code (never candidate output), and is read back by
 * {@link evaluateCandidateSucceeded} / {@link parseObservation} — never
 * trusted as "attempted" without also recording whether it actually
 * succeeded.
 */
function buildScenarioInvocationScript(toolName: string, scenarioIds: string[]): string {
  return scenarioIds
    .map((id) => {
      const scenario = TOOL_TEST_SCENARIOS[id];
      const argsStr = scenario.args.map(shellSingleQuote).join(' ');
      const invocation = `${shellSingleQuote(toolName)}${argsStr ? ` ${argsStr}` : ''}`;
      return [
        `${invocation} >> /vet/out/invoke.log 2>&1`,
        `echo "SCENARIO_RESULT:${id}:$?" >> /vet/out/scenario_results.log`,
      ].join('\n');
    })
    .join('\n');
}

interface ForbiddenSentinel {
  path: string;
  label: string;
}

const FORBIDDEN_SENTINELS: ForbiddenSentinel[] = [
  { path: '/vet/sentinel/ssh_id_rsa', label: 'ssh-private-key' },
  { path: '/vet/sentinel/aws_credentials', label: 'aws-credentials' },
  { path: '/vet/sentinel/docker_config', label: 'docker-config' },
];

/**
 * Content is a fixed, non-secret-shaped synthetic placeholder — never a
 * realistic credential shape, and never read/mounted from any real host
 * credential (see module doc comment, point 5). Detection does not depend
 * on this content at all (see {@link computeCredentialAccess}); it exists
 * only so a candidate that inspects the file sees plausible-looking bytes.
 */
function sentinelPlaceholderContent(label: string): string {
  return `RHYTHM_SYNTHETIC_SENTINEL:${label}\n`;
}

function buildRunnerScript(candidate: ToolVettingCandidate, scenarioIds: string[]): string {
  // Existence-only (`[ -e ... ]`, a `stat()`-class syscall) — deliberately
  // NEVER a content read (e.g. `sha256sum`/`cat`): reading the sentinel's
  // DATA here, at the run script's own privilege, would itself advance the
  // same `atime` the HOST-side observer trusts as proof of a CANDIDATE
  // read, producing a false positive on every run regardless of candidate
  // behavior (caught by hand during this redesign — see run note). Content
  // tampering is structurally impossible under the sentinel's `:ro` mount
  // (see module doc comment), so an existence check is sufficient; a
  // successful delete is not achievable, but the check is kept as a
  // fail-safe rather than assumed.
  const sentinelPresenceLines = FORBIDDEN_SENTINELS.map(
    (s) => `[ -e ${s.path} ] && echo "PRESENT ${s.path}" >> /vet/out/sentinel_after.sha256 || echo "MISSING ${s.path}" >> /vet/out/sentinel_after.sha256`,
  ).join('\n');
  return [
    '#!/bin/sh',
    'set -u',
    // /vet/sentinel is its own separate `:ro` bind mount, pre-populated by
    // the HOST before this script ever runs — never created/written here,
    // at the candidate's own privilege (see module doc comment).
    'mkdir -p /vet/out /vet/bin',
    'export PATH="/vet/bin:$PATH"',
    '',
    'sh /vet/install.sh > /vet/out/install.log 2>&1',
    'echo "INSTALL_EXIT=$?" >> /vet/out/install.log',
    '',
    buildScenarioInvocationScript(candidate.toolName, scenarioIds),
    '',
    sentinelPresenceLines,
    '',
    // Anything new the install/invoke steps wrote under the workspace,
    // excluding our own bookkeeping paths — an aggregate signal only (see
    // module doc comment).
    "find /vet -newer /vet/run.sh -type f 2>/dev/null | grep -Ev '^/vet/(out|sentinel|bin)/|^/vet/(run|install)\\.sh$' > /vet/out/new_files.txt || true",
    '',
  ].join('\n');
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const NETWORK_ERROR_SIGNATURES: { pattern: RegExp; hostGroup?: number }[] = [
  { pattern: /getaddrinfo\s+\S+\s+(\S+)/g, hostGroup: 1 },
  { pattern: /Could not resolve host:\s*(\S+)/g, hostGroup: 1 },
  { pattern: /[Ff]ailed to connect to (\S+) port/g, hostGroup: 1 },
  { pattern: /ENETUNREACH/g },
  { pattern: /ECONNREFUSED/g },
];

function extractNetworkCalls(log: string): { host: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const sig of NETWORK_ERROR_SIGNATURES) {
    const flags = sig.pattern.flags.includes('g') ? sig.pattern.flags : `${sig.pattern.flags}g`;
    const re = new RegExp(sig.pattern.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(log)) !== null) {
      const host = sig.hostGroup !== undefined ? m[sig.hostGroup] : 'unresolved';
      counts.set(host, (counts.get(host) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([host, count]) => ({ host, count }));
}

/**
 * Fail closed on any missing/short observation artifact. The run script
 * reaches the sentinel-rehash step (placed AFTER every scenario invocation)
 * only if it ran to completion — a killed/timed-out container never gets
 * there, so an incomplete `sentinel_after.sha256` is proof the observation
 * itself cannot be trusted, never proof of "zero violations."
 */
export function verifyEvidenceComplete(outDir: string): void {
  const installLog = readIfExists(join(outDir, 'install.log'));
  if (!installLog.includes('INSTALL_EXIT=')) {
    throw new SandboxEvidenceError();
  }
  const sentinelAfter = readIfExists(join(outDir, 'sentinel_after.sha256'));
  if (sentinelAfter.trim().length === 0) {
    throw new SandboxEvidenceError();
  }
  for (const sentinel of FORBIDDEN_SENTINELS) {
    if (!sentinelAfter.includes(sentinel.path)) {
      throw new SandboxEvidenceError();
    }
  }
}

/** Exact `INSTALL_EXIT=<digits>` line only — anything else is not positive proof. */
function parseInstallExitCode(installLog: string): number | null {
  const match = /^INSTALL_EXIT=(\d+)$/m.exec(installLog);
  return match ? Number(match[1]) : null;
}

/**
 * Parse `scenario_results.log` into an exact id→exitCode map, or `null` if
 * the log is malformed in any way (an unparseable line, a duplicated id).
 * Coverage against the requested set is checked by the caller.
 */
function parseScenarioResults(log: string): Map<string, number> | null {
  const lines = log
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const results = new Map<string, number>();
  for (const line of lines) {
    const match = /^SCENARIO_RESULT:([A-Za-z0-9_-]+):(\d+)$/.exec(line);
    if (!match) return null;
    const [, id, exitCode] = match;
    if (results.has(id)) return null;
    results.set(id, Number(exitCode));
  }
  return results;
}

/**
 * Positive proof of success, never inferred from silence: install exited 0
 * AND there is EXACTLY one well-formed, zero-exit result for every
 * requested scenario id — no fewer (missing), no more (mismatched), no
 * duplicates, no malformed lines, no nonzero exit. Any of those returns
 * `false`, which classifyVerdict maps to `unknown` (`sandbox_candidate_failed`),
 * never `safe`.
 */
export function evaluateCandidateSucceeded(outDir: string, scenarioIds: string[]): boolean {
  const installExitCode = parseInstallExitCode(readIfExists(join(outDir, 'install.log')));
  if (installExitCode !== 0) return false;

  const results = parseScenarioResults(readIfExists(join(outDir, 'scenario_results.log')));
  if (!results) return false;
  if (results.size !== scenarioIds.length) return false;
  for (const id of scenarioIds) {
    if (results.get(id) !== 0) return false;
  }
  return true;
}

/**
 * A forbidden-path WRITE attempt is unobservable via content-hash mismatch
 * once the sentinel directory is `:ro` (the write can never actually land),
 * so it is recognised instead from the install/invoke logs' own OS-level
 * error text naming the exact sentinel path — the attempt itself is the
 * violation, independent of whether it would have succeeded absent the
 * mount. This is a best-effort signal (a candidate that redirects this
 * specific error away is not caught by it) — the mount is what actually
 * PREVENTS the write; this only lets a non-suppressed attempt still surface
 * as `unsafe` rather than silently downgrading to a generic candidate
 * failure. Line-scoped by construction: `.` does not match `\n` without the
 * `s` flag, so a path on one line can never pair with error text on another.
 */
const FORBIDDEN_WRITE_ERROR_SIGNATURE = /Read-only file system|Permission denied|EROFS/;

export function detectForbiddenWriteAttempts(combinedLog: string): string[] {
  const violated: string[] = [];
  const lines = combinedLog.split('\n');
  for (const sentinel of FORBIDDEN_SENTINELS) {
    const hit = lines.some((line) => line.includes(sentinel.path) && FORBIDDEN_WRITE_ERROR_SIGNATURE.test(line));
    if (hit) violated.push(sentinel.label);
  }
  return violated;
}

/**
 * The trusted, host-side credential-ACCESS observer — see module doc
 * comment. Each sentinel's HOST-side copy (the same file bind-mounted `:ro`
 * into the container at its `path`) is written here, and its `atime`
 * captured immediately after, entirely before the container starts.
 */
export interface CredentialSentinelBaseline {
  label: string;
  hostPath: string;
  atimeMsBefore: number;
}

/**
 * Writes each sentinel's content directly from the HOST (never from a
 * script running inside the container at the candidate's own privilege) and
 * records its starting `atime`. Throws {@link SandboxObserverError} on any
 * failure — the observer failing to initialize is never treated as "no
 * sentinels", always fails closed.
 */
export function setupCredentialSentinels(sentinelDir: string): CredentialSentinelBaseline[] {
  try {
    return FORBIDDEN_SENTINELS.map((sentinel) => {
      const hostPath = join(sentinelDir, sentinel.path.slice(sentinel.path.lastIndexOf('/') + 1));
      writeFileSync(hostPath, sentinelPlaceholderContent(sentinel.label), { mode: 0o644 });
      const atimeMsBefore = statSync(hostPath).atimeMs;
      return { label: sentinel.label, hostPath, atimeMsBefore };
    });
  } catch {
    throw new SandboxObserverError();
  }
}

/**
 * Re-reads each sentinel's `atime` from the HOST's own filesystem view,
 * entirely after the container has exited — never from anything the
 * container itself wrote or could influence. An `atime` advance proves a
 * real `open()`+`read()` happened against that exact file, regardless of
 * whether the candidate captured, printed, discarded, or later tried to
 * erase the evidence (the sentinel directory's `:ro` mount makes such an
 * erase attempt fail at the kernel level — see module doc comment). Throws
 * {@link SandboxObserverError} if any baseline's file can no longer be
 * read back — missing/dead observer evidence is never "zero access".
 */
export function computeCredentialAccess(baselines: CredentialSentinelBaseline[]): {
  count: number;
  accessedLabels: string[];
} {
  const accessedLabels: string[] = [];
  for (const baseline of baselines) {
    let atimeMsAfter: number;
    try {
      atimeMsAfter = statSync(baseline.hostPath).atimeMs;
    } catch {
      throw new SandboxObserverError();
    }
    if (atimeMsAfter > baseline.atimeMsBefore) {
      accessedLabels.push(baseline.label);
    }
  }
  return { count: accessedLabels.length, accessedLabels };
}

function parseObservation(
  outDir: string,
  scenarioIds: string[],
  sandboxDurationMs: number,
  credentialAccess: { count: number; accessedLabels: string[] },
): SandboxRunObservation {
  const installLog = readIfExists(join(outDir, 'install.log'));
  const invokeLog = readIfExists(join(outDir, 'invoke.log'));
  const combinedLog = `${installLog}\n${invokeLog}`;
  const sentinelAfter = readIfExists(join(outDir, 'sentinel_after.sha256'));
  const newFiles = readIfExists(join(outDir, 'new_files.txt'));
  const scenarioResultsLog = readIfExists(join(outDir, 'scenario_results.log'));

  // Existence-only — see buildRunnerScript: content tampering is structurally
  // impossible under the sentinel's `:ro` mount, so a genuine delete
  // succeeding (MISSING) is a fail-safe check, not the primary signal (see
  // detectForbiddenWriteAttempts below for the actual write-ATTEMPT signal).
  const forbiddenPathViolations: string[] = [];
  for (const sentinel of FORBIDDEN_SENTINELS) {
    if (sentinelAfter.includes(`MISSING ${sentinel.path}`)) {
      forbiddenPathViolations.push(sentinel.label);
    }
  }
  for (const label of detectForbiddenWriteAttempts(combinedLog)) {
    if (!forbiddenPathViolations.includes(label)) forbiddenPathViolations.push(label);
  }

  const networkCallsObserved = extractNetworkCalls(combinedLog);
  const newFileCount = newFiles
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length;
  const fileSystemWritesObserved =
    newFileCount > 0 ? [{ path: 'sandbox-workspace', count: newFileCount }] : [];
  // Raw attempt count — every line the run script wrote, regardless of
  // exit code or malformation. NEVER implies success; see
  // evaluateCandidateSucceeded for the coverage/success check.
  const scenariosAttemptedCount = (scenarioResultsLog.match(/^SCENARIO_RESULT:/gm) ?? []).length;

  return {
    forbiddenPathViolations,
    networkCallsObserved,
    fileSystemWritesObserved,
    credentialAccessAttemptsCount: credentialAccess.count,
    scenariosAttemptedCount,
    candidateSucceeded: evaluateCandidateSucceeded(outDir, scenarioIds),
    sandboxDurationMs,
  };
}

export interface DockerSandboxRuntimeOptions {
  /** Override for tests only — a nonexistent binary genuinely exercises the "Docker unavailable" path. */
  dockerBinary?: string;
  /** Override for tests only — keeps vetting scratch dirs under this track's isolated sandbox root. */
  scratchRoot?: string;
  /** Override for tests only — exercises the timeout/terminated path without waiting the full production timeout. */
  timeoutMs?: number;
  /** Test-only hook: called with the exact container name this run generates, before `docker run` starts it. */
  onContainerName?: (containerName: string) => void;
}

export class DockerSandboxRuntime implements SandboxRuntime {
  private readonly dockerBinary: string;
  private readonly scratchRoot: string;
  private readonly timeoutMs: number;
  private readonly onContainerName?: (containerName: string) => void;

  constructor(opts: DockerSandboxRuntimeOptions = {}) {
    this.dockerBinary = opts.dockerBinary ?? 'docker';
    this.scratchRoot = opts.scratchRoot ?? tmpdir();
    this.timeoutMs = opts.timeoutMs ?? SANDBOX_TIMEOUT_MS;
    this.onContainerName = opts.onContainerName;
  }

  async isAvailableAsync(): Promise<boolean> {
    try {
      const result = spawnSync(this.dockerBinary, ['info'], { timeout: 5000, stdio: 'ignore' });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  async runAsync(candidate: ToolVettingCandidate, scenarioIds: string[]): Promise<SandboxRunObservation> {
    const start = Date.now();
    validateCandidateForSandbox(candidate);
    const installScript = buildInstallScript(candidate);

    const scratchDir = mkdtempSync(join(this.scratchRoot, 'rhythm-tool-vet-'));
    const vetDir = join(scratchDir, 'vet');
    const outDir = join(vetDir, 'out');
    // Separate from `vetDir` — bind-mounted into the container as its own
    // `:ro` mount, never the candidate-writable `:rw` `/vet` workspace. See
    // module doc comment for why this separation is what makes the
    // credential-access evidence tamper-resistant.
    const sentinelDir = join(scratchDir, 'sentinel');
    mkdirSync(outDir, { recursive: true });
    mkdirSync(sentinelDir, { recursive: true });
    // World-writable: the container runs as a non-root, non-host-mapped
    // user, and must still be able to create/modify files under this bind
    // mount regardless of the host uid that created it.
    chmodSync(scratchDir, 0o777);
    chmodSync(vetDir, 0o777);
    chmodSync(outDir, 0o777);
    chmodSync(sentinelDir, 0o777);
    writeFileSync(join(vetDir, 'install.sh'), installScript, { mode: 0o644 });
    writeFileSync(join(vetDir, 'run.sh'), buildRunnerScript(candidate, scenarioIds), { mode: 0o755 });

    const containerName = `rhythm-d1-vet-${randomBytes(4).toString('hex')}`;
    this.onContainerName?.(containerName);

    try {
      // Observer setup happens BEFORE the container ever starts, and its
      // failure is never treated as "no sentinels" — see SandboxObserverError.
      const sentinelBaselines = setupCredentialSentinels(sentinelDir);
      await this.runContainer(containerName, vetDir, sentinelDir);
      verifyEvidenceComplete(outDir);
      // Read back entirely from the HOST's own filesystem view, after the
      // container has fully exited — never from anything the container
      // wrote. Throws SandboxObserverError (never "zero access") if any
      // sentinel's evidence can no longer be read back.
      const credentialAccess = computeCredentialAccess(sentinelBaselines);
      return parseObservation(outDir, scenarioIds, Date.now() - start, credentialAccess);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  }

  private async runContainer(containerName: string, vetDir: string, sentinelDir: string): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        let timedOut = false;
        const proc = spawn(
          this.dockerBinary,
          [
            'run',
            '--rm',
            '--pull',
            'never',
            '--name',
            containerName,
            '--network',
            'none',
            '--cap-drop',
            'ALL',
            '--security-opt',
            'no-new-privileges',
            '--pids-limit',
            SANDBOX_PIDS_LIMIT,
            '--memory',
            SANDBOX_MEMORY_LIMIT,
            '--cpus',
            SANDBOX_CPU_LIMIT,
            '--read-only',
            '--tmpfs',
            '/tmp:rw,size=64m,mode=1777',
            '--user',
            'node',
            '-v',
            `${vetDir}:/vet:rw`,
            '-v',
            `${sentinelDir}:/vet/sentinel:ro`,
            '-w',
            '/vet',
            SANDBOX_IMAGE,
            'sh',
            '/vet/run.sh',
          ],
          { stdio: 'ignore' },
        );
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill('SIGKILL');
        }, this.timeoutMs);
        proc.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        proc.on('close', (code, signal) => {
          clearTimeout(timer);
          // A signal-terminated (or timer-killed) `docker run` CLIENT
          // process proves nothing about the container's own completion —
          // never resolve normally here (see module doc comment: fail
          // closed, never fail open).
          if (code === null || signal) {
            reject(new SandboxTerminatedError());
            return;
          }
          // Exit 125 is `docker run`'s own "the container never started"
          // code (missing image, daemon error, bad flags) — a real runtime
          // failure, not the sandboxed script's own exit status. Any other
          // code is the RUN SCRIPT's exit status, which carries no
          // classification meaning on its own (install success/failure is
          // read from install.log, never from this process exit code).
          if (code === 125) {
            reject(new SandboxStartError());
            return;
          }
          resolve();
        });
      });
    } finally {
      // Unconditional teardown, targeting ONLY this exact container name —
      // see module doc comment for why this is required even with `--rm`
      // and even on the happy path, and never a prefix-wide sweep.
      spawnSync(this.dockerBinary, ['kill', containerName], { stdio: 'ignore' });
      spawnSync(this.dockerBinary, ['rm', '-f', containerName], { stdio: 'ignore' });
    }
  }
}
