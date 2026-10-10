import Database from 'better-sqlite3';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { codingTerms,approvalFor } from './helpers/coding_terms';
const boundary=vi.hoisted(()=>({abort:vi.fn(async(_sdk:string,_cwd:string)=>true),directory:'',busy:true,statusUnavailable:false}));
vi.mock('../services/opencode_engine',()=>({opencodeSessionMap:new Map(),opencodeClient:{
  getSessionStatuses:async()=>{if(boundary.statusUnavailable)throw Error('UNIT offline');return boundary.busy?{ses_manager_unit:{type:'busy'},ses_worker_unit:{type:'busy'}}:{};},
  abortSession:boundary.abort,getSession:async(id:string)=>({id,directory:boundary.directory}),
  promptAsync:()=>{throw Error('UNIT deadline must never infer');},
}}));
import { AsyncDelegationCompletionService } from '../services/async_delegation_completion_service';
let db:Database.Database;
const at='2026-10-09T12:00:00.000Z';
beforeEach(()=>{
  db=new Database(':memory:');runMigrations(db);setDb(db);boundary.abort.mockReset();boundary.abort.mockResolvedValue(true);boundary.busy=true;boundary.statusUnavailable=false;
  const p=codingTerms(),approval=approvalFor(p);boundary.directory=p.workspace.canonicalRoot;
  db.prepare("INSERT INTO users(id,name,email) VALUES(7,'UNIT','unit-deadline@example.invalid')").run();
  db.prepare("INSERT INTO projects(id,name,cwd,created_at) VALUES('project-unit','UNIT',?,?)").run(p.workspace.canonicalRoot,at);
  for(const [id,parent,sdk] of [['root-unit',null,'ses_root_unit'],['manager-unit','root-unit','ses_manager_unit'],['worker-unit','manager-unit','ses_worker_unit']])db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,sdk_session_id,parent_session_id,category,owner_user_id,project_id)
    VALUES(?,?,'librarian','working',?,?,?,'chat',7,'project-unit')`).run(id,'UNIT',p.workspace.canonicalRoot,sdk,parent);
  // UNIT persisted terms; no signer, actual approval, runtime or model qualification.
  db.prepare(`INSERT INTO agent_approvals(id,session_id,agent_config_id,action,status,security_action,payload_digest,bound_payload_json,bound_agent,expires_at,created_at)
    VALUES(?,?,?,'UNIT','pending',?,?,?,?,?,?)`).run(approval.id,p.sessionId,p.profileId,approval.securityAction,approval.payloadDigest,approval.boundPayloadJson,p.profileId,p.expiresAt,p.proposedAt);
  const state={schemaVersion:1,approvalId:approval.id,proposalDigest:approval.payloadDigest,manager:{localId:'manager-unit',sdkId:'ses_manager_unit'},worker:{localId:'worker-unit',sdkId:'ses_worker_unit'},taskStartedAt:at,workerStartedAt:at,workerReservedAt:at,revokedAt:null};
  db.prepare(`INSERT INTO coordinator_conversation_commands(root_session_id,command_key,owner_user_id,project_id,kind,intent_hash,replay_json,created_at,updated_at,journal_ordinal,goal_id,role,coding_grant_json,allocation_intent_at)
    VALUES('root-unit','operation-unit',7,'project-unit','delegate_goal',?,'{}',?,?,1,'goal-unit','manager',?,?)`).run('b'.repeat(64),at,at,JSON.stringify(state),at);
  for(const [id,parent,child,mode] of [['manager-op','root-unit','manager-unit','coding_root_v1'],['worker-op','manager-unit','worker-unit','coding_worker_v1']])db.prepare(`INSERT INTO agent_async_delegations(id,parent_session_id,child_session_id,target_agent_config_id,status,created_at,updated_at,coding_delivery_mode,coding_root_session_id,coding_operation_key)
    VALUES(?,?,?,'librarian','dispatched',?,?,?,'root-unit','operation-unit')`).run(id,parent,child,at,at,mode);
});
afterEach(()=>db.close());
it('restored worker deadline durably revokes/cancels exact children once without inference',async()=>{
  const now=Date.parse(at)+300001;
  await new AsyncDelegationCompletionService().enforceCodingDeadlines(now);
  expect((db.prepare("SELECT status FROM agent_async_delegations WHERE id='worker-op'").get() as any).status).toBe('cancelled');
  expect(JSON.parse((db.prepare('SELECT coding_grant_json FROM coordinator_conversation_commands').get() as any).coding_grant_json).revokedAt).toBe(new Date(now).toISOString());
  expect(boundary.abort.mock.calls.map(x=>x[0]).sort()).toEqual(['ses_manager_unit','ses_worker_unit']);
  boundary.busy=false;
  await new AsyncDelegationCompletionService().enforceCodingDeadlines(now+10000);
  expect(boundary.abort).toHaveBeenCalledTimes(2);
});
it('completed worker clock does not expire its still-authorized manager completion before task deadline',async()=>{
  db.prepare("UPDATE agent_async_delegations SET status='notified',coding_terminal_json='{}' WHERE id='worker-op'").run();
  await new AsyncDelegationCompletionService().enforceCodingDeadlines(Date.parse(at)+300001);
  expect(boundary.abort).not.toHaveBeenCalled();
  await new AsyncDelegationCompletionService().enforceCodingDeadlines(Date.parse(at)+600001);
  expect(boundary.abort).toHaveBeenCalledTimes(1);
});
it('native directory mismatch refuses abort of a substituted SDK session',async()=>{
  boundary.directory='/private/tmp/unrelated-unit';
  await new AsyncDelegationCompletionService().enforceCodingDeadlines(Date.parse(at)+300001);
  expect(boundary.abort).not.toHaveBeenCalled();
  expect((db.prepare("SELECT status FROM agent_async_delegations WHERE id='manager-op'").get() as any).status).toBe('cancelled');
});

it('false abort stays durably pending and retries after revocation until actual idle',async()=>{
  boundary.abort.mockResolvedValue(false);
  const service=new AsyncDelegationCompletionService(),now=Date.parse(at)+300001;
  await service.enforceCodingDeadlines(now);
  const pending=()=>db.prepare("SELECT error_text FROM agent_async_delegations WHERE id='worker-op'").get() as {error_text:string};
  expect(pending().error_text).toContain('stop pending');
  await service.enforceCodingDeadlines(now+10000);
  expect(boundary.abort).toHaveBeenCalledTimes(4);
  boundary.busy=false;
  await service.enforceCodingDeadlines(now+20000);
  expect(pending().error_text).toContain('observed idle');
  await service.enforceCodingDeadlines(now+30000);
  expect(boundary.abort).toHaveBeenCalledTimes(4);
});
it('unavailable native status cannot be mistaken for idle and restart watchdog retries',async()=>{
  boundary.statusUnavailable=true;
  const now=Date.parse(at)+300001;
  await new AsyncDelegationCompletionService().enforceCodingDeadlines(now);
  expect(boundary.abort).not.toHaveBeenCalled();
  expect((db.prepare("SELECT error_text FROM agent_async_delegations WHERE id='worker-op'").get() as any).error_text).toContain('unqualified');
  boundary.statusUnavailable=false;
  await new AsyncDelegationCompletionService().enforceCodingDeadlines(now+10000);
  expect(boundary.abort).toHaveBeenCalledTimes(2);
});

it('every exact child stop marker is committed before the first native await',async()=>{
  boundary.abort.mockImplementation(async()=>{
    const rows=db.prepare("SELECT status,error_text FROM agent_async_delegations").all() as Array<{status:string;error_text:string}>;
    expect(rows.every(row=>row.status==='cancelled' && row.error_text.startsWith('Coding deadline: stop pending'))).toBe(true);
    expect(JSON.parse((db.prepare('SELECT coding_grant_json FROM coordinator_conversation_commands').get() as any).coding_grant_json).revokedAt).not.toBeNull();
    return false;
  });
  await new AsyncDelegationCompletionService().enforceCodingDeadlines(Date.parse(at)+300001);
  expect(boundary.abort).toHaveBeenCalledTimes(2);
});
it('failed second child marker rolls back revocation and both cancellations atomically',async()=>{
  db.exec("CREATE TRIGGER refuse_second_deadline BEFORE UPDATE OF error_text ON agent_async_delegations WHEN NEW.id='worker-op' BEGIN SELECT RAISE(ABORT,'UNIT marker failure'); END");
  await expect(new AsyncDelegationCompletionService().enforceCodingDeadlines(Date.parse(at)+300001)).rejects.toThrow('UNIT marker failure');
  expect(JSON.parse((db.prepare('SELECT coding_grant_json FROM coordinator_conversation_commands').get() as any).coding_grant_json).revokedAt).toBeNull();
  expect((db.prepare('SELECT status FROM agent_async_delegations').all() as Array<{status:string}>).every(row=>row.status==='dispatched')).toBe(true);
  expect(boundary.abort).not.toHaveBeenCalled();
});
