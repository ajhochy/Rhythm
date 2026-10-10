import type Database from 'better-sqlite3';
import { getDb } from '../database/db';
import { CoordinatorConversationsRepository, type CoordinatorConversationScope } from '../repositories/coordinator_conversations_repository';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { readWorkflowProposal, WORKFLOW_APPROVAL_ACTION, workflowProposalDigest } from './chat_bounded_workflow';
import type { CoordinatorCodingExecutionProposal } from '../contracts/coordinator_coding_execution_contract';

export type CodingGrantScope = CoordinatorConversationScope & { commandKey: string };
export interface CodingGrantState {
  schemaVersion: 1; approvalId: string; proposalDigest: string;
  manager: { localId: string; sdkId: string } | null;
  worker: { localId: string; sdkId: string } | null;
  workerReservedAt: string | null; taskStartedAt: string | null;
  workerStartedAt: string | null; revokedAt: string | null;
}

/** Additional binding on the EXISTING manager journal row, not a second ledger. */
export class CoordinatorCodingGrantJournal {
  constructor(private readonly db: Database.Database = getDb()) {}

  read(scope: CodingGrantScope): { raw: string; state: CodingGrantState } | null {
    const row = this.db.prepare(`SELECT coding_grant_json AS raw FROM coordinator_conversation_commands
      WHERE root_session_id=? AND command_key=? AND owner_user_id=? AND project_id=? AND role='manager'`)
      .get(scope.sessionId, scope.commandKey, scope.ownerUserId, scope.projectId) as { raw: string | null } | undefined;
    if (!row?.raw) return null;
    const state = JSON.parse(row.raw) as CodingGrantState;
    if (state.schemaVersion !== 1 || !state.approvalId || !/^[a-f0-9]{64}$/.test(state.proposalDigest)) throw new Error('coding binding held');
    return { raw: row.raw, state };
  }

  private cas(scope: CodingGrantScope, raw: string, state: CodingGrantState): boolean {
    return this.db.prepare(`UPDATE coordinator_conversation_commands SET coding_grant_json=?,updated_at=?
      WHERE root_session_id=? AND command_key=? AND owner_user_id=? AND project_id=? AND coding_grant_json=?`)
      .run(JSON.stringify(state), new Date().toISOString(), scope.sessionId, scope.commandKey,
        scope.ownerUserId, scope.projectId, raw).changes === 1;
  }

  /** Existing approval decision/signature boundary must have accepted the row; never signs. */
  reserveManager(scope: CodingGrantScope, approvalId: string, p: CoordinatorCodingExecutionProposal,
    current: () => boolean): 'reserved' | 'replay' | 'held' {
    try {
      return this.db.transaction(() => {
        if (this.db !== getDb()) return 'held'; // approval repository and journal must share the transaction
        if (!current() || p.sessionId !== scope.sessionId || p.ownerUserId !== scope.ownerUserId || p.projectId !== scope.projectId) return 'held';
        const approval = new AgentApprovalsRepository().getById(approvalId);
        const proposal = approval ? readWorkflowProposal(approval) : null;
        const digest = workflowProposalDigest(p);
        const now = new Date().toISOString();
        if (!approval || !proposal || proposal.purpose !== p.purpose || approval.payloadDigest !== digest ||
            approval.status !== 'approved' || approval.actor !== `user:${p.ownerUserId}` || !approval.decidedAt ||
            approval.decisionNonce !== null || Date.parse(approval.decidedAt) > Date.parse(now) || Date.parse(p.expiresAt) <= Date.parse(now)) return 'held';
        const existing = this.read(scope);
        if (existing) return existing.state.approvalId === approvalId && existing.state.proposalDigest === digest && approval.consumedAt ? 'replay' : 'held';
        if (approval.consumedAt) return 'held';
        const records = new CoordinatorConversationsRepository(this.db);
        const root = records.get(scope);
        const goal = root.kind === 'found' ? root.conversation.goals.find(g => g.id === p.goalId) : null;
        if (!goal || goal.revision !== p.goalRevision || goal.objective !== p.objective) return 'held';
        const result = records.reserveGoalDelegationAuthorized({ ...scope, goalId: p.goalId,
          expectedControlRevision: root.kind === 'found' ? root.conversation.controlRevision : 0,
          parentSdkSessionId: p.sdkSessionId, authorize: () => {
            if (!current() || this.db.prepare(`UPDATE agent_approvals SET consumed_at=? WHERE id=? AND status='approved'
              AND actor=? AND security_action=? AND payload_digest=? AND consumed_at IS NULL AND decision_nonce IS NULL AND expires_at>?`)
              .run(now,approvalId,`user:${p.ownerUserId}`,WORKFLOW_APPROVAL_ACTION,digest,now).changes !== 1) throw new Error('coding approval held');
          } });
        if (result.kind !== 'reserved') return 'held';
        const state: CodingGrantState = { schemaVersion: 1, approvalId, proposalDigest: digest, manager: null, worker: null,
          workerReservedAt: null, taskStartedAt: null, workerStartedAt: null, revokedAt: null };
        if (!current() || this.db.prepare(`UPDATE coordinator_conversation_commands SET coding_grant_json=?,approval_id=?,approval_digest=?,canonical_cwd=?
          WHERE root_session_id=? AND command_key=? AND coding_grant_json IS NULL`)
          .run(JSON.stringify(state),approvalId,digest,p.workspace.canonicalRoot,scope.sessionId,scope.commandKey).changes !== 1) throw new Error('coding binding held');
        return 'reserved';
      })();
    } catch { return 'held'; }
  }

  /** Exact manager claims the one worker slot before SDK allocation; uncertainty keeps it. */
  reserveWorker(scope: CodingGrantScope, managerLocalId: string, managerSdkId: string, current: () => boolean): boolean {
    return this.db.transaction(() => {
      const row = this.read(scope);
      if (!row || !current() || row.state.revokedAt || !row.state.taskStartedAt || row.state.workerReservedAt ||
          row.state.manager?.localId !== managerLocalId || row.state.manager.sdkId !== managerSdkId) return false;
      if (!this.cas(scope,row.raw,{ ...row.state, workerReservedAt: new Date().toISOString() })) return false;
      const inserted=this.db.prepare(`INSERT INTO coordinator_conversation_commands(root_session_id,command_key,owner_user_id,project_id,
        kind,intent_hash,replay_json,created_at,updated_at,journal_ordinal,goal_id,goal_revision,role,parent_command_key,
        attempt_ordinal,target_agent_config_id,approval_id,approval_digest,canonical_cwd,allocation_intent_at,acceptance)
        SELECT root_session_id,command_key||':worker',owner_user_id,project_id,kind,intent_hash,'{}',?,?,
          (SELECT COALESCE(MAX(journal_ordinal),0)+1 FROM coordinator_conversation_commands WHERE root_session_id=?),
          goal_id,goal_revision,'worker',command_key,1,'coding-agent',approval_id,approval_digest,canonical_cwd,?,'pending'
        FROM coordinator_conversation_commands WHERE root_session_id=? AND command_key=?`)
        .run(new Date().toISOString(),new Date().toISOString(),scope.sessionId,new Date().toISOString(),scope.sessionId,scope.commandKey);
      if(inserted.changes!==1)throw new Error('coding worker reservation insert held');
      return true;
    })();
  }

  bindChild(scope: CodingGrantScope, role: 'manager' | 'worker', localId: string, sdkId: string, cwd: string): boolean {
    return this.db.transaction(() => {
      const row = this.read(scope);
      if (!row || row.state.revokedAt || !localId || !sdkId || localId === scope.sessionId) return false;
      const existing = row.state[role];
      if (existing) return existing.localId === localId && existing.sdkId === sdkId && !!this.db.prepare('SELECT 1 FROM coordinator_conversation_commands WHERE root_session_id=? AND command_key=? AND child_session_id=? AND child_sdk_session_id=? AND canonical_cwd=?').get(scope.sessionId,role==='manager'?scope.commandKey:scope.commandKey+':worker',localId,sdkId,cwd);
      const parent = role === 'manager' ? scope.sessionId : row.state.manager?.localId;
      if (!parent || (role === 'worker' && (!row.state.workerReservedAt || localId === parent))) return false;
      const child = this.db.prepare(`SELECT 1 FROM agent_sessions WHERE id=? AND sdk_session_id=? AND parent_session_id=?
        AND owner_user_id=? AND project_id=? AND cwd=? AND permission_mode=?`)
        .get(localId,sdkId,parent,scope.ownerUserId,scope.projectId,cwd,role === 'manager' ? 'plan' : 'default');
      if (!child) return false;
      if (!this.cas(scope,row.raw,{ ...row.state, [role]: { localId, sdkId } })) return false;
      const changed=this.db.prepare(`UPDATE coordinator_conversation_commands SET child_session_id=?,child_sdk_session_id=?,canonical_cwd=?,
        replay_json=CASE WHEN role='manager' THEN json_set(replay_json,'$.childSessionId',?) ELSE replay_json END
        WHERE root_session_id=? AND command_key=? AND child_session_id IS NULL AND child_sdk_session_id IS NULL`)
        .run(localId,sdkId,cwd,localId,scope.sessionId,role === 'manager' ? scope.commandKey : scope.commandKey+':worker').changes;
      if(changed!==1)throw new Error('coding child journal association changed');return true;
    })();
  }

  startClock(scope: CodingGrantScope, role: 'manager' | 'worker', current: () => boolean): boolean {
    return this.db.transaction(() => {
      const row = this.read(scope);
      if (!row || row.state.revokedAt || !row.state[role] || !current()) return false;
      const field = role === 'manager' ? 'taskStartedAt' : 'workerStartedAt';
      if (row.state[field]) return false; // never restart a clock or authorize a retry
      return this.cas(scope,row.raw,{ ...row.state, [field]: new Date().toISOString() });
    })();
  }

  reserveManagerAllocation(scope: CodingGrantScope, current: () => boolean): boolean {
    return this.db.transaction(() => {
      const row = this.read(scope);
      if (!row || row.state.manager || row.state.revokedAt || !current()) return false;
      return this.db.prepare(`UPDATE coordinator_conversation_commands SET allocation_intent_at=?
        WHERE root_session_id=? AND command_key=? AND owner_user_id=? AND project_id=? AND allocation_intent_at IS NULL AND coding_grant_json=?`)
        .run(new Date().toISOString(),scope.sessionId,scope.commandKey,scope.ownerUserId,scope.projectId,row.raw).changes === 1;
    })();
  }

  bindDelegation(scope: CodingGrantScope, role: 'manager'|'worker', id: string): boolean {
    const key = role === 'manager' ? scope.commandKey : scope.commandKey+':worker';
    return this.db.prepare(`UPDATE coordinator_conversation_commands SET delegation_id=?,
      replay_json=CASE WHEN role='manager' THEN json_set(replay_json,'$.delegationId',?,'$.state','dispatched') ELSE replay_json END
      WHERE root_session_id=? AND command_key=?
      AND delegation_id IS NULL AND EXISTS(SELECT 1 FROM agent_async_delegations a WHERE a.id=?
        AND a.child_session_id=coordinator_conversation_commands.child_session_id)`)
      .run(id,id,scope.sessionId,key,id).changes === 1;
  }

  recordPrepared(scope: CodingGrantScope, role: 'manager'|'worker', binding: {dispatchId:string;sdkUserMessageId:string}, engine: unknown): boolean {
    const key = role === 'manager' ? scope.commandKey : scope.commandKey+':worker';
    return this.db.prepare(`UPDATE coordinator_conversation_commands SET initial_dispatch_id=?,initial_sdk_user_message_id=?,engine_identity=?,acceptance='pending'
      WHERE root_session_id=? AND command_key=? AND delegation_id IS NOT NULL AND initial_dispatch_id IS NULL AND initial_sdk_user_message_id IS NULL`)
      .run(binding.dispatchId,binding.sdkUserMessageId,JSON.stringify(engine),scope.sessionId,key).changes === 1;
  }

  recordOutcome(scope: CodingGrantScope, role: 'manager'|'worker', outcome: 'accepted'|'rejected'|'unknown'): void {
    const key = role === 'manager' ? scope.commandKey : scope.commandKey+':worker';
    this.db.prepare(`UPDATE coordinator_conversation_commands SET acceptance=?,updated_at=? WHERE root_session_id=? AND command_key=?
      AND initial_dispatch_id IS NOT NULL AND acceptance IN ('pending','unknown')`)
      .run(outcome,new Date().toISOString(),scope.sessionId,key);
  }

  recordCallbackPrepared(scope: CodingGrantScope, binding: {dispatchId:string;sdkUserMessageId:string}): boolean {
    return this.db.prepare(`UPDATE coordinator_conversation_commands SET callback_dispatch_id=?,callback_sdk_user_message_id=?,callback_acceptance='pending'
      WHERE root_session_id=? AND command_key=? AND acceptance='accepted' AND callback_dispatch_id IS NULL AND callback_sdk_user_message_id IS NULL`)
      .run(binding.dispatchId,binding.sdkUserMessageId,scope.sessionId,scope.commandKey).changes === 1;
  }

  recordCallbackOutcome(scope: CodingGrantScope, outcome: 'accepted'|'rejected'|'unknown'): void {
    this.db.prepare(`UPDATE coordinator_conversation_commands SET callback_acceptance=?,updated_at=? WHERE root_session_id=? AND command_key=?
      AND callback_dispatch_id IS NOT NULL AND callback_acceptance IN ('pending','unknown')`)
      .run(outcome,new Date().toISOString(),scope.sessionId,scope.commandKey);
  }
}
