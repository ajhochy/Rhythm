import { codingEffortVariant } from './coordinator_coding_effort';
import { opencodeClient } from './opencode_engine';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSession } from '../models/agent_session';
import type { AuthContext } from '../middleware/auth_middleware';
import { getDb } from '../database/db';
import { AgentConfigsRepository, agentConfigExecutionBlockReason } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { AgentApprovalsRepository, type AgentApproval } from '../repositories/agent_approvals_repository';
import { codingExecutionIntentHash, parseCodingExecutionProposal, type CoordinatorCodingExecutionProposal } from '../contracts/coordinator_coding_execution_contract';
import { codingEvaluatorPins } from './coordinator_coding_artifact_verifier';
import { CoordinatorCodingGrantJournal, type CodingGrantScope } from './coordinator_coding_grant_journal';
import { configureCodingGrantAdmissionResolver, configureCodingGrantAuthorityResolver, configureCodingResultAuthorityResolver } from './coordinator_coding_grant_permission';
import type { CodingProtectedOperation } from './coordinator_coding_operation_grant';
import { resolveSessionPermissionAuthority, resolveSessionPermissionOperation, type SessionPermissionAuthority } from './session_permission_authority';
import { resolveProfileScope } from './agent_profile_scope';
import { delegateToAgentAsync } from './agent_delegation_service';
import { readWorkflowProposal, workflowProposalDigest } from './chat_bounded_workflow';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const paths = ['src/selectTasks.ts', 'tests/selectTasks.test.mjs', 'package.json', 'tsconfig.json'];

/** One server-composed disposable fixture. No request-selected paths or policy setters. */
export class CoordinatorCodingExecutionService {
  private readonly sessions = new AgentSessionsRepository();
  private readonly configs = new AgentConfigsRepository();
  private readonly records = new CoordinatorConversationsRepository();
  constructor(private readonly projectAccess: (owner: number, project: string) => boolean) {}

  private workspace(root: string): string | null {
    try {
      const declared = process.env.RHYTHM_CODING_WORKSPACE_ROOT;
      if (!declared || declared !== root || !root.startsWith('/private/tmp/') || realpathSync(root) !== root ||
          !lstatSync(root).isDirectory() || lstatSync(root).uid !== process.getuid?.()) return null;
      return hash(JSON.stringify(paths.map(file => {
        const path = join(root, file), info = lstatSync(path);
        if (!info.isFile() || info.isSymbolicLink() || realpathSync(path) !== path || info.size > 1_048_576) throw new Error('unsupported workspace');
        return [file, hash(readFileSync(path))];
      })));
    } catch { return null; }
  }

  private rootCurrent(p: CoordinatorCodingExecutionProposal): boolean {
    const session = this.sessions.findById(p.sessionId);
    const profile = this.configs.getById(p.profileId);
    if (!session || !profile || session.sdkSessionId !== p.sdkSessionId || session.ownerUserId !== p.ownerUserId ||
        session.projectId !== p.projectId || session.cwd !== p.workspace.canonicalRoot || session.parentSessionId !== null ||
        session.permissionMode !== 'plan' || session.approvalBypassExplicit || session.archivedAt || session.status === 'closed' ||
        session.profileId !== p.profileId || !this.projectAccess(p.ownerUserId, p.projectId) ||
        agentConfigExecutionBlockReason(profile) || (profile.revision ?? 1) !== p.profileRevision ||
        hash(JSON.stringify(profile)) !== p.scopeFingerprint || !this.workspace(session.cwd)) return false;
    const root = this.records.get({ sessionId: p.sessionId, ownerUserId: p.ownerUserId, projectId: p.projectId });
    if (root.kind !== 'found' || !root.conversation.primaryOwnerRoot) return false;
    const goal = root.conversation.goals.find(g => g.id === p.goalId);
    return !!goal && goal.revision === p.goalRevision && goal.objective === p.objective && goal.state !== 'blocked';
  }

  isCurrent = (p: CoordinatorCodingExecutionProposal): boolean => {
    try {
      if (!parseCodingExecutionProposal(p) || Date.now() >= Date.parse(p.expiresAt) || !this.rootCurrent(p)) return false;
      for (const role of ['manager', 'worker'] as const) {
        const actual = this.configs.getById(p.chain[role].profileId);
        if (!actual || !actual.enabled || !actual.isAgent || agentConfigExecutionBlockReason(actual) ||
            (actual.revision ?? 1) !== p.chain[role].revision || hash(JSON.stringify(actual)) !== p.chain[role].policyFingerprint) return false;
      }
      const pins = codingEvaluatorPins();
      if (hash(readFileSync(p.command.executable)) !== p.command.executableDigest ||
          hash(readFileSync(p.command.argv[1])) !== p.command.loaderDigest ||
          pins.evaluatorDigest !== p.acceptance.evaluatorDigest || pins.runnerDigest !== p.acceptance.runnerDigest) return false;
      const grant = new CoordinatorCodingGrantJournal().read({sessionId:p.sessionId, ownerUserId:p.ownerUserId,
        projectId:p.projectId,commandKey:`coding-execution:${p.proposalId}`});
      // Edits are expected only after allocation of the exact worker. Before that, approve the exact base bytes.
      if (!grant?.state.worker && this.workspace(p.workspace.canonicalRoot) !== p.workspace.baseDigest) return false;
      if (grant?.state.revokedAt) return false;
      if(grant){
        const approval=new AgentApprovalsRepository().getById(grant.state.approvalId);
        if(!approval || approval.status!=='approved' || approval.actor!==`user:${p.ownerUserId}` || !approval.decidedAt || approval.decisionNonce!==null || !approval.consumedAt || approval.payloadDigest!==grant.state.proposalDigest || approval.payloadDigest!==workflowProposalDigest(p))return false;
        const cancelled=getDb().prepare(`SELECT 1 FROM agent_async_delegations WHERE coding_root_session_id=? AND coding_operation_key=? AND status='cancelled' LIMIT 1`).get(p.sessionId,`coding-execution:${p.proposalId}`);
        if(cancelled)return false;
      }
      return true;
    } catch { return false; }
  };

  async resolveProposal(auth: AuthContext, binding: {sessionId:string;projectId:string;sdkSessionId:string}, selector: string) {
    const session = this.sessions.findById(binding.sessionId);
    const profile = session?.profileId ? this.configs.getById(session.profileId) : null;
    const current = this.records.get({...binding,ownerUserId:auth.user.id});
    const base = session ? this.workspace(session.cwd) : null;
    if (!session || !profile || !base || current.kind !== 'found') return null;
    const goals = current.conversation.goals.filter(g => (g.id === selector || g.objective === selector) && g.state === 'captured');
    if (goals.length !== 1) return null;
    let catalog;try{catalog=await opencodeClient.providerSnapshot();}catch{return null;}
    const chain = {} as CoordinatorCodingExecutionProposal['chain'];
    chain.transport = 'rhythm_delegate_async';
    for (const [role,id] of [['manager','workflow-orchestrator'],['worker','coding-agent']] as const) {
      const config = this.configs.getById(id), scope = await resolveProfileScope(id);
      if (!config || !config.reasoningEffort || !scope.model) return null;
      chain[role] = {profileId:id,revision:config.revision??1,policyFingerprint:hash(JSON.stringify(config)),
        providerId:scope.model.providerID,modelId:scope.model.modelID,
        modelVersion:scope.model.modelID,reasoningEffort:config.reasoningEffort};
      if(!codingEffortVariant(chain[role],catalog))return null;
    }
    const executable=realpathSync(process.execPath),loader=realpathSync(require.resolve('tsx'));
    const proposedAt=new Date().toISOString(),pins=codingEvaluatorPins();
    const p: CoordinatorCodingExecutionProposal = {schemaVersion:1,purpose:'coordinator_coding_execution_v1',proposalId:randomUUID(),
      ownerUserId:auth.user.id,...binding,profileId:profile.id,profileRevision:profile.revision??1,scopeFingerprint:hash(JSON.stringify(profile)),
      controlRevision:current.conversation.controlRevision,goalId:goals[0].id,goalRevision:goals[0].revision,objective:goals[0].objective,
      normalizedIntentHash:'',workspace:{id:binding.projectId,generation:1,canonicalRoot:session.cwd,baseDigest:base,readablePaths:paths,
        writablePaths:['src/selectTasks.ts','tests/selectTasks.test.mjs']},chain,
      command:{id:'selectTasks-tests-v1',cwd:session.cwd,executable,executableDigest:hash(readFileSync(executable)),
        loaderDigest:hash(readFileSync(loader)),argv:['--import',loader,'--test','tests/selectTasks.test.mjs'],env:{},
        shellCommand:[executable,'--import',loader,'--test','tests/selectTasks.test.mjs'].map(value=>"'"+value.replaceAll("'","'\"'\"'")+"'").join(' ')},
      limits:{managerAttempts:1,workerAttempts:1,concurrentWorkers:1,automaticRetries:0,managerCompletionWakes:1,rootCompletionWakes:0,
        taskWallSeconds:600,workerWallSeconds:300,totalSoftTokens:75000,includesManagerCompletion:true},
      acceptance:{evaluatorId:'selectTasks-independent-v1',version:1,evaluatorDigest:pins.evaluatorDigest,runnerDigest:pins.runnerDigest,
        writableByWorker:false,capture:'immutable_allowed_bytes_v1',criteria:['open','done','omitted','empty_no_match','order','unsupported_status','input_preservation']},
      proposedAt,expiresAt:new Date(Date.parse(proposedAt)+900000).toISOString()};
    p.normalizedIntentHash=codingExecutionIntentHash(p);
    return this.isCurrent(p)?parseCodingExecutionProposal(p):null;
  }

  async dispatchManager(p: CoordinatorCodingExecutionProposal, scope: CodingGrantScope): Promise<boolean> {
    if (!this.isCurrent(p)) return false;
    try {
      const result=await delegateToAgentAsync({authenticatedUserId:p.ownerUserId,callerAgentConfigId:p.profileId,
        callerSessionId:p.sessionId,targetAgentConfigId:'workflow-orchestrator',cwd:p.workspace.canonicalRoot,isolateWorktree:false,
        prompt:`${p.objective}\nYou are the single PLAN manager. Delegate exactly one coding-agent via rhythm_delegate_async to implement optional open/done filtering in src/selectTasks.ts, preserving inputs and order, throwing on unsupported status. The worker alone may edit ${p.workspace.writablePaths.join(', ')} and run exactly ${p.command.shellCommand}. No other commands, descendants, retries, commit, push or installation. Wait for its completion once, then report actual results. Independent evaluation and original-chat delivery are server-owned. Soft aggregate allowance ${p.limits.totalSoftTokens} tokens including your completion; worker 300s, task 600s.`});
      return result.status==='dispatched' && !!new CoordinatorCodingGrantJournal().read(scope)?.state.manager;
    } catch {return false;}
  }

  /** Called only for already signed decisions by the existing approval continuation owner. */
  async consumeDecision(approval: AgentApproval): Promise<boolean> {
    const p=readWorkflowProposal(approval);
    if (!p || p.purpose!=='coordinator_coding_execution_v1') return false;
    if (approval.status==='rejected') return true;
    if (!this.isCurrent(p)) return false;
    const scope={sessionId:p.sessionId,ownerUserId:p.ownerUserId,projectId:p.projectId,commandKey:`coding-execution:${p.proposalId}`};
    const reserved=new CoordinatorCodingGrantJournal().reserveManager(scope,approval.id,p,()=>this.isCurrent(p));
    if (reserved==='held') return false;
    if (reserved==='replay') return true; // ambiguity is never a retry
    return this.dispatchManager(p,scope);
  }

  private childTermsCurrent(row:AgentSession, expected:CoordinatorCodingExecutionProposal['chain']['worker']):boolean {
    const named=/\(@([^\s)]+) subagent\)\s*$/.exec(row.name)?.[1];
    const selected=row.profileId??row.mcpRole??(named===row.agentKind?named:undefined);
    return selected===expected.profileId && row.providerId===expected.providerId && row.modelId===expected.modelId &&
      row.modelMode==='fixed' && row.routerVariant===expected.reasoningEffort;
  }

  private operationPolicyAction(authority:SessionPermissionAuthority, operation:CodingProtectedOperation):'deny'|'ask'|'allow' {
    const pattern=operation.kind==='bash'?operation.command:operation.path;
    const permissionAction=resolveSessionPermissionOperation({...authority,mode:'default'},operation.kind,[pattern],
      operation.kind==='bash'?{command:operation.command,env:operation.env}:{});
    const nativeAction=operation.nativeTool && ['read','edit','write','apply_patch','bash'].includes(operation.nativeTool)
      ? resolveSessionPermissionOperation({...authority,mode:'default'},operation.nativeTool,[pattern]) : 'deny';
    return permissionAction==='deny'||nativeAction==='deny'?'deny':permissionAction;
  }

  composePermissionAuthority(): void {
    configureCodingResultAuthorityResolver(p=>{
      if(!this.isCurrent(p))return false;
      const scope={sessionId:p.sessionId,ownerUserId:p.ownerUserId,projectId:p.projectId,commandKey:`coding-execution:${p.proposalId}`};
      const grant=new CoordinatorCodingGrantJournal().read(scope);
      if(!grant?.state.manager || !grant.state.worker || grant.state.revokedAt)return false;
      try{
        const a=resolveSessionPermissionAuthority(grant.state.worker.localId,{ownerUserId:p.ownerUserId,sdkSessionId:grant.state.worker.sdkId,directory:p.workspace.canonicalRoot});
        const [worker,manager,root]=a.chain;
        if(a.chain.length!==3 || worker.id!==grant.state.worker.localId || manager.id!==grant.state.manager.localId ||
          manager.sdkSessionId!==grant.state.manager.sdkId || root.id!==p.sessionId || root.sdkSessionId!==p.sdkSessionId ||
          !this.childTermsCurrent(worker,p.chain.worker) || !this.childTermsCurrent(manager,p.chain.manager) ||
          worker.permissionMode!=='default' || manager.permissionMode!=='plan' || root.permissionMode!=='plan' ||
          [worker,manager,root].some(x=>x.archivedAt || ['closed','error','resumable'].includes(x.status)))return false;
        const rows=getDb().prepare(`SELECT * FROM agent_async_delegations WHERE coding_root_session_id=? AND coding_operation_key=?`).all(p.sessionId,scope.commandKey) as Array<Record<string,unknown>>;
        const managers=rows.filter(x=>x.coding_delivery_mode==='coding_root_v1'),workers=rows.filter(x=>x.coding_delivery_mode==='coding_worker_v1');
        return managers.length===1 && workers.length===1 && managers[0].child_session_id===manager.id && workers[0].child_session_id===worker.id &&
          managers[0].parent_session_id===root.id && workers[0].parent_session_id===manager.id && managers[0].status==='completed' &&
          ['completed','waking','notified'].includes(String(workers[0].status)) &&
          JSON.parse(String(managers[0].coding_terminal_json)).execution==='completed' && JSON.parse(String(workers[0].coding_terminal_json)).execution==='completed';
      }catch{return false;}
    });
    configureCodingGrantAdmissionResolver(({proposal:p,role,callerLocalId,callerSdkId})=>{
      if (!this.isCurrent(p)) return false;
      try { const authority=resolveSessionPermissionAuthority(callerLocalId,{ownerUserId:p.ownerUserId,sdkSessionId:callerSdkId,directory:p.workspace.canonicalRoot});
        return authority.session.permissionMode==='plan' && authority.chain.at(-1)?.id===p.sessionId &&
          (role==='manager'?callerLocalId===p.sessionId:authority.session.parentSessionId===p.sessionId && this.childTermsCurrent(authority.session,p.chain.manager));
      } catch {return false;}
    });
    configureCodingGrantAuthorityResolver(({scope,binding,operation})=>{
      try {
        const row=new CoordinatorCodingGrantJournal().read(scope),approval=row?new AgentApprovalsRepository().getById(row.state.approvalId):null;
        const p=approval?readWorkflowProposal(approval):null;
        if (!p || p.purpose!=='coordinator_coding_execution_v1' || !this.isCurrent(p)) return null;
        const authority=resolveSessionPermissionAuthority(binding.workerLocalId,{ownerUserId:p.ownerUserId,sdkSessionId:binding.workerSdkId,directory:p.workspace.canonicalRoot});
        const [worker,manager,root]=authority.chain;
        if (authority.chain.length!==3 || !this.childTermsCurrent(worker,p.chain.worker) || !this.childTermsCurrent(manager,p.chain.manager) || worker.permissionMode!=='default' || manager.permissionMode!=='plan' || root.permissionMode!=='plan' ||
            worker.id!==binding.workerLocalId || manager.id!==binding.managerLocalId || root.id!==binding.rootLocalId) return null;
        const leases=getDb().prepare(`SELECT child_session_id,parent_session_id,coding_delivery_mode,status FROM agent_async_delegations
          WHERE coding_root_session_id=? AND coding_operation_key=?`).all(p.sessionId,scope.commandKey) as Array<{child_session_id:string;parent_session_id:string;coding_delivery_mode:string;status:string}>;
        const managers=leases.filter(x=>x.coding_delivery_mode==='coding_root_v1'),workers=leases.filter(x=>x.coding_delivery_mode==='coding_worker_v1');
        if(managers.length!==1 || workers.length!==1 || managers[0].child_session_id!==manager.id || managers[0].parent_session_id!==root.id ||
          workers[0].child_session_id!==worker.id || workers[0].parent_session_id!==manager.id ||
          managers[0].status!=='dispatched' || workers[0].status!=='dispatched' ||
          !['starting','working'].includes(worker.status) || !['starting','working','idle'].includes(manager.status) ||
          !row || row.state.manager?.localId!==manager.id || row.state.worker?.localId!==worker.id || row.state.revokedAt)return null;
        const currentRoot=this.records.get(scope),goal=currentRoot.kind==='found'?currentRoot.conversation.goals.find(g=>g.id===p.goalId):null;
        const goalActive=!!goal && goal.state!=='blocked' && goal.revision===p.goalRevision;
        if(!goalActive)return null;
        // Relax ONLY inherited PLAN for this exact worker; intersect actual native tool and permission policies.
        const effectiveAction=this.operationPolicyAction(authority,operation);
        const usageRows=getDb().prepare(`SELECT tokens_json FROM agent_session_messages WHERE role='output' AND session_id IN (?,?)`)
          .all(manager.id,worker.id) as Array<{tokens_json:string|null}>;
        let usageTokens:number|null=0;
        for (const item of usageRows) {
          if (!item.tokens_json) {usageTokens=null;break;}
          const u=JSON.parse(item.tokens_json),values=[u.input,u.output,u.reasoning,u.cache?.read,u.cache?.write];
          if (!values.every(n=>Number.isSafeInteger(n)&&n>=0)) {usageTokens=null;break;}
          usageTokens+=values.reduce((sum,n)=>sum+n,0);
        }
        return {ownerUserId:p.ownerUserId,projectId:p.projectId,rootLocalId:root.id,rootSdkId:root.sdkSessionId!,
          managerLocalId:manager.id,managerSdkId:manager.sdkSessionId!,managerParentLocalId:manager.parentSessionId!,
          workerLocalId:worker.id,workerSdkId:worker.sdkSessionId!,workerParentLocalId:worker.parentSessionId!,
          rootMode:'plan',managerMode:'plan',workerMode:'default',proposal:p,goalActive,projectAccessible:this.projectAccess(p.ownerUserId,p.projectId),profilesEligible:true,
          paused:!['starting','working'].includes(worker.status),cancelled:leases.some(x=>x.status==='cancelled'),usageTokens,effectiveAction,toolAllowed:effectiveAction!=='deny',exactWorkerPlanException:true};
      } catch {return null;}
    });
  }
}
