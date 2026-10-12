import { asyncDelegationCompletionService } from './async_delegation_completion_service';
import { releaseDeliveryHold, readDeliveryTestState } from './coordinator_coding_delivery_controls';
import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { getDb } from '../database/db';
import { env } from '../config/env';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { UsersRepository } from '../repositories/users_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { DayflowReceivingContextRepository } from '../repositories/dayflow_receiving_context_repository';
import { resolveAuthenticatedDayflowConsentScope } from '../routes/dayflow_authenticated_management_routes';
import { DayflowIntegrationService } from '../integrations/dayflow/service';
import { DayflowConfigStore } from '../integrations/dayflow/config_store';
import { MemoryLedger } from '../integrations/dayflow/ledger';
import { DayflowSqliteSource, verifyDayflowJournal } from '../integrations/dayflow/sqlite_source';
import { AuthenticatedDayflowMemoryClient } from '../integrations/dayflow/authenticated_memory_client';
import { DayflowPersistedQualificationAuthority } from '../integrations/dayflow/persisted_qualification_authority';
import { createDayflowManagementAdapter } from '../integrations/dayflow/management_adapter';
import { DayflowCanonicalEvidenceResolver, type DayflowQualifiedEvidenceService } from './dayflow_qualified_evidence_service';
import type { DayflowGuardEnrollmentService } from './dayflow_receiving_context_authority';
import { DayflowReceivingHistoryGuard, DayflowProviderAdmissionService } from './dayflow_receiving_history_guard';
import { createObservationIfAbsentInVault } from './memoryVaultWriteService';
import { MemoryIndexService } from './memory_index_service';
import { opencodeClient, opencodeSessionMap } from './opencode_engine';
import { resolveProfileScope } from './agent_profile_scope';
import { bindQualificationDispatch, qualificationDispatchSnapshot } from './qualification_dispatch_counters';
import { loadQualificationFixtureAuthority, qualificationApiBootId } from './qualification_fixture_authority';
import { configureRouterGridFixtureResolver, type RouterGridFixtureDependencies } from './decision/router_grid_turn';
import { defaultDecisionSettings } from './decision/decision_settings';
import { normaliseRouterGridConfig } from './decision/router_grid_config';
import { RouterGridExhaustionStore } from './decision/router_grid_exhaustion';
import { OAuthAccountsStore } from './anthropic_accounts_store';
import { AnthropicAccountsService } from './anthropic_accounts_service';
import { OpenAIAccountsService } from './openai_accounts_service';
import { OpenAIDecisionsClient } from './decision/openai_decisions_client';
import { handleInputFrame } from './ws_gateway';
import type { CoordinatorConversationService } from './coordinator_conversation_service';
import type { AuthContext } from '../middleware/auth_middleware';
import { codingDockerPins, codingDockerRuntimeDigest, codingEvaluatorPins, captureCodingSnapshot, verifyCodingSnapshot } from './coordinator_coding_artifact_verifier';

export const fixtureModes=['dayflow','router-exhaustion','router-corrupt','coordinator-delivery'] as const;
type Mode=typeof fixtureModes[number];
interface Fixture {id:string;mode:Mode;sessionId:string;sdkSessionId:string;projectId:string;cwd:string;enginePid:number;engineBootId:string;
  apiBootId:string;monitoredSdkIds?:string[];dayflow?:{service:DayflowIntegrationService;guard:DayflowReceivingHistoryGuard;admission:DayflowProviderAdmissionService;authority:DayflowPersistedQualificationAuthority;memoryRoot:string;canary:string};router?:RouterGridFixtureDependencies}
const fixtures=new Map<string,Fixture>();
export function qualificationStopBeforeSdk(sessionId:string):boolean {return [...fixtures.values()].some(f=>f.sessionId===sessionId && !!f.router);}
export function qualificationDayflowForSdk(sdkSessionId:string){return [...fixtures.values()].find(f=>f.sdkSessionId===sdkSessionId)?.dayflow??null;}
export function qualificationDeliveryRoot(sessionId:string):boolean {
  const m=loadQualificationFixtureAuthority(),row=new AgentSessionsRepository().findById(sessionId);
  return !!m && !!row && row.ownerUserId===m.ownerUserId && row.cwd.startsWith(m.fixtureRoot+'/') && ![...fixtures.values()].some(f=>f.sessionId===sessionId && f.mode!=='coordinator-delivery');
}

/** The server's one Dayflow enrollment and the evidence factory bound to it (one guard registration). */
export interface QualificationDayflowSeam {
  guardEnrollment: DayflowGuardEnrollmentService;
  evidenceFor(reader: DayflowIntegrationService, canonical: DayflowCanonicalEvidenceResolver): DayflowQualifiedEvidenceService;
}
export class QualificationFixtureService {
  private readonly m=loadQualificationFixtureAuthority()!;
  private protectedProbe:Promise<boolean>|null=null;
  constructor(private readonly coordinator:CoordinatorConversationService,private readonly dayflowSeam?:QualificationDayflowSeam){
    if(!this.m || env.dbClient!=='sqlite' || env.dbPath!==this.m.dbPath)throw new Error('qualification fixture startup absent');
    configureRouterGridFixtureResolver(sessionId=>{
      const f=[...fixtures.values()].find(x=>x.sessionId===sessionId),row=new AgentSessionsRepository().findById(sessionId);
      return f?.router && f.apiBootId===qualificationApiBootId && row?.sdkSessionId===f.sdkSessionId && row.cwd===f.cwd && row.projectId===f.projectId && row.ownerUserId===this.m.ownerUserId?f.router:null;
    });
  }
  private actor():AuthContext {return {sessionToken:'qualification-fixture-authority',user:new UsersRepository().findById(this.m.ownerUserId)};}
  private async probe():Promise<boolean>{
    const root=join(this.m.fixtureRoot,'protected-evaluator-probe');mkdirSync(root,{recursive:true,mode:0o700});mkdirSync(join(root,'src'),{recursive:true,mode:0o700});
    writeFileSync(join(root,'src/selectTasks.ts'),"export function selectTasks(tasks:any[], status?:string){if(status!==undefined && status!=='open' && status!=='done')throw Error('unsupported');return tasks.filter(t=>status===undefined || t.status===status)}",{mode:0o600});
    const snapshots=join(this.m.fixtureRoot,'protected-evaluator-probe-captures');mkdirSync(snapshots,{recursive:true,mode:0o700});
    const evaluate=async()=>verifyCodingSnapshot(await captureCodingSnapshot(root,['src/selectTasks.ts'],snapshots),codingEvaluatorPins(),{docker:{pins:codingDockerPins(codingDockerRuntimeDigest),context:{rootSessionId:'qualification-runtime-probe',operationKey:this.m.sourceRevision}}});
    const good=await evaluate();writeFileSync(join(root,'src/selectTasks.ts'),'export function selectTasks(){return []}',{mode:0o600});const bad=await evaluate();
    return good.qualified===true && good.verdict==='passed' && bad.qualified===true && bad.verdict==='failed';
  }
  async capability(){
    const engine=await opencodeClient.getEngineIdentity();if(!engine)throw new Error('qualification engine unavailable');
    this.protectedProbe??=this.probe();
    return {available:true,sourceRevision:this.m.sourceRevision,runtime:{apiPid:process.pid,enginePid:engine.pid,enginePort:Number(process.env.RHYTHM_OPENCODE_ENGINE_PORT),bootId:qualificationApiBootId},fixtureModes,protectedEvaluator:{qualified:await this.protectedProbe}};
  }
  private rotatePrimary(nextId:string|null):void {
    const db=getDb();db.transaction(()=>{
      if(db.prepare("SELECT 1 FROM agent_approvals WHERE status='pending' LIMIT 1").get() || db.prepare("SELECT 1 FROM agent_async_delegations WHERE coding_delivery_mode='coding_root_v1' LIMIT 1").get())throw new Error('fixture primary rotation forbidden with real coding/approval authority');
      const primary=new CoordinatorConversationsRepository().findPrimaryOwnerRoot(this.m.ownerUserId);
      if(primary.kind==='found'){
        const old=[...fixtures.values()].find(f=>f.sessionId===primary.conversation.sessionId && f.mode==='dayflow');
        const row=new AgentSessionsRepository().findById(primary.conversation.sessionId);
        if(!old || old.apiBootId!==qualificationApiBootId || !row || row.ownerUserId!==this.m.ownerUserId || row.cwd!==old.cwd || !row.cwd.startsWith(this.m.fixtureRoot+'/'))throw new Error('ordinary root cannot rotate');
        db.prepare("UPDATE agent_sessions SET coordinator_conversation_json=json_set(coordinator_conversation_json,'$.primaryOwnerRoot',json('false')) WHERE id=?").run(row.id);
      }else if(primary.kind!=='not_found')throw new Error('fixture primary integrity hold');
      if(nextId){const f=[...fixtures.values()].find(x=>x.sessionId===nextId && x.mode==='dayflow');if(!f)throw new Error('next root not a fixture');
        const result=new CoordinatorConversationsRepository().designatePrimaryOwnerRoot({sessionId:f.sessionId,ownerUserId:this.m.ownerUserId,projectId:f.projectId});if(result.kind!=='found')throw new Error('fixture designation failed');}
    }).immediate();
  }
  clearDayflowDesignationForCoordinator():void {this.rotatePrimary(null);}
  async create(mode:Mode):Promise<Fixture>{
    if(!fixtureModes.includes(mode))throw new Error('unknown fixture mode');
    if(mode==='coordinator-delivery'){
      const row=getDb().prepare(`SELECT a.coding_root_session_id root FROM agent_async_delegations a JOIN agent_sessions s ON s.id=a.coding_root_session_id
        WHERE a.coding_delivery_mode='coding_root_v1' AND a.coding_result_receipt_json IS NOT NULL AND s.owner_user_id=? ORDER BY a.created_at DESC LIMIT 1`).get(this.m.ownerUserId) as {root:string}|undefined;
      if(!row)throw new Error('genuine completed coding receipt required');const session=new AgentSessionsRepository().findById(row.root)!;
      const engine=await opencodeClient.getEngineIdentity();if(!engine || !session.sdkSessionId || !session.projectId)throw new Error('coding delivery binding unavailable');
      if(!qualificationDeliveryRoot(session.id))throw new Error('foreign genuine receipt');
      const f:Fixture={id:randomUUID(),mode,sessionId:session.id,sdkSessionId:session.sdkSessionId,projectId:session.projectId,cwd:session.cwd,enginePid:engine.pid,engineBootId:engine.bootId,apiBootId:qualificationApiBootId};
      const children=getDb().prepare(`SELECT s.id,s.sdk_session_id,s.project_id,s.cwd FROM agent_sessions s WHERE s.id=? OR s.parent_session_id=? OR s.parent_session_id IN(SELECT id FROM agent_sessions WHERE parent_session_id=?)`).all(session.id,session.id,session.id) as Array<{id:string;sdk_session_id:string;project_id:string;cwd:string}>;
      f.monitoredSdkIds=[];
      for(const child of children){if(!child.sdk_session_id)throw new Error('coding SDK missing');bindQualificationDispatch({fixtureId:f.id,sessionId:child.id,sdkSessionId:child.sdk_session_id,projectId:child.project_id,cwd:child.cwd,enginePid:engine.pid,engineBootId:engine.bootId,canary:null});f.monitoredSdkIds.push(child.sdk_session_id);}
      fixtures.set(f.id,f);return f;
    }
    const id=randomUUID(),cwd=join(this.m.fixtureRoot,'workspaces',id);mkdirSync(cwd,{recursive:true,mode:0o700});
    const project=new ProjectsRepository().createCoordinatorOwned({ownerUserId:this.m.ownerUserId,setupKey:'qualification:'+id,cwd,profileId:'secretary',name:'Invented qualification '+mode,workspaceGeneration:1}).project;
    const sessions=new AgentSessionsRepository(),scope=await resolveProfileScope('secretary');
    const row=sessions.insert({name:'Invented qualification '+mode,agentKind:'claude-code',profileId:'secretary' as never,opencodeAgentId:'secretary' as never,taskId:null,cwd,projectId:project.id,ownerUserId:this.m.ownerUserId,permissionMode:'plan',modelMode:'auto'});
    const created=await opencodeClient.createSession(row.name,cwd,scope.mcpRoleConfig??undefined,[],scope.model?.providerID,undefined,'plan',true);
    if(!created.id)throw new Error('actual SDK fixture creation failed');sessions.setSdkSessionId(row.id,created.id);sessions.updateStatus(row.id,'idle');opencodeSessionMap.set(row.id,created.id);
    const engine=await opencodeClient.getEngineIdentity();if(!engine)throw new Error('engine identity unavailable');
    const f:Fixture={id,mode,sessionId:row.id,sdkSessionId:created.id,projectId:project.id,cwd,enginePid:engine.pid,engineBootId:engine.bootId,apiBootId:qualificationApiBootId};fixtures.set(id,f);
    if(mode==='dayflow'){this.rotatePrimary(row.id);f.dayflow=await this.dayflow(f);}
    else f.router=this.router(f,mode==='router-corrupt');
    bindQualificationDispatch({fixtureId:id,sessionId:f.sessionId,sdkSessionId:f.sdkSessionId,projectId:f.projectId,cwd,enginePid:engine.pid,engineBootId:engine.bootId,canary:f.dayflow?.canary??null});
    return f;
  }
  private router(f:Fixture,corrupt:boolean):RouterGridFixtureDependencies{
    const root=join(this.m.fixtureRoot,'router',f.id);mkdirSync(root,{recursive:true,mode:0o700});
    const openai=new OAuthAccountsStore(join(root,'openai.json')),anthropic=new OAuthAccountsStore(join(root,'anthropic.json'));
    for(const id of ['fixture-account-a','fixture-account-b'])openai.upsertAccount({id,label:id,access:'invented-not-a-credential',refresh:'invented-not-a-credential',expires:Date.now()+3600000,status:'ok'});
    const noNetwork=async()=>{throw new Error('fixture account network forbidden');};
    const model='openai/gpt-6.1-sol',effort='xhigh',candidate={model,effort,cost_per_task:0};
    const config=normaliseRouterGridConfig({routing:{coding:{1:[candidate],2:[candidate],3:[candidate],4:[candidate]},knowledge:'SAME_AS:coding',design:'SAME_AS:coding'},free_mode:{enabled:corrupt}});
    const settings=defaultDecisionSettings();settings.routing.engine='grid';settings.features.model_routing='on';
    const statePath=join(root,'router-free-state.json');if(corrupt)writeFileSync(statePath,'{ malformed state',{mode:0o600});
    return {config,settings,statePath,exhaustion:new RouterGridExhaustionStore(join(root,'exhaustion.json')),
      inventory:{openai:new OpenAIAccountsService(openai,noNetwork,join(root,'engine-auth.json')),anthropic:new AnthropicAccountsService(anthropic,noNetwork)},
      usage:async()=>({fetchedAt:new Date().toISOString(),providers:['fixture-account-a','fixture-account-b'].map((accountId,i)=>({provider:'openai' as const,label:accountId,accountId,kind:'window' as const,items:[{label:'invented bounded quota',remainingFraction:i===0?.9:.6,resetAt:new Date(Date.now()+3600000).toISOString()}]}))}),
      classifierClient:new OpenAIDecisionsClient({baseUrl:'http://127.0.0.1',model:'fixture-disabled',apiKey:'',consent:false,fetchImpl:noNetwork}),
      authedProviders:async()=>['openai'],catalog:async()=>({source:'live' as const,fetchedAt:new Date().toISOString(),curatedCount:1,tiers:{mode:'manual' as const,cheapMaxOutputUsd:0,frontierMinOutputUsd:1,derivedFromModels:1},models:[{providerID:'openai',modelID:'gpt-6.1-sol',name:'Invented Sol inventory',family:'gpt',tier:'standard' as const,tierSource:'override' as const,costInputUsd:1,costOutputUsd:1,releaseDate:null,contextLimit:100000,reasoning:true,variants:['xhigh'],keyless:false}]})};
  }
  private async dayflow(f:Fixture):Promise<NonNullable<Fixture['dayflow']>>{
    const root=join(this.m.fixtureRoot,'dayflow',f.id),memoryRoot=join(this.m.fixtureRoot,'memory');mkdirSync(root,{recursive:true,mode:0o700});mkdirSync(memoryRoot,{recursive:true,mode:0o700});
    const journal=join(root,'timeline.sqlite'),db=new Database(journal),date=new Date(Date.now()-86400000).toISOString().slice(0,10),canary='invented_amber_schedule_'+f.id.replaceAll('-','');
    db.exec('CREATE TABLE timeline_cards(id INTEGER PRIMARY KEY,start_ts INTEGER,end_ts INTEGER,title TEXT,summary TEXT,detailed_summary TEXT,category TEXT,subcategory TEXT,metadata TEXT,is_deleted INTEGER)');
    db.prepare("INSERT INTO timeline_cards VALUES(1,?,?,?,?,?,'work','fixture','{}',0)").run(Date.parse(date+'T12:00:00Z')/1000,Date.parse(date+'T12:30:00Z')/1000,'Invented rehearsal schedule',canary+' rehearsal at 15:30','Invented activity fixture only.');db.close();chmodSync(journal,0o600);
    const config=new DayflowConfigStore(join(root,'config.json')),ledger=new MemoryLedger(join(root,'ledger.json')),authority=new DayflowPersistedQualificationAuthority(config,ledger);
    const memory=new AuthenticatedDayflowMemoryClient(authority,{createOnly:(input,options)=>createObservationIfAbsentInVault(input,{...options,memoryDir:memoryRoot}),indexForOwner:owner=>new MemoryIndexService(new AgentMemoryRepository(),owner)});
    const service=new DayflowIntegrationService({source:new DayflowSqliteSource(),memoryClient:memory,configStore:config,ledger,journalVerifier:{verify:verifyDayflowJournal},sourceForJournal:j=>new DayflowSqliteSource(j),qualificationAuthority:authority});
    const adapter=createDayflowManagementAdapter(service),check=await adapter.checkReadiness({bundlePath:journal});if(!check.selectionToken)throw new Error('actual Dayflow selection unavailable');
    await adapter.updateConfig({sourceSelectionToken:check.selectionToken});await adapter.updateConfig({enabled:true,automaticImport:true,timezone:'UTC'});
    const consent=resolveAuthenticatedDayflowConsentScope(this.m.ownerUserId,{schemaVersion:1,action:'grant',sessionId:f.sessionId,projectId:f.projectId});if(!consent)throw new Error('actual Dayflow consent scope unavailable');service.grantAuthenticatedSourceConsent(consent.scope);
    // Consent binds this final configuration generation. A subsequent config
    // update would revoke it; the real automatic scheduler starts after 15m.
    const preview=await adapter.preview({date});await adapter.commit({token:preview.token,candidateIds:preview.candidates.map(x=>x.candidateId)});
    // A second enrollment would be a second native guard registration; reuse the server's.
    if(!this.dayflowSeam)throw new Error('server Dayflow enrollment unavailable');
    const records=new DayflowReceivingContextRepository(getDb()),enrollment=this.dayflowSeam.guardEnrollment;
    const evidence=this.dayflowSeam.evidenceFor(service,new DayflowCanonicalEvidenceResolver({memoryRoot:()=>memoryRoot}));
    return {service,authority,memoryRoot,canary,guard:new DayflowReceivingHistoryGuard({reader:service,records,authority,enrollment,evidence}),admission:new DayflowProviderAdmissionService({records,engine:opencodeClient,reader:service,evidence,authority,enrollment})};
  }
  private bindings(f:Fixture){return {fixtureId:f.id,sessionId:f.sessionId,sdkSessionId:f.sdkSessionId,sourceRevision:this.m.sourceRevision,apiPid:process.pid,enginePid:f.enginePid,enginePort:Number(process.env.RHYTHM_OPENCODE_ENGINE_PORT),bootId:qualificationApiBootId};}
  private async frontdoor(f:Fixture){const errors:string[]=[];await handleInputFrame({send(raw:string){const v=JSON.parse(raw);if(v.type==='error')errors.push(String(v.message));}} as never,{type:'session.input',id:f.sessionId,data:'Extract the invented fixture names.'},{origin:'prompt_api',agent:'secretary'});return errors;}
  private async positive(f:Fixture,waitMs=7500){
    const root=new CoordinatorConversationsRepository().get({sessionId:f.sessionId,ownerUserId:this.m.ownerUserId,projectId:f.projectId});if(root.kind!=='found')throw new Error('actual receiver unavailable');
    await this.coordinator.receiveMessage(this.actor(),{sessionId:f.sessionId,projectId:f.projectId,expectedControlRevision:root.conversation.controlRevision,commandKey:'qualification:'+randomUUID(),message:'Describe the invented rehearsal schedule from prior-day Dayflow context in one sentence. Do not use tools.'});
    const until=Date.now()+waitMs;while(Date.now()<until){const observed=qualificationDispatchSnapshot(f.sdkSessionId);if(observed.provider>0 && observed.contextInjected){await opencodeClient.abortSession(f.sdkSessionId,f.cwd);return observed;}await new Promise(r=>setTimeout(r,50));}
    throw new Error('actual fixture provider handoff not observed');
  }
  async runCase(id:string,caseName:string){
    const f=fixtures.get(id);if(!f || f.apiBootId!==qualificationApiBootId)throw new Error('fixture stale or foreign');
    const engine=await opencodeClient.getEngineIdentity();if(!engine || engine.pid!==f.enginePid || engine.bootId!==f.engineBootId)throw new Error('fixture engine boot changed');
    const snapshot=()=>f.monitoredSdkIds?.reduce((a,sdk)=>{const b=qualificationDispatchSnapshot(sdk);return {sdk:a.sdk+b.sdk,provider:a.provider+b.provider,contextInjected:a.contextInjected||b.contextInjected};},{sdk:0,provider:0,contextInjected:false})??qualificationDispatchSnapshot(f.sdkSessionId);
    const before=snapshot(),caseDeadline=Date.now()+9000;
    const checks:Array<{id:string;pass:boolean;observed:unknown}>=[],limits:string[]=[];
    if(f.dayflow){
      if(caseName==='dayflow-unenrolled'){
        // Fresh ordinary session has never received Dayflow exposure; source consent is revoked before dispatch.
        this.rotatePrimary(null);
        const records=new DayflowReceivingContextRepository(getDb());if(records.listSdkHistory(f.sdkSessionId)?.length!==0)throw new Error('unenrolled fixture already has retained exposure');
        const consent=resolveAuthenticatedDayflowConsentScope(this.m.ownerUserId,{schemaVersion:1,action:'revoke',sessionId:f.sessionId,projectId:f.projectId});if(!consent)throw new Error('fixture consent scope absent');f.dayflow.service.revokeAuthenticatedSourceConsent(consent.scope);
        if(await f.dayflow.guard.shouldBindPrompt(f.sdkSessionId))throw new Error('unrelated fixture still enrolled for source');
        const result=await this.frontdoor(f),until=Date.now()+7500;while(Date.now()<until && qualificationDispatchSnapshot(f.sdkSessionId).provider===before.provider)await new Promise(r=>setTimeout(r,50));
        const after=qualificationDispatchSnapshot(f.sdkSessionId);await opencodeClient.abortSession(f.sdkSessionId,f.cwd);if(after.provider<=before.provider)throw new Error('actual ordinary provider dispatch missing');
        checks.push({id:'unenrolled',pass:result.length===0 && !after.contextInjected,observed:{admission:result.length?'held':'allowed',contextInjected:after.contextInjected}});
      }else{
        const positive=await this.positive(f);if(!positive.contextInjected)throw new Error('actual canonical context missing from provider input');
        if(caseName==='dayflow-receiver')checks.push({id:'receiver',pass:true,observed:{admission:'allowed',receiverSessionId:f.sessionId,contextInjected:true}});
        else{
          const retained=new DayflowReceivingContextRepository(getDb()).listSdkHistory(f.sdkSessionId);if(!retained?.length)throw new Error('actual retained exposure missing');
          if(caseName==='dayflow-revoked'){const consent=resolveAuthenticatedDayflowConsentScope(this.m.ownerUserId,{schemaVersion:1,action:'revoke',sessionId:f.sessionId,projectId:f.projectId});if(!consent)throw new Error('revoke scope absent');f.dayflow.service.revokeAuthenticatedSourceConsent(consent.scope);}
          else if(caseName==='dayflow-foreign'){this.rotatePrimary(null);getDb().prepare('UPDATE agent_sessions SET owner_user_id=NULL WHERE id=?').run(f.sessionId);}
          else if(caseName==='dayflow-history'){const candidate=retained[0].candidates[0];const key=candidate.canonicalSourceKey;const {vaultKeyToMemoryDirRelative}=await import('./memoryVaultSyncService');const path=join(f.dayflow.memoryRoot,vaultKeyToMemoryDirRelative(f.dayflow.memoryRoot,key));writeFileSync(path,readFileSync(path,'utf8')+'\nInvented changed canonical bytes.\n');}
          else throw new Error('unsupported Dayflow case');
          const errors=await this.frontdoor(f),after=qualificationDispatchSnapshot(f.sdkSessionId),held=errors.length>0 && after.sdk===positive.sdk && after.provider===positive.provider;
          const observed={admission:held?'held':'allowed',contextInjected:false,reason:errors[0]??'no refusal observed'};
          if(caseName==='dayflow-history'){checks.push({id:'changed-history',pass:held,observed});const clean=await this.create('dayflow');const cleanPositive=await this.positive(clean,Math.max(1,caseDeadline-Date.now()-500));const cleanRecords=new DayflowReceivingContextRepository(getDb());if(!cleanRecords.listSdkHistory(clean.sdkSessionId)?.length || !(await clean.dayflow!.guard.revalidateBeforeSdk(clean.sdkSessionId)))throw new Error('clean retained unsafe baseline unavailable');cleanRecords.markSdkUnsafe(clean.sdkSessionId,'dayflow_binding_ambiguous');const unsafe=await this.frontdoor(clean),unsafeAfter=qualificationDispatchSnapshot(clean.sdkSessionId);checks.push({id:'unsafe-history',pass:unsafe.length>0 && unsafeAfter.sdk===cleanPositive.sdk && unsafeAfter.provider===cleanPositive.provider,observed:{admission:unsafe.length?'held':'allowed',contextInjected:false,reason:unsafe[0]??'no unsafe refusal',independentSessionId:clean.sessionId,independentSdkSessionId:clean.sdkSessionId,dispatch:{sdkBefore:cleanPositive.sdk,sdkAfter:unsafeAfter.sdk,providerBefore:cleanPositive.provider,providerAfter:unsafeAfter.provider}}});}
          else checks.push({id:caseName==='dayflow-revoked'?'revoked':'foreign',pass:held,observed});
          // Receipt baseline begins after the genuine retained exposure was established.
          before.sdk=positive.sdk;before.provider=positive.provider;
        }
      }
    }else if(f.router){
      const repo=new AgentSessionsRepository(),projection=()=>{const row=repo.findById(f.sessionId)!;return {accountId:row.openaiAccountId,model:row.modelId,effort:row.routerVariant};};
      if(caseName==='router-corrupt'){const errors=await this.frontdoor(f);checks.push({id:'corrupt',pass:errors.some(x=>x.includes('Routing state is unavailable')),observed:{admission:errors.length?'refused':'allowed',state:errors.some(x=>x.includes('Routing state is unavailable'))?'corrupt':'unknown'}});}
      else{
        await this.frontdoor(f);const initial=projection();if(initial.accountId!=='fixture-account-a')throw new Error('actual first router policy did not select fixture account A');
        if(caseName==='router-exhausted-pinned'){repo.setOpenaiAccountSource(f.sessionId,'pinned');repo.updateFields(f.sessionId,{modelMode:'fixed',routerVariant:initial.effort});}
        else if(caseName==='router-exhausted-null')getDb().prepare('UPDATE agent_sessions SET openai_account_source=NULL WHERE id=?').run(f.sessionId);
        else if(caseName!=='router-exhausted-auto')throw new Error('unsupported router case');
        f.router.exhaustion.markExhausted('openai',initial.accountId,Date.now()+3600000);await this.frontdoor(f);const after=projection(),unknown=caseName==='router-exhausted-null',pinned=caseName==='router-exhausted-pinned';
        checks.push({id:unknown?'unknown':pinned?'pinned':'automatic',pass:unknown||pinned?JSON.stringify(initial)===JSON.stringify(after):after.accountId==='fixture-account-b',observed:{mode:unknown?null:pinned?'fixed':'automatic',before:initial,after,persisted:projection(),exhaustedAccountId:initial.accountId}});
        limits.push('Invented inventory/quota tested through production router; intentional pre-SDK stop prevents synthetic credentials reaching any provider. No real provider rollover quality claim.');
      }
    }else if(f.mode==='coordinator-delivery' && caseName==='coordinator-delivery'){
      const actor={ownerUserId:this.m.ownerUserId,projectId:f.projectId},state=readDeliveryTestState(f.sessionId,actor);
      if(state.receipt?.kind!=='coding_result_v1' || state.receipt.execution!=='completed' || state.receipt.verification!=='passed' || !state.hold?.held || state.resultMessageId)throw new Error('genuine verified held receipt required');
      const recovered=typeof state.receipt.producedApiBootId==='string' && state.receipt.producedApiBootId!==qualificationApiBootId;
      if(!recovered)throw new Error('actual completed-before-delivery runtime recovery required');
      const children=getDb().prepare(`SELECT child_session_id,coding_delivery_mode FROM agent_async_delegations WHERE coding_root_session_id=? AND coding_operation_key=?`).all(f.sessionId,state.scope.operationKey) as Array<{child_session_id:string;coding_delivery_mode:string}>;
      const workerCount=children.filter(x=>x.coding_delivery_mode==='coding_worker_v1').length;
      if(workerCount!==1 || children.filter(x=>x.coding_delivery_mode==='coding_root_v1').length!==1)throw new Error('sole coding chain required');
      releaseDeliveryHold(f.sessionId,actor);await asyncDelegationCompletionService.onParentIdle(f.sessionId);
      const first=readDeliveryTestState(f.sessionId,actor).resultMessageId;if(!first)throw new Error('actual canonical delivery missing');
      const duplicateResultMessageIds:number[]=[];
      for(const child of children){await asyncDelegationCompletionService.onChildIdle(child.child_session_id);await asyncDelegationCompletionService.onParentIdle(f.sessionId);duplicateResultMessageIds.push(readDeliveryTestState(f.sessionId,actor).resultMessageId as number);}
      const messages=getDb().prepare("SELECT COUNT(*) n FROM agent_session_messages WHERE session_id=? AND json_valid(info_json) AND json_extract(info_json,'$.kind')='work_result' AND json_extract(info_json,'$.operationKey')=?").get(f.sessionId,state.scope.operationKey) as {n:number};
      const callback=getDb().prepare(`SELECT COUNT(*) n FROM coordinator_conversation_commands c JOIN agent_async_delegations a ON a.id=c.delegation_id WHERE c.root_session_id=? AND c.command_key=? AND c.callback_acceptance='accepted' AND c.callback_dispatch_id IS NOT NULL AND json_valid(a.coding_terminal_json) AND json_extract(a.coding_terminal_json,'$.kind')='coding_terminal_v1' AND json_extract(a.coding_terminal_json,'$.sdkUserMessageId')=c.callback_sdk_user_message_id AND json_extract(a.coding_terminal_json,'$.execution')='completed'`).get(f.sessionId,state.scope.operationKey) as {n:number};
      await new Promise(r=>setTimeout(r,300));
      const quiet=snapshot(),noDispatch=quiet.sdk===before.sdk && quiet.provider===before.provider;
      checks.push({id:'delivery',pass:noDispatch && messages.n===1 && workerCount===1 && callback.n===1 && duplicateResultMessageIds.every(x=>x===first),observed:{workerCount,resultCount:messages.n,modelWakeCount:callback.n,rootSessionId:f.sessionId,originalSessionId:f.sessionId,durableResultMessageId:first,duplicateResultMessageIds:[...new Set(duplicateResultMessageIds)],rawReplayResultMessageIds:duplicateResultMessageIds,recovered,noNewSdkOrProviderDispatch:noDispatch}});
      limits.push('Completed-before-delivery proof requires a real prior API boot; supported whole-runtime restart may also change engine boot. API-only engine preservation NOTRUN.', 'Duplicate delivery dispatch observations include 300ms bounded quiescence; root independently enumerates native callback anchors/children.', 'Dispatch counters monitor these existing root/manager/worker SDKs from case baseline: '+JSON.stringify(f.monitoredSdkIds));
    }else throw new Error('unsupported fixture case');
    const after=snapshot();
    return {caseName,bindings:this.bindings(f),checks,dispatch:{sdkBefore:before.sdk,sdkAfter:after.sdk,providerBefore:before.provider,providerAfter:after.provider},limits};
  }
}
