import { codingEffortVariant } from './coordinator_coding_effort';
import { createHash } from 'node:crypto';

import {
  AgentAsyncDelegationsRepository,
} from '../repositories/agent_async_delegations_repository';
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
} from '../repositories/agent_configs_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import type { AgentSession } from '../models/agent_session';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { untrustedContext } from '../security/untrusted_fence';
import { prepareAutomaticMemoryPreface } from './automatic_memory_preface';
import type {
  CoordinatorCallbackContext,
  CoordinatorCallbackContextInput,
} from './coordinator_conversation_service';
import { getDb } from '../database/db';
import { qualifyCodingTerminal } from './coordinator_coding_terminal';
import { codingGrantDelegation, codingResultAuthorityCurrent } from './coordinator_coding_grant_permission';
import { holdCodingResultIfScoped } from './coordinator_coding_delivery_controls';
import { captureCodingSnapshot, codingSnapshotCurrent, verifyCodingSnapshot, codingEvaluatorPins,
  codingDockerPins, codingDockerRuntimeDigest } from './coordinator_coding_artifact_verifier';
import { readWorkflowProposal } from './chat_bounded_workflow';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadQualificationFixtureAuthority, qualificationApiBootId } from './qualification_fixture_authority';
import { opencodeClient, opencodeSessionMap } from './opencode_engine';
import { resolveProfileScope } from './agent_profile_scope';
import {
  AgentBridgeJobsRepository,
  type AgentBridgeJobRow,
} from '../shared_agents/delegation_jobs_repository';
import {
  isNativeWorkstreamDeliveryScope,
  projectNativeWorkstreamWake,
  renderNativeWorkstreamWake,
  type NativeWorkstreamDeliveryPolicy,
  type NativeWorkstreamDeliveryScope,
  type NativeWorkstreamWakeItem,
} from '../shared_agents/native_workstream_wake_contract';

const RESTART_RECOVERY_PARENT_LIMIT = 100;
const CALLBACK_MEMORY_QUERY_CHARS = 1_000;

/** Narrow server-composed preparer; implemented by the coordinator conversation service. */
export interface CoordinatorCallbackContextPort {
  prepare(input: CoordinatorCallbackContextInput): Promise<CoordinatorCallbackContext | null>;
}
const DISABLED_NATIVE_DELIVERY_POLICY: NativeWorkstreamDeliveryPolicy = {
  enabled: () => false,
  currentHostEpoch: () => null,
  isParentContextEligible: () => false,
};

interface NativeDeliveryContext {
  parent: AgentSession;
  parentSdkSessionId: string;
  scope: NativeWorkstreamDeliveryScope;
}

/**
 * Serializes and coalesces asynchronous child callbacks by parent session.
 *
 * Durable delivery state lives in agent_async_delegations. These maps only
 * prevent two SSE callbacks in this process from racing between the parent's
 * durable idle status and the engine's later busy event.
 */
export class AsyncDelegationCompletionService {
  private parentChains = new Map<string, Promise<void>>();
  private wakeInFlight = new Set<string>();
  private delegationsRepo = new AgentAsyncDelegationsRepository();
  private messagesRepo = new AgentSessionMessagesRepository();
  private sessionsRepo = new AgentSessionsRepository();
  private bridgeRestartRecovered = false;
  private coordinatorCallbackContext: CoordinatorCallbackContextPort | null = null;

  constructor(
    private readonly nativeDeliveryPolicy: NativeWorkstreamDeliveryPolicy =
      DISABLED_NATIVE_DELIVERY_POLICY,
  ) {}

  /** Server composition supplies the coordinator contract preparer; absent means no overlay. */
  setCoordinatorCallbackContext(port: CoordinatorCallbackContextPort | null): void {
    this.coordinatorCallbackContext = port;
  }

  private async prepareCallbackOverlay(
    parent: AgentSession,
    parentSdkSessionId: string,
    delegationId: string,
    childSessionId: string,
    wakeText: string,
  ): Promise<{ text: string; current: () => Promise<boolean> } | null> {
    const port = this.coordinatorCallbackContext;
    if (!port || typeof parent.ownerUserId !== 'number' || !parent.projectId) return null;
    try {
      const contract = await port.prepare({
        ownerUserId: parent.ownerUserId,
        projectId: parent.projectId,
        sessionId: parent.id,
        sdkSessionId: parentSdkSessionId,
        delegationId,
        childSessionId,
      });
      if (!contract) return null;
      let memoryText = '';
      try {
        const memory = await prepareAutomaticMemoryPreface({
          query: wakeText.slice(0, CALLBACK_MEMORY_QUERY_CHARS),
          sessionId: parent.id,
          ownerUserId: parent.ownerUserId,
        });
        memoryText = memory?.text ?? '';
      } catch {
        // Retrieval/provenance stays fail-open, as in foreground ingress.
      }
      // Directly adjacent to enqueue: after every preparation await.
      if (!(await contract.current())) return null;
      return {
        text: [contract.system, memoryText].filter((block) => block.length > 0).join('\n\n'),
        current: () => contract.current(),
      };
    } catch {
      return null;
    }
  }

  /** Existing engine watchdog owns expiry observation; persisted clocks survive API restart. */
  async enforceCodingDeadlines(now=Date.now()):Promise<void> {
    if(env.dbClient!=='sqlite')return;
    const db=getDb();
    if(!(db.prepare('PRAGMA table_info(coordinator_conversation_commands)').all() as Array<{name:string}>).some(x=>x.name==='coding_grant_json'))return;
    const rows=db.prepare(`SELECT * FROM coordinator_conversation_commands WHERE role='manager' AND coding_grant_json IS NOT NULL`).all() as Array<Record<string,unknown>>;
    for(const row of rows){
      let state;try{state=JSON.parse(String(row.coding_grant_json));}catch{continue;}
      const approval=new AgentApprovalsRepository().getById(state.approvalId),p=approval?readWorkflowProposal(approval):null;
      if(!p || p.purpose!=='coordinator_coding_execution_v1')continue;
      const task=Date.parse(String(row.allocation_intent_at??state.taskStartedAt)),worker=Date.parse(String(state.workerReservedAt??state.workerStartedAt));
      const active=db.prepare(`SELECT a.id,a.child_session_id,a.parent_session_id,a.status,a.coding_terminal_json,a.error_text FROM agent_async_delegations a WHERE a.coding_root_session_id=? AND a.coding_operation_key=? AND (a.status IN('dispatched','waking') OR (a.status='cancelled' AND a.error_text LIKE 'Coding deadline: stop pending%'))`).all(row.root_session_id,row.command_key) as Array<{id:string;child_session_id:string;parent_session_id:string;status:string;coding_terminal_json:string|null;error_text:string|null}>;
      if(!active.length)continue;
      const workerActive=active.some(a=>a.child_session_id===state.worker?.localId && a.status==='dispatched' && !a.coding_terminal_json);
      const expired=now>=Date.parse(p.expiresAt) || (Number.isFinite(task) && now>=task+p.limits.taskWallSeconds*1000) ||
        (workerActive && Number.isFinite(worker) && now>=worker+p.limits.workerWallSeconds*1000);
      const exactChildren=active.flatMap(a=>{
        if(state.revokedAt && !a.error_text?.startsWith('Coding deadline: stop pending'))return [];
        const child=this.sessionsRepo.findById(a.child_session_id),role=child?.id===state.manager?.localId?'manager':child?.id===state.worker?.localId?'worker':null;
        return child && role && child.sdkSessionId===state[role].sdkId && child.ownerUserId===p.ownerUserId && child.projectId===p.projectId && child.cwd===p.workspace.canonicalRoot && child.parentSessionId===a.parent_session_id?[{a,child}]:[];
      });
      if(!state.revokedAt && !expired)continue;
      // All durable deadline ownership is committed together BEFORE the first native await.
      const pending=db.transaction(()=>{
        if(!state.revokedAt){
          const changed=db.prepare('UPDATE coordinator_conversation_commands SET coding_grant_json=?,updated_at=? WHERE root_session_id=? AND command_key=? AND coding_grant_json=?')
            .run(JSON.stringify({...state,revokedAt:new Date(now).toISOString()}),new Date(now).toISOString(),row.root_session_id,row.command_key,row.coding_grant_json).changes;
          if(changed!==1)return [];
        }
        const result:typeof exactChildren=[];
        for(const item of exactChildren){
          if(item.a.status!=='cancelled' && !this.delegationsRepo.markCancelled(item.a.id))continue;
          const marked=db.prepare("UPDATE agent_async_delegations SET error_text='Coding deadline: stop pending; hard stop remains unqualified',updated_at=? WHERE id=? AND status='cancelled'").run(new Date(now).toISOString(),item.a.id).changes;
          if(marked!==1)throw new Error('coding deadline marker held');
          result.push(item);
        }
        return result;
      }).immediate();
      for(const {a,child} of pending){
        try{
          const native=await opencodeClient.getSession(child.sdkSessionId!);
          if(native?.id!==child.sdkSessionId || native.directory!==child.cwd)continue;
          const statuses=await opencodeClient.getSessionStatuses(child.cwd,true);
          if(!statuses[child.sdkSessionId!] || statuses[child.sdkSessionId!].type==='idle'){
            db.prepare("UPDATE agent_async_delegations SET error_text='Coding deadline: exact native child observed idle',updated_at=? WHERE id=? AND status='cancelled'").run(new Date(now).toISOString(),a.id);
          }else if(await opencodeClient.abortSession(child.sdkSessionId!,child.cwd)){
            // ACK is not idle. The existing watchdog retries/checks after restart until native idle.
            db.prepare("UPDATE agent_async_delegations SET error_text='Coding deadline: stop pending; abort acknowledged, native idle unconfirmed' WHERE id=? AND status='cancelled'").run(a.id);
          }
        }catch{logger.warn('[CodingDeadline] exact owned stop unavailable; remains partial and will be checked by existing watchdog');}
      }
      await this.flushParent(String(row.root_session_id));
    }
  }

  async onBridgeJobTerminal(parentSessionId: string): Promise<void> {
    await this.flushParent(parentSessionId);
  }

  /**
   * Production restart hook. Each query is bounded, but cursor pagination
   * continues through every stale parent so a restart cannot strand parent
   * 101 merely because the first page contained 100. Each selected parent's
   * logical batch is reconciled as one unit. The caller invokes this only
   * after the engine and persisted session mappings are ready.
   */
  async recoverAfterRestart(
    limit = RESTART_RECOVERY_PARENT_LIMIT,
  ): Promise<{ parentsExamined: number; claimsRemaining: number }> {
    const bridgeJobs = new AgentBridgeJobsRepository();
    if (!this.bridgeRestartRecovered) {
      bridgeJobs.recoverAfterRestart();
      this.bridgeRestartRecovered = true;
    }
    const pageSize = Math.max(
      1,
      Math.min(RESTART_RECOVERY_PARENT_LIMIT, Math.floor(limit)),
    );
    const examined = new Set<string>();
    let afterParentSessionId: string | null = null;

    while (true) {
      const parentIds = this.delegationsRepo.listWakingParentIds(
        pageSize,
        afterParentSessionId,
      );
      if (parentIds.length === 0) break;

      for (const parentSessionId of parentIds) {
        if (examined.has(parentSessionId)) {
          logger.warn(
            `[AsyncDelegation] restart recovery stopped after cursor made no progress at ${parentSessionId}`,
          );
          return {
            parentsExamined: examined.size,
            claimsRemaining: this.delegationsRepo.countWakingClaims(),
          };
        }
        examined.add(parentSessionId);
        let childCursor = '';
        while (true) {
          const children = this.delegationsRepo.listCodingRecoveryChildren(parentSessionId, childCursor, pageSize);
          if (!children.length) break;
          for (const child of children) await this.onChildIdle(child.child_session_id);
          childCursor = children.at(-1)!.id;
        }
        await this.flushParent(parentSessionId);
      }

      const nextCursor = parentIds.at(-1)!;
      if (nextCursor === afterParentSessionId) break;
      afterParentSessionId = nextCursor;
    }

    for (const parentSessionId of bridgeJobs.listWakingParentIds(pageSize)) {
      if (!examined.has(parentSessionId)) {
        examined.add(parentSessionId);
        await this.flushParent(parentSessionId);
      }
    }

    const nativeEpoch = this.nativeDeliveryEpoch();
    if (nativeEpoch) {
      let nativeCursor: string | undefined;
      while (true) {
        if (this.nativeDeliveryEpoch() !== nativeEpoch) break;
        const scopes = bridgeJobs.listNativeWakingParentIds(
          nativeEpoch,
          pageSize,
          nativeCursor,
        );
        if (scopes.length === 0) break;
        for (const scope of scopes) {
          if (this.nativeDeliveryEpoch() !== nativeEpoch) break;
          const parent = this.sessionsRepo.findById(scope.parentSessionId);
          if (!parent) continue;
          const context = await this.resolveNativeDeliveryContext(parent);
          if (!context || !sameNativeScope(context.scope, scope)) continue;
          examined.add(scope.parentSessionId);
          await this.flushParent(scope.parentSessionId);
        }
        const nextCursor = scopes.at(-1)?.parentSessionId;
        if (!nextCursor || nextCursor === nativeCursor) break;
        nativeCursor = nextCursor;
      }
    }

    return {
      parentsExamined: examined.size,
      claimsRemaining: this.delegationsRepo.countWakingClaims(),
    };
  }

  async onChildIdle(childSessionId: string): Promise<void> {
    const delegation = this.delegationsRepo.findByChildSessionId(childSessionId);
    if (delegation && await this.reconcileCodingTerminal(delegation.id, childSessionId)) {
      await this.flushParent(delegation.parentSessionId);
      return;
    }
    if (!delegation || delegation.status === 'notified' || delegation.status === 'failed') {
      return;
    }

    if (delegation.status === 'dispatched') {
      const messages = this.messagesRepo
        .listBySession(childSessionId, 500)
        .filter((message) => message.role === 'output' && message.rawText.trim().length > 0);
      const completionText =
        messages.at(-1)?.rawText.trim() || 'The delegated agent completed without a text result.';
      this.delegationsRepo.markCompleted(childSessionId, completionText);
    }

    await this.flushParent(delegation.parentSessionId);
  }

  async onChildFailed(childSessionId: string, errorText: string): Promise<void> {
    const delegation = this.delegationsRepo.findByChildSessionId(childSessionId);
    if (delegation && await this.reconcileCodingTerminal(delegation.id, childSessionId)) {
      await this.flushParent(delegation.parentSessionId);
      return;
    }
    if (!delegation || delegation.status !== 'dispatched') return;
    this.delegationsRepo.markFailed(childSessionId, errorText);
    await this.flushParent(delegation.parentSessionId);
  }

  async onParentIdle(parentSessionId: string): Promise<void> {
    // An accepted callback prompt owns this marker until its resulting parent
    // turn reaches the next idle boundary. Only then may another batch wake it.
    this.wakeInFlight.delete(parentSessionId);
    await this.flushParent(parentSessionId);
  }

  private async reconcileCodingTerminal(id: string, child: string): Promise<boolean> {
    if (env.dbClient !== 'sqlite') return false; // hosted local coding execution is inert
    const db = getDb();
    const rows = db.prepare(`SELECT c.*,a.coding_delivery_mode,a.coding_terminal_json FROM coordinator_conversation_commands c
      JOIN agent_async_delegations a ON a.id=c.delegation_id WHERE a.id=? AND c.child_session_id=? LIMIT 2`)
      .all(id,child) as Array<Record<string,unknown>>;
    const trace = db.prepare(`SELECT 1 FROM coordinator_conversation_commands WHERE json_valid(coding_grant_json) AND
      (json_extract(coding_grant_json,'$.manager.localId')=? OR json_extract(coding_grant_json,'$.worker.localId')=?) LIMIT 1`).get(child,child);
    const mode = db.prepare('SELECT coding_delivery_mode FROM agent_async_delegations WHERE id=?').get(id) as {coding_delivery_mode:string|null};
    if (!trace && !mode?.coding_delivery_mode) return false; // unchanged ordinary/coordinator planning lane
    if (rows.length !== 1) return true; // contradictory/unbound coding history never adopts idle/prose
    const row = rows[0];
    if (row.coding_terminal_json) return true;
    const root = String(row.root_session_id), operation = String(row.parent_command_key ?? row.command_key);
    const role = row.role as 'manager'|'worker';
    if (!mode.coding_delivery_mode) this.delegationsRepo.bindCoding(id,root,operation,role);
    const manager = db.prepare('SELECT coding_grant_json FROM coordinator_conversation_commands WHERE root_session_id=? AND command_key=?')
      .get(root,operation) as {coding_grant_json:string|null}|undefined;
    if (!manager?.coding_grant_json || !row.engine_identity || !row.child_sdk_session_id) return true;
    let state;
    try { state = JSON.parse(manager.coding_grant_json); } catch { return true; }
    if (state[role]?.localId !== child || state[role]?.sdkId !== row.child_sdk_session_id) return true;
    const session = this.sessionsRepo.findById(child);
    if (!session || session.ownerUserId !== row.owner_user_id || session.projectId !== row.project_id ||
        session.sdkSessionId !== row.child_sdk_session_id || session.cwd !== row.canonical_cwd ||
        session.parentSessionId !== (role === 'manager' ? root : state.manager?.localId)) return true;
    let anchor = String(row.initial_sdk_user_message_id ?? '');
    if (role === 'manager') {
      if (!state.workerReservedAt) return true;
      const worker = db.prepare(`SELECT coding_terminal_json FROM agent_async_delegations WHERE coding_root_session_id=?
        AND coding_operation_key=? AND coding_delivery_mode='coding_worker_v1'`).get(root,operation) as {coding_terminal_json:string|null}|undefined;
      if (!worker?.coding_terminal_json || row.callback_acceptance !== 'accepted') return true;
      anchor = String(row.callback_sdk_user_message_id ?? '');
    } else if (row.acceptance !== 'accepted') return true;
    const engine = await opencodeClient.getEngineIdentity();
    if (!engine || JSON.stringify(engine) !== row.engine_identity) return true;
    const sdk = String(row.child_sdk_session_id), cwd = String(row.canonical_cwd);
    const gates = await opencodeClient.codingPendingGateState(sdk,cwd);
    if (!gates || gates.pending) return true;
    const messages: Array<{info:Record<string,unknown>;parts?:unknown}> = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    let complete = false;
    for (let page = 0; page < 50; page++) {
      const result = await opencodeClient.listMessagesPageStrict(sdk,cwd,{limit:200,...(cursor ? {before:cursor}: {})});
      if (!result) return true;
      messages.push(...result.messages);
      if (result.messages.some(m => m.info.id === anchor)) { complete = true; break; }
      if (!result.nextCursor || seen.has(result.nextCursor)) return true;
      seen.add(result.nextCursor); cursor = result.nextCursor;
    }
    if (JSON.stringify(await opencodeClient.getEngineIdentity()) !== row.engine_identity) return true;
    const finalGates = await opencodeClient.codingPendingGateState(sdk,cwd);
    if (!finalGates || finalGates.pending) return true;
    const current = db.prepare('SELECT acceptance,callback_acceptance,initial_sdk_user_message_id,callback_sdk_user_message_id FROM coordinator_conversation_commands WHERE root_session_id=? AND command_key=?')
      .get(root,row.command_key) as Record<string,unknown>;
    if (!current || (role === 'manager' && state.workerReservedAt ? current.callback_acceptance : current.acceptance) !== 'accepted') return true;
    const fact = qualifyCodingTerminal({sdkSessionId:sdk,anchor,messages,complete,pending:false,
      ...(row.allocation_intent_at ? {notBefore:Date.parse(String(row.allocation_intent_at))} : {})});
    if (fact) this.delegationsRepo.recordCodingTerminal(id,fact);
    return true;
  }

  private async flushParent(parentSessionId: string): Promise<void> {
    const previous = this.parentChains.get(parentSessionId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.flushParentLocked(parentSessionId));
    this.parentChains.set(parentSessionId, current);
    try {
      await current;
    } finally {
      if (this.parentChains.get(parentSessionId) === current) {
        this.parentChains.delete(parentSessionId);
      }
    }
  }

  private async flushParentLocked(parentSessionId: string): Promise<void> {
    if (this.wakeInFlight.has(parentSessionId)) return;

    const parent = this.sessionsRepo.findById(parentSessionId);
    if (parent) await this.publishCodingRootResults(parent);
    if (!parent) return;

    const nativeContext = await this.resolveNativeDeliveryContext(parent);
    let nativeReady = false;
    if (nativeContext) {
      nativeReady = await this.reconcileNativeWakingClaims(nativeContext);
      if (!nativeReady && this.hasLegacyWakingClaims(parent.id)) {
        // These claims may be one accepted mixed batch. Without a qualified
        // native receipt, mutating the legacy half could create a duplicate.
        return;
      }
    }

    // A process can die after the engine accepts a wake but before SQLite is
    // marked notified. Resolve that ambiguity before considering any retry.
    // A deterministic engine message id plus transcript inspection makes an
    // already-accepted wake observable and prevents duplicate parent turns.
    const wakingReady = await this.reconcileWakingClaims(parent);
    if (!wakingReady) return;

    if (parent.status === 'starting' || parent.status === 'working') return;

    const parentAgentConfigId = (parent.mcpRole ?? parent.agentKind)?.trim() || null;
    const initialBlockReason = this.parentExecutionBlockReason(
      parentAgentConfigId,
    );
    if (initialBlockReason) {
      logger.warn(
        `[AsyncDelegation] parent ${parent.id} remains queued: ${initialBlockReason}`,
      );
      return;
    }

    const claimed = this.delegationsRepo.claimCompletedForParent(parentSessionId);
    const bridgeRepo = new AgentBridgeJobsRepository();
    const bridgeClaimed = bridgeRepo.claimCompletedForParent(parentSessionId);
    const ids = claimed.map((delegation) => delegation.id);
    const bridgeIds = bridgeClaimed.map((delegation) => delegation.id);
    const wakeDelegations: WakeDelegation[] = [
      ...claimed,
      ...bridgeClaimed.map(bridgeWakeDelegation),
    ];
    let nativeRows: AgentBridgeJobRow[] = [];
    if (nativeContext && nativeReady
        && await this.nativeContextStillEligible(nativeContext)) {
      nativeRows = bridgeRepo.claimNativeCompletedForParent(nativeContext.scope);
    }
    const projectedNative = nativeRows.flatMap((nativeRow) => {
      const projection = projectNativeWorkstreamWake(nativeRow);
      if (!projection.ok) {
        logger.warn(
          `[AsyncDelegation] native delivery held code=projection_${projection.code}`,
        );
        return [];
      }
      return [projection.item];
    });
    if (wakeDelegations.length === 0 && projectedNative.length === 0) return;

    let activeNative = projectedNative;
    if (activeNative.length > 0 && nativeContext
        && !await this.nativeContextStillEligible(nativeContext)) {
      activeNative = [];
    }
    if (wakeDelegations.length === 0 && activeNative.length === 0) return;

    let parentSdkSessionId = activeNative.length > 0
      ? nativeContext?.parentSdkSessionId ?? null
      : parent.sdkSessionId ?? opencodeSessionMap.get(parent.id) ?? null;
    if (!parentSdkSessionId) {
      this.delegationsRepo.releaseClaims(ids);
      bridgeRepo.releaseDeliveryClaims(bridgeIds);
      if (nativeContext) {
        await this.releaseNativeClaimsIfEligible(
          bridgeRepo,
          nativeContext,
          activeNative.map((item) => item.jobId),
        );
      }
      logger.warn(
        `[AsyncDelegation] parent ${parent.id} has no engine session; completion remains queued`,
      );
      return;
    }

    const profileScope = await resolveProfileScope(parentAgentConfigId);
    const executionBlockReason = this.parentExecutionBlockReason(
      parentAgentConfigId,
    );
    if (executionBlockReason) {
      this.delegationsRepo.releaseClaims(ids);
      if (nativeContext) {
        await this.releaseNativeClaimsIfEligible(
          bridgeRepo,
          nativeContext,
          activeNative.map((item) => item.jobId),
        );
      }
      logger.warn(
        `[AsyncDelegation] parent ${parent.id} locked before wake; completion remains queued: ${executionBlockReason}`,
      );
      return;
    }
    const runningAsOwnAgent =
      profileScope.ocAgent !== null && profileScope.ocAgent === parentAgentConfigId;
    // `messageID` is deliberately NOT forwarded to the engine.
    //
    // Engine message ids are `msg_` + 12 HEX characters encoding a timestamp +
    // random base62 (Identifier.create in the fork's id/id.ts), and the engine
    // orders a session's messages by that decoded timestamp. Our deterministic id
    // is `msg_rhythm_async_<sha256>`, whose characters 4..16 are `rhythm_async` —
    // not hex — so `Identifier.timestamp()` cannot decode it and the wake message
    // has no position in time. The engine therefore never saw the wake as the
    // latest, answered message: every reply the parent produced got a correctly
    // ordered id that sorted BEFORE the unplaceable wake, so it re-invoked the
    // model forever. Observed 2026-08-05 — a single wake produced 56 assistant
    // turns ("OK", "OK", "OK"…) until the session was cancelled.
    //
    // Idempotency does not need it: `wasWakeDelivered` matches on the delivery
    // MARKER embedded in the wake text, and the id branch there is only a
    // redundant fast path (kept for wakes delivered before this fix). Letting the
    // engine assign the id restores correct ordering and ends the turn normally.
    const promptOpts: Record<string, unknown> = {
      permissionMode: parent.permissionMode,
      ...(profileScope.ocAgent ? { agent: profileScope.ocAgent } : {}),
      ...(profileScope.systemPrompt && !runningAsOwnAgent
        ? { system: profileScope.systemPrompt }
        : {}),
    };

    if (activeNative.length > 0 && nativeContext) {
      if (!await this.nativeContextStillEligible(nativeContext)) {
        activeNative = [];
        parentSdkSessionId = parent.sdkSessionId ?? opencodeSessionMap.get(parent.id) ?? null;
      } else {
        // This synchronous read is deliberately adjacent to enqueue. It
        // rechecks the exact claimed IDs against current ready/revision scope
        // after every awaited policy/profile step.
        activeNative = this.refreshClaimedNativeItems(
          bridgeRepo,
          nativeContext,
          activeNative,
        );
      }
    }
    if (activeNative.length === 0) {
      parentSdkSessionId = parent.sdkSessionId ?? opencodeSessionMap.get(parent.id) ?? null;
    }
    if (!parentSdkSessionId
        || (wakeDelegations.length === 0 && activeNative.length === 0)) {
      this.delegationsRepo.releaseClaims(ids);
      bridgeRepo.releaseDeliveryClaims(bridgeIds);
      return;
    }

    const messageID = activeNative.length > 0 && nativeContext
      ? this.nativeDeliveryMessageId(
        wakeDelegations,
        activeNative,
        nativeContext.scope.hostEpoch,
      )
      : this.deliveryMessageId(wakeDelegations);
    const wakeText = activeNative.length > 0
      ? this.buildNativeWakeText(wakeDelegations, activeNative, messageID)
      : this.buildWakeText(wakeDelegations, messageID);
    // A generic async completion must never acquire coordinator model-control
    // authority merely because it shares the Secretary's SDK session. Only a
    // single, previously bound Coding Workflow child gets this internal marker;
    // mixed callbacks remain ordinary existing completion wakes.
    const singleCoordinatorWake = activeNative.length === 0 && wakeDelegations.length === 1
      ? wakeDelegations[0]
      : null;
    const singleCoordinatorChildSessionId = singleCoordinatorWake?.childSessionId;
    const coordinatorCallbackReason = singleCoordinatorWake && singleCoordinatorChildSessionId
      ? new CoordinatorConversationsRepository().coordinatorDelegationCallbackReason({
        parentSessionId,
        parentSdkSessionId,
        delegationId: singleCoordinatorWake.id,
        childSessionId: singleCoordinatorChildSessionId,
        targetAgentConfigId: singleCoordinatorWake.targetAgentConfigId,
      })
      : null;

    // Fresh bounded coordinator contract + automatic memory for the exact
    // single bound child only. Mixed/native/unbound completions get neither.
    // Both are rechecked after their awaits and directly before enqueue; a
    // stale scope drops the overlay (the wake itself is unchanged), it never
    // yields a qualified one.
    let callbackFreshness: (() => Promise<boolean>) | null = null;
    if (coordinatorCallbackReason && singleCoordinatorWake && singleCoordinatorChildSessionId) {
      const overlay = await this.prepareCallbackOverlay(
        parent,
        parentSdkSessionId,
        singleCoordinatorWake.id,
        singleCoordinatorChildSessionId,
        wakeText,
      );
      if (overlay) {
        promptOpts.system = [
          typeof promptOpts.system === 'string' ? promptOpts.system : '',
          overlay.text,
        ].filter((block) => block.length > 0).join('\n\n');
        // The same recheck runs again at the client's final SDK boundary.
        callbackFreshness = overlay.current;
      }
    }

    // The bound Coding Workflow manager's exact single callback mints a native
    // user anchor that must be durable BEFORE exposure, with or without a
    // Dayflow receiver. An unrelated/mixed callback never reaches this branch.
    const workflowJob = coordinatorCallbackReason && singleCoordinatorWake
      ? bridgeRepo.findLiveCoordinatorWorkflowJobByDelegation(singleCoordinatorWake.id)
      : null;
    let callbackContext = callbackFreshness || workflowJob
      ? {
        kind: 'coordinator_callback_v1' as const,
        validate: async () => (callbackFreshness ? await callbackFreshness() : true) &&
          (!workflowJob || bridgeRepo.findLiveCoordinatorWorkflowJobByDelegation(singleCoordinatorWake!.id) !== null),
        ...(workflowJob ? {
          onPrepared: (binding: { dispatchId: string; sdkUserMessageId: string }): boolean => {
            try {
              bridgeRepo.recordCoordinatorWorkflowCallbackAnchor({
                delegationId: singleCoordinatorWake!.id,
                dispatchId: binding.dispatchId,
                sdkUserMessageId: binding.sdkUserMessageId,
                now: new Date().toISOString(),
              });
              return true;
            } catch {
              return false;
            }
          },
        } : {}),
      }
      : null;

    const codingClaims=claimed.filter(item=>(getDb().prepare('SELECT coding_delivery_mode FROM agent_async_delegations WHERE id=?').get(item.id) as {coding_delivery_mode:string|null})?.coding_delivery_mode==='coding_worker_v1');
    if(codingClaims.length && (claimed.length!==1 || activeNative.length || bridgeClaimed.length)){this.delegationsRepo.releaseClaims(ids);return;}
    let codingCallback: ReturnType<typeof codingGrantDelegation> = null;
    if (claimed.length === 1 && activeNative.length === 0 && bridgeClaimed.length === 0) {
      const coded = getDb().prepare('SELECT coding_delivery_mode FROM agent_async_delegations WHERE id=?').get(claimed[0].id) as {coding_delivery_mode:string|null};
      if (coded?.coding_delivery_mode === 'coding_worker_v1') {
        try {
          codingCallback = codingGrantDelegation(parent.id,parentSdkSessionId,parent.ownerUserId ?? 0);
          if (!codingCallback || codingCallback.role !== 'worker' || !codingCallback.current() ||
              profileScope.model?.providerID !== codingCallback.proposal.chain.manager.providerId ||
              profileScope.model?.modelID !== codingCallback.proposal.chain.manager.modelId) throw new Error('coding callback held');
          const variant=codingEffortVariant(codingCallback.proposal.chain.manager,await opencodeClient.providerSnapshot());
          if(!variant || !codingCallback.current())throw new Error('coding callback effort held');
          promptOpts.variant=variant;
          const binding = getDb().prepare('SELECT callback_dispatch_id FROM coordinator_conversation_commands WHERE root_session_id=? AND command_key=?')
            .get(codingCallback.scope.sessionId,codingCallback.scope.commandKey) as {callback_dispatch_id:string|null};
          if (binding?.callback_dispatch_id) throw new Error('one coding callback already prepared; never replay');
          const exact = codingCallback;
          callbackContext = { kind:'coordinator_callback_v1', validate:async () => exact.current(),
            onPrepared: b => exact.current() && exact.journal.recordCallbackPrepared(exact.scope,b) };
        } catch { this.delegationsRepo.releaseClaims(ids); return; }
      }
    }

    this.wakeInFlight.add(parentSessionId);
    let deliveryUnknown = false;
    const attemptedNative = activeNative.length > 0 && nativeContext
      ? { context: nativeContext, items: activeNative }
      : null;
    try {
      if (codingCallback) codingCallback.journal.recordCallbackOutcome(codingCallback.scope,'unknown');
      const dispatchProvenance = {
        sessionId: parentSessionId,
        sdkSessionId: parentSdkSessionId,
        origin: 'delegation_completion' as const,
        requestedSource: 'agent_config' as const,
        requestedProviderId: profileScope.model?.providerID ?? null,
        requestedModelId: profileScope.model?.modelID ?? null,
        resolvedProviderId: profileScope.model?.providerID ?? null,
        resolvedModelId: profileScope.model?.modelID ?? null,
        routeAuthed: null,
        finalProviderId: profileScope.model?.providerID ?? null,
        finalModelId: profileScope.model?.modelID ?? null,
        ...(coordinatorCallbackReason ? { reasonCode: coordinatorCallbackReason } : {}),
      };
      // Ordinary completions keep the exact historical call shape; only the
      // exact prepared callback appends its final-boundary freshness hook.
      const enqueued = callbackContext
        ? await opencodeClient.promptAsync(
          parentSdkSessionId,
          wakeText,
          profileScope.model,
          parent.cwd,
          promptOpts,
          undefined,
          undefined,
          dispatchProvenance,
          undefined,
          undefined,
          callbackContext,
        )
        : await opencodeClient.promptAsync(
          parentSdkSessionId,
          wakeText,
          profileScope.model,
          parent.cwd,
          promptOpts,
          undefined,
          undefined,
          dispatchProvenance,
        );
      if (codingCallback) {
        if (enqueued) codingCallback.journal.recordCallbackOutcome(codingCallback.scope,'accepted');
        else {
          codingCallback.journal.recordCallbackOutcome(codingCallback.scope,'unknown');
          deliveryUnknown = true; return;
        } // exact prepared anchor, never marker/prose retry
      }
      if (!enqueued) {
        let nativeDelivered = attemptedNative
          ? wakeDelegations.length > 0
            ? await this.wasMixedWakeDelivered(
              attemptedNative.context,
              attemptedNative.items,
              wakeDelegations,
            )
            : await this.wasNativeWakeDelivered(
              attemptedNative.context,
              attemptedNative.items,
              wakeDelegations,
            )
          : null;
        if (nativeDelivered === true) {
          const acknowledged = wakeDelegations.length > 0
            ? await this.markMixedDeliveredIfEligible(
              bridgeRepo,
              attemptedNative!.context,
              attemptedNative!.items.map((item) => item.jobId),
              ids,
              bridgeIds,
            )
            : await this.markNativeDeliveredIfEligible(
              bridgeRepo,
              attemptedNative!.context,
              attemptedNative!.items.map((item) => item.jobId),
            );
          if (!acknowledged) nativeDelivered = null;
        }
        const delivered = attemptedNative
          ? nativeDelivered
          : await this.wasWakeDelivered(parent, wakeDelegations);
        if (delivered === true && wakeDelegations.length > 0) {
          if (!attemptedNative) {
            this.delegationsRepo.markNotified(ids);
            bridgeRepo.markDelivered(bridgeIds);
          }
          logger.info(
            `[AsyncDelegation] recovered accepted parent wake ${messageID} after an ambiguous enqueue result`,
          );
          return;
        }
        deliveryUnknown = delivered === null;
        logger.warn(
          `[AsyncDelegation] engine rejected parent wake for ${parentSessionId}; ` +
            `${deliveryUnknown ? 'claim retained pending delivery inspection' : 'callbacks re-queued'}`,
        );
        return;
      }

      this.delegationsRepo.markNotified(ids);
      bridgeRepo.markDelivered(bridgeIds);
      if (attemptedNative) {
        await this.markNativeDeliveredIfEligible(
          bridgeRepo,
          attemptedNative.context,
          attemptedNative.items.map((item) => item.jobId),
        );
      }
      logger.info(
        `[AsyncDelegation] woke parent ${parentSessionId} with ` +
          `${claimed.length} completed delegate(s) and ${activeNative.length} native status item(s)`,
      );
    } catch (error) {
      if (codingCallback) {
        codingCallback.journal.recordCallbackOutcome(codingCallback.scope,'unknown');
        deliveryUnknown = true; return;
      }
      let nativeDelivered = attemptedNative
        ? wakeDelegations.length > 0
          ? await this.wasMixedWakeDelivered(
            attemptedNative.context,
            attemptedNative.items,
            wakeDelegations,
          )
          : await this.wasNativeWakeDelivered(
            attemptedNative.context,
            attemptedNative.items,
            wakeDelegations,
          )
        : null;
      if (nativeDelivered === true) {
        const acknowledged = wakeDelegations.length > 0
          ? await this.markMixedDeliveredIfEligible(
            bridgeRepo,
            attemptedNative!.context,
            attemptedNative!.items.map((item) => item.jobId),
            ids,
            bridgeIds,
          )
          : await this.markNativeDeliveredIfEligible(
            bridgeRepo,
            attemptedNative!.context,
            attemptedNative!.items.map((item) => item.jobId),
          );
        if (!acknowledged) nativeDelivered = null;
      }
      const delivered = attemptedNative
        ? nativeDelivered
        : await this.wasWakeDelivered(parent, wakeDelegations);
      if (delivered === true && wakeDelegations.length > 0) {
        if (!attemptedNative) {
          this.delegationsRepo.markNotified(ids);
          bridgeRepo.markDelivered(bridgeIds);
        }
        logger.info(
          `[AsyncDelegation] recovered accepted parent wake ${messageID} after enqueue exception`,
        );
        return;
      }
      deliveryUnknown = delivered === null;
      throw error;
    } finally {
      this.wakeInFlight.delete(parentSessionId);
      if (!deliveryUnknown) {
        this.delegationsRepo.releaseClaims(ids);
        bridgeRepo.releaseDeliveryClaims(bridgeIds);
      }
    }
  }

  private hasLegacyWakingClaims(parentSessionId: string): boolean {
    if (this.delegationsRepo.listWakingForParent(parentSessionId).length > 0) {
      return true;
    }
    return new AgentBridgeJobsRepository()
      .listWakingForParent(parentSessionId)
      .length > 0;
  }

  private hasNativeWakingClaims(parentSessionId: string): boolean {
    try {
      const row = getDb().prepare(`SELECT 1 FROM agent_bridge_jobs
        WHERE parent_runtime='opencode' AND parent_session_id=?
          AND direction='rhythm_to_native' AND delivery_state='waking'
          AND COALESCE(native_execution_kind, 'legacy') <> 'coordinator'
        LIMIT 1`).get(parentSessionId);
      return Boolean(row);
    } catch {
      logger.warn(
        '[AsyncDelegation] native delivery held code=waking_inspection_exception',
      );
      return true;
    }
  }

  private refreshClaimedNativeItems(
    repository: AgentBridgeJobsRepository,
    context: NativeDeliveryContext,
    claimed: NativeWorkstreamWakeItem[],
  ): NativeWorkstreamWakeItem[] {
    const claimedIds = new Set(claimed.map((item) => item.jobId));
    const refreshed: NativeWorkstreamWakeItem[] = [];
    for (const row of repository.listNativeWakingForParent(context.scope)) {
      if (!claimedIds.has(row.id)) continue;
      const projection = projectNativeWorkstreamWake(row);
      if (!projection.ok) {
        logger.warn(
          `[AsyncDelegation] native delivery held code=projection_${projection.code}`,
        );
        continue;
      }
      refreshed.push(projection.item);
    }
    if (refreshed.length !== claimed.length) {
      logger.warn('[AsyncDelegation] native delivery held code=claimed_scope_changed');
    }
    return refreshed;
  }

  private nativeDeliveryEpoch(): string | null {
    try {
      if (!env.workstreamsEnabled
          || env.dbClient !== 'sqlite'
          || env.role === 'cloud'
          || env.role === 'relay'
          || !this.nativeDeliveryPolicy.enabled()) {
        return null;
      }
      const epoch = this.nativeDeliveryPolicy.currentHostEpoch();
      return typeof epoch === 'string' && epoch.length > 0 ? epoch : null;
    } catch {
      logger.warn('[AsyncDelegation] native delivery held code=gate_exception');
      return null;
    }
  }

  private nativeDeliveryContextForParent(
    parent: AgentSession,
  ): NativeDeliveryContext | null {
    const hostEpoch = this.nativeDeliveryEpoch();
    if (!hostEpoch || parent.ownerUserId === null || !parent.projectId) return null;
    const parentSdkSessionId =
      opencodeSessionMap.get(parent.id) ?? parent.sdkSessionId ?? null;
    if (!parentSdkSessionId) return null;
    const scope: NativeWorkstreamDeliveryScope = {
      localUserId: parent.ownerUserId,
      projectId: parent.projectId,
      parentSessionId: parent.id,
      hostEpoch,
    };
    if (!isNativeWorkstreamDeliveryScope(scope)) return null;
    return { parent, parentSdkSessionId, scope };
  }

  private async resolveNativeDeliveryContext(
    parent: AgentSession,
  ): Promise<NativeDeliveryContext | null> {
    const initial = this.nativeDeliveryContextForParent(parent);
    if (!initial) return null;
    let eligible = false;
    try {
      eligible = await this.nativeDeliveryPolicy.isParentContextEligible(
        initial.parent,
        initial.scope,
      );
    } catch {
      logger.warn(
        '[AsyncDelegation] native delivery held code=context_policy_exception',
      );
      return null;
    }
    if (!eligible) return null;
    const refreshedParent = this.sessionsRepo.findById(parent.id);
    if (!refreshedParent) return null;
    const refreshed = this.nativeDeliveryContextForParent(refreshedParent);
    if (!refreshed
        || !sameNativeScope(initial.scope, refreshed.scope)
        || initial.parentSdkSessionId !== refreshed.parentSdkSessionId) {
      return null;
    }
    return refreshed;
  }

  private async nativeContextStillEligible(
    context: NativeDeliveryContext,
  ): Promise<boolean> {
    const parent = this.sessionsRepo.findById(context.parent.id);
    if (!parent) return false;
    const current = this.nativeDeliveryContextForParent(parent);
    if (!current
        || !sameNativeScope(context.scope, current.scope)
        || context.parentSdkSessionId !== current.parentSdkSessionId) {
      return false;
    }
    let eligible = false;
    try {
      eligible = await this.nativeDeliveryPolicy.isParentContextEligible(
        current.parent,
        current.scope,
      );
    } catch {
      logger.warn(
        '[AsyncDelegation] native delivery held code=context_recheck_exception',
      );
      return false;
    }
    if (!eligible) return false;
    const afterAwait = this.sessionsRepo.findById(context.parent.id);
    if (!afterAwait) return false;
    const finalContext = this.nativeDeliveryContextForParent(afterAwait);
    return Boolean(finalContext
      && sameNativeScope(context.scope, finalContext.scope)
      && context.parentSdkSessionId === finalContext.parentSdkSessionId);
  }

  private async releaseNativeClaimsIfEligible(
    repository: AgentBridgeJobsRepository,
    context: NativeDeliveryContext,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0 || !await this.nativeContextStillEligible(context)) return;
    repository.releaseNativeDeliveryClaims(context.scope, ids);
  }

  private async markNativeDeliveredIfEligible(
    repository: AgentBridgeJobsRepository,
    context: NativeDeliveryContext,
    ids: string[],
  ): Promise<boolean> {
    if (ids.length === 0 || !await this.nativeContextStillEligible(context)) {
      return false;
    }
    repository.markNativeDelivered(context.scope, ids);
    return true;
  }

  private async markMixedDeliveredIfEligible(
    repository: AgentBridgeJobsRepository,
    context: NativeDeliveryContext,
    nativeIds: string[],
    asyncLegacyIds: string[],
    bridgeLegacyIds: string[],
  ): Promise<boolean> {
    if (nativeIds.length === 0
        || (asyncLegacyIds.length === 0 && bridgeLegacyIds.length === 0)
        || !await this.nativeContextStillEligible(context)) {
      return false;
    }
    let acknowledged = false;
    getDb().transaction(() => {
      const eligibleIds = new Set(
        repository.listNativeWakingForParent(context.scope).map((row) => row.id),
      );
      if (!nativeIds.every((id) => eligibleIds.has(id))) return;
      const currentAsyncLegacyIds = new Set(
        this.delegationsRepo.listWakingForParent(context.scope.parentSessionId)
          .map((delegation) => delegation.id),
      );
      const currentBridgeLegacyIds = new Set(
        repository.listWakingForParent(context.scope.parentSessionId)
          .map((delegation) => delegation.id),
      );
      if (!asyncLegacyIds.every((id) => currentAsyncLegacyIds.has(id))
          || !bridgeLegacyIds.every((id) => currentBridgeLegacyIds.has(id))) {
        return;
      }
      repository.markNativeDelivered(context.scope, nativeIds);
      this.delegationsRepo.markNotified(asyncLegacyIds);
      repository.markDelivered(bridgeLegacyIds);
      acknowledged = true;
    }).immediate();
    return acknowledged;
  }

  private async reconcileNativeWakingClaims(
    context: NativeDeliveryContext,
  ): Promise<boolean> {
    if (!await this.nativeContextStillEligible(context)) return false;
    const repository = new AgentBridgeJobsRepository();
    const rows = repository.listNativeWakingForParent(context.scope);
    if (rows.length === 0) {
      return !this.hasNativeWakingClaims(context.scope.parentSessionId);
    }
    const items: NativeWorkstreamWakeItem[] = [];
    for (const row of rows) {
      const projection = projectNativeWorkstreamWake(row);
      if (!projection.ok) {
        logger.warn(
          `[AsyncDelegation] native delivery held code=projection_${projection.code}`,
        );
        return false;
      }
      items.push(projection.item);
    }
    const asyncWaking = this.delegationsRepo.listWakingForParent(
      context.scope.parentSessionId,
    );
    const bridgeWaking = repository.listWakingForParent(
      context.scope.parentSessionId,
    );
    const legacyWaking: WakeDelegation[] = [
      ...asyncWaking,
      ...bridgeWaking.map(bridgeWakeDelegation),
    ];
    const delivered = legacyWaking.length > 0
      ? await this.wasMixedWakeDelivered(context, items, legacyWaking)
      : await this.wasNativeWakeDelivered(context, items, []);
    if (delivered === true) {
      if (legacyWaking.length > 0) {
        const acknowledged = await this.markMixedDeliveredIfEligible(
          repository,
          context,
          items.map((item) => item.jobId),
          asyncWaking.map((delegation) => delegation.id),
          bridgeWaking.map((delegation) => delegation.id),
        );
        if (!acknowledged) return false;
      } else {
        const acknowledged = await this.markNativeDeliveredIfEligible(
          repository,
          context,
          items.map((item) => item.jobId),
        );
        if (!acknowledged) return false;
      }
      logger.info(
        `[AsyncDelegation] reconciled exact native wake ${this.nativeDeliveryMessageId([], items, context.scope.hostEpoch)} for parent ${context.parent.id}`,
      );
      return true;
    }
    logger.warn(
      `[AsyncDelegation] native wake inspection is incomplete for ${context.parent.id}; ` +
        `retaining ${items.length} waking claim(s)`,
    );
    return false;
  }

  private async wasMixedWakeDelivered(
    context: NativeDeliveryContext,
    items: NativeWorkstreamWakeItem[],
    legacyDelegations: WakeDelegation[],
  ): Promise<true | null> {
    if (items.length === 0
        || legacyDelegations.length === 0
        || !await this.nativeContextStillEligible(context)) {
      return null;
    }
    const nativeMarker = this.nativeDeliveryMarker(
      this.nativeDeliveryMessageId([], items, context.scope.hostEpoch),
    );
    const legacyMarker = this.deliveryMarker(
      this.deliveryMessageId(legacyDelegations),
    );
    const maybeClient = opencodeClient as unknown as {
      listMessages?: (
        sdkId: string,
        directory?: string,
      ) => Promise<Array<{
        parts?: Array<{ type?: string; text?: string }>;
      }>>;
    };
    if (typeof maybeClient.listMessages !== 'function') return null;
    try {
      const messages = await maybeClient.listMessages.call(
        opencodeClient,
        context.parentSdkSessionId,
        context.parent.cwd,
      );
      const exactMixedReceipt = messages.some((candidate) => {
        const text = candidate.parts
          ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join('\n') ?? '';
        return text.includes(nativeMarker) && text.includes(legacyMarker);
      });
      return exactMixedReceipt ? true : null;
    } catch {
      logger.warn(
        '[AsyncDelegation] native delivery held code=mixed_inspection_exception',
      );
      return null;
    }
  }

  private async wasNativeWakeDelivered(
    context: NativeDeliveryContext,
    items: NativeWorkstreamWakeItem[],
    _legacyDelegations: WakeDelegation[],
  ): Promise<true | null> {
    if (!await this.nativeContextStillEligible(context)) return null;
    const messageID = this.nativeDeliveryMessageId(
      [],
      items,
      context.scope.hostEpoch,
    );
    const marker = this.nativeDeliveryMarker(messageID);
    const matches = (candidate: {
      rawText?: string | null;
      parts?: Array<{ type?: string; text?: string }>;
    }): boolean => {
      const text = candidate.rawText ?? candidate.parts
        ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n') ?? '';
      return text.includes(marker);
    };
    const maybeClient = opencodeClient as unknown as {
      listMessages?: (
        sdkId: string,
        directory?: string,
      ) => Promise<Array<{
        parts?: Array<{ type?: string; text?: string }>;
      }>>;
    };
    if (typeof maybeClient.listMessages !== 'function') return null;
    try {
      const messages = await maybeClient.listMessages.call(
        opencodeClient,
        context.parentSdkSessionId,
        context.parent.cwd,
      );
      return messages.some(matches) ? true : null;
    } catch {
      logger.warn(
        '[AsyncDelegation] native delivery held code=inspection_exception',
      );
      return null;
    }
  }

  private nativeDeliveryMessageId(
    _legacyDelegations: WakeDelegation[],
    items: NativeWorkstreamWakeItem[],
    hostEpoch: string,
  ): string {
    const stableItems = items.map((item) => [
      item.kind,
      item.jobId,
      item.workstreamId,
      item.status,
      item.reasonCode ?? 'none',
      hostEpoch,
    ].join(':')).sort().join('|');
    const digest = createHash('sha256')
      .update(stableItems)
      .digest('hex')
      .slice(0, 24);
    return `msg_rhythm_native_${digest}`;
  }

  private nativeDeliveryMarker(messageID: string): string {
    return `<!-- rhythm-native-workstream:${messageID} -->`;
  }

  private buildNativeWakeText(
    legacyDelegations: WakeDelegation[],
    items: NativeWorkstreamWakeItem[],
    messageID: string,
  ): string {
    const nativeSection =
      '[Native workstream status update]\n' +
      items.map(renderNativeWorkstreamWake).join('\n\n') +
      '\n\nTreat this as status-only notification bookkeeping. ' +
      'Do not infer completion or apply effects from this notice.\n' +
      this.nativeDeliveryMarker(messageID);
    if (legacyDelegations.length === 0) return nativeSection;
    const legacyMessageID = this.deliveryMessageId(legacyDelegations);
    const legacyText = this.buildWakeText(legacyDelegations, legacyMessageID);
    return `${legacyText}\n\n${nativeSection}`;
  }

  private parentExecutionBlockReason(
    parentAgentConfigId: string | null,
  ): string | null {
    if (!parentAgentConfigId) return 'parent session has no agent profile';
    const config = new AgentConfigsRepository().getById(parentAgentConfigId);
    if (!config || !config.isAgent) {
      return `parent profile is not runnable: '${parentAgentConfigId}'`;
    }
    return agentConfigExecutionBlockReason(config);
  }

  private async reconcileWakingClaims(parent: AgentSession): Promise<boolean> {
    const bridgeRepo = new AgentBridgeJobsRepository();
    const asyncWaking = this.delegationsRepo.listWakingForParent(parent.id);
    for (const item of asyncWaking) {
      const coded = getDb().prepare(`SELECT a.coding_delivery_mode,c.callback_acceptance,c.callback_sdk_user_message_id,
        c.child_sdk_session_id,c.canonical_cwd,c.engine_identity,c.root_session_id,c.command_key FROM agent_async_delegations a
        LEFT JOIN coordinator_conversation_commands c ON c.root_session_id=a.coding_root_session_id AND c.command_key=a.coding_operation_key WHERE a.id=?`)
        .get(item.id) as {coding_delivery_mode:string|null;callback_acceptance:string|null;callback_sdk_user_message_id:string;
          child_sdk_session_id:string;canonical_cwd:string;engine_identity:string;root_session_id:string;command_key:string}|undefined;
      if (coded?.coding_delivery_mode === 'coding_worker_v1') {
        if(!coded.root_session_id || !coded.command_key)return false;
        if (coded.callback_acceptance !== 'accepted') {
          if (!coded.callback_sdk_user_message_id || JSON.stringify(await opencodeClient.getEngineIdentity()) !== coded.engine_identity) return false;
          let cursor: string | undefined;
          let proven = false;
          const seen = new Set<string>();
          for (let n = 0; n < 50; n++) {
            const page = await opencodeClient.listMessagesPageStrict(coded.child_sdk_session_id,coded.canonical_cwd,
              {limit:200,...(cursor ? {before:cursor} : {})});
            if (!page) return false;
            proven = page.messages.some(m => m.info.id === coded.callback_sdk_user_message_id &&
              m.info.role === 'user' && m.info.sessionID === coded.child_sdk_session_id);
            if (proven || !page.nextCursor || seen.has(page.nextCursor)) break;
            seen.add(page.nextCursor); cursor = page.nextCursor;
          }
          if (!proven || JSON.stringify(await opencodeClient.getEngineIdentity()) !== coded.engine_identity) return false;
          getDb().prepare(`UPDATE coordinator_conversation_commands SET callback_acceptance='accepted' WHERE root_session_id=? AND command_key=?
            AND callback_sdk_user_message_id=? AND callback_acceptance IN ('pending','unknown')`)
            .run(coded.root_session_id,coded.command_key,coded.callback_sdk_user_message_id);
        }
        this.delegationsRepo.markNotified([item.id]);
      }
    }
    const refreshedAsync = this.delegationsRepo.listWakingForParent(parent.id);
    const bridgeWaking = bridgeRepo.listWakingForParent(parent.id);
    const waking: WakeDelegation[] = [
      ...refreshedAsync,
      ...bridgeWaking.map(bridgeWakeDelegation),
    ];
    if (waking.length === 0) return true;

    const delivered = await this.wasWakeDelivered(parent, waking);
    if (delivered === true) {
      this.delegationsRepo.markNotified(
        asyncWaking.map((delegation) => delegation.id),
      );
      bridgeRepo.markDelivered(bridgeWaking.map((delegation) => delegation.id));
      logger.info(
        `[AsyncDelegation] reconciled already-delivered wake ${this.deliveryMessageId(waking)} for parent ${parent.id}`,
      );
      return true;
    }
    if (delivered === null) {
      logger.warn(
        `[AsyncDelegation] could not inspect parent ${parent.id}; retaining ${waking.length} waking claim(s)`,
      );
      return false;
    }

    this.delegationsRepo.releaseClaims(
      asyncWaking.map((delegation) => delegation.id),
    );
    bridgeRepo.releaseDeliveryClaims(bridgeWaking.map((delegation) => delegation.id));
    return true;
  }

  private async publishCodingRootResults(parent:AgentSession):Promise<void> {
    if (env.dbClient!=='sqlite' || parent.ownerUserId==null || parent.projectId==null) return;
    const db=getDb(),actor={ownerUserId:parent.ownerUserId,projectId:parent.projectId};
    let cursor='';
    for (;;) {
      const rows=db.prepare(`SELECT * FROM agent_async_delegations WHERE coding_root_session_id=? AND id>?
        AND coding_delivery_mode IN ('coding_root_v1','delivery_only_v1') ORDER BY id LIMIT 100`)
        .all(parent.id,cursor) as Array<Record<string,unknown>>;
      if (!rows.length) break;
      for (const row of rows) {
        cursor=String(row.id);
        if (!['completed','failed','cancelled'].includes(String(row.status))) continue;
        if (!row.coding_result_receipt_json && row.coding_delivery_mode==='coding_root_v1') {
          const command=db.prepare('SELECT * FROM coordinator_conversation_commands WHERE root_session_id=? AND command_key=?')
            .get(parent.id,row.coding_operation_key) as Record<string,unknown>|undefined;
          if (!command || command.owner_user_id!==actor.ownerUserId || command.project_id!==actor.projectId) continue;
          const state=command.coding_grant_json?JSON.parse(String(command.coding_grant_json)):null;
          const approval=state?.approvalId?new AgentApprovalsRepository().getById(state.approvalId):null;
          const proposal=approval?readWorkflowProposal(approval):null;
          const worker=db.prepare(`SELECT * FROM agent_async_delegations
            WHERE coding_root_session_id=? AND coding_operation_key=? AND coding_delivery_mode='coding_worker_v1' LIMIT 1`)
            .get(parent.id,row.coding_operation_key) as Record<string,unknown>|undefined;
          const terminal=worker?.coding_terminal_json?JSON.parse(String(worker.coding_terminal_json)):null;
          let files:unknown[]=[],reason='Qualified worker/source capture unavailable; no independent verification authority';
          let verification='unverified',checks:unknown[]=[],authentication:unknown=null;
          if (proposal?.purpose==='coordinator_coding_execution_v1' && terminal?.execution==='completed' && row.status==='completed' &&
              worker && ['completed','waking','notified'].includes(String(worker.status)) && state?.worker?.localId===worker.child_session_id &&
              state.manager?.localId===row.child_session_id && worker.parent_session_id===row.child_session_id &&
              terminal.sdkSessionId===state.worker.sdkId && codingResultAuthorityCurrent(proposal)) {
            try {
              const fixture=loadQualificationFixtureAuthority();
              const artifacts=fixture?join(fixture.fixtureRoot,'coding-verification'):join(homedir(),'coding-verification');mkdirSync(artifacts,{recursive:true,mode:0o700});
              const snapshot=await captureCodingSnapshot(proposal.workspace.canonicalRoot,proposal.workspace.readablePaths,artifacts);
              files=snapshot.files;
              if (!codingSnapshotCurrent(snapshot)) {
                verification='stale';reason='Current source differs from captured bytes';
              } else {
                const pins=codingEvaluatorPins();
                if(pins.evaluatorDigest!==proposal.acceptance.evaluatorDigest || pins.runnerDigest!==proposal.acceptance.runnerDigest)
                  throw new Error('approved evaluator differs from current evaluator');
                const evaluated=await verifyCodingSnapshot(snapshot,pins,{docker:{pins:codingDockerPins(codingDockerRuntimeDigest),
                  context:{rootSessionId:parent.id,operationKey:String(row.coding_operation_key)}}});
                verification=evaluated.qualified && codingSnapshotCurrent(snapshot) && codingResultAuthorityCurrent(proposal)?evaluated.verdict:'unverified';checks=evaluated.checks;
                evaluated.snapshot && (terminal.verifiedSnapshot=evaluated.snapshot);
                authentication=evaluated.authentication??null;reason=evaluated.reason??'Exact immutable source independently evaluated';
              }
            } catch(error){reason=String(error).slice(0,512);}
          }
          const receipt={kind:'coding_result_v1',execution:terminal?.execution??(row.status==='cancelled'?'cancelled':'unknown'),
            producedApiBootId:qualificationApiBootId,producedApiPid:process.pid,verification,files,checks,authentication,snapshot:terminal?.verifiedSnapshot??null,usage:terminal?.usage??null,
            summary:verification==='passed'?'Independent checks confirmed optional open/done/all filtering, empty handling, stable order, unsupported-status rejection and preservation of input values.':'Independent acceptance did not establish the requested behavior; see actual verification checks and limits.',
            limits:[reason,'Worker command/evaluator/genuine A6 are distinct proofs; no billable root prompt','Worker Node test subprocess is not generally confined by SDK tool grants; this is an invented bounded fixture, not OS/network confinement.']};
          db.prepare('UPDATE agent_async_delegations SET coding_result_receipt_json=? WHERE id=? AND coding_result_receipt_json IS NULL')
            .run(JSON.stringify(receipt),row.id);
        }
        // A retained receipt is evidence of a past evaluation, never a current success lease.
        if(row.coding_delivery_mode==='coding_root_v1'){
          const fresh=db.prepare('SELECT coding_result_receipt_json,result_message_id FROM agent_async_delegations WHERE id=?').get(row.id) as {coding_result_receipt_json:string|null;result_message_id:number|null};
          if(fresh.coding_result_receipt_json && !fresh.result_message_id){
            const receipt=JSON.parse(fresh.coding_result_receipt_json);
            const command=db.prepare('SELECT coding_grant_json FROM coordinator_conversation_commands WHERE root_session_id=? AND command_key=?').get(parent.id,row.coding_operation_key) as {coding_grant_json:string|null}|undefined;
            const state=command?.coding_grant_json?JSON.parse(command.coding_grant_json):null;
            const approval=state?.approvalId?new AgentApprovalsRepository().getById(state.approvalId):null;
            const proposal=approval?readWorkflowProposal(approval):null;
            if(receipt.verification==='passed' && (!proposal || proposal.purpose!=='coordinator_coding_execution_v1' ||
              !codingResultAuthorityCurrent(proposal) || !receipt.snapshot || !codingSnapshotCurrent(receipt.snapshot))){
              receipt.verification='stale';receipt.limits.push('Current artifact or signed execution authority changed before delivery');
              db.prepare('UPDATE agent_async_delegations SET coding_result_receipt_json=? WHERE id=? AND result_message_id IS NULL').run(JSON.stringify(receipt),row.id);
            }
          }
        }
        holdCodingResultIfScoped(String(row.id),actor);
        this.messagesRepo.appendCodingResult(String(row.id),actor);
      }
    }
  }

  private async wasWakeDelivered(
    parent: AgentSession,
    delegations: WakeDelegation[],
  ): Promise<boolean | null> {
    const messageID = this.deliveryMessageId(delegations);
    const marker = this.deliveryMarker(messageID);
    const childIds = delegations
      .map((delegation) => delegation.childSessionId)
      .filter((id): id is string => Boolean(id));
    const matches = (
      candidate: {
        sdkMessageId?: string | null;
        rawText?: string | null;
        info?: { id?: string };
        parts?: Array<{ type?: string; text?: string }>;
      },
    ): boolean => {
      if (candidate.sdkMessageId === messageID || candidate.info?.id === messageID) {
        return true;
      }
      const text =
        candidate.rawText ??
        candidate.parts
          ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join('\n') ??
        '';
      return (
        text.includes(marker) ||
        (childIds.length > 0 && text.includes('[Async delegation update]') &&
          childIds.every((childId) => text.includes(childId)))
      );
    };

    if (this.messagesRepo.listBySession(parent.id, 2_000).some(matches)) {
      return true;
    }

    const parentSdkSessionId =
      parent.sdkSessionId ?? opencodeSessionMap.get(parent.id) ?? null;
    if (!parentSdkSessionId) return false;
    const maybeClient = opencodeClient as unknown as {
      listMessages?: (
        sdkId: string,
        directory?: string,
      ) => Promise<Array<{
        info?: { id?: string };
        parts?: Array<{ type?: string; text?: string }>;
      }>>;
    };
    if (typeof maybeClient.listMessages !== 'function') {
      // Unit/fake transports cannot inspect the engine. They have no independent
      // process that could have accepted a prompt after throwing, so a retry is
      // unambiguous in that environment.
      return false;
    }
    try {
      const messages = await maybeClient.listMessages.call(
        opencodeClient,
        parentSdkSessionId,
        parent.cwd,
      );
      return messages.some(matches);
    } catch (error) {
      logger.warn(
        `[AsyncDelegation] wake delivery inspection failed for ${parent.id}: ${String(error)}`,
      );
      return null;
    }
  }

  private deliveryMessageId(delegations: WakeDelegation[]): string {
    const stableIds = delegations
      .map((delegation) => delegation.id)
      .sort()
      .join(':');
    const digest = createHash('sha256').update(stableIds).digest('hex').slice(0, 24);
    return `msg_rhythm_async_${digest}`;
  }

  private deliveryMarker(messageID: string): string {
    return `<!-- rhythm-async-delegation:${messageID} -->`;
  }

  private buildWakeText(
    delegations: WakeDelegation[],
    messageID = this.deliveryMessageId(delegations),
  ): string {
    const blocks = delegations.map((delegation) => {
      // A child's output is only first-party if the CHILD never consumed external
      // content. When it did, that text is attacker-influenced and must be fenced
      // before it enters the parent's prompt — the rule in
      // docs/ai/decisions/2026-06-27-fence-untrusted-external-content.md.
      // This path previously interpolated it raw, which was the one place in the
      // system that injected possibly-tainted text into a prompt unfenced.
      const tainted = delegation.forceUntrusted ||
        childConsumedExternalContent(delegation.childSessionId ?? '');
      const body = delegation.completionText ?? '(no text result)';
      const renderedBody = tainted
        ? untrustedContext(body, `delegated result from @${delegation.targetAgentConfigId}`)
        : body;
      const outcome = delegation.errorText
        ? `failed (${delegation.errorText}):\n${renderedBody}`
        : `finished:\n${renderedBody}`;
      const childReference = delegation.forceUntrusted
        ? 'external runtime'
        : delegation.childSessionId ?? 'unknown';
      return (
        `- @${delegation.targetAgentConfigId} ` +
        `(delegated child session ${childReference}) ${outcome}`
      );
    });
    return (
      '[Async delegation update]\n' +
      `${blocks.join('\n\n')}\n\n` +
      'Incorporate these results into the conversation. Respect any newer user direction already in the session.\n' +
      this.deliveryMarker(messageID)
    );
  }
}

function sameNativeScope(
  left: NativeWorkstreamDeliveryScope,
  right: NativeWorkstreamDeliveryScope,
): boolean {
  return left.localUserId === right.localUserId
    && left.projectId === right.projectId
    && left.parentSessionId === right.parentSessionId
    && left.hostEpoch === right.hostEpoch;
}

interface WakeDelegation {
  id: string;
  childSessionId: string | null;
  targetAgentConfigId: string;
  completionText: string | null;
  errorText: string | null;
  forceUntrusted?: boolean;
}

function bridgeWakeDelegation(row: AgentBridgeJobRow): WakeDelegation {
  return {
    id: row.id,
    childSessionId: row.child_session_id,
    targetAgentConfigId: row.target_agent_id,
    completionText: row.result_text,
    errorText: row.state === 'failed' || row.state === 'unknown'
      ? row.state_reason ?? row.state
      : row.state === 'cancelled'
        ? 'cancelled'
        : null,
    forceUntrusted: true,
  };
}

/**
 * Did this child session read external content?
 *
 * Keyed off `agent_external_taint_state`, the same store the approval gate uses.
 * A child that only touched first-party data yields a result that needs no fence
 * and must not taint its parent — fencing everything would train the model to
 * ignore the fence, and tainting everything would put an approval gate in front
 * of every delegated result.
 */
function childConsumedExternalContent(childSessionId: string): boolean {
  if (!childSessionId) return false;
  try {
    const row = getDb()
      .prepare(`SELECT 1 FROM agent_external_taint_state WHERE session_id = ?`)
      .get(childSessionId);
    return Boolean(row);
  } catch {
    // Unknown taint status must fail SAFE: assume tainted and fence it.
    return true;
  }
}

export const asyncDelegationCompletionService =
  new AsyncDelegationCompletionService();
