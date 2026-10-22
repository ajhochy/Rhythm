/** Copied-state tool-install lifecycle only.
 * Called from the sandboxed worker; never from the live approval path. */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { ToolSafetyReportsRepository } from '../repositories/tool_safety_reports_repository';
import { approveVettedToolInstallProposalAsync } from './tool_install_proposal_lifecycle';
import { applyVettedToolInstallAsync, inspectActivatedManagedToolAsync } from './tool_install_apply';
import { buildToolInstallProposalFingerprint } from './tool_install_safety_policy';
import { parseImmutableLocalTarballSource } from './tool_install_artifact';
import type { ToolInstallEvaluationVettingReceipt } from './org_evaluation_external_effects';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const PRIVATE_EVALUATION_OWNER_ID = 900_000_001;
export function ensurePrivateEvaluationOwner(db: Database.Database): number {
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?')
    .get(PRIVATE_EVALUATION_OWNER_ID) as { id: number; email: string } | undefined;
  if (user) {
    if (user.email !== 'disposable-owner@evaluation.invalid')
      throw Error('Private evaluation owner ID collided with copied fixture');
    return PRIVATE_EVALUATION_OWNER_ID;
  }
  db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)')
    .run(PRIVATE_EVALUATION_OWNER_ID, 'Disposable evaluation owner',
      'disposable-owner@evaluation.invalid');
  return PRIVATE_EVALUATION_OWNER_ID;
}
export function privateToolProposalId(targetRef: string, changeJson: string): string {
  return `eval-tool-${sha256(JSON.stringify({ targetRef, changeJson })).slice(0, 32)}`;
}

/** The parent supplies a Docker observation for exact immutable change bytes.
 * This function rechecks the report against the copied proposal and runs the
 * production approval+installer wholly under the worker's private roots. */
export async function applyPrivateManagedToolAsync(input: {
  db: Database.Database; workerRoot: string; targetRef: string;
  changeJson: string; vetting: ToolInstallEvaluationVettingReceipt;
}): Promise<{ proposalId: string; profileId: string; toolName: string;
  artifactDigest: string; proposalFingerprint: string; vettingReceiptHash: string }> {
  if (process.env.RHYTHM_EVALUATION_WORKER !== '1' ||
      process.env.DB_CLIENT !== 'sqlite' ||
      !input.workerRoot.startsWith('/private/tmp/') ||
      input.vetting.status !== 'observed' ||
      input.vetting.changeHash !== sha256(input.changeJson) ||
      input.vetting.receiptHash !== sha256(JSON.stringify(input.vetting.report))) {
    throw Error('Private tool evaluation lacks exact Docker proof');
  }
  const change = JSON.parse(input.changeJson) as { agentConfigId?: unknown;
    toolName?: unknown; packageSource?: unknown; installMethod?: unknown };
  const profileId = change.agentConfigId;
  const toolName = change.toolName;
  const artifactDigest = parseImmutableLocalTarballSource(change.packageSource);
  if (typeof profileId !== 'string' || typeof toolName !== 'string' ||
      input.targetRef !== `agent_config:${profileId}` ||
      change.installMethod !== 'local-tarball' || !artifactDigest) {
    throw Error('Private tool candidate target or artifact is malformed');
  }
  ensurePrivateEvaluationOwner(input.db);
  const proposals = new AgentOrgProposalsRepository(input.db);
  const reports = new ToolSafetyReportsRepository(input.db);
  const proposalId = privateToolProposalId(input.targetRef, input.changeJson);
  const proposal = await proposals.createAsync({ id: proposalId, kind: 'tool-install',
    risk: 'high', status: 'sandbox-vetted', title: 'Disposable vetted candidate',
    targetRef: input.targetRef, changeJson: input.changeJson,
    ownerUserId: PRIVATE_EVALUATION_OWNER_ID });
  const proposalFingerprint = buildToolInstallProposalFingerprint(proposal);
  if (!proposalFingerprint) throw Error('Private tool proposal failed production fingerprint');
  await reports.createAsync({ proposalId, proposalFingerprint,
    toolName, packageSource: change.packageSource as string,
    installMethod: 'local-tarball', ...input.vetting.report });
  const artifactRoot = join(input.workerRoot, 'artifacts');
  const managedRoot = join(input.workerRoot, 'managed-tools');
  mkdirSync(managedRoot, { recursive: true, mode: 0o700 });
  const applied = await approveVettedToolInstallProposalAsync(
    proposalId, PRIVATE_EVALUATION_OWNER_ID, true, { proposals, reports,
      vet: async () => { throw Error('Private copied report must be reused'); },
      installer: (approved) => applyVettedToolInstallAsync(approved, undefined,
        { artifactRoot, managedRoot }),
    });
  if (applied.status !== 'applied') throw Error('Private vetted candidate was not applied');
  const installed = await inspectActivatedManagedToolAsync(applied, profileId, { managedRoot });
  if (!installed || installed.proposalId !== proposalId || installed.agentConfigId !== profileId ||
      installed.artifactDigest !== artifactDigest || installed.toolName !== toolName) {
    throw Error('Private managed receipt differs from vetted candidate');
  }
  return { proposalId, profileId, toolName, artifactDigest,
    proposalFingerprint, vettingReceiptHash: input.vetting.receiptHash };
}

/** Semantic manifest identity. Re-verifies production receipt on every read;
 * excludes worker-private paths and installation timestamps. */
export async function readPrivateManagedToolDescriptorAsync(input: {
  db: Database.Database; workerRoot: string; targetRef: string;
  changeJson: string; baseline: boolean;
}): Promise<{ profileId: string; toolName: string; artifactDigest: string;
  proposalFingerprint: string; execution: 'offline-container' } | null> {
  const proposals = new AgentOrgProposalsRepository(input.db);
  if (input.baseline) {
    const existing = (await Promise.all(['applied', 'measuring', 'active'].map((status) =>
      proposals.listByStatusAsync(status)))).flat().filter((item) =>
      item.kind === 'tool-install' && item.targetRef === input.targetRef);
    if (existing.length) throw Error('Original copied arm contains an approved managed tool');
    return null;
  }
  const change = JSON.parse(input.changeJson) as { agentConfigId?: unknown;
    toolName?: unknown; packageSource?: unknown };
  const profileId = change.agentConfigId;
  const toolName = change.toolName;
  const digest = parseImmutableLocalTarballSource(change.packageSource);
  if (typeof profileId !== 'string' || typeof toolName !== 'string' || !digest ||
      input.targetRef !== `agent_config:${profileId}`) throw Error('Private tool manifest input changed');
  const applied = (await Promise.all(['applied', 'measuring', 'active'].map((status) =>
    proposals.listByStatusAsync(status)))).flat().filter((item) =>
      item.kind === 'tool-install' && item.targetRef === input.targetRef &&
      item.changeJson && (() => { try {
        const value = JSON.parse(item.changeJson) as { toolName?: unknown; packageSource?: unknown };
        return value.toolName === toolName && value.packageSource === change.packageSource;
      } catch { return false; } })());
  const proposalId = privateToolProposalId(input.targetRef, input.changeJson);
  const proposal = applied.find((item) => item.id === proposalId);
  if (!proposal || applied.length !== 1) throw Error('Copied managed candidate is not uniquely applied');
  const fingerprint = buildToolInstallProposalFingerprint(proposal);
  const installed = await inspectActivatedManagedToolAsync(proposal, profileId,
    { managedRoot: join(input.workerRoot, 'managed-tools') });
  if (!fingerprint || !installed || installed.artifactDigest !== digest ||
      installed.toolName !== toolName || installed.agentConfigId !== profileId)
    throw Error('Copied managed install receipt changed');
  return { profileId, toolName, artifactDigest: digest,
    proposalFingerprint: fingerprint, execution: 'offline-container' };
}
