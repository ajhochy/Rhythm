/** Sol-owned verification only: frozen reconstruction, no production edits. */
import Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { agentMemoryService } from '../services/agentMemoryService';
import { isGenericMemoryAdmissionAllowed } from '../services/automatic_memory_preface';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import { DayflowReceivingContextRepository } from '../repositories/dayflow_receiving_context_repository';
import { OpencodeClientService } from '../services/opencode_client_service';
let db: Database.Database;
let previous: ReturnType<typeof setDb>;
const repo = new AgentMemoryRepository();
beforeEach(() => {db=new Database(':memory:');runMigrations(db);db.pragma('foreign_keys=OFF');previous=setDb(db);});
afterEach(() => {setDb(previous);db.close();vi.unstubAllGlobals();});
async function put(id:string, updatedAt:string,tagsJson:string) {
 return repo.upsertBySourceAsync({kind:'context',content:`shortlistterm ${id}`,source:'ordinary',sourceId:id,tagsJson,ownerUserId:7,createdAt:updatedAt,updatedAt});
}
describe('SOL decoded admission must decide membership before visible page/count/shortlist',()=>{
 it('escaped Dayflow metadata cannot consume the visible slot or inflate count',async()=>{
  await put('escaped-hidden','2026-10-06T10:00:00Z','["d\\u0061yflow"]');await put('plain','2026-10-06T09:00:00Z','[]');
  const raw=await repo.listAsync(7,undefined,50);
  expect(isGenericMemoryAdmissionAllowed(raw.find(x=>x.sourceId==='escaped-hidden')!)).toBe(false);
  expect({ids:(await agentMemoryService.list(7,undefined,1)).map(x=>x.sourceId),count:await agentMemoryService.countByKind(7)}).toEqual({ids:['plain'],count:{context:1}});
 });
 it('keys ignored by JS policy must not hide admitted ordinary rows',async()=>{
  await put('key-only','2026-10-06T10:00:00Z','{"dayflow":"ordinary"}');
  const raw=await repo.listAsync(7,undefined,50);expect(isGenericMemoryAdmissionAllowed(raw[0])).toBe(true);
  expect({ids:(await agentMemoryService.list(7,undefined,1)).map(x=>x.sourceId),count:await agentMemoryService.countByKind(7)}).toEqual({ids:['key-only'],count:{context:1}});
 });
 it('escaped withheld metadata must not starve actual service search shortlist',async()=>{
  await put('escaped-hidden','2026-10-06T10:00:00Z','["d\\u0061yflow"]');
  db.prepare("UPDATE agent_memory SET content='shortlistterm shortlistterm shortlistterm' WHERE source_id='escaped-hidden'").run();
  await put('plain','2026-10-06T09:00:00Z','[]');
  expect((await agentMemoryService.search('shortlistterm',7,1)).map(x=>x.sourceId)).toEqual(['plain']);
 });
});
describe('SOL actual callback SDK boundary retains honest origin but lacks Dayflow identity',()=>{
 const local='sol-root',sdk='ses_sol_root',cwd='/safe/sol';
 function root(){db.prepare(`INSERT INTO agent_sessions(id,sdk_session_id,agent_kind,cwd,name,owner_user_id,project_id,category,is_system)
 VALUES (?,?,'librarian',?,'Sol fixture',7,'project-sol','chat',0)`).run(local,sdk,cwd);}
 function service(){
  const promptAsync=vi.fn(async (_input:any)=>({response:{status:204}}));const svc=new OpencodeClientService();
  (svc as any).client={session:{promptAsync}};(svc as any).status='ready';(svc as any).server={url:'http://engine.test',close(){}};
  const shouldBind=vi.fn(async()=>true);svc.setDayflowSdkHistoryGuard({shouldBindPrompt:shouldBind,revalidateBeforeSdk:async()=>true});
  return{svc,promptAsync,shouldBind};
 }
 function provenance(routeAuthed:boolean|null,origin:string){return{sessionId:local,sdkSessionId:sdk,origin,routeAuthed,requestedSource:origin==='delegation_completion'?'agent_config':'session',reasonCode:origin==='delegation_completion'?'c2_goal_callback:dg-sol':'foreground_test'} as any;}
 it('reproduces callback request without minted anchor or resolvable receiving turn',async()=>{
  root();const{svc,promptAsync,shouldBind}=service();const fetcher=vi.fn(async()=>({ok:true,json:async()=>({messageID:'msg_sol_real_anchor'})}));vi.stubGlobal('fetch',fetcher);
  expect(await svc.promptAsync(sdk,'Synthetic completion status',undefined,cwd,{system:'Synthetic status-only contract'},undefined,undefined,provenance(null,'delegation_completion'))).toBe(true);
  expect(promptAsync).toHaveBeenCalledOnce();expect(promptAsync.mock.calls[0][0].body.messageID).toBeUndefined();expect(fetcher).not.toHaveBeenCalled();expect(shouldBind).not.toHaveBeenCalled();
  expect(new ModelProvenanceRepository().list(local)).toEqual([expect.objectContaining({origin:'delegation_completion',routeAuthed:null,sdkUserMessageId:null,outcome:'accepted'})]);
  expect(new DayflowReceivingContextRepository(db).findByActiveTool({ownerUserId:7,sdkSessionId:sdk,sdkTurnId:'msg_assistant_sol',sdkUserMessageId:'msg_sol_real_anchor'})).toBeNull();
 });
 it('positive actual foreground request mints exactly one engine identity',async()=>{
  root();const{svc,promptAsync,shouldBind}=service();const fetcher=vi.fn(async()=>({ok:true,json:async()=>({messageID:'msg_sol_real_anchor'})}));vi.stubGlobal('fetch',fetcher);
  const old=process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS='1';
  try{
   expect(await svc.promptAsync(sdk,'Synthetic foreground',undefined,cwd,undefined,undefined,undefined,provenance(true,'prompt_api'))).toBe(true);
   expect(shouldBind).toHaveBeenCalledWith(sdk);expect(fetcher).toHaveBeenCalledOnce();expect(promptAsync.mock.calls[0][0].body.messageID).toBe('msg_sol_real_anchor');
   expect(new ModelProvenanceRepository().list(local)).toEqual([expect.objectContaining({origin:'prompt_api',routeAuthed:true,sdkUserMessageId:'msg_sol_real_anchor',outcome:'accepted'})]);
   expect(new DayflowReceivingContextRepository(db).findByActiveTool({ownerUserId:7,sdkSessionId:sdk,sdkTurnId:'msg_assistant_sol',sdkUserMessageId:'msg_sol_real_anchor'})).not.toBeNull();
  }finally{if(old===undefined)delete process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;else process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS=old;}
 });
});
