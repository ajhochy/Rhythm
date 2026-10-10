import { getDb } from '../database/db';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { readWorkflowProposal, workflowProposalDigest } from './chat_bounded_workflow';
import { CoordinatorCodingGrantJournal, type CodingGrantScope } from './coordinator_coding_grant_journal';
import { evaluateCodingOperation, type CodingProtectedOperation, type CurrentCodingOperationAuthority,
  type CodingOperationBinding, type CodingOperationDecision } from './coordinator_coding_operation_grant';
import type { CoordinatorCodingExecutionProposal } from '../contracts/coordinator_coding_execution_contract';

/** Grant-specific integration, NOT a second parent-policy resolver. No HTTP/model setter. */
export type CodingGrantAuthorityResolver = (input: {
  scope: CodingGrantScope; binding: CodingOperationBinding; operation: CodingProtectedOperation;
}) => CurrentCodingOperationAuthority | null;
let resolveCurrentAuthority: CodingGrantAuthorityResolver | null = null;
export type CodingGrantAdmissionResolver = (input: { scope: CodingGrantScope; proposal: CoordinatorCodingExecutionProposal;
  role: 'manager' | 'worker'; callerLocalId: string; callerSdkId: string }) => boolean;
let resolveCurrentAdmission: CodingGrantAdmissionResolver | null = null;
export function configureCodingGrantAdmissionResolver(resolver: CodingGrantAdmissionResolver): void {
  if (resolveCurrentAdmission && resolveCurrentAdmission !== resolver) throw new Error('coding admission resolver already composed');
  resolveCurrentAdmission = resolver;
}
export function configureCodingGrantAuthorityResolver(resolver: CodingGrantAuthorityResolver): void {
  if (resolveCurrentAuthority && resolveCurrentAuthority !== resolver) throw new Error('coding grant resolver already composed');
  resolveCurrentAuthority = resolver;
}

let resolveResultAuthority: ((p:CoordinatorCodingExecutionProposal)=>boolean)|null=null;
export function configureCodingResultAuthorityResolver(resolver:(p:CoordinatorCodingExecutionProposal)=>boolean):void {
  if(resolveResultAuthority)throw new Error('coding result authority already composed');resolveResultAuthority=resolver;
}
export function codingResultAuthorityCurrent(p:CoordinatorCodingExecutionProposal):boolean {
  try{return resolveResultAuthority?.(p)===true;}catch{return false;}
}

function codingGrantSchemaPresent(): boolean {
  return (getDb().prepare('PRAGMA table_info(coordinator_conversation_commands)').all() as Array<{name:string}>)
    .some(column => column.name === 'coding_grant_json');
}

/** Called for both SSE asks and queued/recovered asks. null means ordinary, never grant. */
export function codingGrantPermission(localSessionId: string, sdkSessionId: string,
  operation: CodingProtectedOperation): CodingOperationDecision | null {
  try {
    if (!codingGrantSchemaPresent()) return null; // no grant can be persisted on an unmigrated ordinary runtime
    const rows = getDb().prepare(`SELECT root_session_id AS sessionId, command_key AS commandKey,
      owner_user_id AS ownerUserId, project_id AS projectId FROM coordinator_conversation_commands
      WHERE coding_grant_json IS NOT NULL AND (root_session_id=? OR
        json_extract(coding_grant_json,'$.manager.localId')=? OR json_extract(coding_grant_json,'$.worker.localId')=?) LIMIT 2`)
      .all(localSessionId,localSessionId,localSessionId) as CodingGrantScope[];
    if (rows.length === 0) return null;
    if (rows.length !== 1) return { reply: 'reject', reason: 'binding_ambiguous' };
    const scope = rows[0];
    const row = new CoordinatorCodingGrantJournal().read(scope);
    const approval = row ? new AgentApprovalsRepository().getById(row.state.approvalId) : null;
    const p = approval ? readWorkflowProposal(approval) : null;
    const state = row?.state;
    if (!state?.manager || !state.worker || !state.taskStartedAt || !state.workerStartedAt || !p ||
        p.purpose !== 'coordinator_coding_execution_v1' || !approval || !resolveCurrentAuthority)
      return { reply: 'reject', reason: 'coding_authority_unavailable' };
    const binding: CodingOperationBinding = { approvalId: state.approvalId, proposalDigest: state.proposalDigest,
      rootLocalId: p.sessionId, rootSdkId: p.sdkSessionId, managerLocalId: state.manager.localId,
      managerSdkId: state.manager.sdkId, workerLocalId: state.worker.localId, workerSdkId: state.worker.sdkId,
      taskStartedAt: state.taskStartedAt, workerStartedAt: state.workerStartedAt, revokedAt: state.revokedAt };
    const current = resolveCurrentAuthority({ scope, binding, operation });
    if (!current) return { reply: 'reject', reason: 'coding_authority_unavailable' };
    return evaluateCodingOperation({ approval, binding, current, operation, localSessionId, sdkSessionId });
  } catch { return { reply: 'reject', reason: 'coding_authority_unavailable' }; }
}

/** Ordinary delegate callers cannot pass grant IDs. Exact durable parent membership selects it. */
export function codingGrantDelegation(callerLocalId: string, callerSdkId: string, ownerUserId: number) {
  if (!codingGrantSchemaPresent()) return null;
  const rows = getDb().prepare(`SELECT root_session_id AS sessionId,command_key AS commandKey,
    owner_user_id AS ownerUserId,project_id AS projectId FROM coordinator_conversation_commands
    WHERE coding_grant_json IS NOT NULL AND (root_session_id=? OR json_extract(coding_grant_json,'$.manager.localId')=?
      OR json_extract(coding_grant_json,'$.worker.localId')=?) LIMIT 2`).all(callerLocalId,callerLocalId,callerLocalId) as CodingGrantScope[];
  if (rows.length === 0) return null;
  if (rows.length !== 1 || rows[0].ownerUserId !== ownerUserId) throw new Error('coding delegation held');
  const scope = rows[0];
  const journal = new CoordinatorCodingGrantJournal();
  const row = journal.read(scope);
  const approval = row ? new AgentApprovalsRepository().getById(row.state.approvalId) : null;
  const p = approval ? readWorkflowProposal(approval) : null;
  if (!row || !p || p.purpose !== 'coordinator_coding_execution_v1' || row.state.worker?.localId === callerLocalId)
    throw new Error('coding delegation held'); // workers never create descendants
  const role = callerLocalId === scope.sessionId ? 'manager' as const : 'worker' as const;
  const current = () => {
    const live = journal.read(scope);
    const decision = new AgentApprovalsRepository().getById(row.state.approvalId);
    const same = decision ? readWorkflowProposal(decision) : null;
    const parentMatches = role === 'manager' ? callerLocalId === p.sessionId && callerSdkId === p.sdkSessionId :
      live?.state.manager?.localId === callerLocalId && live.state.manager.sdkId === callerSdkId;
    const now = Date.now();
    return !!live && parentMatches && !live.state.revokedAt && decision?.status === 'approved' && !!decision.consumedAt &&
      decision.decisionNonce === null && decision.actor === `user:${ownerUserId}` && !!same && workflowProposalDigest(same) === live.state.proposalDigest &&
      now < Date.parse(p.expiresAt) && (!live.state.taskStartedAt || now < Date.parse(live.state.taskStartedAt) + 600_000) &&
      resolveCurrentAdmission?.({ scope,proposal: p,role,callerLocalId,callerSdkId }) === true;
  };
  if (!current()) throw new Error('coding delegation held');
  return { scope,proposal: p,role,current,journal };
}
