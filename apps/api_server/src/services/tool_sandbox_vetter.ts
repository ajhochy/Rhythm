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
 * container, or incomplete/corrupt observation evidence all return
 * `verdict: 'unknown'` with a FIXED, code-owned reason string. NONE of
 * these paths can ever resolve to `'safe'` — a partial or ambiguous
 * observation is evidence of nothing, not evidence of safety. See D1.3's
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
 *   - Credential ACCESS attempts (reads) are detected by counting how many
 *     times a sentinel's marker text appears in the captured install output
 *     — a `cat`/read of a sentinel file prints its content to stdout/stderr,
 *     which the run script redirects into a log file this module parses (and
 *     then discards — only the aggregate count is ever returned).
 *   - Network calls are always refused at the kernel level (`--network
 *     none`); "network calls observed" means the install/invocation step's
 *     own network client (npm, pip, curl, the candidate itself, ...)
 *     attempted one and failed with a recognizable resolution/connection
 *     error, which is parsed for the attempted host and discarded — only
 *     the aggregate `{host, count}` list is returned.
 *   - Each selected scenario is genuinely invoked as a SEPARATE command
 *     inside the container (`<toolName> <scenario args>`), unconditionally
 *     followed by a fixed, non-sensitive completion marker
 *     (`SCENARIO_ATTEMPTED:<id>`) — `testPromptsRunCount` is the number of
 *     markers actually observed after the run, never the requested array
 *     length, so a container killed mid-run under-counts rather than lying.
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
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

function classifyVerdict(observation: SandboxRunObservation): 'safe' | 'conditional' | 'unsafe' {
  if (observation.forbiddenPathViolations.length > 0) return 'unsafe';
  if (observation.networkCallsObserved.length > 0) return 'conditional';
  return 'safe';
}

/** Map any thrown error to a FIXED, sanitized reason — never the exception's own message text. */
function classifyFailureReason(err: unknown): ToolVettingFailureReason {
  if (err instanceof SandboxConfigError) return err.code;
  if (err instanceof SandboxTerminatedError) return 'sandbox_terminated';
  if (err instanceof SandboxStartError) return 'sandbox_start_failed';
  if (err instanceof SandboxEvidenceError) return 'sandbox_evidence_incomplete';
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
    reason: null,
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
 * followed by a fixed completion marker — `;`, never `&&`, so one
 * scenario's non-zero exit never suppresses the next scenario's attempt or
 * its own marker. The marker carries only the closed scenario ID (never
 * candidate output), and is read back for a COUNT ONLY (see parseObservation).
 */
function buildScenarioInvocationScript(toolName: string, scenarioIds: string[]): string {
  return scenarioIds
    .map((id) => {
      const scenario = TOOL_TEST_SCENARIOS[id];
      const argsStr = scenario.args.map(shellSingleQuote).join(' ');
      const invocation = `${shellSingleQuote(toolName)}${argsStr ? ` ${argsStr}` : ''}`;
      return [
        `${invocation} >> /vet/out/invoke.log 2>&1`,
        `echo 'SCENARIO_ATTEMPTED:${id}' >> /vet/out/scenario_markers.log`,
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

function sentinelMarker(path: string): string {
  return `SENTINEL:${path}\n`;
}

function sentinelExpectedHash(path: string): string {
  return createHash('sha256').update(sentinelMarker(path)).digest('hex');
}

function buildRunnerScript(candidate: ToolVettingCandidate, scenarioIds: string[]): string {
  const sentinelSetup = FORBIDDEN_SENTINELS.map(
    (s) => `printf '%s' '${sentinelMarker(s.path).replace(/'/g, `'\\''`)}' > ${s.path}`,
  ).join('\n');
  const sentinelHashLines = FORBIDDEN_SENTINELS.map(
    (s) => `sha256sum ${s.path} >> /vet/out/sentinel_after.sha256 2>/dev/null || echo "MISSING ${s.path}" >> /vet/out/sentinel_after.sha256`,
  ).join('\n');
  return [
    '#!/bin/sh',
    'set -u',
    'mkdir -p /vet/sentinel /vet/out /vet/bin',
    'export PATH="/vet/bin:$PATH"',
    sentinelSetup,
    '',
    'sh /vet/install.sh > /vet/out/install.log 2>&1',
    'echo "INSTALL_EXIT=$?" >> /vet/out/install.log',
    '',
    buildScenarioInvocationScript(candidate.toolName, scenarioIds),
    '',
    sentinelHashLines,
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

function parseObservation(outDir: string, sandboxDurationMs: number): SandboxRunObservation {
  const installLog = readIfExists(join(outDir, 'install.log'));
  const invokeLog = readIfExists(join(outDir, 'invoke.log'));
  const combinedLog = `${installLog}\n${invokeLog}`;
  const sentinelAfter = readIfExists(join(outDir, 'sentinel_after.sha256'));
  const newFiles = readIfExists(join(outDir, 'new_files.txt'));
  const scenarioMarkers = readIfExists(join(outDir, 'scenario_markers.log'));

  const forbiddenPathViolations: string[] = [];
  for (const sentinel of FORBIDDEN_SENTINELS) {
    if (sentinelAfter.includes(`MISSING ${sentinel.path}`)) {
      forbiddenPathViolations.push(sentinel.label);
      continue;
    }
    const expected = sentinelExpectedHash(sentinel.path);
    const escapedPath = sentinel.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^([0-9a-f]{64})\\s+${escapedPath}$`, 'm').exec(sentinelAfter);
    if (match && match[1] !== expected) {
      forbiddenPathViolations.push(sentinel.label);
    }
  }

  const credentialAccessAttemptsCount = (combinedLog.match(/SENTINEL:/g) ?? []).length;
  const networkCallsObserved = extractNetworkCalls(combinedLog);
  const newFileCount = newFiles
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length;
  const fileSystemWritesObserved =
    newFileCount > 0 ? [{ path: 'sandbox-workspace', count: newFileCount }] : [];
  const scenariosAttemptedCount = (scenarioMarkers.match(/SCENARIO_ATTEMPTED:/g) ?? []).length;

  return {
    forbiddenPathViolations,
    networkCallsObserved,
    fileSystemWritesObserved,
    credentialAccessAttemptsCount,
    scenariosAttemptedCount,
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
    mkdirSync(outDir, { recursive: true });
    // World-writable: the container runs as a non-root, non-host-mapped
    // user, and must still be able to create/modify files under this bind
    // mount regardless of the host uid that created it.
    chmodSync(scratchDir, 0o777);
    chmodSync(vetDir, 0o777);
    chmodSync(outDir, 0o777);
    writeFileSync(join(vetDir, 'install.sh'), installScript, { mode: 0o644 });
    writeFileSync(join(vetDir, 'run.sh'), buildRunnerScript(candidate, scenarioIds), { mode: 0o755 });

    const containerName = `rhythm-d1-vet-${randomBytes(4).toString('hex')}`;
    this.onContainerName?.(containerName);

    try {
      await this.runContainer(containerName, vetDir);
      verifyEvidenceComplete(outDir);
      return parseObservation(outDir, Date.now() - start);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  }

  private async runContainer(containerName: string, vetDir: string): Promise<void> {
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
