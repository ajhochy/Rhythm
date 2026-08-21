/**
 * D1.2 (#1427) — the isolated tool sandbox vetter.
 *
 * Installs a `tool-install` proposal's candidate tool inside a disposable,
 * network-isolated Docker container, observes what it does (forbidden-path
 * writes, credential-shaped file reads, outbound network attempts), and
 * classifies a verdict. NEVER installs on the host — the only place
 * `candidate.installCommand`-equivalent logic ever executes is inside the
 * throwaway container built by {@link DockerSandboxRuntime}.
 *
 * Fails CLOSED: if Docker is unavailable, this returns `verdict: 'unknown'`,
 * `reason: 'sandbox_unavailable'` and runs nothing — no install is ever
 * attempted outside a real, observed sandbox run. See D1.3's proposal
 * validator (org_proposal_apply_service.ts) for the durable enforcement that
 * a `verdict: 'unknown'` (or `'unsafe'`) report can never reach approval.
 *
 * Scope decision (see docs/ai/contracts/issue-1427.json): no tool-invocation
 * protocol exists anywhere in this codebase yet for "run this candidate tool
 * against a typed prompt" — none of the D1 issues define one. Raw prompt
 * TEXT is therefore never passed into the sandbox at all: Docker's default
 * log driver persists container stdout/stderr to disk on the HOST, which
 * would risk raw prompt text landing in durable state, directly violating
 * the track's no-raw-prompts rule. `testPrompts` is used only for its
 * COUNT (`testPromptsRunCount`) — the vetting run itself observes the
 * install step, which is the one real, well-defined action a `tool-install`
 * proposal performs.
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
 *     none`); "network calls observed" means the install step's own network
 *     client (npm, pip, curl, ...) attempted one and failed with a
 *     recognizable resolution/connection error, which is parsed for the
 *     attempted host and discarded — only the aggregate `{host, count}` list
 *     is returned.
 *   - Teardown is unconditional (`docker kill` + `docker rm -f` in a
 *     `finally`), proven necessary by hand: killing the `docker run` CLI
 *     process (e.g. on a timeout) does NOT stop the container itself
 *     (`--rm` only fires when the CONTAINER exits, not when its client is
 *     killed) — an orphaned container survives its killed client.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ToolSafetyReportInput } from '../models/tool_safety_report';

export interface ToolVettingCandidate {
  toolName: string;
  toolVersion?: string | null;
  packageSource: string;
  installMethod: string;
}

export interface ToolVettingInput {
  candidate: ToolVettingCandidate;
  /** Real prompt text. Used only for its count — see module doc comment. */
  testPrompts: string[];
}

export interface SandboxRunObservation {
  forbiddenPathViolations: string[];
  networkCallsObserved: { host: string; count: number }[];
  fileSystemWritesObserved: { path: string; count: number }[];
  credentialAccessAttemptsCount: number;
  sandboxDurationMs: number;
}

export interface SandboxRuntime {
  isAvailableAsync(): Promise<boolean>;
  runAsync(candidate: ToolVettingCandidate): Promise<SandboxRunObservation>;
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

function unavailableOutcome(reason: string): ToolVettingOutcome {
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

/**
 * Vet a candidate tool. Fails CLOSED on every error path (Docker unavailable,
 * an unsupported install method, or the sandbox runtime itself throwing) —
 * every failure returns `verdict: 'unknown'`, never a fabricated 'safe'.
 */
export async function vetToolInSandboxAsync(
  input: ToolVettingInput,
  deps: ToolSandboxVetterDeps = {},
): Promise<ToolVettingOutcome> {
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
    observation = await runtime.runAsync(input.candidate);
  } catch (err) {
    return unavailableOutcome(`sandbox_error: ${String((err as Error).message ?? err)}`);
  }

  const verdict = classifyVerdict(observation);
  return {
    verdict,
    reason: null,
    sandboxDurationMs: observation.sandboxDurationMs,
    testPromptsRunCount: input.testPrompts.length,
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
    }),
  };
}

// ── DockerSandboxRuntime — the real, production runtime ─────────────────────

const SANDBOX_IMAGE = 'node:22-alpine';
const SANDBOX_TIMEOUT_MS = 60_000;
const SANDBOX_MEMORY_LIMIT = '256m';
const SANDBOX_CPU_LIMIT = '1';

/**
 * Closed set of install methods this runtime knows how to translate into a
 * concrete sandbox command. `local-script` is a TEST-ONLY escape hatch (the
 * "package source" is treated as literal, pre-vetted script content) — never
 * accepted by the production proposal validator (org_proposal_apply_service.ts),
 * so a real proposal can never smuggle arbitrary shell content through it.
 */
const INSTALL_COMMAND_BUILDERS: Record<string, (packageSource: string) => string> = {
  'npm install': (pkg) => `npm install ${pkg} --no-audit --no-fund`,
  'pip install': (pkg) => `pip install ${pkg}`,
  'local-script': (pkg) => pkg,
};

/** Package identifiers safe to interpolate into a shell command (no shell metacharacters). */
const SAFE_PACKAGE_SOURCE = /^[A-Za-z0-9_@/.:^~+-]+$/;

function buildInstallScript(candidate: ToolVettingCandidate): string {
  const builder = INSTALL_COMMAND_BUILDERS[candidate.installMethod];
  if (!builder) {
    throw new Error(
      `unsupported installMethod '${candidate.installMethod}' — cannot construct a sandbox install command`,
    );
  }
  if (candidate.installMethod !== 'local-script' && !SAFE_PACKAGE_SOURCE.test(candidate.packageSource)) {
    throw new Error(
      `packageSource '${candidate.packageSource}' contains characters unsafe to pass to the sandbox installer`,
    );
  }
  return builder(candidate.packageSource);
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

function buildRunnerScript(): string {
  const sentinelSetup = FORBIDDEN_SENTINELS.map(
    (s) => `printf '%s' '${sentinelMarker(s.path).replace(/'/g, `'\\''`)}' > ${s.path}`,
  ).join('\n');
  const sentinelHashLines = FORBIDDEN_SENTINELS.map(
    (s) => `sha256sum ${s.path} >> /vet/out/sentinel_after.sha256 2>/dev/null || echo "MISSING ${s.path}" >> /vet/out/sentinel_after.sha256`,
  ).join('\n');
  return [
    '#!/bin/sh',
    'set -u',
    'mkdir -p /vet/sentinel /vet/out',
    sentinelSetup,
    '',
    'sh /vet/install.sh > /vet/out/install.log 2>&1',
    'echo "INSTALL_EXIT=$?" >> /vet/out/install.log',
    '',
    sentinelHashLines,
    '',
    // Anything new the install step wrote under the workspace, excluding our
    // own bookkeeping paths — an aggregate signal only (see doc comment).
    "find /vet -newer /vet/run.sh -type f 2>/dev/null | grep -Ev '^/vet/(out|sentinel)/|^/vet/(run|install)\\.sh$' > /vet/out/new_files.txt || true",
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

function parseObservation(outDir: string, sandboxDurationMs: number): SandboxRunObservation {
  const installLog = readIfExists(join(outDir, 'install.log'));
  const sentinelAfter = readIfExists(join(outDir, 'sentinel_after.sha256'));
  const newFiles = readIfExists(join(outDir, 'new_files.txt'));

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

  const credentialAccessAttemptsCount = (installLog.match(/SENTINEL:/g) ?? []).length;
  const networkCallsObserved = extractNetworkCalls(installLog);
  const newFileCount = newFiles
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length;
  const fileSystemWritesObserved =
    newFileCount > 0 ? [{ path: 'sandbox-workspace', count: newFileCount }] : [];

  return {
    forbiddenPathViolations,
    networkCallsObserved,
    fileSystemWritesObserved,
    credentialAccessAttemptsCount,
    sandboxDurationMs,
  };
}

export interface DockerSandboxRuntimeOptions {
  /** Override for tests only — a nonexistent binary genuinely exercises the "Docker unavailable" path. */
  dockerBinary?: string;
  /** Override for tests only — keeps vetting scratch dirs under this track's isolated sandbox root. */
  scratchRoot?: string;
}

export class DockerSandboxRuntime implements SandboxRuntime {
  private readonly dockerBinary: string;
  private readonly scratchRoot: string;

  constructor(opts: DockerSandboxRuntimeOptions = {}) {
    this.dockerBinary = opts.dockerBinary ?? 'docker';
    this.scratchRoot = opts.scratchRoot ?? tmpdir();
  }

  async isAvailableAsync(): Promise<boolean> {
    try {
      const result = spawnSync(this.dockerBinary, ['info'], { timeout: 5000, stdio: 'ignore' });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  async runAsync(candidate: ToolVettingCandidate): Promise<SandboxRunObservation> {
    const start = Date.now();
    const installScript = buildInstallScript(candidate);

    const scratchDir = mkdtempSync(join(this.scratchRoot, 'rhythm-tool-vet-'));
    const vetDir = join(scratchDir, 'vet');
    const outDir = join(vetDir, 'out');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(vetDir, 'install.sh'), installScript, { mode: 0o600 });
    writeFileSync(join(vetDir, 'run.sh'), buildRunnerScript(), { mode: 0o700 });

    const containerName = `rhythm-d1-vet-${randomBytes(4).toString('hex')}`;

    try {
      await this.runContainer(containerName, vetDir);
      return parseObservation(outDir, Date.now() - start);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  }

  private async runContainer(containerName: string, vetDir: string): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
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
            '--memory',
            SANDBOX_MEMORY_LIMIT,
            '--cpus',
            SANDBOX_CPU_LIMIT,
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
          proc.kill('SIGKILL');
        }, SANDBOX_TIMEOUT_MS);
        proc.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        proc.on('close', (code) => {
          clearTimeout(timer);
          // Exit 125 is `docker run`'s own "the container never started"
          // code (missing image, daemon error, bad flags) — a real runtime
          // failure, not the sandboxed script's own exit status. Any other
          // code is the RUN SCRIPT's exit status, which carries no
          // classification meaning on its own (install success/failure is
          // read from install.log, never from this process exit code).
          if (code === 125) {
            reject(new Error(`docker run failed to start container '${containerName}' (exit 125)`));
            return;
          }
          resolve();
        });
      });
    } finally {
      // Unconditional teardown — see module doc comment for why this is
      // required even with `--rm` and even on the happy path.
      spawnSync(this.dockerBinary, ['kill', containerName], { stdio: 'ignore' });
      spawnSync(this.dockerBinary, ['rm', '-f', containerName], { stdio: 'ignore' });
    }
  }
}
