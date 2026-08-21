/** D1.4 (#1429) — transactional managed installation of immutable local tools. */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { resolveManagedToolArtifactRoot, resolveManagedToolRoot } from '../config/env';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import { buildToolInstallProposalFingerprint, evaluateToolInstallSafetyAsync } from './tool_install_safety_policy';
import { LOCAL_TARBALL_INSTALL_METHOD, inspectImmutableLocalTarball, parseImmutableLocalTarballSource, validateImmutableLocalTarballBytes } from './tool_install_artifact';
import { isSafeToolName } from './tool_install_safety';

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
  /** Test seam only: runs after source inspection and before the staging copy. */
  afterArtifactInspection?: () => Promise<void>;
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

function directlyBelow(root: string, child: string, candidate: string): boolean {
  return relative(root, candidate) === child && dirname(candidate) === root;
}

async function ownedChildDirectory(root: string, child: string, create = false, allowExisting = true): Promise<string | null> {
  const path = join(root, child);
  if (!directlyBelow(root, child, path)) return null;
  try {
    if (create) {
      try { await fs.mkdir(path, { mode: 0o700 }); }
      catch (error: unknown) { if (!allowExisting || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const stat = await fs.lstat(path);
    const canonical = await fs.realpath(path);
    return stat.isDirectory() && !stat.isSymbolicLink() && directlyBelow(root, child, canonical) ? canonical : null;
  } catch { return null; }
}

async function ownedOrdinaryFile(root: string, child: string): Promise<string | null> {
  const path = join(root, child);
  if (!directlyBelow(root, child, path)) return null;
  try {
    const stat = await fs.lstat(path);
    const canonical = await fs.realpath(path);
    return stat.isFile() && !stat.isSymbolicLink() && directlyBelow(root, child, canonical) ? canonical : null;
  } catch { return null; }
}

async function readOwnedFile(root: string, child: string): Promise<Buffer | null> {
  const path = await ownedOrdinaryFile(root, child);
  if (!path) return null;
  try { return await fs.readFile(path); } catch { return null; }
}

function destinationName(toolName: string, digest: string): string {
  return `${toolName}-${digest.slice(0, 16)}`;
}

async function readReceipt(path: string): Promise<ManagedInstallReceipt | null> {
  try {
    const bytes = await readOwnedFile(path, '.rhythm-managed-install.json');
    if (!bytes) return null;
    const value = JSON.parse(bytes.toString('utf8')) as ManagedInstallReceipt;
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

async function verifyActivated(toolsRoot: string, destinationName: string, artifactDigest: string, toolName: string, receiptExpected: Omit<ManagedInstallReceipt, 'installedAt' | 'verifiedAt' | 'status' | 'version'>): Promise<boolean> {
  const destination = await ownedChildDirectory(toolsRoot, destinationName);
  if (!destination) return false;
  const receipt = await readReceipt(destination);
  if (!receiptMatches(receipt, receiptExpected)) return false;
  try {
    const archive = await readOwnedFile(destination, 'artifact.tgz');
    if (!archive || !validateImmutableLocalTarballBytes(archive, artifactDigest, toolName)) return false;
    const nodeModules = await ownedChildDirectory(destination, 'node_modules');
    if (!nodeModules) return false;
    const packageDirectory = await ownedChildDirectory(nodeModules, toolName);
    if (!packageDirectory) return false;
    const packageJson = JSON.parse((await readOwnedFile(packageDirectory, 'package.json'))?.toString('utf8') ?? '') as { name?: unknown };
    return packageJson.name === toolName;
  } catch { return false; }
}

async function removeOwnedChild(root: string, child: string): Promise<void> {
  const path = join(root, child);
  const canonical = await ownedChildDirectory(root, child);
  if (canonical) await fs.rm(path, { recursive: true, force: true });
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
  if (!isSafeToolName(candidate.toolName)) return { applied: false, reason: 'tool_install_apply_immutable_artifact_refused' };
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
  await deps.afterArtifactInspection?.();
  const root = await ownedDirectory(deps.managedRoot ?? resolveManagedToolRoot(), true);
  if (!root) return { applied: false, reason: 'tool_install_apply_failed' };
  const tools = await ownedChildDirectory(root, 'tools', true);
  if (!tools) return { applied: false, reason: 'tool_install_apply_failed' };
  const leaf = destinationName(candidate.toolName, digest);
  const relativeDestination = join('tools', leaf);
  const destination = join(tools, leaf);
  const expected: Omit<ManagedInstallReceipt, 'installedAt' | 'verifiedAt' | 'status' | 'version'> = {
    proposalId: proposal.id, proposalFingerprint: fingerprint, installMethod: LOCAL_TARBALL_INSTALL_METHOD,
    artifactDigest: digest, managedRelativePath: relativeDestination,
  };
  try {
    const existing = await fs.lstat(destination).catch(() => null);
    if (existing) return await verifyActivated(tools, leaf, digest, candidate.toolName, expected)
      ? { applied: true, reason: null }
      : { applied: false, reason: 'tool_install_apply_conflict' };
    const stagingRoot = await ownedChildDirectory(root, '.staging', true);
    const lockRoot = await ownedChildDirectory(root, '.locks', true);
    if (!stagingRoot || !lockRoot) return { applied: false, reason: 'tool_install_apply_failed' };
    const lockName = `${leaf}.lock`;
    let lockHeld = false;
    try {
      const lock = await ownedChildDirectory(lockRoot, lockName, true, false);
      if (!lock) return { applied: false, reason: 'tool_install_apply_failed' };
      lockHeld = true;
    } catch {
      return await verifyActivated(tools, leaf, digest, candidate.toolName, expected)
        ? { applied: true, reason: null }
        : { applied: false, reason: 'tool_install_apply_conflict' };
    }
    const stagingName = `${leaf}-${randomUUID()}`;
    try {
      const staging = await ownedChildDirectory(stagingRoot, stagingName, true, false);
      if (!staging) throw new Error('staging unavailable');
      await fs.copyFile(artifact.path, join(staging, 'artifact.tgz'), fs.constants.COPYFILE_EXCL);
      const stagedArchive = await readOwnedFile(staging, 'artifact.tgz');
      if (!stagedArchive || !validateImmutableLocalTarballBytes(stagedArchive, digest, candidate.toolName)) throw new Error('staged artifact validation failed');
      await fs.writeFile(join(staging, 'package.json'), JSON.stringify({ private: true }), { mode: 0o600, flag: 'wx' });
      const npm = npmCliPath();
      if (!npm) throw new Error('npm cli unavailable');
      await (deps.runner ?? defaultRunner)([
        process.execPath, npm, 'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--omit=dev', '--omit=optional', './artifact.tgz',
      ], staging);
      const now = new Date().toISOString();
      const receipt: ManagedInstallReceipt = { version: 1, ...expected, status: 'active', installedAt: now, verifiedAt: now };
      await fs.writeFile(join(staging, '.rhythm-managed-install.json'), JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
      if (!(await verifyActivated(stagingRoot, stagingName, digest, candidate.toolName, expected))) throw new Error('staging verification failed');
      const appearedDestination = await fs.lstat(destination).catch(() => null);
      if (appearedDestination) {
        const result: ToolInstallApplyResult = await verifyActivated(tools, leaf, digest, candidate.toolName, expected)
          ? { applied: true, reason: null }
          : { applied: false, reason: 'tool_install_apply_conflict' };
        await removeOwnedChild(stagingRoot, stagingName);
        return result;
      }
      await fs.rename(staging, destination);
      return await verifyActivated(tools, leaf, digest, candidate.toolName, expected)
        ? { applied: true, reason: null }
        : { applied: false, reason: 'tool_install_apply_failed' };
    } catch {
      await removeOwnedChild(stagingRoot, stagingName);
      return { applied: false, reason: 'tool_install_apply_failed' };
    } finally {
      if (lockHeld) await removeOwnedChild(lockRoot, lockName);
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
