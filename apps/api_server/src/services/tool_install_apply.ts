/** D1.4 (#1429) — transactional managed installation of immutable local tools. */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { resolveManagedToolArtifactRoot, resolveManagedToolRoot } from '../config/env';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import { buildToolInstallProposalFingerprint, evaluateToolInstallSafetyAsync } from './tool_install_safety_policy';
import { LOCAL_TARBALL_INSTALL_METHOD, inspectImmutableLocalTarball, parseImmutableLocalTarballSource } from './tool_install_artifact';

export type ToolInstallApplyReason =
  | 'tool_install_apply_unavailable'
  | 'tool_install_apply_unsupported_method'
  | 'tool_install_apply_immutable_artifact_refused'
  | 'tool_install_apply_safety_refused'
  | 'tool_install_apply_conflict'
  | 'tool_install_apply_failed';

export interface ToolInstallApplyResult {
  applied: boolean;
  reason: ToolInstallApplyReason | null;
}

export type ToolInstallApplier = (proposal: AgentOrgProposal) => Promise<ToolInstallApplyResult>;

export interface ToolInstallApplyDeps {
  /** Code-owned test/sandbox roots. Never accepted from a request. */
  managedRoot?: string;
  artifactRoot?: string;
  /** Test seam only: lifecycle production callers always re-read safety. */
  skipSafetyRecheck?: boolean;
  runner?: (argv: readonly string[], cwd: string) => Promise<void>;
}

interface ManagedInstallReceipt {
  version: 1;
  proposalId: string;
  proposalFingerprint: string;
  installMethod: typeof LOCAL_TARBALL_INSTALL_METHOD;
  artifactDigest: string;
  managedRelativePath: string;
  status: 'active';
  installedAt: string;
  verifiedAt: string;
}

function inputs(proposal: AgentOrgProposal): { toolName: string; source: string; method: string } | null {
  try {
    const value = JSON.parse(proposal.changeJson ?? '') as Record<string, unknown>;
    return typeof value.toolName === 'string' && typeof value.packageSource === 'string' && typeof value.installMethod === 'string'
      ? { toolName: value.toolName, source: value.packageSource, method: value.installMethod }
      : null;
  } catch { return null; }
}

async function ownedDirectory(root: string, create = false): Promise<string | null> {
  try {
    const configured = resolve(root);
    if (create) await fs.mkdir(configured, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(configured);
    const canonical = await fs.realpath(configured);
    return stat.isDirectory() && !stat.isSymbolicLink() ? canonical : null;
  } catch { return null; }
}

function destinationName(toolName: string, digest: string): string {
  return `${toolName}-${digest.slice(0, 16)}`;
}

async function readReceipt(path: string): Promise<ManagedInstallReceipt | null> {
  try {
    const value = JSON.parse(await fs.readFile(join(path, '.rhythm-managed-install.json'), 'utf8')) as ManagedInstallReceipt;
    return value?.version === 1 && value.status === 'active' && typeof value.proposalId === 'string' &&
      typeof value.proposalFingerprint === 'string' && value.installMethod === LOCAL_TARBALL_INSTALL_METHOD &&
      /^[a-f0-9]{64}$/.test(value.artifactDigest) && typeof value.managedRelativePath === 'string' ? value : null;
  } catch { return null; }
}

function receiptMatches(receipt: ManagedInstallReceipt | null, expected: Omit<ManagedInstallReceipt, 'installedAt' | 'verifiedAt' | 'status' | 'version'>): boolean {
  return !!receipt && receipt.proposalId === expected.proposalId && receipt.proposalFingerprint === expected.proposalFingerprint &&
    receipt.installMethod === expected.installMethod && receipt.artifactDigest === expected.artifactDigest &&
    receipt.managedRelativePath === expected.managedRelativePath;
}

async function defaultRunner(argv: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(argv[0], [...argv.slice(1)], {
      cwd, env: { PATH: process.env.PATH ?? '', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' },
      stdio: 'ignore', shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error('managed installer failed')));
  });
}

function npmCliPath(): string | null {
  try { return require.resolve('npm/bin/npm-cli.js'); } catch {
    const bundled = join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    return existsSync(bundled) ? bundled : null;
  }
}

async function verifyActivated(destination: string, artifactDigest: string, toolName: string, receiptExpected: Omit<ManagedInstallReceipt, 'installedAt' | 'verifiedAt' | 'status' | 'version'>): Promise<boolean> {
  const receipt = await readReceipt(destination);
  if (!receiptMatches(receipt, receiptExpected)) return false;
  try {
    const archive = await fs.readFile(join(destination, 'artifact.tgz'));
    const { createHash } = await import('node:crypto');
    if (createHash('sha256').update(archive).digest('hex') !== artifactDigest) return false;
    const packageJson = JSON.parse(await fs.readFile(join(destination, 'node_modules', toolName, 'package.json'), 'utf8')) as { name?: unknown };
    return packageJson.name === toolName;
  } catch { return false; }
}

/**
 * Real production boundary. Registry/npm/pip proposal shapes are intentionally
 * not installed: they lack a byte identity shared by sandbox and apply.
 */
async function applyImmutableLocalTarballAsync(proposal: AgentOrgProposal, deps: ToolInstallApplyDeps): Promise<ToolInstallApplyResult> {
  const candidate = inputs(proposal);
  if (!candidate || candidate.method !== LOCAL_TARBALL_INSTALL_METHOD) {
    return { applied: false, reason: 'tool_install_apply_unsupported_method' };
  }
  const digest = parseImmutableLocalTarballSource(candidate.source);
  if (!digest) return { applied: false, reason: 'tool_install_apply_immutable_artifact_refused' };
  if (!deps.skipSafetyRecheck) {
    const safety = await evaluateToolInstallSafetyAsync(proposal);
    if (!safety.allowed) return { applied: false, reason: 'tool_install_apply_safety_refused' };
  }
  const fingerprint = buildToolInstallProposalFingerprint(proposal);
  if (!fingerprint) return { applied: false, reason: 'tool_install_apply_immutable_artifact_refused' };
  const artifact = inspectImmutableLocalTarball(deps.artifactRoot ?? resolveManagedToolArtifactRoot(), digest, candidate.toolName);
  if (!artifact) return { applied: false, reason: 'tool_install_apply_immutable_artifact_refused' };
  const root = await ownedDirectory(deps.managedRoot ?? resolveManagedToolRoot(), true);
  if (!root) return { applied: false, reason: 'tool_install_apply_failed' };
  const relativeDestination = join('tools', destinationName(candidate.toolName, digest));
  const destination = join(root, relativeDestination);
  const expected: Omit<ManagedInstallReceipt, 'installedAt' | 'verifiedAt' | 'status' | 'version'> = {
    proposalId: proposal.id, proposalFingerprint: fingerprint, installMethod: LOCAL_TARBALL_INSTALL_METHOD,
    artifactDigest: digest, managedRelativePath: relativeDestination,
  };
  try {
    const existing = await fs.lstat(destination).catch(() => null);
    if (existing) return await verifyActivated(destination, digest, candidate.toolName, expected)
      ? { applied: true, reason: null }
      : { applied: false, reason: 'tool_install_apply_conflict' };
    const stagingRoot = join(root, '.staging');
    const lockRoot = join(root, '.locks');
    await fs.mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    await fs.mkdir(lockRoot, { recursive: true, mode: 0o700 });
    const lock = join(lockRoot, `${destinationName(candidate.toolName, digest)}.lock`);
    let lockHeld = false;
    try {
      await fs.mkdir(lock, { mode: 0o700 }); lockHeld = true;
    } catch {
      return await verifyActivated(destination, digest, candidate.toolName, expected)
        ? { applied: true, reason: null }
        : { applied: false, reason: 'tool_install_apply_conflict' };
    }
    const staging = join(stagingRoot, `${destinationName(candidate.toolName, digest)}-${randomUUID()}`);
    try {
      await fs.mkdir(staging, { mode: 0o700 });
      await fs.copyFile(artifact.path, join(staging, 'artifact.tgz'), fs.constants.COPYFILE_EXCL);
      const npm = npmCliPath();
      if (!npm) throw new Error('npm cli unavailable');
      await (deps.runner ?? defaultRunner)([
        process.execPath, npm, 'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--omit=dev', '--omit=optional', './artifact.tgz',
      ], staging);
      const now = new Date().toISOString();
      const receipt: ManagedInstallReceipt = { version: 1, ...expected, status: 'active', installedAt: now, verifiedAt: now };
      await fs.writeFile(join(staging, '.rhythm-managed-install.json'), JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
      if (!(await verifyActivated(staging, digest, candidate.toolName, expected))) throw new Error('staging verification failed');
      await fs.mkdir(join(root, 'tools'), { recursive: true, mode: 0o700 });
      await fs.rename(staging, destination);
      return await verifyActivated(destination, digest, candidate.toolName, expected)
        ? { applied: true, reason: null }
        : { applied: false, reason: 'tool_install_apply_failed' };
    } catch {
      await fs.rm(staging, { recursive: true, force: true });
      return { applied: false, reason: 'tool_install_apply_failed' };
    } finally {
      if (lockHeld) await fs.rmdir(lock).catch(() => undefined);
    }
  } catch { return { applied: false, reason: 'tool_install_apply_failed' }; }
}

export async function applyVettedToolInstallAsync(
  proposal: AgentOrgProposal,
  applier?: ToolInstallApplier,
  deps: ToolInstallApplyDeps = {},
): Promise<ToolInstallApplyResult> {
  return applier ? applier(proposal) : applyImmutableLocalTarballAsync(proposal, deps);
}
