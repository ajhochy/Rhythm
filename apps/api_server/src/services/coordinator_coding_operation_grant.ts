import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, dirname, basename, sep } from 'node:path';
import { parseCodingExecutionProposal, type CoordinatorCodingExecutionProposal } from '../contracts/coordinator_coding_execution_contract';
import type { AgentApproval } from '../repositories/agent_approvals_repository';
import { readWorkflowProposal, workflowProposalDigest } from './chat_bounded_workflow';

/** Server-only inputs from the existing journal's immutable child binding. No model tool accepts this. */
export interface CodingOperationBinding {
  approvalId: string; proposalDigest: string; rootLocalId: string; rootSdkId: string;
  managerLocalId: string; managerSdkId: string; workerLocalId: string; workerSdkId: string;
  taskStartedAt: string; workerStartedAt: string; revokedAt: string | null;
}

/** Integration seam: common CURRENT authority resolver supplies these, not cached engine permission state. */
export interface CurrentCodingOperationAuthority {
  ownerUserId: number; projectId: string; rootLocalId: string; rootSdkId: string;
  managerLocalId: string; managerSdkId: string; managerParentLocalId: string;
  workerLocalId: string; workerSdkId: string; workerParentLocalId: string;
  rootMode: 'plan'; managerMode: 'plan'; workerMode: 'default';
  proposal: CoordinatorCodingExecutionProposal;
  goalActive: boolean; projectAccessible: boolean; profilesEligible: boolean;
  paused: boolean; cancelled: boolean;
  usageTokens: number | null;
  // Existing shared resolver/profile helper must intersect native/profile/admin/tool hard denies.
  // This module intentionally implements NO generic permission inheritance or wildcard evaluator.
  effectiveAction: 'allow' | 'ask' | 'deny' | 'unknown';
  toolAllowed: boolean;
  exactWorkerPlanException: boolean;
}

export type CodingProtectedOperation =
  | { kind: 'read' | 'edit' | 'write'; path: string; cwd: string; nativeTool?: string }
  | { kind: 'bash'; command: string; cwd: string; env: Record<string, unknown>; nativeTool?: string };

export type CodingOperationDecision = { reply: 'once' | 'reject'; reason: string };

function approvedPath(root: string, input: string, allowed: string[]): boolean {
  if (!input || input.includes('\\') || input.split('/').some(p => p === '..' || p === '.') || input.includes('\0')) return false;
  const absolute = isAbsolute(input) ? input : resolve(root, input);
  if (resolve(absolute) !== absolute || !allowed.includes(relative(root, absolute))) return false;
  try {
    if (realpathSync(root) !== root) return false;
    // Follow existing files, including dangling symlinks (which must reject).
    // For an absent optional worker test, only its existing trusted parent may resolve.
    let actual: string;
    try { lstatSync(absolute); actual = realpathSync(absolute); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
      try { lstatSync(absolute); return false; } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return false;
      }
      actual = resolve(realpathSync(dirname(absolute)), basename(absolute));
    }
    const rel = relative(root, actual);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) && actual === absolute;
  } catch { return false; }
}

/** Pure authority checks + actual realpath checks. Does NOT issue grants or acknowledge an SDK ask. */
export function evaluateCodingOperation(input: {
  approval: AgentApproval;
  binding: CodingOperationBinding;
  current: CurrentCodingOperationAuthority;
  localSessionId: string;
  sdkSessionId: string;
  operation: CodingProtectedOperation;
  now?: number;
}): CodingOperationDecision {
  const deny = (reason: string): CodingOperationDecision => ({ reply: 'reject', reason });
  const { approval, binding: b, current: c, operation: op } = input;
  if (!approval || !b || !op || !['read', 'edit', 'write', 'bash'].includes(op.kind)) return deny('invalid_operation');
  // Hard policy and root/manager restrictions precede all grant exceptions.
  if (!c || !c.toolAllowed || c.effectiveAction === 'deny' || c.effectiveAction === 'unknown') return deny('hard_policy');
  if (c.rootMode !== 'plan' || c.managerMode !== 'plan' || c.workerMode !== 'default' || !c.exactWorkerPlanException ||
      input.localSessionId !== b.workerLocalId || input.sdkSessionId !== b.workerSdkId ||
      input.localSessionId === b.rootLocalId || input.localSessionId === b.managerLocalId) return deny('worker_only');
  const p = readWorkflowProposal(approval);
  const current = parseCodingExecutionProposal(c.proposal);
  if (!p || p.purpose !== 'coordinator_coding_execution_v1' || !current ||
      approval.id !== b.approvalId || approval.payloadDigest !== b.proposalDigest ||
      workflowProposalDigest(p) !== b.proposalDigest || p.normalizedIntentHash !== current.normalizedIntentHash ||
      p.proposalId !== current.proposalId || p.proposedAt !== current.proposedAt || p.expiresAt !== current.expiresAt ||
      approval.status !== 'approved' || approval.actor !== `user:${p.ownerUserId}` || !approval.decidedAt ||
      approval.decisionNonce !== null || !approval.consumedAt) return deny('approval_binding');
  if (c.ownerUserId !== p.ownerUserId || c.projectId !== p.projectId ||
      b.rootLocalId !== p.sessionId || b.rootSdkId !== p.sdkSessionId ||
      c.rootLocalId !== b.rootLocalId || c.rootSdkId !== b.rootSdkId ||
      c.managerLocalId !== b.managerLocalId || c.managerSdkId !== b.managerSdkId ||
      c.workerLocalId !== b.workerLocalId || c.workerSdkId !== b.workerSdkId ||
      c.managerParentLocalId !== b.rootLocalId || c.workerParentLocalId !== b.managerLocalId ||
      new Set([b.rootLocalId, b.managerLocalId, b.workerLocalId]).size !== 3 ||
      new Set([b.rootSdkId, b.managerSdkId, b.workerSdkId]).size !== 3 ||
      ![b.rootLocalId,b.rootSdkId,b.managerLocalId,b.managerSdkId,b.workerLocalId,b.workerSdkId].every(v => typeof v === 'string' && v.length > 0)) return deny('identity_binding');
  if (!c.projectAccessible || !c.profilesEligible || !c.goalActive || c.paused || c.cancelled || b.revokedAt !== null) return deny('revoked');
  const now = input.now ?? Date.now();
  const proposed = Date.parse(p.proposedAt), expiry = Date.parse(p.expiresAt);
  const decision = Date.parse(approval.decidedAt), consumed = Date.parse(approval.consumedAt);
  const task = Date.parse(b.taskStartedAt), worker = Date.parse(b.workerStartedAt);
  if (![now,proposed,expiry,decision,consumed,task,worker].every(Number.isFinite) ||
      proposed > decision || decision > consumed || consumed > task || task > worker || worker > now ||
      now >= Math.min(expiry, task + 600_000, worker + 300_000)) return deny('expired');
  if (!Number.isSafeInteger(c.usageTokens) || c.usageTokens === null || c.usageTokens < 0 ||
      c.usageTokens >= p.limits.totalSoftTokens) return deny('usage_hold');
  if (op.cwd !== p.workspace.canonicalRoot) return deny('workspace');
  try { if (realpathSync(op.cwd) !== p.workspace.canonicalRoot) return deny('workspace'); }
  catch { return deny('workspace'); }
  if (op.kind === 'bash') {
    if (op.command !== p.command.shellCommand || !op.env || typeof op.env !== 'object' || Array.isArray(op.env) || Object.keys(op.env).length !== 0) return deny('command_scope');
  } else if (!approvedPath(p.workspace.canonicalRoot, op.path, (op.kind==='read'?p.workspace.readablePaths:p.workspace.writablePaths))) return deny('write_scope');
  return { reply: 'once', reason: 'exact_current_coding_worker_operation' };
}
